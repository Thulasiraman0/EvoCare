"""
Two-Step Authentication (Password + OTP) test suite.

Covers:
  - Step 1 never issues tokens; returns an OTP challenge with a masked destination.
  - Wrong password / wrong OTP are rejected and audited.
  - Correct OTP issues the same JWT token pair as legacy login, with correct role.
  - Resend invalidates the previous code; cooldown is enforced.
  - Challenges lock after max attempts.
  - OTP verification is required before any patient data is reachable.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import app
from app.core.config import settings

client = TestClient(app)

DEMO_ACCOUNTS = {
    "doctor": ("doctor.demo", "DoctorPass123!", "DOCTOR"),
    "caregiver": ("caregiver.demo", "CaregiverPass123!", "CAREGIVER"),
    "admin": ("admin.demo", "AdminPass123!", "ADMIN"),
    "patient": ("patient.demo", "PatientPass123!", "PATIENT"),
}


def _step1(username: str, password: str):
    return client.post("/api/auth/login", json={"username": username, "password": password})


def _verify(challenge_id: str, code: str):
    return client.post("/api/auth/otp/verify", json={"challenge_id": challenge_id, "code": code})


def full_login(role_key: str) -> dict:
    username, password, _ = DEMO_ACCOUNTS[role_key]
    res = _step1(username, password)
    assert res.status_code == 200, res.text
    body = res.json()
    verify = _verify(body["challenge_id"], body["demo_code"])
    assert verify.status_code == 200, verify.text
    return verify.json()


# ============================================================================
# STEP 1: CREDENTIALS
# ============================================================================

def test_wrong_password_rejected():
    res = _step1("doctor.demo", "WrongPassword!")
    assert res.status_code == 401
    assert "access_token" not in res.json()


def test_step1_returns_challenge_without_tokens():
    res = _step1(*DEMO_ACCOUNTS["doctor"][:2])
    assert res.status_code == 200
    body = res.json()
    assert body["otp_required"] is True
    assert len(body["challenge_id"]) >= 8
    assert body["masked_destination"].endswith("@evocare.health")
    assert "*" in body["masked_destination"]
    assert "access_token" not in body
    assert "refresh_token" not in body
    # DEMO_MODE surfaces the code so the demo runs without a mail provider
    assert body["demo_code"] and len(str(body["demo_code"])) == settings.OTP_LENGTH


def test_unknown_user_rejected():
    res = _step1("ghost.user", "Whatever123!")
    assert res.status_code == 401


# ============================================================================
# STEP 2: OTP VERIFICATION
# ============================================================================

def test_wrong_otp_rejected_and_attempts_tracked():
    res = _step1(*DEMO_ACCOUNTS["doctor"][:2])
    challenge = res.json()
    wrong = "000000" if challenge["demo_code"] != "000000" else "111111"

    bad = _verify(challenge["challenge_id"], wrong)
    assert bad.status_code == 401
    assert "attempt" in bad.json()["detail"].lower()

    # The correct code still works afterwards (attempts not exhausted)
    good = _verify(challenge["challenge_id"], challenge["demo_code"])
    assert good.status_code == 200
    assert good.json()["user"]["role"] == "DOCTOR"


def test_correct_otp_issues_tokens_with_role():
    body = full_login("doctor")
    assert body["access_token"] and body["refresh_token"]
    assert body["token_type"] == "bearer"
    assert body["user"]["username"] == "doctor.demo"
    assert body["user"]["role"] == "DOCTOR"


def test_patient_otp_login_returns_patient_role():
    body = full_login("patient")
    assert body["user"]["role"] == "PATIENT"
    assert body["user"]["username"] == "patient.demo"


def test_unknown_challenge_rejected():
    res = _verify("ffffffffffffffffffffffffffffffff", "123456")
    assert res.status_code == 401


def test_challenge_single_use():
    res = _step1(*DEMO_ACCOUNTS["doctor"][:2])
    challenge = res.json()
    first = _verify(challenge["challenge_id"], challenge["demo_code"])
    assert first.status_code == 200
    # Replaying the same (consumed) challenge must fail
    replay = _verify(challenge["challenge_id"], challenge["demo_code"])
    assert replay.status_code == 401


def test_resend_invalidates_previous_code():
    res = _step1(*DEMO_ACCOUNTS["caregiver"][:2])
    old = res.json()

    # Cooldown blocks an immediate resend (429)
    immediate = client.post("/api/auth/otp/resend", json={"challenge_id": old["challenge_id"]})
    assert immediate.status_code == 429

    # Simulate cooldown expiry directly on the challenge row
    from app.core.database import SessionLocal
    from app.models.otp import OTPChallenge
    from app.core.database import utc_now
    from datetime import timedelta
    db = SessionLocal()
    try:
        row = db.query(OTPChallenge).filter(OTPChallenge.challenge_id == old["challenge_id"]).first()
        row.created_at = utc_now() - timedelta(seconds=settings.OTP_RESEND_COOLDOWN_SECONDS + 5)
        db.commit()
    finally:
        db.close()

    resent = client.post("/api/auth/otp/resend", json={"challenge_id": old["challenge_id"]})
    assert resent.status_code == 200
    new = resent.json()
    assert new["challenge_id"] != old["challenge_id"]
    assert new["demo_code"] != old["demo_code"]

    # Old code no longer verifies anywhere: old challenge deactivated
    stale = _verify(old["challenge_id"], old["demo_code"])
    assert stale.status_code == 401

    # New code works
    ok = _verify(new["challenge_id"], new["demo_code"])
    assert ok.status_code == 200
    assert ok.json()["user"]["role"] == "CAREGIVER"


def test_max_attempts_locks_challenge():
    res = _step1(*DEMO_ACCOUNTS["admin"][:2])
    challenge = res.json()
    wrong = "000000" if challenge["demo_code"] != "000000" else "111111"

    last = None
    for _ in range(challenge["max_attempts"]):
        last = _verify(challenge["challenge_id"], wrong)
        assert last.status_code == 401

    # After max attempts the challenge is locked — even the correct code fails
    locked = _verify(challenge["challenge_id"], challenge["demo_code"])
    assert locked.status_code == 401
    assert "too many" in locked.json()["detail"].lower()


# ============================================================================
# NO PATIENT DATA BEFORE FULL AUTHENTICATION
# ============================================================================

def test_no_data_access_between_steps():
    """After step 1 (credentials ok, OTP pending) no patient data may leak."""
    res = _step1(*DEMO_ACCOUNTS["doctor"][:2])
    challenge_id = res.json()["challenge_id"]

    # Use the challenge_id as if it were a token -> must be rejected
    snooper = client.get(
        "/api/dashboard/patients/P001",
        headers={"Authorization": f"Bearer {challenge_id}"},
    )
    assert snooper.status_code == 401

    # Unauthenticated access is still rejected too
    assert client.get("/api/dashboard/patients/P001").status_code == 401


# ============================================================================
# PATIENT ROLE ISOLATION (patient.demo -> own record only, no doctor tools)
# ============================================================================

def test_patient_can_view_own_dashboard():
    token = full_login("patient")["access_token"]
    res = client.get("/api/dashboard/patients/P001", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["patient"]["patient_code"] == "P001"


def test_patient_cannot_view_other_patients():
    token = full_login("patient")["access_token"]
    res = client.get("/api/dashboard/patients/P002", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 403


def test_patient_cannot_use_clinical_reasoning():
    token = full_login("patient")["access_token"]
    res = client.post(
        "/api/clinical-reasoning/P001",
        json={"question": "Why is she dizzy?"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403


def test_patient_cannot_create_clinical_records():
    token = full_login("patient")["access_token"]
    res = client.post(
        "/api/records/patients/P001/records",
        json={"record_type": "consultation", "content": "Patient self-authored note attempt."},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403


def test_patient_can_list_own_records():
    token = full_login("patient")["access_token"]
    res = client.get("/api/records/patients/P001/records", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert isinstance(res.json(), list)
