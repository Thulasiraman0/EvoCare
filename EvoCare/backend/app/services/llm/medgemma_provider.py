"""
MedGemma 1.5 Provider
=====================

Google's MedGemma 1.5 (google/medgemma-1.5-4b-it) is a Gemma-3 variant trained on
medical text + imaging (CT/MRI, CXR, histopathology, lab-report & EHR understanding).
It is an *open-weights* model - there is no hosted Google API for it - so EvoCare
talks to it through whatever OpenAI-compatible server the operator runs:

    vLLM    : vllm serve google/medgemma-1.5-4b-it --port 8001          (MEDGEMMA_BASE_URL=http://localhost:8001/v1)
    Ollama  : ollama pull hf.co/unsloth/medgemma-1.5-4b-it-GGUF         (MEDGEMMA_BASE_URL=http://localhost:11434/v1)
    HF      : MEDGEMMA_BASE_URL=https://router.huggingface.co/v1  MEDGEMMA_API_KEY=<hf token>

Only the standard ``/chat/completions`` route is used, so any of the above work
unchanged. The provider is deliberately dependency-free (urllib only).

Safety posture (per the model card): MedGemma is a *developer* model, not a
clinical device. Every prompt here grounds the model in the patient's actual
EvoCare record and instructs it to stay educational / non-diagnostic; the
router additionally attaches a disclaimer and never persists model output as
clinical fact.
"""
import json
import logging
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

from app.core.config import settings
from app.services.llm.clinical_reasoning_prompts import (
    CLINICAL_REASONING_SYSTEM_PROMPT,
    build_clinical_reasoning_prompt,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Anatomy taxonomy shared by the 3D viewer and the LLM prompt
# ---------------------------------------------------------------------------
ANATOMY_SYSTEMS: Dict[str, Dict[str, Any]] = {
    "skeletal": {
        "label": "Skeletal System",
        "description": "Bones, joints and cartilage — structure, protection and mobility.",
        "evocare_domains": ["mobility", "falls", "osteoarthritis", "fractures", "posture"],
        "keywords": ["bone", "joint", "knee", "hip", "spine", "fracture", "osteo", "arthritis", "fall", "posture"],
    },
    "muscular": {
        "label": "Muscular System",
        "description": "Skeletal muscle, tendons and strength — gait, balance and daily function.",
        "evocare_domains": ["mobility", "sarcopenia", "gait", "weakness", "near-falls"],
        "keywords": ["muscle", "weak", "strength", "gait", "walk", "support", "tendon", "cramp", "sarcopenia"],
    },
    "nervous": {
        "label": "Nervous System",
        "description": "Brain, spinal cord and nerves — cognition, balance, sensation and dizziness.",
        "evocare_domains": ["cognition", "dizziness", "confusion", "neuropathy", "memory"],
        "keywords": ["brain", "nerve", "dizzy", "dizziness", "vertigo", "confus", "memory", "cognit", "numb", "tingling", "stroke", "neuro"],
    },
    "cardiovascular": {
        "label": "Cardiovascular System",
        "description": "Heart and blood vessels — blood pressure, circulation and orthostatic symptoms.",
        "evocare_domains": ["hypertension", "orthostatic hypotension", "dizziness", "medication effects"],
        "keywords": ["heart", "blood pressure", "hypertension", "bp", "pulse", "amlodipine", "circulat", "orthostatic", "faint"],
    },
    "digestive": {
        "label": "Digestive System",
        "description": "Stomach, intestines, liver and pancreas — nutrition, appetite and glucose metabolism.",
        "evocare_domains": ["nutrition", "appetite", "diabetes", "weight", "hydration"],
        "keywords": ["stomach", "appetite", "eat", "meal", "digest", "diabetes", "glucose", "sugar", "metformin", "weight", "nutrition", "liver"],
    },
    "integumentary": {
        "label": "Integumentary System",
        "description": "Skin, hair and nails — wound healing, pressure areas and hydration.",
        "evocare_domains": ["skin integrity", "wounds", "bruising", "pressure sores"],
        "keywords": ["skin", "bruise", "wound", "rash", "ulcer", "sore", "itch", "dry"],
    },
    "respiratory": {
        "label": "Respiratory System",
        "description": "Lungs and airways — breathing, oxygenation and exertion tolerance.",
        "evocare_domains": ["breathlessness", "infection", "exercise tolerance"],
        "keywords": ["lung", "breath", "cough", "oxygen", "asthma", "copd", "respirat", "wheez"],
    },
    "urinary": {
        "label": "Urinary System",
        "description": "Kidneys and bladder — fluid balance, continence and drug clearance.",
        "evocare_domains": ["kidney function", "hydration", "continence", "medication dosing"],
        "keywords": ["kidney", "urine", "bladder", "continence", "creatinine", "egfr", "renal"],
    },
}

ANATOMY_AUDIENCES = ("doctor", "patient", "caregiver")


def detect_anatomy_system(text: str) -> Optional[str]:
    """Best-effort mapping of free text to one of the ANATOMY_SYSTEMS keys."""
    t = (text or "").lower()
    best, best_hits = None, 0
    for key, meta in ANATOMY_SYSTEMS.items():
        hits = sum(1 for kw in meta["keywords"] if kw in t)
        if hits > best_hits:
            best, best_hits = key, hits
    return best


def _audience_instructions(audience: str, patient_name: str) -> str:
    first = patient_name.split()[0] if patient_name else "the patient"
    if audience == "doctor":
        return (
            "AUDIENCE: attending physician. Use precise anatomical and clinical terminology. "
            "Relate the selected body system to the patient's documented conditions, medications and "
            "longitudinal observations. Highlight clinically relevant anatomical-physiological links "
            "(e.g. vestibular vs. orthostatic mechanisms of dizziness). Cite evidence codes when given. "
            "Do NOT issue a diagnosis or prescribe; frame everything as considerations for clinician review."
        )
    if audience == "caregiver":
        return (
            f"AUDIENCE: family caregiver looking after {first}. Explain the body system in plain language, "
            "then give practical, safe, non-medical observation tips (what to watch for, when to tell the doctor). "
            "Never suggest changing medication or treatment."
        )
    return (
        f"AUDIENCE: the patient, {patient_name}. Speak warmly and simply in the second person. "
        "Explain how this part of the body works and how it relates to what is already in their own record. "
        "Be reassuring, avoid alarming language, never diagnose, and remind them to raise concerns with Dr. Ramesh Varma."
    )


def build_anatomy_prompt(
    system_key: str,
    audience: str,
    patient_context: Dict[str, Any],
    question: Optional[str] = None,
    structure: Optional[str] = None,
) -> str:
    meta = ANATOMY_SYSTEMS.get(system_key, ANATOMY_SYSTEMS["skeletal"])
    demo = patient_context.get("demographics") or patient_context.get("patient") or {}
    name = demo.get("name", "the patient")
    age = demo.get("age", "unknown")
    sex = demo.get("sex", "unknown")

    diagnoses = patient_context.get("clinician_diagnoses") or patient_context.get("diagnoses") or []
    diag_lines = []
    for d in diagnoses[:8]:
        if isinstance(d, dict):
            diag_lines.append(f"- {d.get('condition') or d.get('content', '')[:160]} ({d.get('icd_code') or d.get('evidence_code', '')})")
    meds = patient_context.get("medications") or []
    med_lines = [f"- {m.get('name')} {m.get('dose', '')} {m.get('frequency', '')} — {m.get('indication', '')}" for m in meds[:10] if isinstance(m, dict)]
    obs = patient_context.get("caregiver_observations") or patient_context.get("recent_observations") or []
    obs_lines = [f"- {str(o.get('observed_at', ''))[:10]}: {o.get('observation_text') or o.get('statement', '')}" for o in obs[:8] if isinstance(o, dict)]
    claims = patient_context.get("memory_claims") or patient_context.get("claims") or []
    claim_lines = [f"- [{c.get('category')}] {c.get('statement')}" for c in claims[:8] if isinstance(c, dict)]

    focus = f"\nThe user has selected the specific structure: **{structure}**." if structure else ""
    q = f"\nUser question: \"{question}\"" if question else "\nUser question: (none — give a concise overview relevant to this patient)."

    return f"""You are MedGemma, assisting inside the EvoCare 3D Human Anatomy explorer.

{_audience_instructions(audience, name)}

SELECTED BODY SYSTEM: {meta['label']} — {meta['description']}
Related EvoCare care domains: {', '.join(meta['evocare_domains'])}{focus}

PATIENT RECORD (grounding — only use these facts, say "not recorded" otherwise):
- Name: {name} | Age: {age} | Sex: {sex}
Confirmed diagnoses / clinician notes:
{chr(10).join(diag_lines) or '- none recorded'}
Active medications:
{chr(10).join(med_lines) or '- none recorded'}
Recent caregiver observations:
{chr(10).join(obs_lines) or '- none recorded'}
Longitudinal memory claims:
{chr(10).join(claim_lines) or '- none recorded'}
{q}

RESPONSE FORMAT (markdown, max ~250 words):
### {meta['label']} — What it is
### How it connects to {name.split()[0] if name else 'this patient'}'s record
### What to watch for
End with one sentence reminding the reader this is educational and not a diagnosis."""


ANATOMY_SYSTEM_PROMPT = (
    "You are a careful medical education assistant embedded in a longitudinal elder-care record system. "
    "You explain human anatomy and physiology, grounded strictly in the supplied patient record. "
    "You never diagnose, never prescribe, never change treatment, and never invent facts not in the record."
)


class MedGemmaProvider:
    """
    Thin OpenAI-compatible chat client for a self-hosted / HF-hosted MedGemma 1.5 endpoint.
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        timeout: Optional[int] = None,
        enabled: Optional[bool] = None,
    ):
        self.base_url = (base_url if base_url is not None else settings.MEDGEMMA_BASE_URL).rstrip("/")
        self.api_key = api_key if api_key is not None else settings.MEDGEMMA_API_KEY
        self.model = model or settings.MEDGEMMA_MODEL
        self.timeout = timeout or settings.MEDGEMMA_TIMEOUT_SECONDS
        self.enabled = enabled if enabled is not None else settings.LLM_ENABLED
        self.unavailable_until: float = 0.0

    # -- status -------------------------------------------------------------
    def is_configured(self) -> bool:
        return bool(self.enabled and self.base_url)

    def is_cooling_down(self) -> bool:
        return time.time() < self.unavailable_until

    def status(self) -> Dict[str, Any]:
        return {
            "configured": self.is_configured(),
            "model": self.model,
            "base_url": self.base_url or None,
            "cooling_down": self.is_cooling_down(),
        }

    # -- transport ----------------------------------------------------------
    def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.2,
        max_tokens: int = 900,
        json_mode: bool = False,
    ) -> str:
        if not self.is_configured():
            raise RuntimeError("MedGemma endpoint not configured (set MEDGEMMA_BASE_URL)")
        if self.is_cooling_down():
            raise RuntimeError("MedGemma endpoint in cool-down after a recent failure")

        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}

        req = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json",
                **({"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}),
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "ignore")[:300]
            if e.code in (429, 503):
                self.unavailable_until = time.time() + 60.0
            raise RuntimeError(f"MedGemma HTTP {e.code}: {detail}") from e
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            self.unavailable_until = time.time() + 30.0
            raise RuntimeError(f"MedGemma endpoint unreachable: {e}") from e

        try:
            return (body["choices"][0]["message"]["content"] or "").strip()
        except (KeyError, IndexError, TypeError) as e:
            raise RuntimeError(f"MedGemma returned unexpected payload: {str(body)[:200]}") from e

    # -- use cases ----------------------------------------------------------
    def explain_anatomy(
        self,
        system_key: str,
        audience: str,
        patient_context: Dict[str, Any],
        question: Optional[str] = None,
        structure: Optional[str] = None,
    ) -> str:
        prompt = build_anatomy_prompt(system_key, audience, patient_context, question, structure)
        return self.chat(
            [
                {"role": "system", "content": ANATOMY_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            max_tokens=900,
        )

    def generate_clinical_reasoning(self, question: str, patient_context: Dict[str, Any]) -> Dict[str, Any]:
        """Optional: use MedGemma for the doctor reasoning JSON schema (same contract as Gemini/Groq)."""
        raw = self.chat(
            [
                {"role": "system", "content": CLINICAL_REASONING_SYSTEM_PROMPT},
                {"role": "user", "content": build_clinical_reasoning_prompt(question, patient_context)},
            ],
            temperature=0.0,
            max_tokens=2000,
            json_mode=True,
        )
        clean = raw.strip()
        if clean.startswith("```json"):
            clean = clean[7:]
        if clean.startswith("```"):
            clean = clean[3:]
        if clean.endswith("```"):
            clean = clean[:-3]
        parsed = json.loads(clean.strip())
        parsed["_llm_model_used"] = f"MedGemma 1.5 ({self.model})"
        return parsed


# ---------------------------------------------------------------------------
# Offline fallback (no endpoint configured) — deterministic, record-grounded
# ---------------------------------------------------------------------------
def offline_anatomy_explanation(
    system_key: str,
    audience: str,
    patient_context: Dict[str, Any],
    question: Optional[str] = None,
    structure: Optional[str] = None,
) -> str:
    meta = ANATOMY_SYSTEMS.get(system_key, ANATOMY_SYSTEMS["skeletal"])
    demo = patient_context.get("demographics") or patient_context.get("patient") or {}
    name = demo.get("name", "the patient")
    first = name.split()[0] if name else "the patient"

    meds = [m for m in (patient_context.get("medications") or []) if isinstance(m, dict)]
    obs = [o for o in (patient_context.get("caregiver_observations") or patient_context.get("recent_observations") or []) if isinstance(o, dict)]
    kws = meta["keywords"]

    related_meds = [m for m in meds if any(k in (f"{m.get('name','')} {m.get('indication','')}").lower() for k in kws)]
    related_obs = [o for o in obs if any(k in (o.get("observation_text") or o.get("statement") or "").lower() for k in kws)]

    you = "you" if audience == "patient" else first
    your = "your" if audience == "patient" else f"{first}'s"

    lines = [f"### {meta['label']} — What it is", meta["description"]]
    if structure:
        lines.append(f"Selected structure: **{structure}**.")
    lines += ["", f"### How it connects to {your} record"]
    if related_meds:
        lines.append("Medications in the record that act on or relate to this system:")
        lines += [f"- **{m.get('name')}** {m.get('dose','')} — {m.get('indication','')}" for m in related_meds[:5]]
    if related_obs:
        lines.append("Recent caregiver observations that involve this system:")
        lines += [f"- {str(o.get('observed_at',''))[:10]}: {o.get('observation_text') or o.get('statement')}" for o in related_obs[:5]]
    if not related_meds and not related_obs:
        lines.append(f"Nothing in {your} current record is specifically linked to the {meta['label'].lower()}.")
    lines += ["", "### What to watch for"]
    lines += [f"- Care domains EvoCare tracks for this system: {', '.join(meta['evocare_domains'])}."]
    if audience == "caregiver":
        lines.append(f"- Note any new change for {first} in these areas with the date and context, and share it with the doctor.")
    elif audience == "doctor":
        lines.append("- Review the linked observations above against the longitudinal baseline before drawing conclusions.")
    else:
        lines.append("- If you notice anything new or worrying in these areas, tell your caregiver or Dr. Ramesh Varma.")
    if question:
        lines += ["", f"_Your question (\"{question}\") will be answered in detail once the MedGemma 1.5 endpoint is connected (see MEDGEMMA_BASE_URL)._"]
    lines += ["", "_Educational information grounded in the EvoCare record — not a diagnosis._"]
    return "\n".join(lines)
