from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Optional
import json
import shutil
import tempfile
import zipfile

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session
import geopandas as gpd
import pandas as pd
import shapely

from app.config import TEMP_UPLOAD_DIR
from app.database import engine, get_db
from app.models import BiophysicalLayer, User
from app.auth import get_current_user
from app.routers.layer_router import find_vector_file_in_dir

router = APIRouter(prefix="/api/analysis", tags=["AOI Clipping Analysis"])


class ExportColumnSpec(BaseModel):
    key: str
    label: str


class ExportTableRequest(BaseModel):
    layer_name: str
    format: str = "xlsx"  # 'xlsx' atau 'csv'
    columns: List[ExportColumnSpec]
    rows: List[Dict[str, Any]]


@router.post("/clip")
async def clip_aoi_with_layers(
    file: UploadFile = File(...),
    layer_slugs: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    Menerima file AOI (.zip berisi SHP atau .geojson), melakukan clipping otomatis
    di PostGIS terhadap database biofisik yang dipilih, dan mengembalikan:
    - GeoJSON AOI & Luas Total AOI (Ha)
    - Untuk setiap database: GeoJSON hasil clip, daftar kolom atribut, dan baris atribut lengkap.
    """
    filename = file.filename or "aoi.zip"
    suffix = Path(filename).suffix.lower()
    if suffix not in (".zip", ".geojson", ".json", ".gpkg"):
        raise HTTPException(
            status_code=400,
            detail="Harap unggah file AOI dalam bentuk .zip (berisi .shp, .shx, .dbf, .prj) atau .geojson.",
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
                raise HTTPException(status_code=400, detail="File .zip AOI rusak atau tidak valid.")

            vector_file = find_vector_file_in_dir(extract_dir)
            if not vector_file:
                raise HTTPException(
                    status_code=400,
                    detail="Tidak ditemukan file .shp di dalam .zip AOI yang diunggah.",
                )
        else:
            vector_file = saved_path

        try:
            aoi_gdf = gpd.read_file(vector_file, engine="pyogrio")
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Gagal membaca file AOI: {str(exc)}",
            )

        if aoi_gdf.empty:
            raise HTTPException(status_code=400, detail="File AOI tidak memiliki poligon.")

        aoi_gdf = aoi_gdf[aoi_gdf.geometry.notnull() & ~aoi_gdf.geometry.is_empty].copy()
        if aoi_gdf.empty:
            raise HTTPException(status_code=400, detail="Geometri pada file AOI kosong.")

        if aoi_gdf.crs is None:
            aoi_gdf = aoi_gdf.set_crs(epsg=4326)
        elif aoi_gdf.crs.to_epsg() != 4326:
            aoi_gdf = aoi_gdf.to_crs(epsg=4326)

        aoi_gdf.geometry = shapely.force_2d(aoi_gdf.geometry)
        aoi_gdf.geometry = shapely.make_valid(aoi_gdf.geometry)

        # Gabungkan seluruh poligon AOI menjadi satu kesatuan geometri untuk clipping
        unioned_geom = shapely.unary_union(aoi_gdf.geometry.values)
        unioned_geom = shapely.make_valid(shapely.force_2d(unioned_geom))
        aoi_wkt = unioned_geom.wkt

        # GeoJSON AOI untuk ditampilkan di peta
        aoi_geojson = json.loads(aoi_gdf.to_json())

        # Tentukan layer mana saja yang akan di-clip
        query = db.query(BiophysicalLayer).filter(BiophysicalLayer.has_data == True)
        if layer_slugs:
            try:
                slug_list = json.loads(layer_slugs)
                if isinstance(slug_list, list) and len(slug_list) > 0:
                    query = query.filter(BiophysicalLayer.slug.in_(slug_list))
            except Exception:
                slug_list = [s.strip() for s in layer_slugs.split(",") if s.strip()]
                if slug_list:
                    query = query.filter(BiophysicalLayer.slug.in_(slug_list))

        active_layers = query.order_by(BiophysicalLayer.order_index.asc()).all()
        if not active_layers:
            raise HTTPException(
                status_code=400,
                detail="Belum ada database biofisik yang memiliki data SHP (atau tema yang dipilih masih kosong). Silakan unggah SHP referensi terlebih dahulu di menu Database.",
            )

        with engine.connect() as conn:
            # Hitung luas total AOI dalam Hektar menggunakan PostGIS Geography
            aoi_area_ha = conn.execute(
                text(
                    """
                    SELECT ROUND((ST_Area(ST_SetSRID(ST_GeomFromText(:wkt), 4326)::geography) / 10000.0)::numeric, 2)
                    """
                ),
                {"wkt": aoi_wkt},
            ).scalar()
            aoi_area_ha = float(aoi_area_ha or 0.0)

            results_by_layer = []

            for layer in active_layers:
                cols_meta = layer.available_columns or []
                col_names = [c["original_name"] for c in cols_meta]
                quoted_cols = (
                    ", ".join([f'l."{c}"' for c in col_names]) + ","
                    if col_names
                    else ""
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

                result = conn.execute(clip_sql, {"wkt": aoi_wkt})
                rows_data = []
                features = []
                total_clipped_ha = 0.0

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

                results_by_layer.append(
                    {
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
                )

        return {
            "aoi_filename": filename,
            "aoi_area_ha": aoi_area_ha,
            "aoi_geojson": aoi_geojson,
            "results": results_by_layer,
        }
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@router.post("/export")
def export_customized_table(
    payload: ExportTableRequest,
    _: User = Depends(get_current_user),
):
    """
    Export tabel atribut hasil clip sesuai pilihan kolom dan nama kolom (alias)
    yang telah disesuaikan oleh user ke dalam format Excel (.xlsx) atau CSV (.csv).
    """
    if not payload.columns:
        raise HTTPException(
            status_code=400,
            detail="Pilih minimal 1 kolom atribut untuk diekspor.",
        )

    export_records = []
    for row in payload.rows:
        item = {}
        for col_spec in payload.columns:
            item[col_spec.label] = row.get(col_spec.key, "")
        export_records.append(item)

    df = pd.DataFrame(export_records)
    safe_name = payload.layer_name.lower().replace(" ", "_")

    if payload.format.lower() == "csv":
        stream = BytesIO()
        df.to_csv(stream, index=False, encoding="utf-8-sig")
        stream.seek(0)
        return StreamingResponse(
            stream,
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="analisis_{safe_name}.csv"'
            },
        )
    else:
        stream = BytesIO()
        with pd.ExcelWriter(stream, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name=payload.layer_name[:31])
        stream.seek(0)
        return StreamingResponse(
            stream,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f'attachment; filename="analisis_{safe_name}.xlsx"'
            },
        )
