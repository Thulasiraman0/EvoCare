"""
Doctor-authored clinical records.

Invariant preserved: EvoCare's evidence store is APPEND-ONLY. Adding a record
never mutates or deletes existing rows — each new record mints a fresh
immutable Evidence (EV-DR-xxx) plus a linked DoctorRecord, and writes an
immutable audit entry. Corrections arrive as NEW records, never edits.
"""
import logging
import re
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import utc_now
from app.models.doctor_record import DoctorRecord
from app.models.evidence import Evidence
from app.models.enums import EvidenceStatus, SourceType
from app.models.patient import Patient
from app.models.security import User
from app.schemas.record import DoctorRecordCreate, DoctorRecordResponse, DoctorRecordType
from app.services.audit_service import AuditService

logger = logging.getLogger(__name__)

_ALLOWED_RECORD_TYPES = {t.value for t in DoctorRecordType}
_EVIDENCE_CODE_RE = re.compile(r"^EV-DR-(\d+)$")
_MAX_CODE_RETRIES = 5


class DoctorRecordService:

    # ------------------------------------------------------------------ helpers

    @staticmethod
    def _role_str(user: User) -> str:
        return user.role.value if hasattr(user.role, "value") else str(user.role)

    @staticmethod
    def _normalize_record_type(raw: str) -> str:
        value = (raw or "").strip().lower().replace("-", "_").replace(" ", "_")
        if value not in _ALLOWED_RECORD_TYPES:
            allowed = ", ".join(sorted(_ALLOWED_RECORD_TYPES))
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid record_type '{raw}'. Allowed values: {allowed}.",
            )
        return value

    @staticmethod
    def _next_evidence_code(db: Session) -> str:
        max_seen = 0
        for (code,) in (
            db.query(Evidence.evidence_code)
            .filter(Evidence.evidence_code.like("EV-DR-%"))
            .all()
        ):
            m = _EVIDENCE_CODE_RE.match(code or "")
            if m:
                max_seen = max(max_seen, int(m.group(1)))
        return f"EV-DR-{max_seen + 1:03d}"

    @staticmethod
    def _coerce_naive_utc(dt: datetime) -> datetime:
        if dt.tzinfo is not None:
            return dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt

    @classmethod
    def _to_response(cls, record: DoctorRecord, evidence: Evidence, doctor_name: Optional[str] = None) -> DoctorRecordResponse:
        return DoctorRecordResponse(
            id=record.id,
            patient_id=record.patient_id,
            evidence_code=evidence.evidence_code,
            record_type=record.record_type,
            content=record.content,
            doctor_id=record.doctor_id,
            doctor_name=doctor_name,
            observed_at=record.observed_at,
            created_at=record.created_at,
            source_type=evidence.source_type.value if hasattr(evidence.source_type, "value") else str(evidence.source_type),
            status=evidence.status.value if hasattr(evidence.status, "value") else str(evidence.status),
        )

    # ------------------------------------------------------------------ API

    @classmethod
    def create_record(
        cls,
        db: Session,
        patient: Patient,
        doctor: User,
        payload: DoctorRecordCreate,
        ip_address: Optional[str] = None,
    ) -> DoctorRecordResponse:
        record_type = cls._normalize_record_type(payload.record_type)
        content = payload.content.strip()
        observed_at = cls._coerce_naive_utc(payload.observed_at or utc_now())
        doctor_name = (payload.doctor_name or "").strip() or None

        # Mint the next EV-DR-xxx code. Retry on the (unlikely) unique-collision race.
        last_error: Optional[Exception] = None
        for _ in range(_MAX_CODE_RETRIES):
            evidence_code = cls._next_evidence_code(db)
            evidence = Evidence(
                patient_id=patient.id,
                evidence_code=evidence_code,
                source_type=SourceType.DOCTOR,
                source_id=doctor.username,
                observed_at=observed_at,
                recorded_at=utc_now(),
                original_statement=content,
                status=EvidenceStatus.IMMUTABLE,
            )
            db.add(evidence)
            try:
                db.flush()
            except IntegrityError as e:
                db.rollback()
                last_error = e
                continue

            record = DoctorRecord(
                patient_id=patient.id,
                evidence_id=evidence.id,
                doctor_id=doctor.username,
                record_type=record_type,
                content=content,
                observed_at=observed_at,
            )
            db.add(record)
            db.commit()
            db.refresh(record)

            AuditService.log_audit_event(
                db=db,
                action="RECORD_CREATED",
                user_id=doctor.id,
                username=doctor.username,
                role=cls._role_str(doctor),
                patient_id=patient.patient_code,
                resource_type="DOCTOR_RECORD",
                resource_id=evidence_code,
                result="SUCCESS",
                reason=f"Append-only clinical record created ({record_type}); evidence {evidence_code} is IMMUTABLE",
                ip_address=ip_address,
            )
            return cls._to_response(record, evidence, doctor_name)

        logger.error("Could not allocate an EV-DR evidence code: %s", last_error)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not allocate a unique evidence code. Please retry.",
        )

    @classmethod
    def list_records(cls, db: Session, patient: Patient) -> List[DoctorRecordResponse]:
        rows = (
            db.query(DoctorRecord, Evidence, User)
            .join(Evidence, DoctorRecord.evidence_id == Evidence.id)
            .outerjoin(User, User.username == DoctorRecord.doctor_id)
            .filter(DoctorRecord.patient_id == patient.id)
            .order_by(DoctorRecord.observed_at.desc(), DoctorRecord.id.desc())
            .all()
        )
        return [
            cls._to_response(record, evidence, user.full_name if user else None)
            for record, evidence, user in rows
        ]
