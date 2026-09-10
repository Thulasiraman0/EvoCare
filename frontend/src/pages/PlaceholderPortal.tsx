import React from 'react';
import { Activity, LogOut, HardHat, ShieldCheck, CalendarClock } from 'lucide-react';
import { AuthUser, authService } from '../services/auth';

interface PlaceholderPortalProps {
  user: AuthUser;
  onLogout: () => void;
}

const ROLE_CONTENT: Record<string, { title: string; subtitle: string; bullets: string[] }> = {
  CAREGIVER: {
    title: 'Caregiver Portal',
    subtitle: 'Home observations, daily logs and clarification requests will live here.',
    bullets: [
      'Submit free-text home observations ("She stumbled near the bathroom")',
      'Answer adaptive clarification questions before evidence is committed',
      'Track which of your reports the doctor has reviewed',
    ],
  },
  ADMIN: {
    title: 'Admin Console',
    subtitle: 'User management, access grants and the security audit trail will live here.',
    bullets: [
      'Create users and manage role assignments (Doctor / Caregiver / Patient / Admin)',
      'Grant and revoke patient-level access',
      'Review immutable audit logs and security events',
    ],
  },
};

/**
 * Shared placeholder screen for roles whose portals are scheduled for the next
 * phase (CAREGIVER console, ADMIN console). Authentication, RBAC and the OTP
 * flow are fully live for these roles — only the workspace UI is pending.
 */
export const PlaceholderPortal: React.FC<PlaceholderPortalProps> = ({ user, onLogout }) => {
  const content = ROLE_CONTENT[user.role] ?? { title: 'Portal', subtitle: '', bullets: [] };
  const isAdmin = user.role === 'ADMIN';

  const handleLogout = async () => {
    await authService.logout();
    onLogout();
  };

  const accent = isAdmin ? '#7c3aed' : '#059669';

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: isAdmin ? '#faf5ff' : '#f0fdf4',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          padding: '36px',
          width: '100%',
          maxWidth: '480px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: '52px',
            height: '52px',
            borderRadius: '13px',
            backgroundColor: accent + '18',
            color: accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
          }}
        >
          <HardHat size={26} />
        </div>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a', margin: '0 0 6px' }}>
          {content.title}
        </h1>
        <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 20px' }}>{content.subtitle}</p>

        <div style={{ textAlign: 'left', marginBottom: '22px' }}>
          {content.bullets.map((b) => (
            <div
              key={b}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                padding: '8px 10px',
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                marginBottom: '6px',
                fontSize: '12px',
                color: '#374151',
              }}
            >
              <CalendarClock size={14} style={{ color: accent, flexShrink: 0, marginTop: '1px' }} />
              {b}
            </div>
          ))}
        </div>

        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '11px',
            fontWeight: 700,
            color: accent,
            backgroundColor: accent + '12',
            padding: '5px 12px',
            borderRadius: '999px',
            marginBottom: '22px',
          }}
        >
          <ShieldCheck size={12} />
          Signed in as {user.full_name} ({user.role}) · two-step verified
        </div>

        <div>
          <button
            onClick={handleLogout}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '10px 22px',
              backgroundColor: '#ffffff',
              color: '#374151',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '18px', fontSize: '11px', color: '#94a3b8' }}>
        <Activity size={12} style={{ color: accent }} />
        EvoCare · Synthetic demo data only · Not for clinical use
      </div>
    </div>
  );
};
