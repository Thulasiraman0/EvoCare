import json
import pytest
from app.services.llm import (
    ParsedCaregiverObservation,
    ObservationCategory,
    EventType,
    ConfidenceLevel,
    CertaintyState,
    LLMStatus,
    ProcessingMethod,
    MockLLMProvider,
    AnthropicProvider,
    ObservationValidator,
    SafetyValidator,
)
from app.services.observation_pipeline_service import ObservationPipelineService
from app.models.evidence import Evidence
from app.models.audit import AuditLog
from app.models.caregiver_observation import CaregiverObservation

def test_valid_llm_response_validation():
    raw_json = json.dumps({
        "category": "dizziness",
        "subject": "patient",
        "event_type": "DIZZINESS_EPISODE",
        "severity": "Mild",
        "duration": "A few seconds",
        "frequency": "UNKNOWN",
        "onset": "After standing",
        "context": "Bedroom",
        "functional_impact": "UNKNOWN",
        "associated_details": {},
        "negations": [],
        "confidence": "HIGH",
        "certainty": "CONFIRMED",
        "unknown_fields": [],
        "requires_clarification": False,
        "clarification_fields": [],
        "etiology": "UNKNOWN",
        "diagnosis": None,
        "dementia_diagnosed": False,
        "clinical_diagnoses_inferred": False,
        "ground_impact": False,
        "raw_statement": "She had mild dizziness for a few seconds after standing in the bedroom."
    })
    is_valid, parsed, err = ObservationValidator.validate_raw_response(
        raw_json, "She had mild dizziness for a few seconds after standing in the bedroom."
    )
    assert is_valid is True
    assert parsed is not None
    assert parsed.category == ObservationCategory.DIZZINESS
    assert parsed.severity == "Mild"
    assert parsed.etiology == "UNKNOWN"

    is_safe, violations = SafetyValidator.validate_safety(
        parsed, "She had mild dizziness for a few seconds after standing in the bedroom."
    )
    assert is_safe is True
    assert len(violations) == 0

def test_malformed_json_handling():
    malformed = "{category: 'dizziness', severity: broken json"
    is_valid, parsed, err = ObservationValidator.validate_raw_response(malformed, "She is dizzy.")
    assert is_valid is False
    assert parsed is None
    assert "Malformed JSON" in err

def test_invalid_category_handling():
    invalid_cat_json = json.dumps({
        "category": "cardiology_pathology_invalid",
        "severity": "UNKNOWN"
    })
    is_valid, parsed, err = ObservationValidator.validate_raw_response(invalid_cat_json, "She is dizzy.")
    assert is_valid is False
    assert parsed is None
    assert "Schema validation error" in err

def test_hallucinated_severity_rejection():
    # Caregiver only said "She is dizzy" but LLM hallucinated "Severe"
    parsed = ParsedCaregiverObservation(
        category=ObservationCategory.DIZZINESS,
        severity="Severe",
        raw_statement="She is dizzy."
    )
    is_safe, violations = SafetyValidator.validate_safety(parsed, "She is dizzy.")
    assert is_safe is False
    assert any("Severity 'Severe' was hallucinated" in v for v in violations)

def test_hallucinated_duration_rejection():
    # Caregiver only said "She is dizzy" but LLM hallucinated "45 minutes"
    parsed = ParsedCaregiverObservation(
        category=ObservationCategory.DIZZINESS,
        duration="45 minutes",
        raw_statement="She is dizzy."
    )
    is_safe, violations = SafetyValidator.validate_safety(parsed, "She is dizzy.")
    assert is_safe is False
    assert any("Duration '45 minutes' was hallucinated" in v for v in violations)

def test_hallucinated_etiology_and_cause_rejection():
    # LLM inferred dehydration as cause of dizziness
    parsed = ParsedCaregiverObservation(
        category=ObservationCategory.DIZZINESS,
        etiology="dehydration and orthostatic hypotension",
        raw_statement="She is dizzy."
    )
    is_safe, violations = SafetyValidator.validate_safety(parsed, "She is dizzy.")
    assert is_safe is False
    assert any("Inferred dizziness etiology" in v for v in violations)

def test_confusion_does_not_become_dementia():
    # Caregiver reported confusion, LLM attempted to diagnose dementia
    parsed = ParsedCaregiverObservation(
        category=ObservationCategory.COGNITION,
        diagnosis="Dementia",
        dementia_diagnosed=True,
        raw_statement="She seems confused today."
    )
    is_safe, violations = SafetyValidator.validate_safety(parsed, "She seems confused today.")
    assert is_safe is False
    assert any("Dementia was diagnosed" in v for v in violations)

def test_near_fall_remains_near_fall():
    # Input is near-fall but LLM output classified as FALL
    parsed_bad = ParsedCaregiverObservation(
        category=ObservationCategory.FALL,
        event_type="FALL",
        ground_impact=True,
        raw_statement="She almost fell near the bathroom."
    )
    is_safe, violations = SafetyValidator.validate_safety(parsed_bad, "She almost fell near the bathroom.")
    assert is_safe is False
    assert any("Near-fall event was improperly classified" in v for v in violations)

def test_negation_did_not_fall():
    # Input says "She did not fall" but LLM classified as FALL
    parsed_bad = ParsedCaregiverObservation(
        category=ObservationCategory.FALL,
        event_type="FALL",
        ground_impact=True,
        raw_statement="She slipped but did not fall."
    )
    is_safe, violations = SafetyValidator.validate_safety(parsed_bad, "She slipped but did not fall.")
    assert is_safe is False
    assert any("Negated fall" in v for v in violations)

def test_uncertainty_handling_i_think():
    mock = MockLLMProvider()
    result = mock.extract_observation("I think she took her medicine.")
    assert result.status == LLMStatus.SUCCESS
    assert result.parsed_observation.certainty == CertaintyState.UNCERTAIN
    assert result.parsed_observation.confidence == ConfidenceLevel.LOW

def test_api_key_missing_fallback(client):
    # AnthropicProvider without API key reports LLM_UNAVAILABLE and falls back
    provider = AnthropicProvider(api_key="", enabled=True)
    res = provider.extract_observation("She is dizzy.")
    assert res.status == LLMStatus.LLM_UNAVAILABLE
    assert res.processing_method == ProcessingMethod.LLM_FALLBACK

def test_llm_exception_fallback(client):
    # Mock provider forcing ERROR status
    error_provider = MockLLMProvider(force_status=LLMStatus.ERROR, error_message="API Timeout 504")
    ObservationPipelineService.set_llm_provider(error_provider)
    try:
        res = client.post("/api/observations/start", json={
            "patient_code": "P001",
            "text": "She is dizzy.",
            "processing_mode": "LLM"
        })
        assert res.status_code == 201
        data = res.json()
        assert data["processing_method"] == "LLM_FALLBACK"
        assert data["category"] == "dizziness"
        assert len(data["missing_fields"]) >= 2
    finally:
        ObservationPipelineService.set_llm_provider(None)

def test_redundant_clarification_prevention(client):
    # Input has severity and duration already stated
    mock = MockLLMProvider()
    ObservationPipelineService.set_llm_provider(mock)
    try:
        res = client.post("/api/observations/start", json={
            "patient_code": "P001",
            "text": "She had severe dizziness for about 10 minutes after getting out of bed.",
            "processing_mode": "LLM"
        })
        assert res.status_code == 201
        data = res.json()
        assert "severity" not in data["missing_fields"]
        assert "duration" not in data["missing_fields"]
        assert "onset" not in data["missing_fields"]
    finally:
        ObservationPipelineService.set_llm_provider(None)

def test_one_question_at_a_time_behavior(client):
    mock = MockLLMProvider()
    ObservationPipelineService.set_llm_provider(mock)
    try:
        res = client.post("/api/observations/start", json={
            "patient_code": "P001",
            "text": "She is dizzy.",
            "processing_mode": "LLM"
        })
        assert res.status_code == 201
        data = res.json()
        assert data["next_question"] is not None
        assert data["next_question"]["field_name"] == data["missing_fields"][0]
        assert len(data["next_question"]["options"]) >= 2
    finally:
        ObservationPipelineService.set_llm_provider(None)

def test_evidence_creation_and_provenance(client, db_session):
    mock = MockLLMProvider()
    ObservationPipelineService.set_llm_provider(mock)
    try:
        res_start = client.post("/api/observations/start", json={
            "patient_code": "P001",
            "text": "She had knee pain after walking in the garden.",
            "caregiver_id": "CG001",
            "processing_mode": "AUTO"
        })
        sess_id = res_start.json()["session_id"]
        
        # Complete
        client.post(f"/api/clarification/{sess_id}/answer", json={
            "field_name": "severity",
            "answer": "Mild"
        })
        res_comp = client.post(f"/api/clarification/{sess_id}/complete")
        assert res_comp.status_code == 200
        comp_data = res_comp.json()

        # Check evidence code format
        assert comp_data["evidence_code"].startswith("EV-CG-")

        # Check DB records
        ev = db_session.query(Evidence).filter(Evidence.evidence_code == comp_data["evidence_code"]).first()
        assert ev is not None
        assert ev.original_statement == "She had knee pain after walking in the garden."

        # Check CaregiverObservation attributes provenance
        cg_obs = db_session.query(CaregiverObservation).filter(CaregiverObservation.evidence_id == ev.id).first()
        assert cg_obs is not None
        assert cg_obs.attributes.get("extraction_method") == "LLM_ASSISTED"

        # Check Audit Log (filter by action: entity_id alone can collide with
        # stale rows from earlier runs since ids are only unique per table)
        audit = db_session.query(AuditLog).filter(
            AuditLog.entity_id == str(ev.id),
            AuditLog.action == "CAREGIVER_OBSERVATION_INGESTED",
        ).first()
        assert audit is not None
        assert "LLM_ASSISTED" in audit.details
    finally:
        ObservationPipelineService.set_llm_provider(None)
