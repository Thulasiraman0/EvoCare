import React, { useState, useEffect } from 'react';
import { usePatient } from '../hooks/usePatient';
import { Header } from '../components/layout/Header';
import { SafetyAlert } from '../components/common/SafetyAlert';
import { PatientOverviewCard } from '../components/patient/PatientOverviewCard';
import { RecentChangesPanel } from '../components/patient/RecentChangesPanel';
import { ClinicalContextPanel } from '../components/clinical/ClinicalContextPanel';
import { CaregiverObservationsPanel } from '../components/caregiver/CaregiverObservationsPanel';
import { DoctorRecordsPanel } from '../components/records/DoctorRecordsPanel';
import { LongitudinalMemoryPanel } from '../components/memory/LongitudinalMemoryPanel';
import { ClinicalReasoningPanel } from '../components/reasoning/ClinicalReasoningPanel';
import { PatientTimeline } from '../components/timeline/PatientTimeline';
import { ConflictCard } from '../components/common/ConflictCard';
import { WhyModal } from '../components/evidence/WhyModal';
import { EvidenceDrawer } from '../components/evidence/EvidenceDrawer';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { RecentChangeItem, EvidenceDetailItem } from '../types';
import { ShieldCheck, AlertTriangle } from 'lucide-react';
import { authService, AuthUser, AuthorizedPatient } from '../services/auth';

interface DashboardProps {
  user: AuthUser;
  onLogout: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ user, onLogout }) => {
  const [authorizedPatients, setAuthorizedPatients] = useState<AuthorizedPatient[]>([]);
  const [selectedPatientCode, setSelectedPatientCode] = useState<string>('P001');

  const { data, loading, error, refetch } = usePatient(selectedPatientCode);
  const [selectedWhyChange, setSelectedWhyChange] = useState<RecentChangeItem | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceDetailItem | null>(null);

  // Fetch authorized patient list from backend (not hardcoded)
  useEffect(() => {
    authService.getAuthorizedPatients().then((patients) => {
      setAuthorizedPatients(patients);
      // Auto-select first authorized patient if available
      if (patients.length > 0) {
        setSelectedPatientCode(patients[0].patient_code);
      }
    });
  }, []);

  const handleOpenEvidence = (code: string) => {
    if (data?.provenance_map && data.provenance_map[code]) {
      setSelectedEvidence(data.provenance_map[code]);
    } else {
      setSelectedEvidence({
        evidence_code: code,
        patient_id: data?.patient?.id || 1,
        source_type: code.startsWith('EV-CG') ? 'CAREGIVER' : code.startsWith('EV-DR') ? 'DOCTOR' : 'PATIENT',
        observed_at: '—',
        recorded_at: '—',
        original_statement: `Evidence record ${code}. Full record available in the backend evidence store.`,
        category: 'general',
        status: 'IMMUTABLE',
        observer: 'On record',
        linked_claims: [],
      });
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc' }}>
        <LoadingSpinner message="Loading EvoCare Patient Dashboard…" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', padding: '40px 20px' }}>
        <ErrorMessage message={error || `Patient ${selectedPatientCode} records unavailable.`} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', color: '#0f172a' }}>
      {/* Top Fixed Header */}
      <Header
        patient={data.patient}
        user={user}
        authorizedPatients={authorizedPatients}
        selectedPatientCode={selectedPatientCode}
        onSelectPatient={setSelectedPatientCode}
        onLogout={onLogout}
      />

      {/* Main Content Area */}
      <main style={{ maxWidth: '1440px', margin: '0 auto', padding: '24px' }}>
        {/* Safety & Read-Only Banner */}
        <SafetyAlert />

        {/* 1. Patient Overview Card (6 key health domains) */}
        <PatientOverviewCard overview={data.overview} />

        {/* 2. Most Important Section: Recent Changes Panel */}
        <RecentChangesPanel
          recentChanges={data.recent_changes}
          onOpenWhy={(change) => setSelectedWhyChange(change)}
          onSelectEvidence={handleOpenEvidence}
        />

        {/* 2-Column Clinical & Caregiver Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: '24px', marginBottom: '24px' }}>
          {/* Clinical Context */}
          <ClinicalContextPanel
            diagnoses={data.clinical_diagnoses}
            medications={data.medications}
            labs={data.labs}
            onSelectEvidence={handleOpenEvidence}
          />

          {/* Caregiver Observations */}
          <CaregiverObservationsPanel
            observations={data.caregiver_observations}
            onSelectEvidence={handleOpenEvidence}
          />
        </div>

        {/* Clinical Records — append-only, doctor-authored (add record: DOCTOR only) */}
        <DoctorRecordsPanel patientCode={data.patient.patient_code} user={user} />

        {/* Phase 7: Doctor-Only Clinical Reasoning Assistant */}
        <ClinicalReasoningPanel
          patientId={data.patient.patient_code}
          onSelectEvidence={handleOpenEvidence}
        />

        {/* 3. Longitudinal Memory Panel */}
        <LongitudinalMemoryPanel
          memory={data.longitudinal_memory}
          patientId={data.patient.patient_code}
          onSelectEvidence={handleOpenEvidence}
        />

        {/* 4. Longitudinal Patient Timeline */}
        <PatientTimeline
          timeline={data.timeline}
          onSelectEvidence={handleOpenEvidence}
        />

        {/* 5. Discrepancy & Conflict Analysis Panel */}
        {data.conflicts && data.conflicts.length > 0 && (
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              border: '1px solid #fed7aa',
              padding: '20px',
              marginBottom: '24px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <AlertTriangle size={18} style={{ color: '#ea580c' }} />
              <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#9a3412', margin: 0 }}>
                Contextual Discrepancies &amp; Conflict Analysis
              </h2>
            </div>
            <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 14px 0' }}>
              Recorded differences between clinical exam and home observations (Preserved contextually without premature AI resolution)
            </p>
            {data.conflicts.map((c) => (
              <ConflictCard key={c.id} conflict={c} onSelectEvidence={handleOpenEvidence} />
            ))}
          </div>
        )}

        {/* Footer Note */}
        <footer
          style={{
            textAlign: 'center',
            padding: '24px 0',
            borderTop: '1px solid #e2e8f0',
            color: '#94a3b8',
            fontSize: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '4px' }}>
            <ShieldCheck size={14} style={{ color: '#0284c7' }} />
            <span>EvoCare Clinical Intelligence Station · Read-Only Invariant Enforced · Phase 9</span>
          </div>
          <div>Patient {data.patient.patient_code} ({data.patient.name}) · Synthetic Demo Dataset</div>
        </footer>
      </main>

      {/* Modals & Drawers */}
      <WhyModal
        change={selectedWhyChange}
        provenanceMap={data.provenance_map}
        onClose={() => setSelectedWhyChange(null)}
        onSelectEvidence={handleOpenEvidence}
      />

      <EvidenceDrawer
        evidence={selectedEvidence}
        onClose={() => setSelectedEvidence(null)}
      />
    </div>
  );
};
