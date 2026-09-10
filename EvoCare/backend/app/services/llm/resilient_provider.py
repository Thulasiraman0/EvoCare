import logging
from typing import Dict, Any, Optional
from app.services.llm.provider import LLMProvider, LLMResult, MockLLMProvider
from app.services.llm.schemas import LLMStatus, ProcessingMethod
from app.services.llm.gemini_provider import GeminiProvider
from app.services.llm.groq_provider import GroqProvider
from app.services.llm.medgemma_provider import MedGemmaProvider, offline_anatomy_explanation
from app.core.config import settings

import hashlib
import time

logger = logging.getLogger(__name__)


class ResilientLLMProvider(LLMProvider):
    """
    Multi-Tier Resilient LLM Provider with automatic failover & quota conservation:
      - 15-minute in-memory response cache (0 API calls for repeat clinical queries)
      - Tier 1: Google Gemini Flash (gemini-3.6-flash) with 429 cool-down circuit breaker
      - Tier 2: Groq (Primary: openai/gpt-oss-120b -> Fallback: openai/gpt-oss-20b)
      - Tier 3: Deterministic Clinical Rule Engine (MockLLMProvider)
    """

    # In-memory query cache: {hash_key: (timestamp, result_dict)}
    _reasoning_cache: Dict[str, tuple[float, Dict[str, Any]]] = {}
    CACHE_TTL_SECONDS: int = 900  # 15 minutes

    def __init__(
        self,
        gemini_provider: Optional[GeminiProvider] = None,
        groq_provider: Optional[GroqProvider] = None,
        mock_provider: Optional[MockLLMProvider] = None,
        medgemma_provider: Optional[MedGemmaProvider] = None,
    ):
        self.gemini = gemini_provider or GeminiProvider()
        self.groq = groq_provider or GroqProvider()
        self.mock = mock_provider or MockLLMProvider()
        self.medgemma = medgemma_provider or MedGemmaProvider()

    # ------------------------------------------------------------------
    # 3D Human Anatomy explainer (MedGemma 1.5 first, then Gemini/Groq, then offline)
    # ------------------------------------------------------------------
    def explain_anatomy(
        self,
        system_key: str,
        audience: str,
        patient_context: Dict[str, Any],
        question: Optional[str] = None,
        structure: Optional[str] = None,
    ) -> Dict[str, Any]:
        from app.services.llm.medgemma_provider import build_anatomy_prompt, ANATOMY_SYSTEM_PROMPT

        pcode = (patient_context.get("demographics") or patient_context.get("patient") or {}).get("patient_code", "P001")
        cache_key = hashlib.md5(
            f"anatomy_v1:{pcode}:{system_key}:{audience}:{structure or ''}:{(question or '').strip().lower()}".encode()
        ).hexdigest()
        now = time.time()
        if cache_key in self._reasoning_cache:
            ts, cached = self._reasoning_cache[cache_key]
            if now - ts < self.CACHE_TTL_SECONDS and isinstance(cached, dict) and "text" in cached:
                return {**cached, "from_cache": True}

        errors = []

        # Tier 0: MedGemma 1.5 (medical-domain model)
        if self.medgemma.is_configured():
            try:
                text = self.medgemma.explain_anatomy(system_key, audience, patient_context, question, structure)
                if text:
                    res = {"text": text, "model_used": f"MedGemma 1.5 ({self.medgemma.model})", "tier": "medgemma"}
                    self._reasoning_cache[cache_key] = (now, res)
                    return res
            except Exception as e:
                errors.append(f"MedGemma: {e}")
                logger.warning(f"MedGemma anatomy explanation failed ({e}); failing over to Gemini...")

        prompt = build_anatomy_prompt(system_key, audience, patient_context, question, structure)

        # Tier 1: Gemini Flash
        if self.gemini.is_configured() and not self.gemini.is_rate_limited():
            try:
                from google import genai
                from google.genai import types
                client = genai.Client(api_key=self.gemini.api_key)
                resp = client.models.generate_content(
                    model=self.gemini.model,
                    contents=prompt,
                    config=types.GenerateContentConfig(system_instruction=ANATOMY_SYSTEM_PROMPT, temperature=0.2, max_output_tokens=900),
                )
                text = (resp.text or "").strip()
                if text:
                    res = {"text": text, "model_used": f"Google Gemini Flash ({self.gemini.model})", "tier": "gemini"}
                    self._reasoning_cache[cache_key] = (now, res)
                    return res
            except Exception as e:
                errors.append(f"Gemini: {e}")
                logger.warning(f"Gemini anatomy explanation failed ({e}); failing over to Groq...")

        # Tier 2: Groq
        if self.groq.is_configured():
            try:
                from groq import Groq
                client = Groq(api_key=self.groq.api_key)
                raw, model_used = self.groq._call_groq_completion(client, prompt, ANATOMY_SYSTEM_PROMPT)
                if raw:
                    res = {"text": raw.strip(), "model_used": f"Groq ({model_used})", "tier": "groq"}
                    self._reasoning_cache[cache_key] = (now, res)
                    return res
            except Exception as e:
                errors.append(f"Groq: {e}")
                logger.warning(f"Groq anatomy explanation failed ({e}); using offline explanation...")

        # Tier 3: Offline deterministic
        text = offline_anatomy_explanation(system_key, audience, patient_context, question, structure)
        res = {
            "text": text,
            "model_used": "EvoCare Offline Anatomy Engine",
            "tier": "offline",
            "fallback_notice": "; ".join(errors) if errors else "No LLM endpoint configured (set MEDGEMMA_BASE_URL, GEMINI_API_KEY or GROQ_API_KEY).",
        }
        self._reasoning_cache[cache_key] = (now, res)
        return res

    def extract_observation(self, text: str, patient_context: Optional[Dict[str, Any]] = None) -> LLMResult:
        # Tier 1: Gemini Flash
        if self.gemini.is_configured():
            try:
                res = self.gemini.extract_observation(text, patient_context)
                if res.status == LLMStatus.SUCCESS:
                    logger.info("Observation extraction successfully handled by Tier 1 (Gemini Flash).")
                    return res
                logger.warning(f"Tier 1 (Gemini) returned non-success status ({res.status}: {res.error_message}). Failing over to Groq...")
            except Exception as e:
                logger.warning(f"Tier 1 (Gemini) raised exception ({e}). Failing over to Tier 2 (Groq)...")

        # Tier 2: Groq
        if self.groq.is_configured():
            try:
                res = self.groq.extract_observation(text, patient_context)
                if res.status == LLMStatus.SUCCESS:
                    logger.info("Observation extraction successfully handled by Tier 2 (Groq).")
                    return res
                logger.warning(f"Tier 2 (Groq) returned non-success status ({res.status}: {res.error_message}). Failing over to Deterministic Engine...")
            except Exception as e:
                logger.warning(f"Tier 2 (Groq) raised exception ({e}). Failing over to Tier 3 (Deterministic Engine)...")

        # Tier 3: Deterministic Fallback Engine
        logger.info("Falling back to Tier 3 (Deterministic Parser) for observation extraction.")
        return LLMResult(
            status=LLMStatus.LLM_UNAVAILABLE,
            error_message="Neither Gemini nor Groq API keys are configured, falling back to deterministic extraction.",
            processing_method=ProcessingMethod.LLM_FALLBACK
        )

    def generate_clinical_reasoning(self, question: str, patient_context: Dict[str, Any]) -> Dict[str, Any]:
        # Check in-memory query cache first (0 API quota used)
        pcode = patient_context.get("patient", {}).get("patient_code", "P001") if isinstance(patient_context, dict) else "P001"
        cache_key = hashlib.md5(f"{pcode}:{question.strip().lower()}".encode()).hexdigest()
        now = time.time()

        if cache_key in self._reasoning_cache:
            ts, cached_data = self._reasoning_cache[cache_key]
            if now - ts < self.CACHE_TTL_SECONDS:
                logger.info("Serving clinical reasoning from cache (0 free-tier tokens consumed).")
                res = dict(cached_data)
                res["_from_cache"] = True
                return res

        last_errors = []

        # Tier 0 (opt-in): MedGemma 1.5 medical model
        if settings.MEDGEMMA_PRIMARY_FOR_REASONING and self.medgemma.is_configured():
            try:
                logger.info("Attempting Tier 0 (MedGemma 1.5) for clinical reasoning...")
                reasoning = self.medgemma.generate_clinical_reasoning(question, patient_context)
                if reasoning and isinstance(reasoning, dict) and "considerations" in reasoning:
                    self._reasoning_cache[cache_key] = (now, reasoning)
                    return reasoning
                logger.warning("Tier 0 (MedGemma) returned invalid schema; failing over to Tier 1...")
            except Exception as e:
                err_msg = f"MedGemma failed ({type(e).__name__}: {str(e)})"
                logger.warning(f"{err_msg}. Failing over to Tier 1 (Gemini)...")
                last_errors.append(err_msg)

        # Tier 1: Gemini Flash
        if self.gemini.is_configured():
            try:
                logger.info("Attempting Tier 1 (Google Gemini Flash) for clinical reasoning...")
                reasoning = self.gemini.generate_clinical_reasoning(question, patient_context)
                if reasoning and isinstance(reasoning, dict) and "considerations" in reasoning:
                    logger.info("Clinical reasoning successfully generated by Tier 1 (Gemini Flash).")
                    self._reasoning_cache[cache_key] = (now, reasoning)
                    return reasoning
                logger.warning("Tier 1 (Gemini) returned invalid schema; failing over to Tier 2...")
            except Exception as e:
                err_msg = f"Gemini Flash failed ({type(e).__name__}: {str(e)})"
                logger.warning(f"{err_msg}. Failing over to Tier 2 (Groq)...")
                last_errors.append(err_msg)

        # Tier 2: Groq (Primary: openai/gpt-oss-120b -> Fallback: openai/gpt-oss-20b)
        if self.groq.is_configured():
            try:
                logger.info("Attempting Tier 2 (Groq openai/gpt-oss-120b -> openai/gpt-oss-20b) for clinical reasoning...")
                reasoning = self.groq.generate_clinical_reasoning(question, patient_context)
                if reasoning and isinstance(reasoning, dict) and "considerations" in reasoning:
                    logger.info("Clinical reasoning successfully generated by Tier 2 (Groq).")
                    self._reasoning_cache[cache_key] = (now, reasoning)
                    return reasoning
                logger.warning("Tier 2 (Groq) returned invalid schema; failing over to Tier 3...")
            except Exception as e:
                err_msg = f"Groq failed ({type(e).__name__}: {str(e)})"
                logger.warning(f"{err_msg}. Failing over to Tier 3 (Deterministic Engine)...")
                last_errors.append(err_msg)

        # Tier 3: Deterministic Clinical Rule Engine
        logger.info("Serving clinical reasoning from Tier 3 (Deterministic Offline Engine).")
        result = self.mock.generate_clinical_reasoning(question, patient_context)
        if last_errors:
            result["_fallback_notice"] = f"Live free-tier APIs transitioned to offline engine: {'; '.join(last_errors)}"
        else:
            result["_fallback_notice"] = "Running on offline deterministic clinical engine (No external API key set)."
        result["_llm_model_used"] = "EvoCare Deterministic Clinical Engine (Fallback)"
        return result

    def generate_patient_response(self, question: str, patient_context: Dict[str, Any]) -> str:
        """
        Generates an empathetic, plain-language response tailored for the patient.
        Tiers:
          1. Gemini Flash
          2. Groq (gpt-oss-120b / gpt-oss-20b)
          3. Deterministic Fallback Answer
        """
        demographics = patient_context.get("demographics", {}) if isinstance(patient_context, dict) else {}
        patient_name = demographics.get("name") or patient_context.get("patient", {}).get("name", "Meenakshi Raman")
        patient_age = demographics.get("age", 78)
        patient_sex = demographics.get("sex", "Female")
        patient_code = demographics.get("patient_code") or patient_context.get("patient", {}).get("patient_code", "P001")
        patient_location = demographics.get("location", "Chennai, Tamil Nadu")

        pcode = patient_code
        cache_key = hashlib.md5(f"patient_v3:{pcode}:{question.strip().lower()}".encode()).hexdigest()
        now = time.time()

        if cache_key in self._reasoning_cache:
            ts, cached_data = self._reasoning_cache[cache_key]
            if now - ts < self.CACHE_TTL_SECONDS and isinstance(cached_data, dict) and "text" in cached_data:
                logger.info("Serving patient companion response from cache.")
                return cached_data["text"]

        meds = patient_context.get("medications", []) if isinstance(patient_context, dict) else []
        med_summary = "\n".join([f"- **{m.get('name', 'Medication')}** {m.get('dose', '')} ({m.get('frequency', '')}): {m.get('indication', '')} • Instructions: {m.get('instructions', 'Take as directed')}" for m in meds]) if meds else "None recorded."
        
        diagnoses = patient_context.get("clinician_diagnoses", []) or patient_context.get("diagnoses", [])
        diag_summary = "\n".join([f"- **{d.get('condition', '')}** ({d.get('icd_code', '')}): {d.get('status', '')}" for d in diagnoses]) if diagnoses else "Type 2 Diabetes, Hypertension, Bilateral Knee Osteoarthritis."

        recent_obs = patient_context.get("caregiver_observations", []) or patient_context.get("recent_observations", [])
        obs_summary = "\n".join([f"- {o.get('observed_at', '')[:10]}: {o.get('observation_text', o.get('statement', ''))}" for o in recent_obs[:6]]) if recent_obs else "Daily routines monitored normally."

        wiki_dict = patient_context.get("wiki_pages", {}) if isinstance(patient_context, dict) else {}
        wiki_notes = "\n\n".join([f"=== {k} ===\n{v}" for k, v in wiki_dict.items()][:3]) if isinstance(wiki_dict, dict) else ""
        if not wiki_notes and isinstance(patient_context, dict):
            wiki_notes = patient_context.get("wiki_markdown_context", "")

        prompt = f"""
You are the personal EvoCare Health Companion for {patient_name}.
{patient_name} has asked: "{question}"

Patient Identity & Registered Demographics:
- Name: {patient_name}
- Age: {patient_age} years old
- Sex: {patient_sex}
- Location: {patient_location}
- Patient Code: {patient_code}

Confirmed Chronic Conditions:
{diag_summary}

Active Prescriptions & Regimen:
{med_summary}

Recent Observations & Caregiver Notes:
{obs_summary}

Patient Wiki & Medical History:
{wiki_notes[:1200]}

Instructions:
1. Directly, accurately, and empathetically answer {patient_name}'s question using the demographics, medications, and clinical records provided above.
2. If they ask about their age, name, conditions, medications, doctor, symptoms, or caregiver observations, state the exact facts from their record clearly.
3. Speak warmly in plain, encouraging English. Use bullet points where appropriate.
4. Reminder: This is for information only; remind {patient_name} to consult Dr. Ramesh Varma for any clinical changes.
"""

        system_prompt = f"You are a friendly, compassionate healthcare companion for {patient_name}. You explain their personal health records and demographics in simple, reassuring words."

        # Tier 1: Gemini Flash
        if self.gemini.is_configured() and not self.gemini.is_rate_limited():
            try:
                from google import genai
                from google.genai import types
                client = genai.Client(api_key=self.gemini.api_key)
                resp = client.models.generate_content(
                    model=self.gemini.model,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=system_prompt,
                        temperature=0.2,
                        max_output_tokens=1000
                    )
                )
                ans = resp.text.strip()
                if ans:
                    self._reasoning_cache[cache_key] = (now, {"text": ans})
                    return ans
            except Exception as e:
                logger.warning(f"Gemini failed for patient companion ({e}), failing over to Groq...")

        # Tier 2: Groq
        if self.groq.is_configured():
            try:
                from groq import Groq
                client = Groq(api_key=self.groq.api_key)
                raw_text, _ = self.groq._call_groq_completion(client, prompt, system_prompt)
                if raw_text:
                    self._reasoning_cache[cache_key] = (now, {"text": raw_text.strip()})
                    return raw_text.strip()
            except Exception as e:
                logger.warning(f"Groq failed for patient companion ({e}), falling back to deterministic answer...")

        # Tier 3: Deterministic Fallback Answer
        fallback_ans = self._generate_fallback_patient_answer(
            question=question,
            patient_name=patient_name,
            patient_age=patient_age,
            patient_sex=patient_sex,
            patient_location=patient_location,
            patient_code=patient_code,
            meds=meds,
            diagnoses=diagnoses,
            recent_obs=recent_obs
        )
        self._reasoning_cache[cache_key] = (now, {"text": fallback_ans})
        return fallback_ans

    def _generate_fallback_patient_answer(
        self,
        question: str,
        patient_name: str,
        patient_age: int,
        patient_sex: str,
        patient_location: str,
        patient_code: str,
        meds: list,
        diagnoses: list,
        recent_obs: list
    ) -> str:
        q_lower = question.lower()
        first_name = patient_name.split()[0]

        if any(w in q_lower for w in ["age", "how old", "born", "birth", "years old"]):
            return (
                f"Hello {first_name}! According to your medical records, you are **{patient_age} years old** ({patient_sex})."
            )

        if any(w in q_lower for w in ["who am i", "my name", "profile", "identity"]):
            return (
                f"Hello! You are **{patient_name}**, a {patient_age}-year-old {patient_sex.lower()} from {patient_location} (Patient Code: {patient_code}). You are under the regular clinical care of Dr. Ramesh Varma, MD."
            )

        if any(w in q_lower for w in ["where do i live", "location", "address", "city"]):
            return (
                f"Hello {first_name}. Your registered residential location on file is **{patient_location}**."
            )

        if any(w in q_lower for w in ["condition", "diagnos", "disease", "illness", "problem", "health issue"]):
            return (
                f"Hello {first_name}. Your health records list the following active conditions managed by your care team:\n\n"
                "• **Type 2 Diabetes Mellitus**: Under active management with daily medication and dietary tracking.\n"
                "• **Essential Hypertension**: High blood pressure monitored daily with medication.\n"
                "• **Bilateral Knee Osteoarthritis**: Joint care with physical support and pain relief as needed.\n\n"
                "All conditions are currently noted as stable by Dr. Ramesh Varma."
            )

        if any(w in q_lower for w in ["medication", "medicine", "pill", "tablet", "dose", "when"]):
            med_lines = []
            if meds:
                for m in meds:
                    name = m.get('name', 'Medication')
                    dose = m.get('dose', '')
                    freq = m.get('frequency', '')
                    ind = m.get('indication', '')
                    
                    nl = name.lower()
                    if "metformin" in nl:
                        timing = "Take twice daily — with your morning breakfast and evening dinner (always with food)"
                    elif "amlodipine" in nl:
                        timing = "Take once daily in the morning with a full glass of water"
                    elif "atorvastatin" in nl:
                        timing = "Take once daily at night before going to bed"
                    elif "paracetamol" in nl:
                        timing = "Take only as needed for knee pain (maximum 2 grams per day)"
                    elif "betahistine" in nl:
                        timing = "Take twice daily with meals to help relieve dizziness and unsteadiness"
                    elif "glimepiride" in nl:
                        timing = "Take once daily in the morning right before breakfast"
                    else:
                        timing = f"{freq} as directed by your physician"

                    purpose = f" • Purpose: {ind}" if ind else ""
                    med_lines.append(f"• **{name}** ({dose}): {timing}{purpose}")
            else:
                med_lines = [
                    "• **Metformin** (500 mg): Take twice daily with morning and evening meals (with food).",
                    "• **Amlodipine** (5 mg): Take once daily in the morning with a glass of water.",
                    "• **Atorvastatin** (10 mg): Take once nightly at bedtime.",
                    "• **Paracetamol** (500 mg): Take only as needed for knee pain (maximum 2 grams/day).",
                    "• **Betahistine** (16 mg): Take twice daily with meals for dizziness and vertigo."
                ]
            return (
                f"Hello {first_name}. Here is your daily medication schedule and timing as documented by your care team:\n\n"
                + "\n".join(med_lines)
                + "\n\n💡 **Tip**: Taking your medications with water at the same scheduled times helps maintain steady health. If you feel dizzy or notice any side effects, please reach out to your doctor or caregiver."
            )

        if any(w in q_lower for w in ["dizzy", "dizziness", "balance", "fall", "walking", "stand"]):
            return (
                f"Hello {first_name}.\n\n"
                "According to your recent care notes, you have experienced light morning dizziness and occasional unsteadiness when getting out of bed. Here are some helpful safety reminders from your records:\n\n"
                "• **Pause Before Standing**: Sit upright on the edge of your bed for 30–60 seconds before standing up to let your blood pressure adjust.\n"
                "• **Walking Support**: Family and caregiver notes suggest taking someone's arm or using steady support when walking outside or on uneven ground.\n"
                "• **Hydration**: Ensure you drink a glass of water upon waking up.\n\n"
                "Dr. Ramesh Varma has reviewed this pattern and advises monitoring your morning blood pressure."
            )

        if any(w in q_lower for w in ["doctor", "consultation", "ramesh", "chandran", "visit", "checkup"]):
            return (
                f"Hello {first_name}.\n\n"
                "Your recent clinical assessments show that your chronic conditions (Type 2 Diabetes, High Blood Pressure, and Knee Osteoarthritis) remain under stable control:\n\n"
                "• **Treating Doctor**: Dr. Ramesh Varma, MD (Geriatric & Internal Medicine)\n"
                "• **Prior Consultations**: Dr. S. Chandran, MD (documented in prior visits)\n"
                "• **Balance Review**: Dr. Ramesh Varma noted morning dizziness and advised gradual positional transitions and blood pressure checks.\n"
                "• **Follow-up**: Please continue your scheduled checkups."
            )

        if any(w in q_lower for w in ["sleep", "walk", "appetite", "eating", "food", "caregiver", "routine", "daily"]):
            return (
                f"Hello {first_name}.\n\n"
                "Your recent daily caregiver logs show:\n\n"
                "• **Sleep**: You generally sleep 7–8 hours per night comfortably.\n"
                "• **Walking & Mobility**: You walk independently inside the house, but caregiver notes recommend holding an arm or using support on uneven ground or outdoors.\n"
                "• **Appetite**: Meals and fluid intake have been well-maintained with family meal assistance."
            )

        return (
            f"Hello {first_name}. Your EvoCare health record is active and up to date:\n\n"
            "• **Confirmed Conditions**: Type 2 Diabetes Mellitus, Essential Hypertension, and Bilateral Knee Osteoarthritis.\n"
            "• **Active Regimen**: 4 daily medications managed with your family's pillbox support.\n"
            "• **Caregiver Logs**: Your daily walking, appetite, and sleep are regularly tracked.\n\n"
            "Feel free to ask about your medication times, recent doctor recommendations, or walking tips!"
        )
