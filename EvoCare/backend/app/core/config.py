import os
from pathlib import Path

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

    # Phase 4 & Phase 7 LLM Settings
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    ANTHROPIC_MODEL: str = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")
    CLINICAL_REASONING_MODEL: str = os.getenv("CLINICAL_REASONING_MODEL", "claude-3-5-sonnet-20241022")
    LLM_ENABLED: bool = os.getenv("LLM_ENABLED", "true").lower() in ("true", "1")

    # Phase 8 Security & Authentication Settings
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "evocare-dev-jwt-secret-key-32bytes-long-2026!!")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = int(os.getenv("JWT_REFRESH_TOKEN_EXPIRE_DAYS", "7"))
    CORS_ORIGINS: list = os.getenv("CORS_ORIGINS", "http://localhost:9000,http://127.0.0.1:9000,http://localhost:5173,http://127.0.0.1:5173").split(",")
    AUTH_ENABLED: bool = os.getenv("AUTH_ENABLED", "true").lower() in ("true", "1")
    DEMO_MODE: bool = os.getenv("DEMO_MODE", "true").lower() in ("true", "1")

    # Two-Step Authentication (Password + OTP)
    OTP_ENABLED: bool = os.getenv("OTP_ENABLED", "true").lower() in ("true", "1")
    OTP_LENGTH: int = int(os.getenv("OTP_LENGTH", "6"))
    OTP_EXPIRE_SECONDS: int = int(os.getenv("OTP_EXPIRE_SECONDS", "300"))
    OTP_MAX_ATTEMPTS: int = int(os.getenv("OTP_MAX_ATTEMPTS", "5"))
    OTP_RESEND_COOLDOWN_SECONDS: int = int(os.getenv("OTP_RESEND_COOLDOWN_SECONDS", "30"))

settings = Settings()
