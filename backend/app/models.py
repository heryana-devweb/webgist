from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, JSON, Text, Float
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, index=True, nullable=False)
    full_name = Column(String(150), nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, default="user")  # 'admin' atau 'user'
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    project_code = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(200), nullable=False)
    location = Column(String(250), nullable=False)
    upload_date = Column(String(20), nullable=False)  # Format YYYY-MM-DD
    aoi_filename = Column(String(255), nullable=False)
    aoi_area_ha = Column(Float, default=0.0)
    aoi_wkt = Column(Text, nullable=False)
    aoi_geojson = Column(JSON, nullable=False)
    created_by = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ProjectLayerAnalysis(Base):
    __tablename__ = "project_layer_analyses"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, index=True, nullable=False)
    layer_slug = Column(String(100), index=True, nullable=False)
    # Menyimpan hasil clipping (GeoJSON + tabel baris atribut) secara permanen
    result_data = Column(JSON, nullable=True)
    # Menyimpan susunan kolom, centang kolom, dan nama alias yang diatur user
    custom_columns = Column(JSON, nullable=True)
    # Menyimpan preferensi tampilan (pilihan tahun Hansen, atribut peta, sort, dll.)
    preferences = Column(JSON, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow)


class BiophysicalLayer(Base):
    __tablename__ = "biophysical_layers"

    id = Column(Integer, primary_key=True, index=True)
    order_index = Column(Integer, nullable=False, default=1)
    slug = Column(String(100), unique=True, index=True, nullable=False)
    name = Column(String(150), nullable=False)
    description = Column(Text, nullable=True)
    table_name = Column(String(150), unique=True, nullable=False)
    has_data = Column(Boolean, default=False)
    feature_count = Column(Integer, default=0)
    source_filename = Column(String(255), nullable=True)
    # Menyimpan daftar kolom dari SHP beserta konfigurasi default:
    # [{"original_name": "WADMKK", "default_alias": "Kabupaten/Kota", "selected": True, "dtype": "str"}, ...]
    available_columns = Column(JSON, default=list)
    updated_at = Column(DateTime, nullable=True)


DEFAULT_BIOPHICAL_LAYERS = [
    {
        "order_index": 1,
        "slug": "administrasi_wilayah",
        "name": "Administrasi Wilayah",
        "description": "Database batas administrasi wilayah (Desa/Kecamatan/Kabupaten/Provinsi) se-Indonesia.",
    },
    {
        "order_index": 2,
        "slug": "fungsi_kawasan_hutan",
        "name": "Fungsi Kawasan Hutan",
        "description": "Database penunjukan/penetapan fungsi kawasan hutan (HL, HP, HPT, HPK, KSA/KPA, APL).",
    },
    {
        "order_index": 3,
        "slug": "ketinggian",
        "name": "Ketinggian",
        "description": "Database kelas ketinggian tempat / elevasi (mdpl).",
    },
    {
        "order_index": 4,
        "slug": "kelerengan",
        "name": "Kelerengan",
        "description": "Database kelas kemiringan lereng (%).",
    },
    {
        "order_index": 5,
        "slug": "jenis_tanah",
        "name": "Jenis Tanah",
        "description": "Database klasifikasi jenis tanah / satuan peta tanah.",
    },
    {
        "order_index": 6,
        "slug": "ketebalan_gambut",
        "name": "Ketebalan Gambut",
        "description": "Database sebaran dan kelas ketebalan lahan gambut.",
    },
    {
        "order_index": 7,
        "slug": "fungsi_ekosistem_gambut",
        "name": "Fungsi Ekosistem Gambut",
        "description": "Database Fungsi Ekosistem Gambut (Fungsi Lindung & Fungsi Budidaya).",
    },
    {
        "order_index": 8,
        "slug": "sistem_lahan",
        "name": "Sistem Lahan",
        "description": "Database satuan sistem lahan (Land System).",
    },
    {
        "order_index": 9,
        "slug": "tutupan_lahan",
        "name": "Tutupan Lahan",
        "description": "Database penutupan lahan eksisting.",
    },
    {
        "order_index": 10,
        "slug": "fungsi_ekosistem_mangrove",
        "name": "Fungsi Ekosistem Mangrove",
        "description": "Database peta ekosistem mangrove nasional dan fungsinya.",
    },
    {
        "order_index": 11,
        "slug": "perubahan_tutupan_lahan",
        "name": "Perubahan Tutupan Lahan",
        "description": "Database dinamika / transisi perubahan tutupan lahan antar periode.",
    },
    {
        "order_index": 12,
        "slug": "deforestasi_klhk",
        "name": "Deforestasi KLHK",
        "description": "Database spasi-temporal deforestasi resmi KLHK.",
    },
    {
        "order_index": 13,
        "slug": "deforestasi_hansen",
        "name": "Deforestasi Hansen",
        "description": "Database kehilangan tutupan pohon (Tree Cover Loss) berbasis data Hansen.",
    },
    {
        "order_index": 14,
        "slug": "kebakaran_lahan",
        "name": "Kebakaran Lahan",
        "description": "Database areal bekas kebakaran hutan dan lahan (Burned Area).",
    },
]
DEFAULT_BIOPHYSICAL_LAYERS = DEFAULT_BIOPHICAL_LAYERS
