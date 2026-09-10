import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from './App';
import { Header } from './components/layout/Header';
import { PatientOverviewCard } from './components/patient/PatientOverviewCard';
import { RecentChangesPanel } from './components/patient/RecentChangesPanel';
import { ClinicalContextPanel } from './components/clinical/ClinicalContextPanel';
import { CaregiverObservationsPanel } from './components/caregiver/CaregiverObservationsPanel';
import { LongitudinalMemoryPanel } from './components/memory/LongitudinalMemoryPanel';
import { PatientTimeline } from './components/timeline/PatientTimeline';
import { ConflictCard } from './components/common/ConflictCard';
import { WhyModal } from './components/evidence/WhyModal';
import { EvidenceDrawer } from './components/evidence/EvidenceDrawer';
import { SourceBadge } from './components/common/SourceBadge';
import { ErrorMessage } from './components/common/ErrorMessage';
import { LoadingSpinner } from './components/common/LoadingSpinner';
import { ClinicalReasoningPanel } from './components/reasoning/ClinicalReasoningPanel';
import { apiService } from './services/api';
import { DashboardResponse } from './types';

const mockDashboardData: DashboardResponse = {
  patient: {
    id: 1,
    patient_code: 'P001',
    name: 'Meenakshi Raman',
    age: 78,
    sex: 'Female',
    location: 'Chennai, Tamil Nadu',
    dataset_type: 'SYNTHETIC DEMO DATA',
    primary_language: 'Tamil / English',
  },
  overview: [
    {
      category: 'Mobility',
      baseline: 'Independent ambulation',
      recent_status: 'Intermittent outdoor support needed',
      status_tone: 'caution',
      source_type: 'CAREGIVER-REPORTED',
      is_clinician_confirmed: false,
    },
    {
      category: 'Cognition',
      baseline: 'Oriented, independent',
      recent_status: 'Intermittent morning confusion reported',
      status_tone: 'caution',
      source_type: 'CAREGIVER-REPORTED',
      is_clinician_confirmed: false,
    },
    {
      category: 'Dizziness',
      baseline: 'No chronic vertigo',
      recent_status: 'Postural dizziness; etiology UNKNOWN',
      status_tone: 'caution',
      source_type: 'CAREGIVER-REPORTED',
      is_clinician_confirmed: false,
    },
    {
      category: 'Falls & Near-Falls',
      baseline: 'Zero falls',
      recent_status: '1 near-fall reported (2026-09-06); 0 falls',
      status_tone: 'alert',
      source_type: 'CAREGIVER-REPORTED',
      is_clinician_confirmed: false,
    },
  ],
  recent_changes: [
    {
      category: 'Mobility',
      title: 'Fluctuating Walking Support & Indoor Recovery',
      latest_state: 'Indoor walking improved without support',
      previous_state: 'Required caregiver arm support outdoors',
      direction: 'FLUCTUATION',
      observed_date: '2026-09-10',
      source_type: 'CAREGIVER',
      information_state: 'AI_DERIVED',
      evidence_count: 3,
      evidence_ids: ['EV-CG-021', 'EV-CG-031', 'EV-CG-040'],
      confidence: 'HIGH',
      change_summary: 'Mobility has shown recent variability, with increased support required during earlier outdoor observations followed by later improvement in indoor walking without support.',
      memory_version: 27,
    },
    {
      category: 'Falls & Stability',
      title: 'Near-Fall Incident (Zero Ground Impact)',
      latest_state: 'Near-fall event near bathroom; stabilized before impact',
      previous_state: 'No recent fall reports',
      direction: 'DECLINE',
      observed_date: '2026-09-06',
      source_type: 'CAREGIVER',
      information_state: 'RAW_OBSERVATION',
      evidence_count: 1,
      evidence_ids: ['EV-CG-031'],
      confidence: 'HIGH',
      change_summary: 'Near-fall near bathroom; patient lost balance upon rising but was caught by caregiver. Zero ground impact.',
      memory_version: null,
    },
  ],
  clinical_diagnoses: [
    {
      code: 'E11.9',
      description: 'Type 2 Diabetes Mellitus without complications',
      confirmed_date: '2024-03-15',
      doctor: 'Dr. K. Srinivasan',
    },
    {
      code: 'I10',
      description: 'Essential (primary) Hypertension',
      confirmed_date: '2024-03-15',
      doctor: 'Dr. K. Srinivasan',
    },
  ],
  medications: [
    {
      name: 'Metformin',
      dose: '500 mg',
      frequency: 'BID',
      status: 'ACTIVE',
      indication: 'Type 2 Diabetes',
      evidence_code: 'EV-MED-001',
      start_date: '2024-03-15',
    },
  ],
  labs: [
    {
      test_name: 'HbA1c',
      value: '7.4',
      unit: '%',
      reference_range: '< 5.7%',
      date: '2026-08-15',
      evidence_code: 'EV-LAB-001',
    },
  ],
  caregiver_observations: [
    {
      id: 1,
      evidence_code: 'EV-CG-021',
      caregiver_id: 'CG001',
      category: 'mobility',
      observation_text: 'She needed someone arm while walking outside today.',
      attributes: {},
      observed_at: '2026-09-02 17:30',
      recorded_at: '2026-09-02 18:00',
      information_state: 'RAW_OBSERVATION',
    },
  ],
  longitudinal_memory: {
    current_version: 27,
    last_updated: '2026-09-10 10:00 UTC',
    baseline: 'Historically independently mobile inside and around home.',
    recent_changes: 'Mobility has shown recent variability with earlier outdoor support needs followed by indoor recovery.',
    clinician_confirmed: 'Independent mobility documented in clinical records.',
    caregiver_reported: 'Support required outdoors.',
    conflicts: 'Clinical documentation describes independent mobility; caregiver observations note subsequent outdoor assistance needs.',
    unknowns: 'Exact etiology of transient unsteadiness and dizziness has not been established by clinician.',
    active_claims: [
      {
        claim_code: 'CLM-P001-MOB01',
        memory_page: 'Mobility',
        category: 'mobility',
        statement: 'Mobility has shown recent variability.',
        information_state: 'AI_DERIVED',
        source_types: ['CAREGIVER'],
        evidence_ids: ['EV-CG-021', 'EV-CG-040'],
        confidence: 'HIGH',
        version: 27,
      },
    ],
  },
  timeline: [
    {
      id: 'EVT-01',
      date: '2026-08-18',
      category: 'Clinical Assessment',
      title: 'Routine Outpatient Review',
      description: 'Dr. K. Srinivasan: Independent ambulation, vitals stable.',
      source_type: 'CLINICIAN-CONFIRMED',
      badge: 'CLINICIAN-CONFIRMED',
      evidence_id: 'EV-DR-001',
    },
    {
      id: 'EVT-02',
      date: '2026-09-06',
      category: 'Near-Fall',
      title: 'Near-Fall Incident',
      description: 'CG001 reported patient almost fell near bathroom; caught immediately.',
      source_type: 'CAREGIVER-REPORTED',
      badge: 'CAREGIVER-REPORTED',
      evidence_id: 'EV-CG-031',
    },
  ],
  conflicts: [
    {
      id: 1,
      category: 'mobility',
      title: 'Mobility Independence vs Support Needs',
      description: 'Difference between clinic mobility and outdoor caregiver reports.',
      doctor_view: 'Independent mobility documented in clinic exam room.',
      caregiver_view: 'Requires physical arm support when walking outdoors.',
      context: 'Clinic visit was in an uncluttered room on Aug 18; caregiver observations occurred outdoors in Sep.',
      status: 'CONTEXTUAL',
      evidence_ids: ['EV-DR-001', 'EV-CG-021'],
    },
  ],
  fall_safety: {
    completed_falls_count: 0,
    near_falls_count: 1,
    near_fall_events: [
      {
        date: '2026-09-06',
        location: 'Near bathroom',
        description: 'Patient almost fell while rising; caught by caregiver.',
        injury: 'None',
        ground_impact: false,
        evidence_code: 'EV-CG-031',
      },
    ],
    safety_rule: 'Strict invariant: Near-falls are NEVER classified as completed falls.',
  },
  provenance_map: {
    'EV-CG-021': {
      evidence_code: 'EV-CG-021',
      patient_id: 1,
      source_type: 'CAREGIVER',
      observed_at: '2026-09-02 17:30',
      recorded_at: '2026-09-02 18:00',
      original_statement: 'She needed someone arm while walking outside today.',
      category: 'mobility',
      status: 'IMMUTABLE',
      observer: 'CG002 (Son)',
      linked_claims: ['Support required outdoors.'],
    },
    'EV-CG-031': {
      evidence_code: 'EV-CG-031',
      patient_id: 1,
      source_type: 'CAREGIVER',
      observed_at: '2026-09-06 07:45',
      recorded_at: '2026-09-06 08:15',
      original_statement: 'She almost fell near the bathroom after standing up, but I caught her.',
      category: 'near_fall',
      status: 'IMMUTABLE',
      observer: 'CG001 (Daughter)',
      linked_claims: ['Near-fall episode with zero ground impact.'],
    },
  },
};

describe('Doctor Dashboard Frontend Unit Test Suite (21 Tests)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockDashboardData),
      })
    ));
  });

  const mockHeaderUser = {
    id: 1, username: 'doctor.demo', email: 'doctor.demo@evocare.health',
    full_name: 'Dr. Ramesh Varma, MD', role: 'DOCTOR' as const,
  };
  const mockHeaderProps = {
    patient: mockDashboardData.patient,
    user: mockHeaderUser,
    authorizedPatients: [{ patient_code: 'P001', name: 'Meenakshi Raman', age: 78, sex: 'Female', access_role: 'ATTENDING_PHYSICIAN' }],
    selectedPatientCode: 'P001',
    onSelectPatient: vi.fn(),
    onLogout: vi.fn(),
  };

  it('1. patient header renders patient name and code', () => {
    render(<Header {...mockHeaderProps} />);
    expect(screen.getByText('Meenakshi Raman')).toBeInTheDocument();
    expect(screen.getByText('P001')).toBeInTheDocument();
  });

  it('2. synthetic patient label renders clearly', () => {
    render(<Header {...mockHeaderProps} />);
    expect(screen.getByText('SYNTHETIC DEMO')).toBeInTheDocument();
  });

  it('3. clinical records render diagnoses', () => {
    render(
      <ClinicalContextPanel
        diagnoses={mockDashboardData.clinical_diagnoses}
        medications={mockDashboardData.medications}
        labs={mockDashboardData.labs}
      />
    );
    expect(screen.getByText('Type 2 Diabetes Mellitus without complications')).toBeInTheDocument();
    expect(screen.getByText('Essential (primary) Hypertension')).toBeInTheDocument();
  });

  it('4. medications render with dose and frequency', () => {
    render(
      <ClinicalContextPanel
        diagnoses={mockDashboardData.clinical_diagnoses}
        medications={mockDashboardData.medications}
        labs={mockDashboardData.labs}
      />
    );
    fireEvent.click(screen.getByText(/Medications/i));
    expect(screen.getByText('Metformin')).toBeInTheDocument();
    expect(screen.getByText('500 mg')).toBeInTheDocument();
    expect(screen.getByText('BID')).toBeInTheDocument();
  });

  it('5. labs render with test parameter and values', () => {
    render(
      <ClinicalContextPanel
        diagnoses={mockDashboardData.clinical_diagnoses}
        medications={mockDashboardData.medications}
        labs={mockDashboardData.labs}
      />
    );
    fireEvent.click(screen.getByText(/Laboratory/i));
    expect(screen.getByText('HbA1c')).toBeInTheDocument();
    expect(screen.getByText('7.4')).toBeInTheDocument();
  });

  it('6. caregiver observations are separated into their own feed', () => {
    render(
      <CaregiverObservationsPanel
        observations={mockDashboardData.caregiver_observations}
        onSelectEvidence={() => {}}
      />
    );
    expect(screen.getByText('Caregiver Observation Feed')).toBeInTheDocument();
    expect(screen.getByText(/She needed someone arm while walking outside today/i)).toBeInTheDocument();
  });

  it('7. recent changes render latest vs previous states', () => {
    render(
      <RecentChangesPanel
        recentChanges={mockDashboardData.recent_changes}
        onOpenWhy={() => {}}
        onSelectEvidence={() => {}}
      />
    );
    expect(screen.getByText('Indoor walking improved without support')).toBeInTheDocument();
    expect(screen.getByText('Required caregiver arm support outdoors')).toBeInTheDocument();
  });

  it('8. memory summary renders current version and baseline', () => {
    render(<LongitudinalMemoryPanel memory={mockDashboardData.longitudinal_memory} />);
    expect(screen.getByText(/MEMORY VERSION 27/i)).toBeInTheDocument();
    expect(screen.getByText(/Historically independently mobile/i)).toBeInTheDocument();
  });

  it('9. source badges render with appropriate styling and labels', () => {
    render(<SourceBadge type="CLINICIAN-CONFIRMED" />);
    expect(screen.getByText('CLINICIAN-CONFIRMED')).toBeInTheDocument();

    render(<SourceBadge type="CAREGIVER-REPORTED" />);
    expect(screen.getByText('CAREGIVER-REPORTED')).toBeInTheDocument();
  });

  it('10. AI-derived memory is explicitly labelled with disclaimer', () => {
    render(<SourceBadge type="AI-DERIVED" showDisclaimer={true} />);
    expect(screen.getByText(/AI-DERIVED/i)).toBeInTheDocument();
    expect(screen.getByText(/not a clinical diagnosis/i)).toBeInTheDocument();
  });

  it('11. Why button triggers provenance derivation modal', () => {
    const handleWhy = vi.fn();
    render(
      <RecentChangesPanel
        recentChanges={mockDashboardData.recent_changes}
        onOpenWhy={handleWhy}
        onSelectEvidence={() => {}}
      />
    );
    const whyButtons = screen.getAllByText(/Why\? \(Trace Provenance\)/i);
    fireEvent.click(whyButtons[0]);
    expect(handleWhy).toHaveBeenCalledWith(mockDashboardData.recent_changes[0]);
  });

  it('12. evidence viewer modal displays exact raw statement and metadata', () => {
    const evDetail = mockDashboardData.provenance_map['EV-CG-031'];
    render(<EvidenceDrawer evidence={evDetail} onClose={() => {}} />);
    expect(screen.getByText('EV-CG-031')).toBeInTheDocument();
    expect(screen.getByText(/She almost fell near the bathroom after standing up, but I caught her/i)).toBeInTheDocument();
  });

  it('13. original evidence statement is preserved exactly in WhyModal', () => {
    render(
      <WhyModal
        change={mockDashboardData.recent_changes[0]}
        provenanceMap={mockDashboardData.provenance_map}
        onClose={() => {}}
        onSelectEvidence={() => {}}
      />
    );
    expect(screen.getByText(/She needed someone arm while walking outside today/i)).toBeInTheDocument();
    expect(screen.getByText('EV-CG-021')).toBeInTheDocument();
  });

  it('14. conflicts render doctor vs caregiver views without auto-resolution', () => {
    render(<ConflictCard conflict={mockDashboardData.conflicts[0]} />);
    expect(screen.getByText('CLINICIAN VIEW')).toBeInTheDocument();
    expect(screen.getByText(/Independent mobility documented in clinic exam room/i)).toBeInTheDocument();
    expect(screen.getByText('CAREGIVER VIEW')).toBeInTheDocument();
    expect(screen.getByText(/Requires physical arm support when walking outdoors/i)).toBeInTheDocument();
  });

  it('15. timeline renders chronological events with source badges', () => {
    render(<PatientTimeline timeline={mockDashboardData.timeline} />);
    expect(screen.getByText('Routine Outpatient Review')).toBeInTheDocument();
    expect(screen.getByText('Near-Fall Incident')).toBeInTheDocument();
  });

  it('16. near-fall remains strictly near-fall (not upgraded to completed fall)', () => {
    render(<PatientOverviewCard overview={mockDashboardData.overview} />);
    expect(screen.getByText(/1 near-fall reported/i)).toBeInTheDocument();
    expect(screen.getByText(/0 falls/i)).toBeInTheDocument();
  });

  it('17. unknown values display as unknown without guessing', () => {
    render(<PatientOverviewCard overview={mockDashboardData.overview} />);
    expect(screen.getByText(/etiology UNKNOWN/i)).toBeInTheDocument();
  });

  it('18. empty/missing states do not display normal without proof', () => {
    render(
      <LongitudinalMemoryPanel memory={mockDashboardData.longitudinal_memory} />
    );
    expect(screen.getByText(/Exact etiology of transient unsteadiness and dizziness has not been established/i)).toBeInTheDocument();
  });

  it('19. API error state renders error message with retry button', () => {
    const handleRetry = vi.fn();
    render(<ErrorMessage message="Unable to connect to server." onRetry={handleRetry} />);
    expect(screen.getByText('Unable to load patient information')).toBeInTheDocument();
    expect(screen.getByText('Unable to connect to server.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry Connection'));
    expect(handleRetry).toHaveBeenCalled();
  });

  it('20. loading state renders clean clinical spinner', () => {
    render(<LoadingSpinner message="Loading patient data..." />);
    expect(screen.getByText('Loading patient data...')).toBeInTheDocument();
  });

  it('21. patient isolation is reflected in dashboard state', async () => {
    // Simulate an already-authenticated session
    const mockUser = {
      id: 1, username: 'doctor.demo', email: 'doctor.demo@evocare.health',
      full_name: 'Dr. Ramesh Varma, MD', role: 'DOCTOR',
    };
    localStorage.setItem('evocare_access_token', 'mock-valid-token');
    localStorage.setItem('evocare_user', JSON.stringify(mockUser));
    // Also mock the authorized-patients fetch
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (typeof url === 'string' && url.includes('authorized-patients')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([{ patient_code: 'P001', name: 'Meenakshi Raman', age: 78, sex: 'Female', access_role: 'ATTENDING_PHYSICIAN' }]) });
      }
      if (typeof url === 'string' && url.includes('/records/')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockDashboardData) });
    }));
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('Meenakshi Raman')).toBeInTheDocument();
    });
    localStorage.clear();
  });

  // ==========================================
  // PHASE 7: DOCTOR-ONLY CLINICAL REASONING
  // ==========================================

  it('22. Clinical Reasoning Panel renders with DOCTOR-ONLY demo banner', () => {
    const handleSelect = vi.fn();
    render(<ClinicalReasoningPanel patientId="P001" onSelectEvidence={handleSelect} />);
    expect(screen.getByText(/DOCTOR-ONLY CLINICAL REASONING/i)).toBeInTheDocument();
    expect(screen.getByText(/DEMO MODE — AUTHENTICATION NOT YET ENABLED/i)).toBeInTheDocument();
  });

  it('23. Clinical Reasoning inquiry input and example chips exist', () => {
    const handleSelect = vi.fn();
    render(<ClinicalReasoningPanel patientId="P001" onSelectEvidence={handleSelect} />);
    expect(screen.getByTestId('reasoning-input')).toBeInTheDocument();
    expect(screen.getByTestId('analyze-button')).toBeInTheDocument();
    expect(screen.getByText(/"Why is she dizzy\?"/i)).toBeInTheDocument();
  });

  it('24. Clinical reasoning result renders consideration cards and disclaimer', async () => {
    const mockReasoningResponse: any = {
      question: 'Why is she dizzy?',
      patient_id: 'P001',
      generated_at: '2026-09-10 12:00:00 UTC',
      context_summary: {
        patient_id: 'P001',
        name: 'Meenakshi Raman',
        age: 78,
        sex: 'Female',
        diagnoses: ['Essential Hypertension (I10)'],
        active_medications: ['Amlodipine 5mg'],
        relevant_observations: ['2026-09-03: Dizzy on standing'],
        relevant_changes: ['Recent episodic dizziness'],
        relevant_labs: ['Hemoglobin: 12.8 g/dL'],
        known_unknowns: ['Dizziness etiology: UNKNOWN'],
        conflicts: [],
        total_evidence_count: 65
      },
      considerations: [
        {
          title: 'Postural / Orthostatic Instability Process',
          category: 'Hemodynamic / Postural',
          description: 'Episodic lightheadedness reported after standing.',
          status: 'POSSIBLE_CONSIDERATION',
          supporting_evidence: [
            {
              evidence_id: 'EV-CG-041',
              source_type: 'CAREGIVER-REPORTED',
              observed_at: '2026-09-03',
              original_statement: 'Patient felt dizzy after getting out of bed.'
            }
          ],
          contradicting_evidence: ['Dizziness etiology is explicitly UNKNOWN in clinical database.'],
          missing_information: ['Orthostatic vital signs'],
          evidence_strength: 'LIMITED',
          reasoning: 'Symptom onset upon getting out of bed suggests postural component.',
          uncertainty: 'Etiology is unconfirmed.',
          references: ['EV-CG-041']
        }
      ],
      missing_information: ['Lying and standing orthostatic vital signs'],
      red_flags: ['Prompt clinical assessment is warranted if dizziness is accompanied by true syncope.'],
      relevant_changes: ['Recent episodic dizziness upon rising from bed'],
      limitations: ['Caregiver observations provide qualitative context.'],
      disclaimer: 'AI-generated clinical reasoning support derived from recorded evidence. This tool does not establish a medical diagnosis or replace clinical judgment.'
    };

    vi.spyOn(apiService, 'getClinicalReasoning').mockResolvedValueOnce(mockReasoningResponse);

    const handleSelect = vi.fn();
    render(<ClinicalReasoningPanel patientId="P001" onSelectEvidence={handleSelect} />);
    const input = screen.getByTestId('reasoning-input');
    fireEvent.change(input, { target: { value: 'Why is she dizzy?' } });
    fireEvent.click(screen.getByTestId('analyze-button'));

    await waitFor(() => {
      expect(screen.getByText(/AI CLINICAL CONSIDERATION • NOT A DIAGNOSIS/i)).toBeInTheDocument();
      expect(screen.getByText(/Postural \/ Orthostatic Instability Process/i)).toBeInTheDocument();
      expect(screen.getByText(/STATUS: POSSIBLE_CONSIDERATION/i)).toBeInTheDocument();
      expect(screen.getByText(/EVIDENCE STRENGTH: LIMITED/i)).toBeInTheDocument();
      expect(screen.getByText('EV-CG-041')).toBeInTheDocument();
      expect(screen.getByText(/Doctor Decision Disclaimer:/i)).toBeInTheDocument();
    });
  });

  it('25. Supporting evidence pill click-through invokes onSelectEvidence', async () => {
    const mockReasoningResponse: any = {
      question: 'Mobility status?',
      patient_id: 'P001',
      generated_at: '2026-09-10 12:00:00 UTC',
      context_summary: {
        patient_id: 'P001',
        name: 'Meenakshi Raman',
        age: 78,
        sex: 'Female',
        diagnoses: [],
        active_medications: [],
        relevant_observations: [],
        relevant_changes: [],
        relevant_labs: [],
        known_unknowns: [],
        conflicts: [],
        total_evidence_count: 65
      },
      considerations: [
        {
          title: 'Mobility Trajectory',
          category: 'Mobility',
          description: 'Near-fall and recovery.',
          status: 'POSSIBLE_CONSIDERATION',
          supporting_evidence: [
            {
              evidence_id: 'EV-CG-045',
              source_type: 'CAREGIVER-REPORTED',
              observed_at: '2026-09-01',
              original_statement: 'Stumbled near bathroom door; caught by caregiver.'
            }
          ],
          contradicting_evidence: [],
          missing_information: [],
          evidence_strength: 'MODERATE',
          reasoning: 'Near fall with recovery.',
          uncertainty: 'Observed at home.',
          references: ['EV-CG-045']
        }
      ],
      missing_information: [],
      red_flags: [],
      relevant_changes: [],
      limitations: [],
      disclaimer: 'AI-generated clinical reasoning support.'
    };

    vi.spyOn(apiService, 'getClinicalReasoning').mockResolvedValueOnce(mockReasoningResponse);

    const handleSelect = vi.fn();
    render(<ClinicalReasoningPanel patientId="P001" onSelectEvidence={handleSelect} />);
    const input = screen.getByTestId('reasoning-input');
    fireEvent.change(input, { target: { value: 'Mobility status?' } });
    fireEvent.click(screen.getByTestId('analyze-button'));

    await waitFor(() => {
      expect(screen.getByText('EV-CG-045')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('EV-CG-045'));
    expect(handleSelect).toHaveBeenCalledWith('EV-CG-045');
  });
});
