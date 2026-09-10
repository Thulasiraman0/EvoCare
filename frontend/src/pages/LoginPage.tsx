import React, { useEffect, useState } from 'react';
import {
  Activity, Lock, User, AlertCircle, ShieldCheck, Eye, EyeOff,
  Smartphone, ArrowLeft, KeyRound, Timer, Info,
} from 'lucide-react';
import { authService, AuthUser, OTPChallenge, OTPNotRequiredError } from '../services/auth';

interface LoginPageProps {
  onLoginSuccess: (user: AuthUser) => void;
}

const DEMO_ACCOUNTS = [
  { label: 'Doctor (P001)', user: 'doctor.demo', pass: 'DoctorPass123!', color: '#0284c7' },
  { label: 'Patient (P001)', user: 'patient.demo', pass: 'PatientPass123!', color: '#d97706' },
  { label: 'Caregiver (P001)', user: 'caregiver.demo', pass: 'CaregiverPass123!', color: '#059669' },
  { label: 'Admin', user: 'admin.demo', pass: 'AdminPass123!', color: '#7c3aed' },
];

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [step, setStep] = useState<'credentials' | 'otp'>('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // OTP step state
  const [challenge, setChallenge] = useState<OTPChallenge | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  // Resend cooldown ticker
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const otpChallenge = await authService.beginLogin(username.trim(), password);
      setChallenge(otpChallenge);
      setOtpCode('');
      setResendCooldown(30);
      setStep('otp');
    } catch (err: any) {
      if (err instanceof OTPNotRequiredError) {
        onLoginSuccess(err.user); // OTP disabled on server — already logged in
        return;
      }
      setError(err?.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpVerify = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!challenge) return;
    if (!otpCode.trim()) {
      setError('Please enter the verification code.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const user = await authService.verifyOtp(challenge.challenge_id, otpCode.trim());
      onLoginSuccess(user);
    } catch (err: any) {
      setError(err?.message || 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!challenge || resendCooldown > 0) return;
    setLoading(true);
    setError(null);
    try {
      const fresh = await authService.resendOtp(challenge.challenge_id);
      setChallenge(fresh);
      setOtpCode('');
      setResendCooldown(30);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Could not resend the code.');
    } finally {
      setLoading(false);
    }
  };

  const backToCredentials = () => {
    setStep('credentials');
    setChallenge(null);
    setOtpCode('');
    setError(null);
  };

  const fillDemo = (u: string, p: string) => {
    setUsername(u);
    setPassword(p);
    setError(null);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px 10px 36px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '14px',
    color: '#0f172a',
    backgroundColor: loading ? '#f9fafb' : '#ffffff',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#f0f9ff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '32px' }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            backgroundColor: '#0284c7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            boxShadow: '0 4px 12px rgba(2, 132, 199, 0.3)',
          }}
        >
          <Activity size={28} />
        </div>
        <div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em' }}>
            EvoCare
          </div>
          <div style={{ fontSize: '12px', color: '#64748b', marginTop: '1px' }}>
            Longitudinal Patient Memory System
          </div>
        </div>
      </div>

      {/* Card */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          padding: '36px',
          width: '100%',
          maxWidth: '420px',
          boxShadow: '0 4px 24px rgba(0, 0, 0, 0.06)',
        }}
      >
        {step === 'credentials' ? (
          <>
            <h2
              style={{
                fontSize: '20px',
                fontWeight: 700,
                color: '#0f172a',
                margin: '0 0 4px 0',
                letterSpacing: '-0.02em',
              }}
            >
              Sign In
            </h2>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 28px 0' }}>
              Step 1 of 2 — verify your identity to receive a one-time code
            </p>

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
                  marginBottom: '20px',
                }}
              >
                <AlertCircle size={16} style={{ color: '#dc2626', flexShrink: 0, marginTop: '1px' }} />
                <span style={{ fontSize: '13px', color: '#991b1b' }}>{error}</span>
              </div>
            )}

            <form onSubmit={handleCredentialsSubmit}>
              {/* Username */}
              <div style={{ marginBottom: '16px' }}>
                <label
                  htmlFor="evocare-username"
                  style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}
                >
                  User ID
                </label>
                <div style={{ position: 'relative' }}>
                  <User
                    size={15}
                    style={{
                      position: 'absolute',
                      left: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: '#9ca3af',
                    }}
                  />
                  <input
                    id="evocare-username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="e.g. doctor.demo"
                    autoComplete="username"
                    disabled={loading}
                    style={inputStyle}
                    onFocus={(e) => (e.target.style.borderColor = '#0284c7')}
                    onBlur={(e) => (e.target.style.borderColor = '#d1d5db')}
                  />
                </div>
              </div>

              {/* Password */}
              <div style={{ marginBottom: '24px' }}>
                <label
                  htmlFor="evocare-password"
                  style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}
                >
                  Password
                </label>
                <div style={{ position: 'relative' }}>
                  <Lock
                    size={15}
                    style={{
                      position: 'absolute',
                      left: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: '#9ca3af',
                    }}
                  />
                  <input
                    id="evocare-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    autoComplete="current-password"
                    disabled={loading}
                    style={{ ...inputStyle, paddingRight: '40px' }}
                    onFocus={(e) => (e.target.style.borderColor = '#0284c7')}
                    onBlur={(e) => (e.target.style.borderColor = '#d1d5db')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '4px',
                      color: '#9ca3af',
                    }}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <button
                id="evocare-login-submit"
                type="submit"
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '11px',
                  backgroundColor: loading ? '#93c5fd' : '#0284c7',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  transition: 'background-color 0.15s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
              >
                {loading ? (
                  <>
                    <span
                      style={{
                        width: '14px',
                        height: '14px',
                        border: '2px solid rgba(255,255,255,0.4)',
                        borderTopColor: '#ffffff',
                        borderRadius: '50%',
                        animation: 'spin 0.7s linear infinite',
                        display: 'inline-block',
                      }}
                    />
                    Verifying…
                  </>
                ) : (
                  <>
                    <Lock size={14} />
                    Continue
                  </>
                )}
              </button>
            </form>
          </>
        ) : (
          <>
            {/* ==================== OTP STEP ==================== */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  backgroundColor: '#ecfeff',
                  border: '1px solid #a5f3fc',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#0e7490',
                }}
              >
                <KeyRound size={18} />
              </div>
              <h2
                style={{
                  fontSize: '20px',
                  fontWeight: 700,
                  color: '#0f172a',
                  margin: 0,
                  letterSpacing: '-0.02em',
                }}
              >
                Two-Step Verification
              </h2>
            </div>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '10px 0 4px 0' }}>
              Step 2 of 2 — a one-time code was sent to
            </p>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                backgroundColor: '#f0f9ff',
                border: '1px solid #bae6fd',
                borderRadius: '8px',
                padding: '10px 12px',
                marginBottom: '6px',
              }}
            >
              <Smartphone size={15} style={{ color: '#0284c7', flexShrink: 0 }} />
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#0c4a6e' }}>
                {challenge?.masked_destination}
              </span>
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: '10px',
                  fontWeight: 700,
                  color: '#0369a1',
                  backgroundColor: '#e0f2fe',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                via {challenge?.channel}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '20px' }}>
              <Timer size={12} style={{ color: '#94a3b8' }} />
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                Code expires in {Math.floor((challenge?.expires_in_seconds ?? 300) / 60)} min ·{' '}
                {challenge?.max_attempts} attempts allowed
              </span>
            </div>

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
                  marginBottom: '20px',
                }}
              >
                <AlertCircle size={16} style={{ color: '#dc2626', flexShrink: 0, marginTop: '1px' }} />
                <span style={{ fontSize: '13px', color: '#991b1b' }}>{error}</span>
              </div>
            )}

            {/* Demo-mode hint: the backend surfaced the code for the demo */}
            {challenge?.demo_code && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  backgroundColor: '#fffbeb',
                  border: '1px dashed #fcd34d',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  marginBottom: '16px',
                }}
              >
                <Info size={15} style={{ color: '#d97706', flexShrink: 0 }} />
                <span style={{ fontSize: '12px', color: '#92400e' }}>
                  <strong>Demo mode:</strong> your code is{' '}
                  <strong style={{ letterSpacing: '0.2em' }}>{challenge.demo_code}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setOtpCode(challenge.demo_code || '')}
                  style={{
                    marginLeft: 'auto',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#d97706',
                    backgroundColor: '#fffbeb',
                    border: '1px solid #fcd34d',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    cursor: 'pointer',
                  }}
                >
                  Autofill
                </button>
              </div>
            )}

            <form onSubmit={handleOtpVerify}>
              <div style={{ marginBottom: '20px' }}>
                <label
                  htmlFor="evocare-otp"
                  style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}
                >
                  Verification Code
                </label>
                <input
                  id="evocare-otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                  placeholder="••••••"
                  disabled={loading}
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '8px',
                    fontSize: '22px',
                    fontWeight: 700,
                    letterSpacing: '0.5em',
                    textAlign: 'center',
                    color: '#0f172a',
                    backgroundColor: loading ? '#f9fafb' : '#ffffff',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = '#0284c7')}
                  onBlur={(e) => (e.target.style.borderColor = '#d1d5db')}
                />
              </div>

              <button
                id="evocare-otp-verify"
                type="submit"
                disabled={loading || otpCode.length < 4}
                style={{
                  width: '100%',
                  padding: '11px',
                  backgroundColor: loading || otpCode.length < 4 ? '#93c5fd' : '#0284c7',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: loading || otpCode.length < 4 ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
              >
                {loading ? (
                  <>
                    <span
                      style={{
                        width: '14px',
                        height: '14px',
                        border: '2px solid rgba(255,255,255,0.4)',
                        borderTopColor: '#ffffff',
                        borderRadius: '50%',
                        animation: 'spin 0.7s linear infinite',
                        display: 'inline-block',
                      }}
                    />
                    Verifying…
                  </>
                ) : (
                  <>
                    <ShieldCheck size={14} />
                    Verify &amp; Sign In
                  </>
                )}
              </button>
            </form>

            {/* Resend + Back */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: '16px',
              }}
            >
              <button
                type="button"
                onClick={backToCredentials}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  fontSize: '12px',
                  cursor: 'pointer',
                  padding: '4px',
                }}
              >
                <ArrowLeft size={13} />
                Back
              </button>
              <button
                type="button"
                id="evocare-otp-resend"
                onClick={handleResend}
                disabled={loading || resendCooldown > 0}
                style={{
                  background: 'none',
                  border: 'none',
                  color: resendCooldown > 0 ? '#94a3b8' : '#0284c7',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: resendCooldown > 0 ? 'default' : 'pointer',
                  padding: '4px',
                }}
              >
                {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
              </button>
            </div>
          </>
        )}

        {/* Demo credentials */}
        <div
          style={{
            marginTop: '24px',
            padding: '14px',
            backgroundColor: '#f8fafc',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
          }}
        >
          <div
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: '#475569',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: '10px',
            }}
          >
            Demo Credentials
          </div>
          {DEMO_ACCOUNTS.map(({ label, user, pass, color }) => (
            <button
              key={user}
              id={`evocare-demo-${user}`}
              onClick={() => fillDemo(user, pass)}
              disabled={loading}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '7px 10px',
                marginBottom: '6px',
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                color: '#374151',
                textAlign: 'left',
              }}
            >
              <span>
                <span style={{ fontWeight: 600, color }}>{label}</span>
                <span style={{ color: '#9ca3af', marginLeft: '6px' }}>{user}</span>
              </span>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  backgroundColor: color + '15',
                  color,
                  padding: '2px 6px',
                  borderRadius: '4px',
                }}
              >
                Fill
              </span>
            </button>
          ))}
          <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '8px' }}>
            ⚠ Synthetic demo data only. Not for clinical use. Login requires password + OTP.
          </div>
        </div>
      </div>

      {/* Security badge */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          marginTop: '20px',
          fontSize: '12px',
          color: '#64748b',
        }}
      >
        <ShieldCheck size={13} style={{ color: '#0284c7' }} />
        JWT-secured · Two-step authentication (Password + OTP) · Role-based access
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
