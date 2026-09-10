import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, engine, Base
from app.services.import_service import ImportService
from app.main import app

@pytest.fixture(scope="session")
def db_session():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    # Ensure KB is imported
    ImportService.import_all(db)
    try:
        yield db
    finally:
        db.close()

@pytest.fixture(scope="session")
def client():
    c = TestClient(app)
    from app.core.security import create_access_token
    from app.models.security import User
    db = SessionLocal()
    user = db.query(User).filter(User.username == "doctor.demo").first()
    if user:
        token = create_access_token(data={"sub": str(user.id), "username": user.username, "role": "DOCTOR"})
        c.headers.update({"Authorization": f"Bearer {token}"})
    db.close()
    return c


@pytest.fixture(scope="session", autouse=True)
def _seed_security_demo():
    """Ensure demo users (incl. PATIENT role) and access grants exist before tests run.

    Uses SessionLocal directly (NOT the db_session fixture) because some test
    modules shadow db_session with a function-scoped fixture, which would
    trigger a ScopeMismatch for this session-scoped autouse fixture.
    """
    from scripts.seed_security_demo import seed_security_and_p002
    seed_security_and_p002()

