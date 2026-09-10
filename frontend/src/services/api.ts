import { DashboardResponse, MemoryHistoryItem, ClinicalReasoningResponse, AnatomySystem, AnatomyExplainRequest, AnatomyExplainResponse, AnatomyLLMStatus } from '../types';
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

  async recordDoctorEntries(patientId: string, payload: any): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/patients/${patientId}/entries`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      if (res.status === 401) handleUnauthorized();
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const msg = errorData.detail || `Failed to record doctor entry (HTTP ${res.status})`;
        throw new ApiError(res.status, typeof msg === 'string' ? msg : JSON.stringify(msg));
      }
      return await res.json();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(500, 'Failed to save doctor clinical entries.');
    }
  },

  async getDoctorEntries(patientId: string): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/patients/${patientId}/entries`, {
        headers: authHeaders(),
      });
      if (res.status === 401) handleUnauthorized();
      if (!res.ok) {
        throw new ApiError(res.status, `Failed to load doctor entries for ${patientId}`);
      }
      return await res.json();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(500, 'Failed to retrieve doctor entries.');
    }
  },

  async queryPatientCompanion(patientId: string, question: string): Promise<{
    patient_code: string;
    patient_name: string;
    question: string;
    answer: string;
    disclaimer: string;
  }> {
    try {
      const res = await fetch(`${API_BASE}/patients/${patientId}/companion`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ question }),
      });
      if (res.status === 401) handleUnauthorized();
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new ApiError(res.status, errData.detail || 'Health Companion query failed');
      }
      return await res.json();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(500, 'Failed to connect to Personal Health Companion.');
    }
  },

  // ---- 3D Human Anatomy Explorer (MedGemma 1.5) ----
  async getAnatomySystems(): Promise<AnatomySystem[]> {
    const res = await fetch(`${API_BASE}/anatomy/systems`, { headers: authHeaders() });
    if (!res.ok) throw new ApiError(res.status, 'Failed to load anatomy taxonomy');
    return await res.json();
  },

  async getAnatomyStatus(): Promise<AnatomyLLMStatus> {
    const res = await fetch(`${API_BASE}/anatomy/status`, { headers: authHeaders() });
    if (res.status === 401) handleUnauthorized();
    if (!res.ok) throw new ApiError(res.status, 'Failed to load anatomy model status');
    return await res.json();
  },

  async explainAnatomy(patientId: string, body: AnatomyExplainRequest): Promise<AnatomyExplainResponse> {
    try {
      const res = await fetch(`${API_BASE}/patients/${patientId}/anatomy/explain`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      if (res.status === 401) handleUnauthorized();
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new ApiError(res.status, errData.detail || 'Anatomy explanation failed');
      }
      return await res.json();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(500, 'Failed to reach the anatomy explainer service.');
    }
  },

  async startObservation(patientCode: string, text: string, caregiverId: string = 'CG001'): Promise<{
    session_id: number;
    session_code: string;
    patient_code: string;
    raw_text: string;
    requires_clarification: boolean;
    detected_category: string;
    extracted_data?: any;
    questions?: Array<{
      id: number;
      session_id: number;
      field_name: string;
      question_text: string;
      options: string[];
      is_answered: boolean;
    }>;
  }> {
    try {
      const res = await fetch(`${API_BASE}/observations/start`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          patient_code: patientCode,
          text,
          caregiver_id: caregiverId,
          processing_mode: 'AUTO',
        }),
      });
      if (res.status === 401) handleUnauthorized();
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new ApiError(res.status, errData.detail || 'Failed to analyze caregiver observation');
      }
      return await res.json();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(500, 'Failed to connect to observation processing engine.');
    }
  },

  async answerClarification(
    sessionId: number,
    questionId: number,
    fieldName: string,
    answer: string
  ): Promise<any> {
    try {
      const res = await fetch(`${API_BASE}/clarification/${sessionId}/answer`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          question_id: questionId,
          field_name: fieldName,
          answer,
        }),
      });
      if (res.status === 401) handleUnauthorized();
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new ApiError(res.status, errData.detail || 'Failed to submit clarification answer');
      }
      return await res.json();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(500, 'Failed to record clarification answer.');
    }
  },

  async completeClarification(sessionId: number): Promise<{
    session_id: number;
    status: string;
    category: string;
    structured_observation: any;
    evidence_id: number;
    evidence_code: string;
    observation_id: number;
    created_at: string;
    wiki_updated?: boolean;
    wiki_files?: string[];
  }> {
    try {
      const res = await fetch(`${API_BASE}/clarification/${sessionId}/complete`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (res.status === 401) handleUnauthorized();
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new ApiError(res.status, errData.detail || 'Failed to finalize observation');
      }
      return await res.json();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(500, 'Failed to finalize caregiver observation and synchronize records.');
    }
  },
};
