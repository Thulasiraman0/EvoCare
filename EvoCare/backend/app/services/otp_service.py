"""
OTP (One-Time Password) service implementing the second authentication step.

Flow
----
  Step 1: POST /api/auth/login        (User ID + password)   -> OTP challenge
  Step 2: POST /api/auth/otp/verify   (challenge_id + code)  -> JWT access/refresh tokens
          POST /api/auth/otp/resend   (challenge_id)         -> fresh challenge (old one invalidated)

Security properties
-------------------
- Codes are cryptographically random 6-digit numbers (`secrets` module).
- Only a salted SHA-256 hash of the code is persisted (salt = challenge_id + app secret).
- Challenges expire (default 5 min) and lock after a configurable number of attempts.
- Resending invalidates every previous active challenge for that user.
- Every transition is written to the immutable audit / security-event trail.
"""
import hashlib
import logging
import secrets
import uuid
from datetime import timedelta
from typing import Optional, Tuple

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import utc_now
from app.models.otp import OTPChallenge, OTPChannel, OTPPurpose
from app.models.security import User
from app.services.audit_service import AuditService

logger = logging.getLogger(__name__)


class OTPService:
    # ------------------------------------------------------------------ helpers

    @staticmethod
    def _hash_code(code: str, challenge_id: str) -> str:
        """Salted hash — the plaintext OTP is never stored."""
        salted = f"{challenge_id}:{code.strip()}:{settings.JWT_SECRET_KEY}"
        return hashlib.sha256(salted.encode("utf-8")).hexdigest()

    @staticmethod
    def _generate_code(length: int) -> str:
        return "".join(str(secrets.randbelow(10)) for _ in range(length))

    @staticmethod
    def _mask_destination(user: User) -> str:
        """Mask the delivery destination for UI display, e.g. 'd*****o@evocare.health'."""
        email = (user.email or "").strip()
        local, _, domain = email.partition("@")
        if not local:
            return "your registered destination"
        if len(local) <= 2:
            masked_local = local[0] + "*"
        else:
            masked_local = f"{local[0]}{'*' * (len(local) - 2)}{local[-1]}"
        return f"{masked_local}@{domain}" if domain else masked_local

    @staticmethod
    def _deliver(channel: str, destination: str, code: str) -> None:
        """
        Delivery hook. In production, plug an email/SMS provider here
        (SES / SNS / Twilio / SendGrid ...). In this demo the code is logged
        and (when DEMO_MODE is on) returned to the client for convenience.
        """
        logger.info("[OTP] channel=%s to=%s code=%s", channel, destination, code)

    @staticmethod
    def _role_str(user: User) -> str:
        return user.role.value if hasattr(user.role, "value") else str(user.role)

    @classmethod
    def _challenge_response(cls, challenge: OTPChallenge, code: Optional[str]) -> dict:
        return {
            "otp_required": True,
            "challenge_id": challenge.challenge_id,
            "channel": challenge.channel.value if hasattr(challenge.channel, "value") else str(challenge.channel),
            "masked_destination": challenge.destination_masked,
            "expires_in_seconds": settings.OTP_EXPIRE_SECONDS,
            "max_attempts": challenge.max_attempts,
            # Surface the plaintext code ONLY in DEMO_MODE so the demo works
            # without a mail/SMS provider. Never enabled in production.
            "demo_code": code if settings.DEMO_MODE else None,
        }

    # ----------------------------------------------------------------- API

    @classmethod
    def create_challenge(
        cls,
        db: Session,
        user: User,
        ip_address: Optional[str] = None,
        channel: OTPChannel = OTPChannel.EMAIL,
    ) -> Tuple[OTPChallenge, str]:
        """Invalidate prior active challenges, then create + dispatch a fresh one."""
        db.query(OTPChallenge).filter(
            OTPChallenge.user_id == user.id,
            OTPChallenge.is_active == True,  # noqa: E712
            OTPChallenge.consumed_at.is_(None),
        ).update({"is_active": False}, synchronize_session="fetch")

        code = cls._generate_code(settings.OTP_LENGTH)
        challenge = OTPChallenge(
            challenge_id=uuid.uuid4().hex,
            user_id=user.id,
            purpose=OTPPurpose.LOGIN,
            channel=channel,
            destination_masked=cls._mask_destination(user),
            code_hash="",
            max_attempts=settings.OTP_MAX_ATTEMPTS,
            expires_at=utc_now() + timedelta(seconds=settings.OTP_EXPIRE_SECONDS),
            ip_address=ip_address,
        )
        challenge.code_hash = cls._hash_code(code, challenge.challenge_id)
        db.add(challenge)
        db.commit()
        db.refresh(challenge)

        cls._deliver(challenge.channel.value, user.email, code)
        AuditService.log_audit_event(
            db=db,
            action="OTP_CHALLENGE_CREATED",
            user_id=user.id,
            username=user.username,
            role=cls._role_str(user),
            result="SUCCESS",
            reason=f"OTP dispatched via {challenge.channel.value} to {challenge.destination_masked}",
            ip_address=ip_address,
        )
        return challenge, code

    @classmethod
    def verify_challenge(
        cls,
        db: Session,
        challenge_id: str,
        code: str,
        ip_address: Optional[str] = None,
    ) -> Tuple[Optional[User], Optional[str]]:
        """Verify a code. Returns (user, None) on success or (None, error_message)."""
        challenge = db.query(OTPChallenge).filter(OTPChallenge.challenge_id == challenge_id).first()

        if not challenge or challenge.consumed_at is not None:
            return None, "Invalid or expired verification session. Please sign in again."

        user = db.query(User).filter(User.id == challenge.user_id).first()

        if challenge.attempts >= challenge.max_attempts:
            # Locked out: no further attempts, even with the correct code.
            challenge.is_active = False
            db.commit()
            AuditService.log_security_event(
                db=db,
                event_type="OTP_MAX_ATTEMPTS_EXCEEDED",
                user_id=challenge.user_id,
                username=user.username if user else None,
                details=f"Max OTP attempts exceeded from {ip_address}",
                severity="HIGH",
                ip_address=ip_address,
            )
            return None, "Too many incorrect attempts. Please request a new code."

        if not challenge.is_active:
            return None, "Invalid or expired verification session. Please sign in again."

        if utc_now() > challenge.expires_at:
            challenge.is_active = False
            db.commit()
            AuditService.log_security_event(
                db=db,
                event_type="OTP_EXPIRED",
                user_id=challenge.user_id,
                username=user.username if user else None,
                details=f"Expired OTP challenge presented from {ip_address}",
                severity="LOW",
                ip_address=ip_address,
            )
            return None, "This verification code has expired. Please request a new one."

        challenge.attempts += 1
        if not secrets.compare_digest(
            cls._hash_code(code, challenge.challenge_id), challenge.code_hash or ""
        ):
            db.commit()
            remaining = challenge.max_attempts - challenge.attempts
            AuditService.log_security_event(
                db=db,
                event_type="OTP_VERIFICATION_FAILED",
                user_id=challenge.user_id,
                username=user.username if user else None,
                details=f"Incorrect OTP code from {ip_address} ({remaining} attempts left)",
                severity="MEDIUM",
                ip_address=ip_address,
            )
            if remaining <= 0:
                challenge.is_active = False
                db.commit()
                return None, "Too many incorrect attempts. Please request a new code."
            return None, f"Incorrect verification code. {remaining} attempt(s) remaining."

        # ---- Success: consume the challenge
        challenge.consumed_at = utc_now()
        challenge.is_active = False
        db.commit()

        if not user or not user.is_active:
            return None, "User account is no longer active."

        AuditService.log_audit_event(
            db=db,
            action="OTP_VERIFIED",
            user_id=user.id,
            username=user.username,
            role=cls._role_str(user),
            result="SUCCESS",
            reason="Second authentication factor verified",
            ip_address=ip_address,
        )
        return user, None

    @classmethod
    def resend_challenge(
        cls,
        db: Session,
        challenge_id: str,
        ip_address: Optional[str] = None,
    ) -> Tuple[Optional[OTPChallenge], Optional[str], Optional[str]]:
        """Re-issue a code for an existing session. Returns (challenge, code, error)."""
        challenge = db.query(OTPChallenge).filter(OTPChallenge.challenge_id == challenge_id).first()
        if not challenge or not challenge.is_active or challenge.consumed_at is not None:
            return None, None, "Unknown or already-used verification session. Please sign in again."

        elapsed = (utc_now() - challenge.created_at).total_seconds()
        if elapsed < settings.OTP_RESEND_COOLDOWN_SECONDS:
            wait = int(settings.OTP_RESEND_COOLDOWN_SECONDS - elapsed) + 1
            return None, None, f"Please wait {wait}s before requesting a new code."

        user = db.query(User).filter(User.id == challenge.user_id).first()
        if not user or not user.is_active:
            return None, None, "User account is no longer active."

        new_challenge, code = cls.create_challenge(db, user, ip_address=ip_address)
        return new_challenge, code, None
