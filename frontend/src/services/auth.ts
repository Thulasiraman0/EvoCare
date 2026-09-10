/**
 * EvoCare Authentication Service
 *
 * Two-step authentication:
 *   Step 1: beginLogin(username, password)  -> OTP challenge (code sent to user)
 *   Step 2: verifyOtp(challengeId, code)    -> JWT session stored
 *   Optional: resendOtp(challengeId)        -> fresh code (previous one invalidated)
 *
 * Manages JWT token lifecycle: login, logout, token storage, user decoding.
 */

const TOKEN_KEY = 'evocare_access_token';
const USER_KEY = 'evocare_user';

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: 'DOCTOR' | 'CAREGIVER' | 'ADMIN' | 'PATIENT';
}

export interface AuthorizedPatient {
  patient_code: string;
  name: string;
  age: number;
  sex: string;
  access_role: string;
}

/** Step-1 response: credentials accepted, OTP dispatched. */
export interface OTPChallenge {
  otp_required: boolean;
  challenge_id: string;
  channel: string;
  masked_destination: string;
  expires_in_seconds: number;
  max_attempts: number;
  /** Present only in DEMO_MODE so the demo runs without an email/SMS provider. */
  demo_code: string | null;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}));
  const msg = data?.detail || fallback;
  return typeof msg === 'string' ? msg : JSON.stringify(msg);
}

class AuthService {
  /**
   * Step 1: verify username + password. Returns the OTP challenge.
   * NOTE: no session is stored at this point.
   */
  async beginLogin(username: string, password: string): Promise<OTPChallenge> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      throw new Error(await readError(res, `Login failed (HTTP ${res.status})`));
    }

    const data = await res.json();
    if (data.access_token) {
      // Server running with OTP disabled (legacy mode): treat as fully logged in.
      this._storeToken(data.access_token);
      this._storeUser(data.user);
      throw new OTPNotRequiredError(data.user as AuthUser);
    }
    return data as OTPChallenge;
  }

  /** Step 2: verify the one-time code; stores the JWT session on success. */
  async verifyOtp(challengeId: string, code: string): Promise<AuthUser> {
    const res = await fetch('/api/auth/otp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge_id: challengeId, code }),
    });

    if (!res.ok) {
      throw new Error(await readError(res, 'Verification failed. Please check the code.'));
    }

    const data = await res.json();
    this._storeToken(data.access_token);
    this._storeUser(data.user);
    return data.user as AuthUser;
  }

  /** Re-issue a fresh one-time code; invalidates the previous code. */
  async resendOtp(challengeId: string): Promise<OTPChallenge> {
    const res = await fetch('/api/auth/otp/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge_id: challengeId }),
    });

    if (!res.ok) {
      throw new Error(await readError(res, 'Could not resend the verification code.'));
    }
    return (await res.json()) as OTPChallenge;
  }

  /** Logout: revoke server-side token, clear local storage. */
  async logout(): Promise<void> {
    const token = this.getToken();
    if (token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Ignore network errors on logout — always clear local state
      }
    }
    this._clearSession();
  }

  /** Get stored JWT access token or null. */
  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  /** Get stored user info or null. */
  getUser(): AuthUser | null {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch {
      return null;
    }
  }

  /** Returns true if a token is currently stored. */
  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  /** Fetch the list of patients this user is authorized to access. */
  async getAuthorizedPatients(): Promise<AuthorizedPatient[]> {
    const token = this.getToken();
    if (!token) return [];
    const res = await fetch('/api/auth/authorized-patients', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    return res.json();
  }

  private _storeToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
  }

  private _storeUser(user: AuthUser): void {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  private _clearSession(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
}

/** Thrown when the backend has OTP disabled and step 1 already logged the user in. */
export class OTPNotRequiredError extends Error {
  constructor(public user: AuthUser) {
    super('OTP not required; user already authenticated.');
    this.name = 'OTPNotRequiredError';
  }
}

export const authService = new AuthService();
