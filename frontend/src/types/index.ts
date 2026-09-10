export type SourceBadgeType =
  | 'CLINICIAN-CONFIRMED'
  | 'CAREGIVER-REPORTED'
  | 'PATIENT-REPORTED'
  | 'MEDICAL-RECORD'
  | 'LAB'
  | 'MEDICATION'
  | 'AI-DERIVED';

export interface PatientDemographics {
  id: number;
  patient_code: string;
  name: string;
  age: number;
  sex: string;
  location: string;
  dataset_type: string;
  primary_language: string;
}

export interface OverviewStatusItem {
  category: string;
  baseline: string;
  recent_status: string;
  status_tone: 'neutral' | 'caution' | 'alert' | 'info';
  source_type: string;
  is_clinician_confirmed: boolean;
}

export interface RecentChangeItem {
  category: string;
  title: string;
  latest_state: string;
  previous_state: string;
  direction: 'IMPROVEMENT' | 'DECLINE' | 'FLUCTUATION' | 'NEW_REPORT';
  observed_date: string;
  source_type: string;
  information_state: string;
  evidence_count: number;
  evidence_ids: string[];
  confidence: string;
  change_summary: string;
  memory_version: number | null;
}

export interface DiagnosisItem {
  code: string;
  description: string;
  confirmed_date: string;
  doctor: string;
}

export interface MedicationItem {
  name: string;
  dose: string;
  frequency: string;
  status: string;
  indication: string;
  evidence_code: string;
  start_date?: string | null;
}

export interface LabResultItem {
  test_name: string;
  value: string;
  unit: string;
  reference_range: string;
  date: string;
  evidence_code: string;
}

export interface CaregiverObservationItem {
  id: number;
  evidence_code: string;
  caregiver_id: string;
  category: string;
  observation_text: string;
  attributes: Record<string, any>;
  observed_at: string;
  recorded_at: string;
  information_state: string;
}

export interface MemoryClaimItem {
  claim_code: string;
  memory_page: string;
  category: string;
  statement: string;
  information_state: string;
  source_types: string[];
  evidence_ids: string[];
  confidence: string;
  version: number;
}

export interface LongitudinalMemoryPayload {
  current_version: number;
  last_updated: string;
  baseline: string;
  recent_changes: string;
  clinician_confirmed: string;
  caregiver_reported: string;
  conflicts: string;
  unknowns: string;
  active_claims: MemoryClaimItem[];
}

export interface TimelineEventItem {
  id: string;
  date: string;
  category: string;
  title: string;
  description: string;
  source_type: string;
  badge: string;
  evidence_id?: string;
}

export interface ConflictItem {
  id: number;
  category: string;
  title: string;
  description: string;
  doctor_view: string;
  caregiver_view: string;
  context: string;
  status: string;
  evidence_ids: string[];
}

export interface FallVsNearFallPayload {
  completed_falls_count: number;
  near_falls_count: number;
  near_fall_events: Array<{
    date: string;
    location: string;
    description: string;
    injury: string;
    ground_impact: boolean;
    evidence_code: string;
  }>;
  safety_rule: string;
}

export interface EvidenceDetailItem {
  evidence_code: string;
  patient_id: number;
  source_type: string;
  observed_at: string;
  recorded_at: string;
  original_statement: string;
  category: string;
  status: string;
  observer?: string;
  linked_claims: string[];
}

export interface DashboardResponse {
  patient: PatientDemographics;
  overview: OverviewStatusItem[];
  recent_changes: RecentChangeItem[];
  clinical_diagnoses: DiagnosisItem[];
  medications: MedicationItem[];
  labs: LabResultItem[];
  caregiver_observations: CaregiverObservationItem[];
  longitudinal_memory: LongitudinalMemoryPayload;
  timeline: TimelineEventItem[];
  conflicts: ConflictItem[];
  fall_safety: FallVsNearFallPayload;
  provenance_map: Record<string, EvidenceDetailItem>;
}

export interface MemoryHistoryItem {
  id: number;
  version_number: number;
  previous_version_id?: number | null;
  update_type: string;
  change_summary: string;
  created_at: string;
  created_by: string;
  validation_status: string;
}

// Phase 7: Doctor-Only Clinical Reasoning Types
export interface ReasoningEvidenceReference {
  evidence_id: string;
  source_type: string;
  observed_at: string;
  original_statement: string;
}

export interface ClinicalConsiderationItem {
  title: string;
  category: string;
  description: string;
  status: 'POSSIBLE_CONSIDERATION' | 'CLINICIAN_CONFIRMED' | 'ALREADY_CONSIDERED' | 'INSUFFICIENT_EVIDENCE' | 'NOT_SUPPORTED';
  supporting_evidence: ReasoningEvidenceReference[];
  contradicting_evidence: string[];
  missing_information: string[];
  evidence_strength: 'STRONG' | 'MODERATE' | 'LIMITED' | 'INSUFFICIENT';
  reasoning: string;
  uncertainty: string;
  references: string[];
}

export interface PatientContextSummaryItem {
  patient_id: string;
  name: string;
  age: number;
  sex: string;
  diagnoses: string[];
  active_medications: string[];
  relevant_observations: string[];
  relevant_changes: string[];
  relevant_labs: string[];
  known_unknowns: string[];
  conflicts: string[];
  total_evidence_count: number;
}

export interface ClinicalReasoningResponse {
  question: string;
  patient_id: string;
  generated_at: string;
  context_summary: PatientContextSummaryItem;
  considerations: ClinicalConsiderationItem[];
  missing_information: string[];
  red_flags: string[];
  relevant_changes: string[];
  limitations: string[];
  disclaimer: string;
  session_id?: string;
  model_used?: string;
  validation_status?: string;
}

// ============================================================================
// Doctor-authored clinical records (append-only, immutable evidence)
// ============================================================================

export type DoctorRecordType = 'consultation' | 'follow_up' | 'assessment' | 'historical_note';

export interface DoctorRecordItem {
  id: number;
  patient_id: number;
  evidence_code: string;
  record_type: string;
  content: string;
  doctor_id: string;
  doctor_name?: string | null;
  observed_at: string;
  created_at: string;
  source_type: string;
  status: string;
}

export interface DoctorRecordCreatePayload {
  record_type: DoctorRecordType;
  content: string;
  observed_at?: string | null;
  doctor_name?: string | null;
}
