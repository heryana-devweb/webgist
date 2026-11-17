import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = BASE_DIR / ".env"

load_dotenv(dotenv_path=ENV_PATH, encoding="utf-8-sig")

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/webgis_carbonstock",
)
SECRET_KEY = os.getenv("SECRET_KEY", "webgis-carbonstock-secret-key-2026")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 jam

DATA_IMPORT_DIR = BASE_DIR / "data_import"
TEMP_UPLOAD_DIR = BASE_DIR / "temp_uploads"

DATA_IMPORT_DIR.mkdir(parents=True, exist_ok=True)
TEMP_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
