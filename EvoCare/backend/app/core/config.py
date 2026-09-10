import os
from pathlib import Path
try:
    from dotenv import load_dotenv
    # Load backend .env or root .env
    backend_env = Path(__file__).resolve().parent.parent.parent / ".env"
    root_env = Path(__file__).resolve().parent.parent.parent.parent / ".env"
    if backend_env.exists():
        load_dotenv(backend_env)
    elif root_env.exists():
        load_dotenv(root_env)
    else:
        load_dotenv()
except Exception:
    pass

class Settings:
    PROJECT_NAME: str = "EvoCare Longitudinal Patient Memory System"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api"
    DB_FILE_PATH: Path = Path(__file__).resolve().parent.parent.parent / "evocare.db"
    DATABASE_URL: str = os.getenv("DATABASE_URL", f"sqlite:///{DB_FILE_PATH}")
    DEBUG: bool = os.getenv("DEBUG", "True").lower() in ("true", "1")
    KNOWLEDGE_BASE_DIR: str = os.getenv(
        "KNOWLEDGE_BASE_DIR",
        str(Path(__file__).resolve().parent.parent.parent.parent / "knowledge-base")
    )

    # Multi-Tier AI Provider Settings (Gemini Flash + Groq + Deterministic Fallback)
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", os.getenv("GOOGLE_API_KEY", "")).strip()
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-3.6-flash").strip()
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "").strip()
    GROQ_PRIMARY_MODEL: str = os.getenv("GROQ_PRIMARY_MODEL", os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")).strip()
    GROQ_FALLBACK_MODEL: str = os.getenv("GROQ_FALLBACK_MODEL", "openai/gpt-oss-20b").strip()
    GROQ_MODEL: str = GROQ_PRIMARY_MODEL

    # Legacy compatibility
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "").strip()
    ANTHROPIC_MODEL: str = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022").strip()
    CLINICAL_REASONING_MODEL: str = GEMINI_MODEL

    LLM_ENABLED: bool = os.getenv("LLM_ENABLED", "true").lower() in ("true", "1")

    # MedGemma 1.5 (google/medgemma-1.5-4b-it) — medical-domain LLM used for the
    # 3D Human Anatomy explainer. Served through any OpenAI-compatible endpoint:
    #   - vLLM:    vllm serve google/medgemma-1.5-4b-it        -> http://localhost:8001/v1
    #   - Ollama:  ollama run hf.co/unsloth/medgemma-1.5-4b-it-GGUF -> http://localhost:11434/v1
    #   - HF Inference Router: https://router.huggingface.co/v1 (MEDGEMMA_API_KEY = HF token)
    MEDGEMMA_BASE_URL: str = os.getenv("MEDGEMMA_BASE_URL", "").strip().rstrip("/")
    MEDGEMMA_API_KEY: str = os.getenv("MEDGEMMA_API_KEY", os.getenv("HF_TOKEN", "")).strip()
    MEDGEMMA_MODEL: str = os.getenv("MEDGEMMA_MODEL", "google/medgemma-1.5-4b-it").strip()
    MEDGEMMA_TIMEOUT_SECONDS: int = int(os.getenv("MEDGEMMA_TIMEOUT_SECONDS", "60"))
    # When true, MedGemma is also tried first for doctor clinical reasoning (before Gemini/Groq)
    MEDGEMMA_PRIMARY_FOR_REASONING: bool = os.getenv("MEDGEMMA_PRIMARY_FOR_REASONING", "false").lower() in ("true", "1")

    # Phase 8 Security & Authentication Settings
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "evocare-dev-jwt-secret-key-32bytes-long-2026!!")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = int(os.getenv("JWT_REFRESH_TOKEN_EXPIRE_DAYS", "7"))
    CORS_ORIGINS: list = os.getenv("CORS_ORIGINS", "http://localhost:9000,http://127.0.0.1:9000,http://localhost:5173,http://127.0.0.1:5173").split(",")
    AUTH_ENABLED: bool = os.getenv("AUTH_ENABLED", "true").lower() in ("true", "1")
    DEMO_MODE: bool = os.getenv("DEMO_MODE", "true").lower() in ("true", "1")

settings = Settings()
