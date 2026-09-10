import logging
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.config import settings
from app.core.security import (
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
    revoke_token,
    check_login_rate_limit,
    record_failed_login,
    reset_failed_logins,
)
from app.models.security import User, UserRole, PatientAccess
from app.models.patient import Patient
from app.services.audit_service import AuditService
from app.core.dependencies import get_current_user
from app.services.otp_service import OTPService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Authentication & Security"])


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=3)
    password: str = Field(..., min_length=6)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: Dict[str, Any]


class RefreshRequest(BaseModel):
    refresh_token: str


class OTPChallengeResponse(BaseModel):
    """Step-1 response: credentials accepted, OTP dispatched to the user's destination."""
    otp_required: bool = True
    challenge_id: str
    channel: str
    masked_destination: str
    expires_in_seconds: int
    max_attempts: int
    # Populated ONLY in DEMO_MODE so the demo runs without an email/SMS provider.
    demo_code: Optional[str] = None


class OTPVerifyRequest(BaseModel):
    challenge_id: str = Field(..., min_length=8)
    code: str = Field(..., min_length=4, max_length=10, description="The one-time code from email/SMS")


class OTPResendRequest(BaseModel):
    challenge_id: str = Field(..., min_length=8)


class AuthorizedPatientItem(BaseModel):
    patient_code: str
    name: str
    age: int
    sex: str
    access_role: str


def _issue_token_response(user: User) -> TokenResponse:
    """Create access/refresh tokens for a fully authenticated user."""
    role_str = user.role.value if hasattr(user.role, "value") else str(user.role)
    token_payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": role_str,
        "full_name": user.full_name
    }
    access_token = create_access_token(token_payload)
    refresh_token = create_refresh_token(token_payload)
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=1800,  # 30 mins
        user={
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "full_name": user.full_name,
            "role": role_str,
        },
    )


@router.post("/login")
def login(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    """
    Step 1 of authentication: verify User ID + password.

    - When OTP is enabled (default): does NOT issue tokens. Returns an OTP
      challenge; the client must complete POST /api/auth/otp/verify to get tokens.
    - When OTP_ENABLED=false: legacy behavior — issues tokens directly.
    """
    ip = request.client.host if request.client else "unknown"

    # 1. Rate Limit Check
    if not check_login_rate_limit(req.username) or not check_login_rate_limit(ip):
        AuditService.log_security_event(
            db=db,
            event_type="LOGIN_RATE_LIMITED",
            username=req.username,
            details=f"Repeated failed login attempts for {req.username} from {ip}",
            severity="HIGH",
            ip_address=ip
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed login attempts. Please wait 5 minutes before trying again."
        )

    # 2. Query User
    user = db.query(User).filter(User.username == req.username).first()
    if not user or not verify_password(req.password, user.password_hash):
        record_failed_login(req.username)
        record_failed_login(ip)
        AuditService.log_audit_event(
            db=db,
            action="LOGIN_FAILURE",
            username=req.username,
            result="DENIED",
            reason="Invalid credentials",
            ip_address=ip
        )
        AuditService.log_security_event(
            db=db,
            event_type="FAILED_LOGIN",
            username=req.username,
            details=f"Failed authentication attempt for {req.username}",
            severity="MEDIUM",
            ip_address=ip
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
            headers={"WWW-Authenticate": "Bearer"}
        )

    if not user.is_active:
        AuditService.log_audit_event(
            db=db,
            action="LOGIN_FAILURE",
            user_id=user.id,
            username=user.username,
            role=user.role.value if hasattr(user.role, 'value') else str(user.role),
            result="DENIED",
            reason="Account deactivated",
            ip_address=ip
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is deactivated. Please contact an administrator."
        )

    # 3. Successful Credential Authentication
    reset_failed_logins(req.username)
    reset_failed_logins(ip)
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()

    role_str = user.role.value if hasattr(user.role, 'value') else str(user.role)

    # 4. Two-step authentication: dispatch OTP challenge before issuing tokens
    if settings.OTP_ENABLED:
        challenge, demo_code = OTPService.create_challenge(db=db, user=user, ip_address=ip)
        AuditService.log_audit_event(
            db=db,
            action="LOGIN_STEP1_SUCCESS",
            user_id=user.id,
            username=user.username,
            role=role_str,
            result="SUCCESS",
            reason="Credentials verified; OTP challenge issued (step 2 pending)",
            ip_address=ip
        )
        return OTPChallengeResponse(
            challenge_id=challenge.challenge_id,
            channel=challenge.channel.value if hasattr(challenge.channel, "value") else str(challenge.channel),
            masked_destination=challenge.destination_masked,
            expires_in_seconds=settings.OTP_EXPIRE_SECONDS,
            max_attempts=challenge.max_attempts,
            demo_code=demo_code if settings.DEMO_MODE else None,
        )

    # Legacy path (OTP disabled): issue tokens directly
    token_response = _issue_token_response(user)
    AuditService.log_audit_event(
        db=db,
        action="LOGIN_SUCCESS",
        user_id=user.id,
        username=user.username,
        role=role_str,
        result="SUCCESS",
        ip_address=ip
    )
    return token_response


@router.post("/otp/verify", response_model=TokenResponse)
def verify_otp(req: OTPVerifyRequest, request: Request, db: Session = Depends(get_db)):
    """
    Step 2 of authentication: verify the one-time code for a challenge.
    On success, issues the same JWT access/refresh token pair as the legacy login.
    """
    ip = request.client.host if request.client else "unknown"

    user, error = OTPService.verify_challenge(db, req.challenge_id, req.code, ip_address=ip)
    if error or not user:
        AuditService.log_audit_event(
            db=db,
            action="OTP_VERIFICATION_FAILURE",
            result="DENIED",
            reason=error or "OTP verification failed",
            ip_address=ip
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=error or "OTP verification failed."
        )

    token_response = _issue_token_response(user)

    role_str = user.role.value if hasattr(user.role, 'value') else str(user.role)
    AuditService.log_audit_event(
        db=db,
        action="LOGIN_SUCCESS",
        user_id=user.id,
        username=user.username,
        role=role_str,
        result="SUCCESS",
        reason="Two-step authentication completed (password + OTP)",
        ip_address=ip
    )
    return token_response


@router.post("/otp/resend", response_model=OTPChallengeResponse)
def resend_otp(req: OTPResendRequest, request: Request, db: Session = Depends(get_db)):
    """Re-issue a fresh one-time code; invalidates any previous code for the session."""
    ip = request.client.host if request.client else "unknown"

    challenge, demo_code, error = OTPService.resend_challenge(db, req.challenge_id, ip_address=ip)
    if error or not challenge:
        is_cooldown = bool(error and "Please wait" in error)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS if is_cooldown else status.HTTP_400_BAD_REQUEST,
            detail=error or "Could not resend the verification code."
        )

    return OTPChallengeResponse(
        challenge_id=challenge.challenge_id,
        channel=challenge.channel.value if hasattr(challenge.channel, "value") else str(challenge.channel),
        masked_destination=challenge.destination_masked,
        expires_in_seconds=settings.OTP_EXPIRE_SECONDS,
        max_attempts=challenge.max_attempts,
        demo_code=demo_code if settings.DEMO_MODE else None,
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh_token_endpoint(req: RefreshRequest, request: Request, db: Session = Depends(get_db)):
    """Generate new access token using valid refresh token."""
    ip = request.client.host if request.client else "unknown"
    try:
        payload = decode_token(req.refresh_token)
    except ValueError as e:
        AuditService.log_security_event(
            db=db,
            event_type="INVALID_REFRESH_TOKEN",
            details=f"Refresh token rejected: {str(e)}",
            severity="HIGH",
            ip_address=ip
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid refresh token: {str(e)}"
        )

    if payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type for refresh endpoint."
        )

    user_id = payload.get("sub")
    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User no longer active or valid."
        )

    # Invalidate old refresh token and issue new pair
    revoke_token(req.refresh_token)

    new_token_response = _issue_token_response(user)

    role_str = user.role.value if hasattr(user.role, 'value') else str(user.role)
    AuditService.log_audit_event(
        db=db,
        action="TOKEN_REFRESH",
        user_id=user.id,
        username=user.username,
        role=role_str,
        result="SUCCESS",
        ip_address=ip
    )

    return new_token_response


@router.post("/logout")
def logout(request: Request, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Revoke user's current token and log event."""
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header[7:]
        revoke_token(token)

    ip = request.client.host if request.client else "unknown"
    role_str = current_user.role.value if hasattr(current_user.role, 'value') else str(current_user.role)
    AuditService.log_audit_event(
        db=db,
        action="LOGOUT",
        user_id=current_user.id,
        username=current_user.username,
        role=role_str,
        result="SUCCESS",
        ip_address=ip
    )
    return {"status": "ok", "message": "Logged out successfully. Token revoked."}


@router.get("/me")
def get_current_user_profile(current_user: User = Depends(get_current_user)):
    """Return current authenticated user profile."""
    role_str = current_user.role.value if hasattr(current_user.role, 'value') else str(current_user.role)
    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "full_name": current_user.full_name,
        "role": role_str,
        "is_active": current_user.is_active,
        "last_login_at": current_user.last_login_at.strftime("%Y-%m-%d %H:%M:%S UTC") if current_user.last_login_at else None
    }


@router.get("/authorized-patients", response_model=List[AuthorizedPatientItem])
def get_authorized_patients(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return only the patients that the current user has explicit authorization to access."""
    grants = db.query(PatientAccess).filter(
        PatientAccess.user_id == current_user.id,
        PatientAccess.is_active == True
    ).all()

    authorized_list = []
    for g in grants:
        p = db.query(Patient).filter(Patient.patient_code == g.patient_code).first()
        if p:
            authorized_list.append(AuthorizedPatientItem(
                patient_code=p.patient_code,
                name=p.name,
                age=p.age,
                sex=p.sex,
                access_role=g.access_role.value if hasattr(g.access_role, 'value') else str(g.access_role)
            ))

    return authorized_list
