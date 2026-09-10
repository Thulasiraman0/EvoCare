import enum
from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Enum as SQLEnum, Text, JSON
from sqlalchemy.orm import relationship
from app.core.database import Base, utc_now


class UserRole(str, enum.Enum):
    DOCTOR = "DOCTOR"
    CAREGIVER = "CAREGIVER"
    ADMIN = "ADMIN"
    PATIENT = "PATIENT"


class AccessRole(str, enum.Enum):
    ATTENDING_PHYSICIAN = "ATTENDING_PHYSICIAN"
    CONSULTING_PHYSICIAN = "CONSULTING_PHYSICIAN"
    PRIMARY_CAREGIVER = "PRIMARY_CAREGIVER"
    FAMILY_CAREGIVER = "FAMILY_CAREGIVER"
    ADMINISTRATIVE = "ADMINISTRATIVE"
    SELF = "SELF"  # the patient's own login (Patient Portal)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, index=True, nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=False)
    role = Column(SQLEnum(UserRole), nullable=False, index=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)
    last_login_at = Column(DateTime, nullable=True)

    # Relationships
    patient_grants = relationship("PatientAccess", back_populates="user", cascade="all, delete-orphan", foreign_keys="PatientAccess.user_id")


class PatientAccess(Base):
    __tablename__ = "patient_access_grants"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    patient_code = Column(String(50), nullable=False, index=True)  # e.g. 'P001', 'P002'
    access_role = Column(SQLEnum(AccessRole), default=AccessRole.PRIMARY_CAREGIVER, nullable=False)
    granted_by = Column(String(100), default="SYSTEM_ADMIN", nullable=False)
    granted_at = Column(DateTime, default=utc_now, nullable=False)
    revoked_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    user = relationship("User", back_populates="patient_grants", foreign_keys=[user_id])


class SecurityEvent(Base):
    __tablename__ = "security_events"

    id = Column(Integer, primary_key=True, index=True)
    event_type = Column(String(100), nullable=False, index=True)  # e.g. FAILED_LOGIN, UNAUTHORIZED_PATIENT_ACCESS, PROMPT_INJECTION_ATTEMPT
    user_id = Column(Integer, nullable=True, index=True)
    username = Column(String(100), nullable=True, index=True)
    timestamp = Column(DateTime, default=utc_now, nullable=False, index=True)
    ip_address = Column(String(50), nullable=True)
    details = Column(Text, nullable=False)
    severity = Column(String(20), default="MEDIUM", nullable=False)  # LOW, MEDIUM, HIGH, CRITICAL
    metadata_json = Column(JSON, nullable=True)
