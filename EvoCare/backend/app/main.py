from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings
from app.core.database import engine, Base
import app.models  # Load all models for metadata

# Initialize database schema
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Longitudinal Memory System & Clinical Intelligence API for Elderly Healthcare",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Security Headers Middleware
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response

app.add_middleware(SecurityHeadersMiddleware)

# CORS middleware
origins = [
    "http://localhost:9000",
    "http://127.0.0.1:9000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health check
@app.get("/health", tags=["Health"])
def health_check():
    return {"status": "ok", "project": settings.PROJECT_NAME, "version": settings.VERSION}

# Include routers
from app.routers import (
    auth,
    admin,
    patients,
    evidence,
    caregiver,
    clinical,
    medications,
    labs,
    memory,
    timeline,
    observations,
    clarification,
    dashboard,
    clinical_reasoning,
    records
)

app.include_router(auth.router, prefix=settings.API_V1_STR)
app.include_router(admin.router, prefix=settings.API_V1_STR)
app.include_router(patients.router, prefix=settings.API_V1_STR)
app.include_router(evidence.router, prefix=settings.API_V1_STR)
app.include_router(caregiver.router, prefix=settings.API_V1_STR)
app.include_router(clinical.router, prefix=settings.API_V1_STR)
app.include_router(medications.router, prefix=settings.API_V1_STR)
app.include_router(labs.router, prefix=settings.API_V1_STR)
app.include_router(memory.router, prefix=settings.API_V1_STR)
app.include_router(timeline.router, prefix=settings.API_V1_STR)
app.include_router(observations.router, prefix=settings.API_V1_STR)
app.include_router(clarification.router, prefix=settings.API_V1_STR)
app.include_router(dashboard.router, prefix=settings.API_V1_STR)
app.include_router(clinical_reasoning.router, prefix=settings.API_V1_STR)
app.include_router(records.router, prefix=settings.API_V1_STR)

