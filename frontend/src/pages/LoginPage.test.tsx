import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginPage } from './LoginPage';

/**
 * Two-step login flow tests:
 *   Step 1 (credentials) -> Step 2 (OTP) -> onLoginSuccess
 */

function stubFetch(routes: Record<string, (url: string, body: any) => { status?: number; body: any }>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    for (const [pattern, handler] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        const result = handler(url, body);
        return {
          ok: (result.status ?? 200) < 400,
          status: result.status ?? 200,
          json: () => Promise.resolve(result.body),
        };
      }
    }
    return { ok: false, status: 404, json: () => Promise.resolve({ detail: 'not found' }) };
  });
}

describe('LoginPage — two-step authentication', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  beforeEach(() => {
    localStorage.clear();
  });

  it('renders step 1 (User ID + password) first', () => {
    render(<LoginPage onLoginSuccess={() => {}} />);
    expect(screen.getByLabelText(/^User ID$/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password$/)).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 2/i)).toBeInTheDocument();
  });

  it('rejects empty credentials with a validation message', async () => {
    render(<LoginPage onLoginSuccess={() => {}} />);
    fireEvent.click(screen.getByText(/Continue/i));
    expect(await screen.findByText(/enter both username and password/i)).toBeInTheDocument();
  });

  it('shows the OTP step after correct credentials, without logging in', async () => {
    const fetchMock = stubFetch({
      '/api/auth/login': () => ({
        body: {
          otp_required: true,
          challenge_id: 'challenge-abc123',
          channel: 'EMAIL',
          masked_destination: 'd*****o@evocare.health',
          expires_in_seconds: 300,
          max_attempts: 5,
          demo_code: '123456',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const onLoginSuccess = vi.fn();
    render(<LoginPage onLoginSuccess={onLoginSuccess} />);

    fireEvent.change(screen.getByLabelText(/^User ID$/), { target: { value: 'doctor.demo' } });
    fireEvent.change(screen.getByLabelText(/^Password$/), { target: { value: 'DoctorPass123!' } });
    fireEvent.click(screen.getByText(/Continue/i));

    // Step 2 appears with masked destination; no login callback yet
    expect(await screen.findByText(/Two-Step Verification/i)).toBeInTheDocument();
    expect(screen.getByText(/d\*\*\*\*\*o@evocare\.health/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Verification Code$/)).toBeInTheDocument();
    expect(onLoginSuccess).not.toHaveBeenCalled();
  });

  it('bad credentials keep the user on step 1 with an error', async () => {
    const fetchMock = stubFetch({
      '/api/auth/login': () => ({ status: 401, body: { detail: 'Invalid username or password.' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<LoginPage onLoginSuccess={() => {}} />);
    fireEvent.change(screen.getByLabelText(/^User ID$/), { target: { value: 'doctor.demo' } });
    fireEvent.change(screen.getByLabelText(/^Password$/), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByText(/Continue/i));

    expect(await screen.findByText(/Invalid username or password/i)).toBeInTheDocument();
    expect(screen.queryByText(/Two-Step Verification/i)).not.toBeInTheDocument();
  });

  it('completes login after OTP verification and reports the role', async () => {
    const fetchMock = stubFetch({
      '/api/auth/login': () => ({
        body: {
          otp_required: true,
          challenge_id: 'challenge-abc123',
          channel: 'EMAIL',
          masked_destination: 'd*****o@evocare.health',
          expires_in_seconds: 300,
          max_attempts: 5,
          demo_code: '654321',
        },
      }),
      '/api/auth/otp/verify': (_url, body) => {
        if (body.code === '654321') {
          return {
            body: {
              access_token: 'jwt-token-123',
              refresh_token: 'refresh-123',
              expires_in: 1800,
              user: {
                id: 1,
                username: 'doctor.demo',
                email: 'doctor.demo@evocare.health',
                full_name: 'Dr. Ramesh Varma, MD',
                role: 'DOCTOR',
              },
            },
          };
        }
        return { status: 401, body: { detail: 'Incorrect verification code. 4 attempt(s) remaining.' } };
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const onLoginSuccess = vi.fn();
    render(<LoginPage onLoginSuccess={onLoginSuccess} />);

    fireEvent.change(screen.getByLabelText(/^User ID$/), { target: { value: 'doctor.demo' } });
    fireEvent.change(screen.getByLabelText(/^Password$/), { target: { value: 'DoctorPass123!' } });
    fireEvent.click(screen.getByText(/Continue/i));

    const otpInput = await screen.findByLabelText(/^Verification Code$/);
    fireEvent.change(otpInput, { target: { value: '999999' } });
    fireEvent.click(screen.getByText(/Verify & Sign In/i));
    expect(await screen.findByText(/Incorrect verification code/i)).toBeInTheDocument();
    expect(onLoginSuccess).not.toHaveBeenCalled();

    // Demo autofill then verify
    fireEvent.click(screen.getByText(/Autofill/i));
    expect(otpInput).toHaveValue('654321');
    fireEvent.click(screen.getByText(/Verify & Sign In/i));

    await waitFor(() => {
      expect(onLoginSuccess).toHaveBeenCalledTimes(1);
      expect(onLoginSuccess.mock.calls[0][0].role).toBe('DOCTOR');
    });
    expect(localStorage.getItem('evocare_access_token')).toBe('jwt-token-123');
  });
});
