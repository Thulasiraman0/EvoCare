import enum
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class DoctorRecordType(str, enum.Enum):
    """Controlled vocabulary for doctor-created clinical records."""
    CONSULTATION = "consultation"
    FOLLOW_UP = "follow_up"
    ASSESSMENT = "assessment"
    HISTORICAL_NOTE = "historical_note"


class DoctorRecordCreate(BaseModel):
    """Payload for the doctor 'Add New Record' action (append-only)."""
    record_type: str = Field(
        ...,
        description="One of: consultation, follow_up, assessment, historical_note",
    )
    content: str = Field(
        ...,
        min_length=10,
        max_length=8000,
        description="Verbatim clinical record content. Becomes an IMMUTABLE evidence record.",
    )
    observed_at: Optional[datetime] = Field(
        None,
        description="When the clinical encounter occurred (defaults to now).",
    )
    doctor_name: Optional[str] = Field(
        None,
        max_length=255,
        description="Optional display name, e.g. 'Dr. Ramesh Varma, MD'.",
    )


class DoctorRecordResponse(BaseModel):
    id: int
    patient_id: int
    evidence_code: str
    record_type: str
    content: str
    doctor_id: str
    doctor_name: Optional[str] = None
    observed_at: datetime
    created_at: datetime
    source_type: str = "DOCTOR"
    status: str = "IMMUTABLE"
