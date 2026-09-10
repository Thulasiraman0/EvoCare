from typing import List

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_doctor, verify_patient_access
from app.models.security import User
from app.schemas.record import DoctorRecordCreate, DoctorRecordResponse
from app.services.audit_service import AuditService
from app.services.doctor_record_service import DoctorRecordService

router = APIRouter(prefix="/records", tags=["Clinical Records (Append-Only)"])


@router.post(
    "/patients/{patient_id}/records",
    response_model=DoctorRecordResponse,
    status_code=201,
    summary="Doctor adds a new clinical record (append-only, becomes immutable evidence)",
)
def create_doctor_record(
    patient_id: str,
    payload: DoctorRecordCreate,
    request: Request,
    current_user: User = Depends(require_doctor),
    db: Session = Depends(get_db),
):
    """
    DOCTOR-only. Requires an active patient access grant.

    Creates a new immutable Evidence record (next free EV-DR-xxx code) plus a
    linked DoctorRecord row. Existing records are never modified — corrections
    must be submitted as new records.
    """
    patient = verify_patient_access(patient_id, current_user, db, request)
    ip = request.client.host if request.client else "unknown"
    return DoctorRecordService.create_record(db, patient, current_user, payload, ip_address=ip)


@router.get(
    "/patients/{patient_id}/records",
    response_model=List[DoctorRecordResponse],
    summary="List clinical records for an authorized patient",
)
def list_doctor_records(
    patient_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Any authenticated role with an active grant for this patient (doctor, caregiver, patient-self, admin)."""
    patient = verify_patient_access(patient_id, current_user, db, request)

    ip = request.client.host if request.client else "unknown"
    role_str = current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)
    AuditService.log_audit_event(
        db=db,
        action="RECORDS_VIEW",
        user_id=current_user.id,
        username=current_user.username,
        role=role_str,
        patient_id=patient.patient_code,
        resource_type="DOCTOR_RECORD",
        resource_id=patient.patient_code,
        result="SUCCESS",
        ip_address=ip,
    )
    return DoctorRecordService.list_records(db, patient)
