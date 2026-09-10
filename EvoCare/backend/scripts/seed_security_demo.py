"""
Seed Script for EvoCare Phase 8 Security & Multi-Patient Data.
Seeds:
- Demo Users (doctor.demo, doctor.other, caregiver.demo, admin.demo)
- Patient Access Grants
- Synthetic Patient P002 (Ananya Sharma) for cross-patient isolation verification
"""
import sys
from pathlib import Path
from datetime import datetime, timezone

# Add backend to path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.core.database import SessionLocal, engine, Base
import app.models  # load all models
from app.models.security import User, UserRole, PatientAccess, AccessRole
from app.models.patient import Patient
from app.models.evidence import Evidence
from app.models.doctor_record import DoctorRecord
from app.models.medication import Medication
from app.models.caregiver_observation import CaregiverObservation
from app.models.baseline import Baseline
from app.models.memory_models import MemoryClaim, MemoryVersion
from app.models.enums import SourceType, InformationState, EvidenceStatus
from app.core.security import hash_password


def seed_security_and_p002():
    print("Seeding EvoCare Phase 8 Security & Multi-Patient Data...")
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    try:
        # 1. Seed Demo Users
        users_data = [
            {
                "username": "doctor.demo",
                "email": "doctor.demo@evocare.health",
                "full_name": "Dr. Ramesh Varma, MD (Attending Physician)",
                "password": "DoctorPass123!",
                "role": UserRole.DOCTOR,
            },
            {
                "username": "doctor.other",
                "email": "doctor.other@evocare.health",
                "full_name": "Dr. Priya Sengupta, MD (Consulting Geriatrician)",
                "password": "DoctorPass123!",
                "role": UserRole.DOCTOR,
            },
            {
                "username": "caregiver.demo",
                "email": "caregiver.demo@evocare.health",
                "full_name": "Lakshmi Raman (Primary Caregiver)",
                "password": "CaregiverPass123!",
                "role": UserRole.CAREGIVER,
            },
            {
                "username": "admin.demo",
                "email": "admin.demo@evocare.health",
                "full_name": "System Administrator",
                "password": "AdminPass123!",
                "role": UserRole.ADMIN,
            },
            {
                "username": "patient.demo",
                "email": "patient.demo@evocare.health",
                "full_name": "Meenakshi Raman (Patient Self-Access)",
                "password": "PatientPass123!",
                "role": UserRole.PATIENT,
            },
            {
                "username": "patient.other",
                "email": "patient.other@evocare.health",
                "full_name": "Rajesh Kumar (Patient Self-Access, P002)",
                "password": "PatientPass123!",
                "role": UserRole.PATIENT,
            }
        ]

        user_records = {}
        for u in users_data:
            existing = db.query(User).filter(User.username == u["username"]).first()
            if not existing:
                new_user = User(
                    username=u["username"],
                    email=u["email"],
                    full_name=u["full_name"],
                    password_hash=hash_password(u["password"]),
                    role=u["role"],
                    is_active=True,
                    created_at=datetime.now(timezone.utc)
                )
                db.add(new_user)
                db.commit()
                db.refresh(new_user)
                user_records[u["username"]] = new_user
                print(f"  [+] Created user: {u['username']} ({u['role'].value})")
            else:
                existing.password_hash = hash_password(u["password"])
                existing.role = u["role"]
                existing.is_active = True
                db.commit()
                db.refresh(existing)
                user_records[u["username"]] = existing
                print(f"  [*] Updated user: {u['username']} ({u['role'].value})")

        # 2. Seed Synthetic Patient P002 (Ananya Sharma)
        p002 = db.query(Patient).filter(Patient.patient_code == "P002").first()
        if not p002:
            p002 = Patient(
                patient_code="P002",
                name="Ananya Sharma",
                age=74,
                sex="Female",
                location="Bengaluru, Karnataka",
                status="ACTIVE",
                is_synthetic=True,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc)
            )
            db.add(p002)
            db.commit()
            db.refresh(p002)
            print("  [+] Created Synthetic Patient P002 (Ananya Sharma)")

            # P002 Evidence
            ev1 = Evidence(
                patient_id=p002.id,
                evidence_code="EV-P002-001",
                source_type=SourceType.DOCTOR,
                source_id="DOC-P002-01",
                observed_at=datetime(2026, 8, 15, 11, 0),
                recorded_at=datetime(2026, 8, 15, 11, 30),
                original_statement="Patient ambulates independently with normal gait and steady balance in clinic.",
                status=EvidenceStatus.IMMUTABLE
            )
            ev2 = Evidence(
                patient_id=p002.id,
                evidence_code="EV-P002-002",
                source_type=SourceType.CAREGIVER,
                source_id="CG-P002-01",
                observed_at=datetime(2026, 9, 2, 9, 0),
                recorded_at=datetime(2026, 9, 2, 9, 15),
                original_statement="Mother walked in the park for 20 minutes without assistance today.",
                status=EvidenceStatus.IMMUTABLE
            )
            db.add_all([ev1, ev2])
            db.commit()

            # P002 Doctor Record
            dr_p002 = DoctorRecord(
                patient_id=p002.id,
                evidence_id=ev1.id,
                doctor_id="DOC-P002-01",
                record_type="assessment",
                content="Assessment: Mild Type 2 Diabetes, controlled. Ambulation normal.",
                observed_at=datetime(2026, 8, 15, 11, 0)
            )
            db.add(dr_p002)

            # P002 Baseline
            base_p002 = Baseline(
                patient_id=p002.id,
                category="Mobility",
                baseline_value="Independent ambulation without assistive device.",
                information_state=InformationState.HISTORICAL
            )
            db.add(base_p002)
            db.commit()
            print("  [+] Seeded P002 clinical records and evidence.")
        else:
            print("  [*] Synthetic Patient P002 already exists.")

        # 3. Seed Patient Access Grants
        # Matrix:
        # doctor.demo   -> P001 (ALLOWED), P002 (DENIED)
        # doctor.other  -> P002 (ALLOWED), P001 (DENIED)
        # caregiver.demo-> P001 (ALLOWED), P002 (DENIED)
        # admin.demo    -> System administrator

        grants_to_ensure = [
            {"username": "doctor.demo", "patient_code": "P001", "role": AccessRole.ATTENDING_PHYSICIAN},
            {"username": "doctor.other", "patient_code": "P002", "role": AccessRole.ATTENDING_PHYSICIAN},
            {"username": "caregiver.demo", "patient_code": "P001", "role": AccessRole.PRIMARY_CAREGIVER},
            {"username": "patient.demo", "patient_code": "P001", "role": AccessRole.SELF},
            {"username": "patient.other", "patient_code": "P002", "role": AccessRole.SELF},
        ]

        for g in grants_to_ensure:
            user_obj = user_records.get(g["username"])
            if user_obj:
                existing_grant = db.query(PatientAccess).filter(
                    PatientAccess.user_id == user_obj.id,
                    PatientAccess.patient_code == g["patient_code"]
                ).first()
                if not existing_grant:
                    grant = PatientAccess(
                        user_id=user_obj.id,
                        patient_code=g["patient_code"],
                        access_role=g["role"],
                        granted_by="ADMIN_INIT",
                        granted_at=datetime.now(timezone.utc),
                        is_active=True
                    )
                    db.add(grant)
                    db.commit()
                    print(f"  [+] Granted access: {g['username']} -> {g['patient_code']} ({g['role'].value})")
                else:
                    existing_grant.is_active = True
                    db.commit()
                    print(f"  [*] Verified access: {g['username']} -> {g['patient_code']}")

        print("\nPhase 8 Security Seeding Completed Successfully!")

    finally:
        db.close()


if __name__ == "__main__":
    seed_security_and_p002()
