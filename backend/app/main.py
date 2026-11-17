from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.database import Base, SessionLocal, engine
from app.models import BiophysicalLayer, DEFAULT_BIOPHYSICAL_LAYERS, User
from app.auth import hash_password
from app.routers import auth_router, layer_router, analysis_router, project_router


def seed_initial_data():
    """Membuat akun default (admin & user) serta 14 kategori database biofisik saat pertama kali dijalankan."""
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis;"))

    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        # 1. Seed akun Admin & User Biasa
        admin_user = db.query(User).filter(User.username == "admin").first()
        if not admin_user:
            db.add(
                User(
                    username="admin",
                    full_name="Administrator WebGIS",
                    hashed_password=hash_password("admin123"),
                    role="admin",
                    is_active=True,
                )
            )

        regular_user = db.query(User).filter(User.username == "user").first()
        if not regular_user:
            db.add(
                User(
                    username="user",
                    full_name="User Analisis Biofisik",
                    hashed_password=hash_password("user123"),
                    role="user",
                    is_active=True,
                )
            )

        # 2. Seed 14 Kategori Database Biofisik
        for item in DEFAULT_BIOPHYSICAL_LAYERS:
            existing = (
                db.query(BiophysicalLayer)
                .filter(BiophysicalLayer.slug == item["slug"])
                .first()
            )
            if not existing:
                db.add(
                    BiophysicalLayer(
                        order_index=item["order_index"],
                        slug=item["slug"],
                        name=item["name"],
                        description=item["description"],
                        table_name=f"layer_{item['slug']}",
                        has_data=False,
                        feature_count=0,
                        available_columns=[],
                    )
                )

        db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    seed_initial_data()
    yield


app = FastAPI(
    title="WebGIS Analisis Biofisik & Carbon Stock API",
    description="API Geoprocessing Otomatis (Clipping AOI & Kustomisasi Atribut Biofisik)",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(layer_router.router)
app.include_router(analysis_router.router)
app.include_router(project_router.router)


@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "service": "WebGIS Analisis Biofisik API",
    }
