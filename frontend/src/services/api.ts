import { DashboardResponse, MemoryHistoryItem, ClinicalReasoningResponse, DoctorRecordItem, DoctorRecordCreatePayload } from '../types';
import { authService } from './auth';

const API_BASE = '/api';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Build Authorization header from stored token. */
function authHeaders(): Record<string, string> {
  const token = authService.getToken();
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
}

/** Handle 401 globally: clear session so App re-routes to login. */
function handleUnauthorized(): never {
  authService.logout().catch(() => {});
  window.dispatchEvent(new CustomEvent('evocare:unauthorized'));
  throw new ApiError(401, 'Session expired. Please log in again.');
}

export const apiService = {
  async getPatientDashboard(patientId: string = 'P001'): Promise<DashboardResponse> {
    try {
      const res = await fetch(`${API_BASE}/dashboard/patients/${patientId}`, {
        headers: authHeaders(),
      });
      if (res.status === 401) handleUnauthorized();
      if (res.status === 403) {
        throw new ApiError(403, `Access denied: You are not authorized to view patient ${patientId}.`);
      }
      if (!res.ok) {
        throw new ApiError(res.status, `Failed to load dashboard for patient ${patientId} (HTTP ${res.status})`);
      }
      return await res.json();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(500, 'Network error connecting to EvoCare backend server. Please verify backend is running.');
    }
  },

  async getMemoryHistory(patientId: string = 'P001', page: string = 'Mobility'): Promise<MemoryHistoryItem[]> {
    try {
      const res = await fetch(`${API_BASE}/memory/${patientId}/${page}/history`, {
        headers: authHeaders(),
      });
      if (res.status === 401) handleUnauthorized();
      if (!res.ok) {
        throw new ApiError(res.status, `Failed to load memory history for ${page}`);
      }
      return await res.json();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(500, 'Network error loading memory history.');
    }
  },

  async getClinicalReasoning(patientId: string = 'P001', question: string): Promise<ClinicalReasoningResponse> {
    try {
      const res = await fetch(`${API_BASE}/clinical-reasoning/${patientId}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ question }),
      });
      if (res.status === 401) handleUnauthorized();
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const msg = errorData.detail?.message || errorData.detail || `Clinical reasoning error (HTTP ${res.status})`;
        throw new ApiError(res.status, typeof msg === 'string' ? msg : JSON.stringify(msg));
      }
      return await res.json();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(500, 'Failed to connect to Clinical Reasoning Assistant.');
    }
  },

  /** List doctor-authored clinical records (append-only store). Any granted role may read. */
  async getPatientRecords(patientId: string): Promise<DoctorRecordItem[]> {
    try {
      const res = await fetch(`${API_BASE}/records/patients/${patientId}/records`, {
        headers: authHeaders(),
      });
      if (res.status === 401) handleUnauthorized();
      if (!res.ok) {
        throw new ApiError(res.status, `Failed to load clinical records (HTTP ${res.status})`);
      }
      return await res.json();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(500, 'Network error loading clinical records.');
    }
  },

  /** DOCTOR-only: append a new immutable clinical record (EV-DR-xxx). */
  async createPatientRecord(patientId: string, payload: DoctorRecordCreatePayload): Promise<DoctorRecordItem> {
    try {
      const res = await fetch(`${API_BASE}/records/patients/${patientId}/records`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      if (res.status === 401) handleUnauthorized();
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const msg = errorData.detail || `Could not create record (HTTP ${res.status})`;
        throw new ApiError(res.status, typeof msg === 'string' ? msg : JSON.stringify(msg));
      }
      return await res.json();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(500, 'Network error creating clinical record.');
    }
  },
};
