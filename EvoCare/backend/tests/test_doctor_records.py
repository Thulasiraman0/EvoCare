"""
Doctor 'Add New Record' (append-only clinical records) test suite.

Covers:
  - DOCTOR with grant can create a record -> 201, new immutable EV-DR-xxx evidence.
  - Evidence codes monotonically increase; existing evidence is untouched.
  - Role enforcement: caregiver/patient cannot create; unauthenticated gets 401.
  - Patient isolation: a doctor without a grant for the patient gets 403.
  - Read access: any granted role (incl. patient-self) can list records.
  - Input validation: invalid record_type and too-short content -> 422.
"""
import re

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _two_step_login(username: str, password: str) -> str:
    res = client.post("/api/auth/login", json={"username": username, "password": password})
    assert res.status_code == 200, res.text
    body = res.json()
    verify = client.post(
        "/api/auth/otp/verify",
        json={"challenge_id": body["challenge_id"], "code": body["demo_code"]},
    )
    assert verify.status_code == 200, verify.text
    return verify.json()["access_token"]


def _auth(username: str, password: str) -> dict:
    return {"Authorization": f"Bearer {_two_step_login(username, password)}"}


# Lazy, memoized auth headers — resolved at first use (after session seeding),
# NOT at import time, so collection order and rate limits cannot break them.
_AUTH_CACHE: dict = {}


def _get_auth(key: str) -> dict:
    if key not in _AUTH_CACHE:
        creds = {
            "doctor": ("doctor.demo", "DoctorPass123!"),
            "caregiver": ("caregiver.demo", "CaregiverPass123!"),
            "patient": ("patient.demo", "PatientPass123!"),
            "other_doctor": ("doctor.other", "DoctorPass123!"),
        }[key]
        _AUTH_CACHE[key] = _auth(*creds)
    return _AUTH_CACHE[key]


def test_doctor_creates_record_appends_immutable_evidence():
    before = client.get("/api/records/patients/P001/records", headers=_get_auth("doctor")).json()
    before_codes = {r["evidence_code"] for r in before}
    before_evidence_count = len(before)

    res = client.post(
        "/api/records/patients/P001/records",
        json={
            "record_type": "consultation",
            "content": "Follow-up consultation: gait improved with support; orthostatic vitals advised.",
            "doctor_name": "Dr. Ramesh Varma, MD",
        },
        headers=_get_auth("doctor"),
    )
    assert res.status_code == 201, res.text
    created = res.json()

    # New unique EV-DR code, immutable, doctor-attributed
    assert re.match(r"^EV-DR-\d{3,}$", created["evidence_code"])
    assert created["evidence_code"] not in before_codes
    assert created["status"] == "IMMUTABLE"
    assert created["source_type"] == "DOCTOR"
    assert created["doctor_id"] == "doctor.demo"

    # Listed afterwards, appended (not replacing anything)
    after = client.get("/api/records/patients/P001/records", headers=_get_auth("doctor")).json()
    assert len(after) == before_evidence_count + 1
    assert created["evidence_code"] in {r["evidence_code"] for r in after}


def test_evidence_codes_monotonically_increase():
    r1 = client.post(
        "/api/records/patients/P001/records",
        json={"record_type": "follow_up", "content": "Second appended record for monotonic code check."},
        headers=_get_auth("doctor"),
    ).json()
    r2 = client.post(
        "/api/records/patients/P001/records",
        json={"record_type": "assessment", "content": "Third appended record for monotonic code check."},
        headers=_get_auth("doctor"),
    ).json()
    n1 = int(r1["evidence_code"].split("-")[-1])
    n2 = int(r2["evidence_code"].split("-")[-1])
    assert n2 == n1 + 1


def test_caregiver_cannot_create_records():
    res = client.post(
        "/api/records/patients/P001/records",
        json={"record_type": "consultation", "content": "Caregiver attempting to author clinical record."},
        headers=_get_auth("caregiver"),
    )
    assert res.status_code == 403


def test_patient_cannot_create_records():
    res = client.post(
        "/api/records/patients/P001/records",
        json={"record_type": "consultation", "content": "Patient attempting to author clinical record."},
        headers=_get_auth("patient"),
    )
    assert res.status_code == 403


def test_unauthenticated_create_rejected():
    res = client.post(
        "/api/records/patients/P001/records",
        json={"record_type": "consultation", "content": "Anonymous attempt to author clinical record."},
    )
    assert res.status_code == 401


def test_doctor_without_grant_cannot_create_for_other_patient():
    res = client.post(
        "/api/records/patients/P002/records",
        json={"record_type": "consultation", "content": "Cross-patient authoring attempt by doctor.demo."},
        headers=_get_auth("doctor"),  # doctor.demo only has P001 grant
    )
    assert res.status_code == 403


def test_granted_patient_can_list_records_readonly():
    res = client.get("/api/records/patients/P001/records", headers=_get_auth("patient"))
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_invalid_record_type_rejected():
    res = client.post(
        "/api/records/patients/P001/records",
        json={"record_type": "surgery_note", "content": "Invalid record type should be rejected."},
        headers=_get_auth("doctor"),
    )
    assert res.status_code == 422


def test_too_short_content_rejected():
    res = client.post(
        "/api/records/patients/P001/records",
        json={"record_type": "consultation", "content": "short"},
        headers=_get_auth("doctor"),
    )
    assert res.status_code == 422


def test_new_record_visible_in_evidence_store():
    """The created record must be a first-class immutable Evidence row."""
    created = client.post(
        "/api/records/patients/P001/records",
        json={"record_type": "historical_note", "content": "Historical note recorded for evidence-store visibility."},
        headers=_get_auth("doctor"),
    ).json()
    code = created["evidence_code"]

    res = client.get("/api/patients/P001/evidence", headers=_get_auth("doctor"))
    assert res.status_code == 200
    codes = {e["evidence_code"] for e in res.json()}
    assert code in codes
