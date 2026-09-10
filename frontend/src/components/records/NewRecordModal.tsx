import React, { useState } from 'react';
import { X, FilePlus2, ShieldCheck, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { DoctorRecordItem, DoctorRecordType } from '../../types';
import { apiService } from '../../services/api';

interface NewRecordModalProps {
  patientCode: string;
  doctorName: string;
  onClose: () => void;
  onCreated: (record: DoctorRecordItem) => void;
}

const RECORD_TYPES: { value: DoctorRecordType; label: string; hint: string }[] = [
  { value: 'consultation', label: 'Consultation', hint: 'A clinical encounter note' },
  { value: 'follow_up', label: 'Follow-up', hint: 'Progress review of a prior issue' },
  { value: 'assessment', label: 'Assessment', hint: 'Examination / test findings' },
  { value: 'historical_note', label: 'Historical Note', hint: 'Context from earlier care' },
];

/**
 * DOCTOR-only modal: append a new clinical record.
 * On success the record becomes an IMMUTABLE evidence (EV-DR-xxx).
 * Existing records are never edited — corrections are new records.
 */
export const NewRecordModal: React.FC<NewRecordModalProps> = ({ patientCode, doctorName, onClose, onCreated }) => {
  const [recordType, setRecordType] = useState<DoctorRecordType>('consultation');
  const [content, setContent] = useState('');
  const [observedAt, setObservedAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<DoctorRecordItem | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (content.trim().length < 10) {
      setError('Record content must be at least 10 characters.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const record = await apiService.createPatientRecord(patientCode, {
        record_type: recordType,
        content: content.trim(),
        observed_at: observedAt ? new Date(observedAt).toISOString() : null,
        doctor_name: doctorName || null,
      });
      setCreated(record);
      onCreated(record);
    } catch (err: any) {
      setError(err?.message || 'Could not create the record.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: '20px',
      }}
      onClick={submitting ? undefined : onClose}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '14px',
          border: '1px solid #e2e8f0',
          width: '100%',
          maxWidth: '560px',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 20px 50px rgba(0,0,0,0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '18px 22px',
            borderBottom: '1px solid #e2e8f0',
            position: 'sticky',
            top: 0,
            backgroundColor: '#ffffff',
            borderRadius: '14px 14px 0 0',
          }}
        >
          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '9px',
              backgroundColor: '#0284c7',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <FilePlus2 size={17} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>Add New Clinical Record</div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              Patient {patientCode} · Appended as immutable evidence
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: '4px' }}
          >
            <X size={18} />
          </button>
        </div>

        {created ? (
          /* ---------------- Success state ---------------- */
          <div style={{ padding: '28px 22px', textAlign: 'center' }}>
            <CheckCircle2 size={44} style={{ color: '#059669' }} />
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', margin: '12px 0 4px' }}>
              Record added to patient memory
            </div>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 16px' }}>
              Stored as immutable evidence with full provenance. It cannot be edited or deleted —
              corrections must be added as a new record.
            </p>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                backgroundColor: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: '8px',
                padding: '8px 14px',
                marginBottom: '20px',
              }}
            >
              <ShieldCheck size={15} style={{ color: '#059669' }} />
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#065f46' }}>
                {created.evidence_code}
              </span>
              <span style={{ fontSize: '11px', color: '#059669', backgroundColor: '#dcfce7', padding: '2px 8px', borderRadius: '999px' }}>
                IMMUTABLE
              </span>
            </div>
            <div>
              <button
                onClick={onClose}
                style={{
                  padding: '10px 22px',
                  backgroundColor: '#0284c7',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          /* ---------------- Form state ---------------- */
          <form onSubmit={handleSubmit} style={{ padding: '20px 22px' }}>
            {error && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  marginBottom: '16px',
                }}
              >
                <AlertCircle size={15} style={{ color: '#dc2626', flexShrink: 0, marginTop: '1px' }} />
                <span style={{ fontSize: '12px', color: '#991b1b' }}>{error}</span>
              </div>
            )}

            {/* Record type */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                Record Type
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {RECORD_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setRecordType(t.value)}
                    style={{
                      textAlign: 'left',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      border: recordType === t.value ? '1.5px solid #0284c7' : '1px solid #e2e8f0',
                      backgroundColor: recordType === t.value ? '#f0f9ff' : '#ffffff',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontSize: '12px', fontWeight: 700, color: recordType === t.value ? '#0284c7' : '#374151' }}>
                      {t.label}
                    </div>
                    <div style={{ fontSize: '10px', color: '#94a3b8' }}>{t.hint}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Content */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                Clinical Content
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={6}
                maxLength={8000}
                placeholder="Record your clinical observations, examination findings, and notes for this patient…"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  fontSize: '13px',
                  color: '#0f172a',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  outline: 'none',
                  fontFamily: 'inherit',
                  lineHeight: 1.5,
                }}
                onFocus={(e) => (e.target.style.borderColor = '#0284c7')}
                onBlur={(e) => (e.target.style.borderColor = '#d1d5db')}
              />
              <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '4px', textAlign: 'right' }}>
                {content.length}/8000
              </div>
            </div>

            {/* Observed date + doctor name */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                  Encounter Date <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span>
                </label>
                <input
                  type="date"
                  value={observedAt}
                  onChange={(e) => setObservedAt(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 10px',
                    border: '1px solid #d1d5db',
                    borderRadius: '8px',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                    color: '#0f172a',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                  Attending Physician
                </label>
                <input
                  type="text"
                  value={doctorName}
                  disabled
                  style={{
                    width: '100%',
                    padding: '9px 10px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                    backgroundColor: '#f8fafc',
                    color: '#64748b',
                  }}
                />
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                style={{
                  padding: '10px 18px',
                  backgroundColor: '#ffffff',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                id="evocare-record-submit"
                disabled={submitting || content.trim().length < 10}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 18px',
                  backgroundColor: submitting || content.trim().length < 10 ? '#93c5fd' : '#0284c7',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: submitting || content.trim().length < 10 ? 'not-allowed' : 'pointer',
                }}
              >
                {submitting ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />}
                {submitting ? 'Saving…' : 'Save as Immutable Evidence'}
              </button>
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </form>
        )}
      </div>
    </div>
  );
};
