import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Plus, ShieldCheck, RefreshCw, Stethoscope } from 'lucide-react';
import { AuthUser } from '../../services/auth';
import { apiService } from '../../services/api';
import { DoctorRecordItem } from '../../types';
import { NewRecordModal } from './NewRecordModal';
import { LoadingSpinner } from '../common/LoadingSpinner';

interface DoctorRecordsPanelProps {
  patientCode: string;
  user: AuthUser;
}

const TYPE_LABELS: Record<string, string> = {
  consultation: 'Consultation',
  follow_up: 'Follow-up',
  assessment: 'Assessment',
  historical_note: 'Historical Note',
};

const TYPE_COLORS: Record<string, string> = {
  consultation: '#0284c7',
  follow_up: '#7c3aed',
  assessment: '#059669',
  historical_note: '#64748b',
};

/**
 * Clinical Records panel — the living, append-only record list.
 * Doctors can add new records (become immutable EV-DR evidence);
 * all authorized roles see the same history.
 */
export const DoctorRecordsPanel: React.FC<DoctorRecordsPanelProps> = ({ patientCode, user }) => {
  const [records, setRecords] = useState<DoctorRecordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  const isDoctor = user.role === 'DOCTOR';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiService.getPatientRecords(patientCode);
      setRecords(data);
    } catch (err: any) {
      setError(err?.message || 'Unable to load clinical records.');
    } finally {
      setLoading(false);
    }
  }, [patientCode]);

  useEffect(() => {
    load();
  }, [load]);

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
      return iso;
    }
  };

  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        padding: '20px',
        marginBottom: '24px',
      }}
    >
      {/* Panel header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            backgroundColor: '#0284c7',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Stethoscope size={16} />
        </div>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', margin: 0 }}>
            Clinical Records
          </h2>
          <p style={{ fontSize: '11px', color: '#64748b', margin: '2px 0 0' }}>
            Append-only clinical documentation — every entry is immutable evidence (EV-DR)
          </p>
        </div>
        <button
          onClick={load}
          title="Refresh"
          style={{
            background: 'none',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '7px',
            cursor: 'pointer',
            color: '#64748b',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <RefreshCw size={14} />
        </button>
        {isDoctor && (
          <button
            id="evocare-add-record"
            onClick={() => setShowModal(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              backgroundColor: '#0284c7',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(2, 132, 199, 0.3)',
            }}
          >
            <Plus size={14} />
            Add New Record
          </button>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <LoadingSpinner message="Loading clinical records…" />
      ) : error ? (
        <div
          style={{
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            padding: '12px 14px',
            fontSize: '13px',
            color: '#991b1b',
          }}
        >
          {error}
        </div>
      ) : records.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '28px 0', color: '#94a3b8', fontSize: '13px' }}>
          <FileText size={28} style={{ marginBottom: '8px' }} />
          <div>No clinical records yet.</div>
          {isDoctor && <div style={{ fontSize: '11px', marginTop: '4px' }}>Use “Add New Record” to document the first encounter.</div>}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
          {records.map((r) => {
            const color = TYPE_COLORS[r.record_type] || '#64748b';
            return (
              <div
                key={r.id}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '12px 14px',
                  backgroundColor: '#fafafa',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      color,
                      backgroundColor: color + '14',
                      padding: '2px 8px',
                      borderRadius: '999px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {TYPE_LABELS[r.record_type] || r.record_type}
                  </span>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '10px',
                      fontWeight: 700,
                      color: '#059669',
                      backgroundColor: '#ecfdf5',
                      padding: '2px 8px',
                      borderRadius: '999px',
                    }}
                  >
                    <ShieldCheck size={11} />
                    {r.evidence_code}
                  </span>
                  <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: 'auto' }}>
                    {formatDate(r.observed_at)}
                  </span>
                </div>
                <div style={{ fontSize: '13px', color: '#1e293b', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                  {r.content}
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '8px' }}>
                  Recorded by {r.doctor_name || r.doctor_id} · {formatDate(r.created_at)} · Immutable
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add-record modal */}
      {showModal && (
        <NewRecordModal
          patientCode={patientCode}
          doctorName={user.full_name}
          onClose={() => setShowModal(false)}
          onCreated={() => load()}
        />
      )}
    </div>
  );
};
