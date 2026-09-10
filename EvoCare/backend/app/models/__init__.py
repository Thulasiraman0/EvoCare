from app.models.enums import SourceType, InformationState, EvidenceStatus, ConflictStatus, PageType
from app.models.associations import pattern_evidence_association, conflict_evidence_association, baseline_evidence_association
from app.models.patient import Patient
from app.models.evidence import Evidence
from app.models.observation import Observation
from app.models.caregiver_observation import CaregiverObservation
from app.models.doctor_record import DoctorRecord
from app.models.medication import Medication
from app.models.lab import LabRecord
from app.models.baseline import Baseline
from app.models.pattern import Pattern
from app.models.conflict import Conflict
from app.models.memory_page import MemoryPage
from app.models.audit import AuditLog
from app.models.clarification import SessionStatus, ClarificationSession, ClarificationQuestion, ClarificationAnswer
from app.models.memory_models import MemoryVersion, MemoryClaim, MemoryProposal
from app.models.reasoning_session import ReasoningSession
from app.models.security import User, UserRole, PatientAccess, AccessRole, SecurityEvent
from app.models.otp import OTPChallenge, OTPChannel, OTPPurpose

