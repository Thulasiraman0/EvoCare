import enum
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import relationship

from app.core.database import Base, utc_now


class OTPChannel(str, enum.Enum):
    """Delivery channel used to transmit the one-time code."""
    EMAIL = "EMAIL"
    SMS = "SMS"


class OTPPurpose(str, enum.Enum):
    """Purpose of an OTP challenge (extensible: LOGIN, TXN_SIGN, ...)."""
    LOGIN = "LOGIN"


class OTPChallenge(Base):
    """
    A single two-step-authentication challenge.

    Lifecycle: CREATED (active) -> VERIFIED (consumed) | EXPIRED | LOCKED (max attempts)
    Only a salted SHA-256 hash of the code is ever persisted; the plaintext code
    exists solely in the delivery channel (email/SMS) and, in DEMO_MODE, in the
    API response so the demo runs without a mail provider.
    """
    __tablename__ = "otp_challenges"

    id = Column(Integer, primary_key=True, index=True)
    challenge_id = Column(String(64), unique=True, index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    purpose = Column(SQLEnum(OTPPurpose), default=OTPPurpose.LOGIN, nullable=False)
    channel = Column(SQLEnum(OTPChannel), default=OTPChannel.EMAIL, nullable=False)
    destination_masked = Column(String(255), nullable=False)
    code_hash = Column(String(128), nullable=False)
    attempts = Column(Integer, default=0, nullable=False)
    max_attempts = Column(Integer, default=5, nullable=False)
    expires_at = Column(DateTime, nullable=False, index=True)
    consumed_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False, index=True)
    ip_address = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)

    user = relationship("User")
