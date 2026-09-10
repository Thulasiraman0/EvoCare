# EvoCare — Role Workflow

> Synthetic demo dataset only. Not for clinical use.

## Roles

| Role | Demo login | Second factor | Workspace |
|---|---|---|---|
| **DOCTOR** | `doctor.demo` / `DoctorPass123!` | OTP (email channel) | Full doctor dashboard + Add Clinical Record |
| **PATIENT** | `patient.demo` / `PatientPass123!` | OTP (email channel) | Read-only Patient Portal (own record only) |
| **CAREGIVER** | `caregiver.demo` / `CaregiverPass123!` | OTP (email channel) | Portal placeholder — observation console planned next phase |
| **ADMIN** | `admin.demo` / `AdminPass123!` | OTP (email channel) | Portal placeholder — user/grant/audit console planned next phase |

Every account signs in with the same two steps: **User ID + password → OTP → workspace**.
Access to patient data is gated per-user by `patient_access_grants` (e.g. `doctor.demo → P001` only).

## The Doctor Workflow (implemented end-to-end)

```
┌──────────────────────────┐      ┌───────────────────────────────┐
│ 1. LOGIN (Step 1)        │      │ 2. OTP CHALLENGE (Step 2)     │
│ User ID + password       │ ───> │ 6-digit code sent to doctor's │
│ POST /api/auth/login     │      │ registered email              │
│ → 401 on bad credentials │      │ POST /api/auth/otp/verify     │
│   (rate-limited, audited)│      │ → 5 min expiry, max attempts, │
└──────────────────────────┘      │   resend cooldown, audited    │
                                  └──────────────┬────────────────┘
                                                 v
┌─────────────────────────────────────────────────────────────────┐
│ 3. DOCTOR DASHBOARD (the "living wiki")                         │
│ Patient P001 longitudinal memory:                               │
│   • Health-domain overview vs. baseline (6 domains)             │
│   • Recent changes with "Why?" provenance chain                 │
│   • Clinical context, caregiver observations, labs, meds        │
│   • Clinical Records panel (append-only history, EV-DR-*)       │
│   • Conflicts preserved, timeline, memory versions              │
│   • Doctor-only Clinical Reasoning Assistant (AI, rule-gated)   │
└─────────────────────────────────────────────────────────────────┘
                                                 v
┌─────────────────────────────────────────────────────────────────┐
│ 4. ADD NEW RECORD ("+" button, DOCTOR role only)                │
│   • record_type: consultation | follow_up | assessment |        │
│     historical_note                                             │
│   • content becomes an IMMUTABLE Evidence row (next EV-DR-xxx)  │
│   • nothing is ever edited or deleted — corrections are new     │
│     records (append-only invariant)                             │
│   • every write is captured in the immutable audit trail        │
└─────────────────────────────────────────────────────────────────┘
```

## The Patient Workflow (implemented; deeper pages later)

```
1. LOGIN (same two steps: password + OTP)
2. PATIENT PORTAL (read-only, own record only — SELF access grant)
   • Health-domain overview (same data the doctor sees)
   • Clinical records authored by the care team
   • No clinical tools, no AI reasoning, no write access
     (enforced server-side: POST /records → 403, reasoning → 403,
      other patients → 403)
```

## Caregiver & Admin

Authentication, OTP and RBAC are fully live for these roles today; their
workspaces are placeholders by design until the next phase:

- **Caregiver console** (next): free-text observation submission with the
  adaptive clarification engine (Phase 3/4 pipeline is already in the backend).
- **Admin console** (next): user management, patient access grants, and the
  audit/security-event explorers (endpoints already exist under `/api/admin`).

## API surface added for this workflow

| Endpoint | Method | Role | Purpose |
|---|---|---|---|
| `/api/auth/login` | POST | any | Step 1: credentials → OTP challenge (or tokens if `OTP_ENABLED=false`) |
| `/api/auth/otp/verify` | POST | any | Step 2: code → JWT access/refresh pair |
| `/api/auth/otp/resend` | POST | any | Re-issue a code (invalidates previous, 30 s cooldown) |
| `/api/records/patients/{id}/records` | POST | DOCTOR | Append a new immutable clinical record |
| `/api/records/patients/{id}/records` | GET | granted roles | List clinical records (read-only) |

## Security invariants kept intact

- Evidence store remains **append-only / immutable** — new records never touch existing rows.
- LLM outputs remain **proposer-only**; deterministic validators still gate the reasoning assistant.
- All authentication transitions (challenge created, failed, verified, resent, locked) are written to the immutable **audit trail**.
- OTP codes are stored **hashed** (salted SHA-256), expire in 5 minutes, lock after 5 failed attempts, and are single-use.
- In `DEMO_MODE` the OTP is surfaced on the login screen so the demo runs without an email/SMS provider. Production wiring point: `app/services/otp_service.py::_deliver`.
