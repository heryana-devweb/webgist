from datetime import datetime
from pathlib import Path
from typing import List, Optional
import shutil
import tempfile
import zipfile

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session
import geopandas as gpd
import shapely

from app.config import DATA_IMPORT_DIR, TEMP_UPLOAD_DIR
from app.database import engine, get_db
from app.models import BiophysicalLayer, User
from app.auth import get_current_user, require_admin

router = APIRouter(prefix="/api/layers", tags=["Biophysical Layers"])

# Kamus pintar untuk menebak alias awal dari kode kolom standar BIG / KLHK
# (User dan Admin tetap bebas mengubah nama alias ini kapan saja)
SMART_COLUMN_ALIASES = {
    "WADMPR": "Provinsi",
    "WADMKK": "Kabupaten/Kota",
    "WADMKC": "Kecamatan",
    "WADMKD": "Desa/Kelurahan",
    "NAMOBJ": "Nama Objek",
    "REMARK": "Catatan / Keterangan",
    "KDPPUM": "Kode Provinsi",
    "KDPKAB": "Kode Kabupaten",
    "KDCPUM": "Kode Kecamatan",
    "KDEPUM": "Kode Desa",
    "FUNGSIKWS": "Fungsi Kawasan Hutan",
    "FUNGSI": "Fungsi Kawasan",
    "SK_MENLHK": "Nomor SK MenLHK",
    "KELERENGAN": "Kelas Kelerengan",
    "LERENG": "Kemiringan Lereng",
    "ELEVASI": "Kelas Ketinggian",
    "KETINGGIAN": "Kelas Ketinggian",
    "JENISTANAH": "Jenis Tanah",
    "TANAH": "Jenis Tanah",
    "TEBAL_GMBT": "Ketebalan Gambut",
    "FEG": "Fungsi Ekosistem Gambut",
    "SISTEMLHN": "Sistem Lahan",
    "TUTUPAN": "Tutupan Lahan",
    "PL_2022": "Tutupan Lahan",
    "PL_2023": "Tutupan Lahan",
    "MANGROVE": "Ekosistem Mangrove",
    "DEFOREST": "Kelas Deforestasi",
    "TAHUN": "Tahun",
}


class ColumnConfigItem(BaseModel):
    original_name: str
    default_alias: str
    selected: bool = True
    dtype: str = "text"


class UpdateColumnsRequest(BaseModel):
    columns: List[ColumnConfigItem]


class LocalImportRequest(BaseModel):
    filename: str


class HansenConfigRequest(BaseModel):
    start_year: int = 2015
    end_year: int = 2025


class HansenDownloadRequest(BaseModel):
    region: str = "all"
    start_year: int = 2015
    end_year: int = 2025


class DemDownloadRequest(BaseModel):
    region: str = "kalimantan"


def find_vector_file_in_dir(directory: Path) -> Optional[Path]:
    """Cari file .shp, .gpkg, atau .geojson di dalam folder hasil ekstrak."""
    for ext in ("*.shp", "*.gpkg", "*.geojson"):
        matches = list(directory.rglob(ext))
        if matches:
            return matches[0]
    return None


def ingest_vector_to_postgis(
    vector_path: Path,
    layer: BiophysicalLayer,
    source_filename: str,
    db: Session,
):
    """Membaca SHP/GPKG, menstandarkan ke EPSG:4326 2D, dan menyimpan ke PostGIS + GIST Index."""
    print(f"[IMPORT] [1/4] Membaca file spasial: {source_filename} ...")
    try:
        gdf = gpd.read_file(vector_path, engine="pyogrio")
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Gagal membaca file spasial: {str(exc)}",
        )

    if gdf.empty:
        raise HTTPException(
            status_code=400,
            detail="File SHP kosong (tidak memiliki data poligon).",
        )

    # Buang baris yang tidak punya geometri
    gdf = gdf[gdf.geometry.notnull() & ~gdf.geometry.is_empty].copy()
    if gdf.empty:
        raise HTTPException(
            status_code=400,
            detail="Seluruh geometri di dalam file SHP kosong atau tidak valid.",
        )

    print(f"[IMPORT] [2/4] Menstandarkan proyeksi & geometri 2D untuk {len(gdf):,} poligon ...")
    # Standarkan sistem koordinat ke EPSG:4326 (WGS 84)
    if gdf.crs is None:
        gdf = gdf.set_crs(epsg=4326)
    elif gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)

    # Paksa geometri menjadi 2D (menghindari masalah Polygon Z / 3D dari data BIG/KLHK)
    gdf.geometry = shapely.force_2d(gdf.geometry)
    gdf = gdf.rename_geometry("geom")

    # Bersihkan nama kolom atribut agar aman di PostgreSQL
    attr_columns = [c for c in gdf.columns if c != "geom"]
    cleaned_col_map = {}
    available_cols_meta = []

    for col in attr_columns:
        safe_col = str(col).strip().replace('"', "").replace(" ", "_")
        if safe_col.lower() in ("geom", "geometry", "_luas_ha", "_persen_aoi"):
            safe_col = f"attr_{safe_col}"
        cleaned_col_map[col] = safe_col

        upper_col = safe_col.upper()
        guessed_alias = SMART_COLUMN_ALIASES.get(upper_col, safe_col)
        dtype_str = str(gdf[col].dtype)

        # Konversi tipe datetime/object kompleks menjadi string agar aman saat masuk DB & JSON
        if "datetime" in dtype_str:
            gdf[col] = gdf[col].astype(str)

        available_cols_meta.append(
            {
                "original_name": safe_col,
                "default_alias": guessed_alias,
                "selected": True,
                "dtype": "number"
                if ("int" in dtype_str or "float" in dtype_str)
                else "text",
            }
        )

    gdf = gdf.rename(columns=cleaned_col_map)

    table_name = layer.table_name

    print(f"[IMPORT] [3/4] Menyimpan {len(gdf):,} poligon ke tabel PostGIS '{table_name}' ...")
    # Simpan ke PostGIS secara bertahap (chunksize=5000) agar stabil untuk data besar se-Indonesia
    try:
        gdf.to_postgis(
            name=table_name,
            con=engine,
            if_exists="replace",
            index=True,
            index_label="gid",
            chunksize=5000,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Gagal menyimpan layer ke PostGIS: {str(exc)}",
        )

    print(f"[IMPORT] [4/4] Membuat Spatial Index (GIST) pada '{table_name}' ...")
    # Pastikan Spatial Index (GIST) terpasang di PostGIS
    with engine.begin() as conn:
        conn.execute(
            text(
                f'CREATE INDEX IF NOT EXISTS "idx_{table_name}_geom" ON "{table_name}" USING GIST (geom);'
            )
        )

    print(f"[IMPORT] SELESAI! Database '{layer.name}' siap digunakan ({len(gdf):,} poligon).")

    layer.has_data = True
    layer.feature_count = int(len(gdf))
    layer.source_filename = source_filename
    layer.available_columns = available_cols_meta
    layer.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(layer)
    return layer


@router.get("")
def list_layers(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    from app.hansen_engine import get_available_hansen_tifs, HANSEN_DEFAULT_COLUMNS

    # Otomatis aktifkan status layer Deforestasi Hansen jika ada file .tif di folder data_hansen
    hansen_tifs = get_available_hansen_tifs()
    if hansen_tifs:
        hansen_layer = (
            db.query(BiophysicalLayer)
            .filter(BiophysicalLayer.slug == "deforestasi_hansen")
            .first()
        )
        if hansen_layer and not hansen_layer.has_data:
            hansen_layer.has_data = True
            hansen_layer.feature_count = len(hansen_tifs)
            hansen_layer.source_filename = f"{len(hansen_tifs)} Tile GeoTIFF (data_hansen)"
            hansen_layer.available_columns = HANSEN_DEFAULT_COLUMNS
            hansen_layer.updated_at = datetime.utcnow()
            db.commit()

    layers = (
        db.query(BiophysicalLayer)
        .order_by(BiophysicalLayer.order_index.asc())
        .all()
    )
    return [
        {
            "id": l.id,
            "order_index": l.order_index,
            "slug": l.slug,
            "name": l.name,
            "description": l.description,
            "table_name": l.table_name,
            "has_data": l.has_data,
            "feature_count": l.feature_count,
            "source_filename": l.source_filename,
            "available_columns": l.available_columns or [],
            "updated_at": l.updated_at.isoformat() if l.updated_at else None,
        }
        for l in layers
    ]


@router.get("/local-files")
def list_local_import_files(_: User = Depends(require_admin)):
    """Daftar file .zip / .shp / .gpkg / .tif di folder backend/data_import untuk import data ukuran besar."""
    files = []
    for ext in ("*.zip", "*.shp", "*.gpkg", "*.geojson", "*.tif", "*.tiff"):
        for f in DATA_IMPORT_DIR.glob(ext):
            size_mb = round(f.stat().st_size / (1024 * 1024), 2)
            files.append(
                {
                    "filename": f.name,
                    "size_mb": size_mb,
                }
            )
    return {
        "import_folder": str(DATA_IMPORT_DIR),
        "files": sorted(files, key=lambda x: x["filename"]),
    }


@router.post("/{slug}/upload")
async def upload_layer_shp(
    slug: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Upload file .zip (berisi .shp, .shx, .dbf, .prj) atau .geojson/.gpkg langsung dari web Admin."""
    layer = db.query(BiophysicalLayer).filter(BiophysicalLayer.slug == slug).first()
    if not layer:
        raise HTTPException(status_code=404, detail="Tema database tidak ditemukan.")

    filename = file.filename or "uploaded_layer.zip"
    suffix = Path(filename).suffix.lower()
    if suffix not in (".zip", ".gpkg", ".geojson", ".json"):
        raise HTTPException(
            status_code=400,
            detail="Harap unggah file Shapefile dalam bentuk .zip (berisi .shp, .shx, .dbf, .prj) atau file .gpkg / .geojson.",
        )

    temp_dir = Path(tempfile.mkdtemp(dir=TEMP_UPLOAD_DIR))
    try:
        saved_path = temp_dir / filename
        with saved_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        if suffix == ".zip":
            extract_dir = temp_dir / "extracted"
            extract_dir.mkdir(exist_ok=True)
            try:
                with zipfile.ZipFile(saved_path, "r") as zf:
                    zf.extractall(extract_dir)
            except zipfile.BadZipFile:
                raise HTTPException(status_code=400, detail="File .zip rusak atau tidak valid.")

            vector_file = find_vector_file_in_dir(extract_dir)
            if not vector_file:
                raise HTTPException(
                    status_code=400,
                    detail="Tidak ditemukan file .shp di dalam .zip yang diunggah.",
                )
        else:
            vector_file = saved_path

        updated_layer = ingest_vector_to_postgis(
            vector_path=vector_file,
            layer=layer,
            source_filename=filename,
            db=db,
        )
        return {
            "message": f"Database '{updated_layer.name}' berhasil diunggah ke PostGIS ({updated_layer.feature_count:,} poligon).",
            "layer": {
                "slug": updated_layer.slug,
                "name": updated_layer.name,
                "has_data": updated_layer.has_data,
                "feature_count": updated_layer.feature_count,
                "source_filename": updated_layer.source_filename,
                "available_columns": updated_layer.available_columns,
            },
        }
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@router.post("/{slug}/import-local")
def import_layer_from_local_folder(
    slug: str,
    payload: LocalImportRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Import file SHP/ZIP/GPKG berukuran besar dari folder backend/data_import ke PostGIS."""
    layer = db.query(BiophysicalLayer).filter(BiophysicalLayer.slug == slug).first()
    if not layer:
        raise HTTPException(status_code=404, detail="Tema database tidak ditemukan.")

    target_file = (DATA_IMPORT_DIR / payload.filename).resolve()
    if not target_file.exists() or target_file.parent != DATA_IMPORT_DIR.resolve():
        raise HTTPException(
            status_code=404,
            detail=f"File '{payload.filename}' tidak ditemukan di folder {DATA_IMPORT_DIR}.",
        )

    suffix = target_file.suffix.lower()

    # Jika file berupa GeoTIFF (.tif / .tiff) untuk Deforestasi Hansen
    if suffix in (".tif", ".tiff"):
        from app.hansen_engine import (
            HANSEN_DIR,
            HANSEN_DEFAULT_COLUMNS,
            get_available_hansen_tifs,
        )

        dest_tif = HANSEN_DIR / target_file.name
        if target_file.resolve() != dest_tif.resolve():
            shutil.copy2(target_file, dest_tif)

        all_tifs = get_available_hansen_tifs()
        layer.has_data = True
        layer.feature_count = len(all_tifs)
        layer.source_filename = f"{len(all_tifs)} Tile GeoTIFF (data_hansen)"
        layer.available_columns = HANSEN_DEFAULT_COLUMNS
        layer.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(layer)
        return {
            "message": f"File GeoTIFF '{target_file.name}' berhasil didaftarkan ke '{layer.name}' (Total: {len(all_tifs)} tile aktif).",
            "layer": {
                "slug": layer.slug,
                "name": layer.name,
                "has_data": layer.has_data,
                "feature_count": layer.feature_count,
                "source_filename": layer.source_filename,
                "available_columns": layer.available_columns,
            },
        }

    temp_dir = None
    try:
        if suffix == ".zip":
            temp_dir = Path(tempfile.mkdtemp(dir=TEMP_UPLOAD_DIR))
            with zipfile.ZipFile(target_file, "r") as zf:
                zf.extractall(temp_dir)
            vector_file = find_vector_file_in_dir(temp_dir)
            if not vector_file:
                raise HTTPException(
                    status_code=400,
                    detail="Tidak ditemukan file .shp di dalam file .zip tersebut.",
                )
        else:
            vector_file = target_file

        updated_layer = ingest_vector_to_postgis(
            vector_path=vector_file,
            layer=layer,
            source_filename=payload.filename,
            db=db,
        )
        return {
            "message": f"Database '{updated_layer.name}' berhasil di-import dari folder lokal ({updated_layer.feature_count:,} poligon).",
            "layer": {
                "slug": updated_layer.slug,
                "name": updated_layer.name,
                "has_data": updated_layer.has_data,
                "feature_count": updated_layer.feature_count,
                "source_filename": updated_layer.source_filename,
                "available_columns": updated_layer.available_columns,
            },
        }
    finally:
        if temp_dir:
            shutil.rmtree(temp_dir, ignore_errors=True)


@router.put("/{slug}/columns")
def update_layer_columns(
    slug: str,
    payload: UpdateColumnsRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Simpan konfigurasi default pilihan kolom & nama alias kolom untuk suatu database."""
    layer = db.query(BiophysicalLayer).filter(BiophysicalLayer.slug == slug).first()
    if not layer:
        raise HTTPException(status_code=404, detail="Tema database tidak ditemukan.")

    layer.available_columns = [col.model_dump() for col in payload.columns]
    db.commit()
    db.refresh(layer)
    return {
        "message": f"Konfigurasi kolom untuk '{layer.name}' berhasil disimpan.",
        "available_columns": layer.available_columns,
    }


@router.get("/{slug}/sample")
def get_layer_sample_rows(
    slug: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Ambil 10 baris contoh atribut dari tabel PostGIS untuk pratinjau kolom."""
    layer = db.query(BiophysicalLayer).filter(BiophysicalLayer.slug == slug).first()
    if not layer or not layer.has_data:
        raise HTTPException(status_code=404, detail="Layer belum memiliki data.")

    if slug == "deforestasi_hansen":
        from app.hansen_engine import get_available_hansen_tifs, get_hansen_config

        if get_available_hansen_tifs():
            cfg = get_hansen_config()
            s_y = cfg["start_year"]
            e_y = cfg["end_year"]
            sample_rows = [
                {
                    "TAHUN": year,
                    "KELAS": f"Deforestasi Tahun {year}",
                    "PERIODE": f"{s_y} - {e_y}",
                    "SUMBER": "Hansen GFC (30m)",
                }
                for year in range(s_y, e_y + 1)
            ]
            return {
                "columns": layer.available_columns,
                "rows": sample_rows,
            }

    if slug == "ketinggian":
        from app.dem_engine import ELEVATION_CLASSES

        return {
            "columns": layer.available_columns,
            "rows": [
                {
                    "KELAS_ELEV": name,
                    "RENTANG_M": rng,
                    "SUMBER": "Copernicus DEM GLO-30 (30m)",
                }
                for _, name, rng, _, _ in ELEVATION_CLASSES
            ],
        }

    if slug == "kelerengan":
        from app.dem_engine import SLOPE_CLASSES

        return {
            "columns": layer.available_columns,
            "rows": [
                {
                    "KELAS_LERENG": name,
                    "PERSEN_LRG": rng,
                    "SUMBER": "Copernicus DEM GLO-30 (30m)",
                }
                for _, name, rng, _, _ in SLOPE_CLASSES
            ],
        }

    cols = [c["original_name"] for c in (layer.available_columns or [])]
    if not cols:
        return {"columns": [], "rows": []}

    quoted_cols = ", ".join([f'"{c}"' for c in cols])
    sql = text(f'SELECT {quoted_cols} FROM "{layer.table_name}" LIMIT 10')
    with engine.connect() as conn:
        result = conn.execute(sql)
        rows = [dict(row._mapping) for row in result]

    return {
        "columns": layer.available_columns,
        "rows": rows,
    }


@router.get("/hansen/status")
def get_hansen_status(_: User = Depends(get_current_user)):
    """Mendapatkan status download, daftar file .tif, dan pengaturan rentang tahun Deforestasi Hansen."""
    from app.hansen_engine import (
        HANSEN_DOWNLOAD_STATE,
        get_available_hansen_tifs,
        get_hansen_config,
    )

    cfg = get_hansen_config()
    tifs = get_available_hansen_tifs()
    return {
        "start_year": cfg["start_year"],
        "end_year": cfg["end_year"],
        "tile_count": len(tifs),
        "files": [
            {
                "filename": f.name,
                "size_mb": round(f.stat().st_size / (1024 * 1024), 1),
            }
            for f in tifs
        ],
        **HANSEN_DOWNLOAD_STATE,
    }


@router.put("/hansen/config")
def update_hansen_year_range(
    payload: HansenConfigRequest,
    _: User = Depends(require_admin),
):
    """Mengubah rentang tahun analisis Deforestasi Hansen (misal 2015 s/d 2025) tanpa perlu download ulang."""
    from app.hansen_engine import save_hansen_config

    cfg = save_hansen_config(payload.start_year, payload.end_year)
    return {
        "message": f"Rentang tahun Deforestasi Hansen diatur ke {cfg['start_year']} - {cfg['end_year']}.",
        "start_year": cfg["start_year"],
        "end_year": cfg["end_year"],
    }


@router.post("/hansen/download")
def trigger_hansen_download(
    payload: HansenDownloadRequest,
    _: User = Depends(require_admin),
):
    """Memulai download otomatis tile GeoTIFF Deforestasi Hansen langsung dari halaman Kelola Database."""
    from app.hansen_engine import start_background_hansen_download, HANSEN_DOWNLOAD_STATE

    started = start_background_hansen_download(
        region_key=payload.region,
        start_year=payload.start_year,
        end_year=payload.end_year,
    )
    if not started:
        return {
            "message": "Proses download sedang berjalan...",
            **HANSEN_DOWNLOAD_STATE,
        }
    return {
        "message": f"Download otomatis Deforestasi Hansen ({payload.start_year}-{payload.end_year}) dimulai.",
        **HANSEN_DOWNLOAD_STATE,
    }


@router.get("/dem/status")
def get_dem_status(_: User = Depends(get_current_user)):
    """Mendapatkan status download offline & cache tile Copernicus DEM 30m."""
    from app.dem_engine import (
        DEM_DOWNLOAD_STATE,
        get_available_dem_tifs,
        get_dem_config,
    )

    tifs = get_available_dem_tifs()
    cfg = get_dem_config()
    return {
        "cached_tile_count": len(tifs),
        **cfg,
        **DEM_DOWNLOAD_STATE,
    }


@router.post("/dem/download")
def trigger_dem_offline_download(
    payload: DemDownloadRequest,
    _: User = Depends(require_admin),
):
    """Memulai download offline tile Copernicus DEM 30m per pulau/seluruh Indonesia."""
    from app.dem_engine import start_background_dem_download, DEM_DOWNLOAD_STATE

    started = start_background_dem_download(payload.region)
    if not started:
        return {
            "message": "Proses download DEM sedang berjalan...",
            **DEM_DOWNLOAD_STATE,
        }
    return {
        "message": f"Download offline Copernicus DEM 30m wilayah '{payload.region}' dimulai.",
        **DEM_DOWNLOAD_STATE,
    }


@router.post("/dem/{slug}/activate")
def activate_dem_online_layer(
    slug: str,
    _: User = Depends(require_admin),
):
    """Mengaktifkan sumber data online Copernicus DEM GLO-30 (30m) untuk Ketinggian atau Kelerengan."""
    if slug not in ("ketinggian", "kelerengan"):
        raise HTTPException(
            status_code=400,
            detail="Hanya layer 'ketinggian' atau 'kelerengan' yang mendukung Copernicus DEM online.",
        )

    from app.dem_engine import set_dem_online_mode

    set_dem_online_mode(slug, True)
    label = "Ketinggian (Elevasi)" if slug == "ketinggian" else "Kelerengan (Kemiringan Lereng)"
    return {
        "message": f"Sumber data online Copernicus DEM 30m untuk '{label}' telah diaktifkan!",
    }


@router.delete("/{slug}/data")
def clear_layer_data(
    slug: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Kosongkan data PostGIS (atau file raster Hansen/DEM) pada tema tertentu."""
    layer = db.query(BiophysicalLayer).filter(BiophysicalLayer.slug == slug).first()
    if not layer:
        raise HTTPException(status_code=404, detail="Tema database tidak ditemukan.")

    if slug == "deforestasi_hansen":
        from app.hansen_engine import clear_all_hansen_files

        clear_all_hansen_files()

    if slug in ("ketinggian", "kelerengan"):
        from app.dem_engine import set_dem_online_mode

        set_dem_online_mode(slug, False)

    with engine.begin() as conn:
        conn.execute(text(f'DROP TABLE IF EXISTS "{layer.table_name}" CASCADE;'))

    layer.has_data = False
    layer.feature_count = 0
    layer.source_filename = None
    layer.available_columns = []
    layer.updated_at = None
    db.commit()
    return {"message": f"Data pada '{layer.name}' telah dihapus dari database."}
