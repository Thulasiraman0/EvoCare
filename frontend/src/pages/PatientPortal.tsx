import React, { useEffect, useState } from 'react';
import { Activity, LogOut, HeartPulse, ShieldCheck, Info, UserRound } from 'lucide-react';
import { AuthUser, authService, AuthorizedPatient } from '../services/auth';
import { usePatient } from '../hooks/usePatient';
import { PatientOverviewCard } from '../components/patient/PatientOverviewCard';
import { DoctorRecordsPanel } from '../components/records/DoctorRecordsPanel';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { SafetyAlert } from '../components/common/SafetyAlert';

interface PatientPortalProps {
  user: AuthUser;
  onLogout: () => void;
}

/**
 * PATIENT portal — a simple, read-only view of the patient's own living memory:
 * health-domain overview (identical data the doctor sees) plus the clinical
 * record history authored by the care team. No clinical tools, no AI reasoning,
 * no write access — the backend enforces this independently of the UI.
 */
export const PatientPortal: React.FC<PatientPortalProps> = ({ user, onLogout }) => {
  const [authorizedPatients, setAuthorizedPatients] = useState<AuthorizedPatient[]>([]);
  const patientCode = authorizedPatients[0]?.patient_code ?? 'P001';
  const { data, loading, error, refetch } = usePatient(patientCode);

  useEffect(() => {
    authService.getAuthorizedPatients().then(setAuthorizedPatients);
  }, []);

  const handleLogout = async () => {
    await authService.logout();
    onLogout();
  };

  if (loading || !data) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#fffbeb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {(loading || !error) && <LoadingSpinner message="Loading your health memory…" />}
        {error && <ErrorMessage message={error} onRetry={refetch} />}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#fffbeb', padding: '40px 20px' }}>
        <ErrorMessage message={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#fffbeb', color: '#0f172a', fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Header */}
      <header
        style={{
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #fde68a',
          padding: '12px 24px',
          position: 'sticky',
          top: 0,
          zIndex: 40,
        }}
      >
        <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              backgroundColor: '#d97706',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
            }}
          >
            <Activity size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
              EvoCare <span style={{ color: '#d97706' }}>Patient Portal</span>
            </div>
            <div style={{ fontSize: '11px', color: '#92400e' }}>
              Your personal health memory · read-only
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              fontWeight: 600,
              color: '#d97706',
              backgroundColor: '#fef3c7',
              padding: '6px 12px',
              borderRadius: '999px',
            }}
          >
            <UserRound size={13} />
            {user.full_name}
          </div>
          <button
            onClick={handleLogout}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              backgroundColor: '#ffffff',
              border: '1px solid #fde68a',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 600,
              color: '#92400e',
              cursor: 'pointer',
            }}
          >
            <LogOut size={13} />
            Sign out
          </button>
        </div>
      </header>

      <main style={{ maxWidth: '1100px', margin: '0 auto', padding: '24px' }}>
        <SafetyAlert />

        {/* Welcome card */}
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #fde68a',
            padding: '20px 22px',
            marginBottom: '24px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '14px',
          }}
        >
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '11px',
              backgroundColor: '#fef3c7',
              color: '#d97706',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <HeartPulse size={22} />
          </div>
          <div>
            <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', margin: '0 0 4px' }}>
              Welcome, {user.full_name.split('(')[0].trim()}
            </h1>
            <p style={{ fontSize: '13px', color: '#78716c', margin: 0, lineHeight: 1.55 }}>
              This is your longitudinal health memory — the same living record your doctors and
              caregivers see. You can review your health trends and every clinical note your care
              team has written. If anything looks unclear, ask your doctor at your next visit.
            </p>
          </div>
        </div>

        {/* Health domains overview (shared component, read-only data) */}
        <PatientOverviewCard overview={data.overview} />

        {/* Clinical records — same append-only store doctors write to */}
        <DoctorRecordsPanel patientCode={data.patient.patient_code} user={user} />

        {/* Note */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            backgroundColor: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: '10px',
            padding: '14px 16px',
            marginBottom: '24px',
          }}
        >
          <Info size={16} style={{ color: '#2563eb', flexShrink: 0, marginTop: '1px' }} />
          <span style={{ fontSize: '12px', color: '#1e40af', lineHeight: 1.5 }}>
            Your care team (doctors and caregivers) record observations here over time. This page is
            read-only — only your doctor can add clinical records, and every entry is permanently
            preserved with proof of who recorded it and when.
          </span>
        </div>

        <footer style={{ textAlign: 'center', padding: '20px 0', borderTop: '1px solid #fde68a', color: '#b0a892', fontSize: '11px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '4px' }}>
            <ShieldCheck size={13} style={{ color: '#d97706' }} />
            EvoCare Patient Portal · Read-Only · Synthetic Demo Dataset
          </div>
        </footer>
      </main>
    </div>
  );
};
