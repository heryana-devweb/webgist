from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
import json
import shutil
import tempfile
import zipfile

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session
import geopandas as gpd
import shapely

from app.config import TEMP_UPLOAD_DIR
from app.database import Base, engine, get_db
from app.models import BiophysicalLayer, Project, ProjectLayerAnalysis, User
from app.auth import get_current_user
from app.routers.layer_router import find_vector_file_in_dir

router = APIRouter(prefix="/api/projects", tags=["Projects"])


class ProjectLayerSettingsRequest(BaseModel):
    custom_columns: Optional[List[Dict[str, Any]]] = None
    preferences: Optional[Dict[str, Any]] = None


def ensure_projects_table():
    Base.metadata.create_all(bind=engine)


def parse_uploaded_aoi_file(file: UploadFile):
    """Membaca file .zip SHP atau .geojson menjadi GeoJSON, WKT union, dan Luas (Ha)."""
    filename = file.filename or "aoi_project.zip"
    suffix = Path(filename).suffix.lower()
    if suffix not in (".zip", ".geojson", ".json", ".gpkg"):
        raise HTTPException(
            status_code=400,
            detail="Harap unggah file SHP dalam bentuk .zip (berisi .shp, .shx, .dbf, .prj) atau .geojson.",
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
                raise HTTPException(status_code=400, detail="File .zip SHP rusak atau tidak valid.")

            vector_file = find_vector_file_in_dir(extract_dir)
            if not vector_file:
                raise HTTPException(
                    status_code=400,
                    detail="Tidak ditemukan file .shp di dalam .zip yang diunggah.",
                )
        else:
            vector_file = saved_path

        try:
            aoi_gdf = gpd.read_file(vector_file, engine="pyogrio")
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Gagal membaca file SHP Project: {str(exc)}",
            )

        if aoi_gdf.empty:
            raise HTTPException(status_code=400, detail="File SHP tidak memiliki poligon.")

        aoi_gdf = aoi_gdf[aoi_gdf.geometry.notnull() & ~aoi_gdf.geometry.is_empty].copy()
        if aoi_gdf.empty:
            raise HTTPException(status_code=400, detail="Geometri pada file SHP kosong.")

        if aoi_gdf.crs is None:
            aoi_gdf = aoi_gdf.set_crs(epsg=4326)
        elif aoi_gdf.crs.to_epsg() != 4326:
            aoi_gdf = aoi_gdf.to_crs(epsg=4326)

        aoi_gdf.geometry = shapely.force_2d(aoi_gdf.geometry)
        aoi_gdf.geometry = shapely.make_valid(aoi_gdf.geometry)

        # Konversi kolom datetime ke string jika ada agar aman di GeoJSON
        for col in aoi_gdf.columns:
            if col != "geometry" and "datetime" in str(aoi_gdf[col].dtype):
                aoi_gdf[col] = aoi_gdf[col].astype(str)

        unioned_geom = shapely.unary_union(aoi_gdf.geometry.values)
        unioned_geom = shapely.make_valid(shapely.force_2d(unioned_geom))
        aoi_wkt = unioned_geom.wkt
        aoi_geojson = json.loads(aoi_gdf.to_json())

        with engine.connect() as conn:
            aoi_area_ha = conn.execute(
                text(
                    """
                    SELECT ROUND((ST_Area(ST_SetSRID(ST_GeomFromText(:wkt), 4326)::geography) / 10000.0)::numeric, 2)
                    """
                ),
                {"wkt": aoi_wkt},
            ).scalar()
            aoi_area_ha = float(aoi_area_ha or 0.0)

        return {
            "filename": filename,
            "aoi_wkt": aoi_wkt,
            "aoi_geojson": aoi_geojson,
            "aoi_area_ha": aoi_area_ha,
            "feature_count": int(len(aoi_gdf)),
        }
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def generate_was_code(db: Session, upload_date_str: str) -> str:
    """Menghasilkan kode otomatis WAS-ddmm-n berdasarkan tanggal upload."""
    ensure_projects_table()
    try:
        dt = datetime.strptime(upload_date_str, "%Y-%m-%d")
    except Exception:
        dt = datetime.now()

    ddmm = dt.strftime("%d%m")
    prefix = f"WAS-{ddmm}-"

    existing_codes = (
        db.query(Project.project_code)
        .filter(Project.project_code.like(f"{prefix}%"))
        .all()
    )

    max_n = 0
    for (code,) in existing_codes:
        try:
            suffix_num = int(str(code).replace(prefix, "").strip())
            if suffix_num > max_n:
                max_n = suffix_num
        except Exception:
            continue

    next_n = max_n + 1
    return f"{prefix}{next_n}"


@router.get("/next-code")
def get_next_project_code(
    upload_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    ensure_projects_table()
    date_str = upload_date or datetime.now().strftime("%Y-%m-%d")
    code = generate_was_code(db, date_str)
    return {"project_code": code, "upload_date": date_str}


@router.post("/preview-shp")
async def preview_project_shp(
    file: UploadFile = File(...),
    _: User = Depends(get_current_user),
):
    """Preview peta areal kerja saat user memilih file SHP di halaman Project Baru."""
    parsed = parse_uploaded_aoi_file(file)
    return {
        "aoi_filename": parsed["filename"],
        "aoi_area_ha": parsed["aoi_area_ha"],
        "feature_count": parsed["feature_count"],
        "aoi_geojson": parsed["aoi_geojson"],
    }


@router.post("")
async def create_project(
    name: str = Form(...),
    location: str = Form(...),
    upload_date: str = Form(...),
    project_code: Optional[str] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ensure_projects_table()
    parsed = parse_uploaded_aoi_file(file)

    final_code = (project_code or "").strip()
    if not final_code:
        final_code = generate_was_code(db, upload_date)
    else:
        # Jika kode sudah terpakai, otomatis buat urutan berikutnya
        exists = db.query(Project).filter(Project.project_code == final_code).first()
        if exists:
            final_code = generate_was_code(db, upload_date)

    new_project = Project(
        project_code=final_code,
        name=name.strip(),
        location=location.strip(),
        upload_date=upload_date.strip(),
        aoi_filename=parsed["filename"],
        aoi_area_ha=parsed["aoi_area_ha"],
        aoi_wkt=parsed["aoi_wkt"],
        aoi_geojson=parsed["aoi_geojson"],
        created_by=current_user.username,
    )
    db.add(new_project)
    db.commit()
    db.refresh(new_project)

    return {
        "message": f"Project '{new_project.name}' ({new_project.project_code}) berhasil disimpan.",
        "project": {
            "id": new_project.id,
            "project_code": new_project.project_code,
            "name": new_project.name,
            "location": new_project.location,
            "upload_date": new_project.upload_date,
            "aoi_filename": new_project.aoi_filename,
            "aoi_area_ha": new_project.aoi_area_ha,
            "aoi_geojson": new_project.aoi_geojson,
            "created_by": new_project.created_by,
            "created_at": new_project.created_at.isoformat() if new_project.created_at else None,
        },
    }


@router.get("")
def list_projects(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    ensure_projects_table()
    projects = db.query(Project).order_by(Project.id.desc()).all()
    return [
        {
            "id": p.id,
            "project_code": p.project_code,
            "name": p.name,
            "location": p.location,
            "upload_date": p.upload_date,
            "aoi_filename": p.aoi_filename,
            "aoi_area_ha": p.aoi_area_ha,
            "created_by": p.created_by,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        }
        for p in projects
    ]


@router.get("/{project_id}")
def get_project_detail(
    project_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    ensure_projects_table()
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Project tidak ditemukan.")
    return {
        "id": p.id,
        "project_code": p.project_code,
        "name": p.name,
        "location": p.location,
        "upload_date": p.upload_date,
        "aoi_filename": p.aoi_filename,
        "aoi_area_ha": p.aoi_area_ha,
        "aoi_geojson": p.aoi_geojson,
        "created_by": p.created_by,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


@router.delete("/{project_id}")
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    ensure_projects_table()
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Project tidak ditemukan.")
    code = p.project_code
    db.query(ProjectLayerAnalysis).filter(
        ProjectLayerAnalysis.project_id == project_id
    ).delete()
    db.delete(p)
    db.commit()
    return {"message": f"Project {code} berhasil dihapus."}


def _save_analysis_result_to_db(
    db: Session,
    project_id: int,
    layer_slug: str,
    result_payload: Dict[str, Any],
) -> ProjectLayerAnalysis:
    record = (
        db.query(ProjectLayerAnalysis)
        .filter(
            ProjectLayerAnalysis.project_id == project_id,
            ProjectLayerAnalysis.layer_slug == layer_slug,
        )
        .first()
    )
    if not record:
        record = ProjectLayerAnalysis(
            project_id=project_id,
            layer_slug=layer_slug,
            result_data=result_payload,
            updated_at=datetime.utcnow(),
        )
        db.add(record)
    else:
        record.result_data = result_payload
        record.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(record)
    return record


@router.put("/{project_id}/clip/{layer_slug}/settings")
def save_project_layer_settings(
    project_id: int,
    layer_slug: str,
    payload: ProjectLayerSettingsRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Menyimpan pengaturan susunan kolom, nama kolom, dan preferensi per project & layer secara permanen."""
    ensure_projects_table()
    record = (
        db.query(ProjectLayerAnalysis)
        .filter(
            ProjectLayerAnalysis.project_id == project_id,
            ProjectLayerAnalysis.layer_slug == layer_slug,
        )
        .first()
    )
    if not record:
        record = ProjectLayerAnalysis(
            project_id=project_id,
            layer_slug=layer_slug,
            custom_columns=payload.custom_columns,
            preferences=payload.preferences,
            updated_at=datetime.utcnow(),
        )
        db.add(record)
    else:
        if payload.custom_columns is not None:
            record.custom_columns = payload.custom_columns
        if payload.preferences is not None:
            merged_prefs = dict(record.preferences or {})
            merged_prefs.update(payload.preferences)
            record.preferences = merged_prefs
        record.updated_at = datetime.utcnow()

    db.commit()
    return {"message": "Pengaturan kolom & preferensi project tersimpan permanen."}


@router.get("/{project_id}/clip/{layer_slug}")
def clip_project_with_single_layer(
    project_id: int,
    layer_slug: str,
    force: bool = Query(False),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Melakukan clipping otomatis AOI Project terhadap satu tema data biofisik.
    Jika hasil clipping sudah pernah tersimpan di PostgreSQL dan force=False,
    langsung mengembalikan hasil tersimpan tanpa mengulang proses clipping.
    """
    ensure_projects_table()
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project tidak ditemukan.")

    layer = (
        db.query(BiophysicalLayer)
        .filter(BiophysicalLayer.slug == layer_slug)
        .first()
    )
    if not layer:
        raise HTTPException(status_code=404, detail="Tema data biofisik tidak ditemukan.")

    if not layer.has_data:
        raise HTTPException(
            status_code=400,
            detail=f"Database '{layer.name}' saat ini belum aktif / belum memiliki data SHP.",
        )

    existing_record = (
        db.query(ProjectLayerAnalysis)
        .filter(
            ProjectLayerAnalysis.project_id == project_id,
            ProjectLayerAnalysis.layer_slug == layer_slug,
        )
        .first()
    )

    if not force and existing_record and existing_record.result_data:
        return {
            **existing_record.result_data,
            "saved_custom_columns": existing_record.custom_columns,
            "saved_preferences": existing_record.preferences,
            "from_cache": True,
        }

    # Metode B Khusus Deforestasi Hansen
    if layer.slug == "deforestasi_hansen":
        from app.hansen_engine import (
            get_available_hansen_tifs,
            clip_hansen_raster_to_polygons,
        )

        if get_available_hansen_tifs():
            try:
                hansen_res = clip_hansen_raster_to_polygons(
                    aoi_wkt=project.aoi_wkt,
                    aoi_area_ha=float(project.aoi_area_ha or 0.0),
                    allowed_columns=layer.available_columns,
                )
            except Exception as exc:
                raise HTTPException(status_code=500, detail=str(exc))

            result_payload = {
                "project_id": project.id,
                "project_code": project.project_code,
                "layer_slug": layer.slug,
                "layer_name": layer.name,
                **hansen_res,
            }
            saved = _save_analysis_result_to_db(db, project.id, layer.slug, result_payload)
            return {
                **result_payload,
                "saved_custom_columns": saved.custom_columns,
                "saved_preferences": saved.preferences,
                "from_cache": False,
            }

    # Metode Online Khusus Ketinggian & Kelerengan (Copernicus DEM GLO-30 30m)
    if layer.slug in ("ketinggian", "kelerengan"):
        from app.dem_engine import (
            get_dem_config,
            clip_dem_ketinggian_to_polygons,
            clip_dem_kelerengan_to_polygons,
        )

        dem_cfg = get_dem_config()
        is_online = (
            (layer.slug == "ketinggian" and dem_cfg.get("ketinggian_online"))
            or (layer.slug == "kelerengan" and dem_cfg.get("kelerengan_online"))
        )
        if is_online:
            try:
                dem_res = (
                    clip_dem_ketinggian_to_polygons(
                        aoi_wkt=project.aoi_wkt,
                        aoi_area_ha=float(project.aoi_area_ha or 0.0),
                        allowed_columns=layer.available_columns,
                    )
                    if layer.slug == "ketinggian"
                    else clip_dem_kelerengan_to_polygons(
                        aoi_wkt=project.aoi_wkt,
                        aoi_area_ha=float(project.aoi_area_ha or 0.0),
                        allowed_columns=layer.available_columns,
                    )
                )
            except Exception as exc:
                raise HTTPException(status_code=500, detail=str(exc))

            result_payload = {
                "project_id": project.id,
                "project_code": project.project_code,
                "layer_slug": layer.slug,
                "layer_name": layer.name,
                **dem_res,
            }
            saved = _save_analysis_result_to_db(db, project.id, layer.slug, result_payload)
            return {
                **result_payload,
                "saved_custom_columns": saved.custom_columns,
                "saved_preferences": saved.preferences,
                "from_cache": False,
            }

    cols_meta = layer.available_columns or []
    col_names = [c["original_name"] for c in cols_meta]
    quoted_cols = (
        ", ".join([f'l."{c}"' for c in col_names]) + "," if col_names else ""
    )

    clip_sql = text(
        f"""
        WITH aoi AS (
            SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromText(:wkt), 4326)) AS geom
        ),
        clipped AS (
            SELECT
                l.gid,
                {quoted_cols}
                ST_Multi(
                    ST_CollectionExtract(
                        ST_Intersection(ST_MakeValid(l.geom), aoi.geom),
                        3
                    )
                ) AS clipped_geom
            FROM "{layer.table_name}" l
            CROSS JOIN aoi
            WHERE l.geom && aoi.geom
              AND ST_Intersects(ST_MakeValid(l.geom), aoi.geom)
        )
        SELECT
            gid,
            {", ".join([f'"{c}"' for c in col_names]) + "," if col_names else ""}
            ROUND((ST_Area(clipped_geom::geography) / 10000.0)::numeric, 4) AS _luas_ha,
            ST_AsGeoJSON(clipped_geom) AS _geojson
        FROM clipped
        WHERE NOT ST_IsEmpty(clipped_geom)
          AND ST_Area(clipped_geom::geography) > 0.01
        ORDER BY _luas_ha DESC
        """
    )

    aoi_area_ha = float(project.aoi_area_ha or 0.0)
    rows_data = []
    features = []
    total_clipped_ha = 0.0

    with engine.connect() as conn:
        result = conn.execute(clip_sql, {"wkt": project.aoi_wkt})
        for idx, record in enumerate(result, start=1):
            rec_dict = dict(record._mapping)
            geom_json_str = rec_dict.pop("_geojson", None)
            luas_ha = float(rec_dict.get("_luas_ha") or 0.0)
            persen_aoi = (
                round((luas_ha / aoi_area_ha) * 100.0, 2)
                if aoi_area_ha > 0
                else 0.0
            )

            rec_dict["_no"] = idx
            rec_dict["_luas_ha"] = round(luas_ha, 2)
            rec_dict["_persen_aoi"] = persen_aoi
            total_clipped_ha += luas_ha

            rows_data.append(rec_dict)

            if geom_json_str:
                features.append(
                    {
                        "type": "Feature",
                        "geometry": json.loads(geom_json_str),
                        "properties": rec_dict,
                    }
                )

    result_payload = {
        "project_id": project.id,
        "project_code": project.project_code,
        "layer_slug": layer.slug,
        "layer_name": layer.name,
        "total_features": len(rows_data),
        "total_clipped_ha": round(total_clipped_ha, 2),
        "available_columns": cols_meta,
        "rows": rows_data,
        "clipped_geojson": {
            "type": "FeatureCollection",
            "features": features,
        },
    }
    saved = _save_analysis_result_to_db(db, project.id, layer.slug, result_payload)
    return {
        **result_payload,
        "saved_custom_columns": saved.custom_columns,
        "saved_preferences": saved.preferences,
        "from_cache": False,
    }
