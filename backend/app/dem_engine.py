from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple
import json
import math
import threading
import urllib.error
import urllib.request

import shapely
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from sqlalchemy import text

from app.config import BASE_DIR
from app.database import SessionLocal, engine
from app.models import BiophysicalLayer

DEM_DIR = BASE_DIR / "data_dem"
DEM_DIR.mkdir(parents=True, exist_ok=True)
DEM_CONFIG_FILE = DEM_DIR / "dem_config.json"

KETINGGIAN_DEFAULT_COLUMNS = [
    {
        "original_name": "KELAS_ELEV",
        "default_alias": "Kelas Ketinggian",
        "selected": True,
        "dtype": "text",
    },
    {
        "original_name": "RENTANG_M",
        "default_alias": "Rentang Elevasi (mdpl)",
        "selected": True,
        "dtype": "text",
    },
    {
        "original_name": "SUMBER",
        "default_alias": "Sumber Dataset",
        "selected": True,
        "dtype": "text",
    },
]

KELERENGAN_DEFAULT_COLUMNS = [
    {
        "original_name": "KELAS_LERENG",
        "default_alias": "Kelas Kelerengan",
        "selected": True,
        "dtype": "text",
    },
    {
        "original_name": "PERSEN_LRG",
        "default_alias": "Kemiringan Lereng (%)",
        "selected": True,
        "dtype": "text",
    },
    {
        "original_name": "SUMBER",
        "default_alias": "Sumber Dataset",
        "selected": True,
        "dtype": "text",
    },
]

# Klasifikasi 5 Kelas Ketinggian (mdpl)
ELEVATION_CLASSES = [
    (1, "Dataran Rendah", "0 - 100 mdpl", -999.0, 100.0),
    (2, "Perbukitan Rendah", "100 - 500 mdpl", 100.0, 500.0),
    (3, "Dataran Tinggi / Pegunungan Bawah", "500 - 1.000 mdpl", 500.0, 1000.0),
    (4, "Pegunungan Tengah", "1.000 - 2.000 mdpl", 1000.0, 2000.0),
    (5, "Pegunungan Tinggi", "> 2.000 mdpl", 2000.0, 99999.0),
]

# Klasifikasi 5 Kelas Kemiringan Lereng Standar KLHK (%)
SLOPE_CLASSES = [
    (1, "Datar", "0 - 8%", 0.0, 8.0),
    (2, "Landai", "8 - 15%", 8.0, 15.0),
    (3, "Agak Curam", "15 - 25%", 15.0, 25.0),
    (4, "Curam", "25 - 45%", 25.0, 45.0),
    (5, "Sangat Curam", "> 45%", 45.0, 99999.0),
]

# Bounding box koordinat grid 1x1 derajat untuk download offline per wilayah pulau Indonesia
DEM_REGION_BBOXES = {
    "sumatera": (-6, 6, 95, 106),
    "jawa_bali": (-9, -5, 105, 116),
    "kalimantan": (-4, 4, 108, 119),
    "sulawesi": (-6, 2, 118, 126),
    "nusa_tenggara": (-11, -8, 115, 128),
    "maluku_papua": (-9, 3, 126, 141),
}

DEM_DOWNLOAD_STATE: Dict[str, Any] = {
    "is_downloading": False,
    "region": "kalimantan",
    "current_tile": "",
    "completed_tiles": 0,
    "total_tiles": 0,
    "downloaded_count": 0,
    "message": "",
    "error": "",
}


def get_available_dem_tifs() -> List[Path]:
    return sorted(DEM_DIR.glob("*.tif"))


def get_dem_config() -> Dict[str, bool]:
    default_cfg = {"ketinggian_online": False, "kelerengan_online": False}
    if DEM_CONFIG_FILE.exists():
        try:
            data = json.loads(DEM_CONFIG_FILE.read_text(encoding="utf-8"))
            return {
                "ketinggian_online": bool(data.get("ketinggian_online", False)),
                "kelerengan_online": bool(data.get("kelerengan_online", False)),
            }
        except Exception:
            pass
    return default_cfg


def set_dem_online_mode(slug: str, enabled: bool) -> Dict[str, bool]:
    cfg = get_dem_config()
    if slug == "ketinggian":
        cfg["ketinggian_online"] = enabled
    elif slug == "kelerengan":
        cfg["kelerengan_online"] = enabled

    DEM_CONFIG_FILE.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    sync_dem_layers_metadata_in_db()
    return cfg


def sync_dem_layers_metadata_in_db():
    cfg = get_dem_config()
    cached_tifs = get_available_dem_tifs()
    db = SessionLocal()
    try:
        for slug, cfg_key, default_cols in [
            ("ketinggian", "ketinggian_online", KETINGGIAN_DEFAULT_COLUMNS),
            ("kelerengan", "kelerengan_online", KELERENGAN_DEFAULT_COLUMNS),
        ]:
            layer = (
                db.query(BiophysicalLayer)
                .filter(BiophysicalLayer.slug == slug)
                .first()
            )
            if not layer:
                continue

            if cfg.get(cfg_key) or cached_tifs:
                layer.has_data = True
                layer.feature_count = 5
                layer.source_filename = (
                    f"Copernicus DEM 30m ({len(cached_tifs)} tile offline)"
                    if cached_tifs
                    else "Copernicus DEM GLO-30 Online (30m)"
                )
                if not layer.available_columns:
                    layer.available_columns = default_cols
                layer.updated_at = datetime.utcnow()
            else:
                layer.has_data = False
                layer.feature_count = 0
                layer.source_filename = None
                layer.updated_at = None
        db.commit()
    finally:
        db.close()


def _format_copernicus_tile_name(lat_floor: int, lon_floor: int) -> str:
    ns = "N" if lat_floor >= 0 else "S"
    ew = "E" if lon_floor >= 0 else "W"
    lat_str = f"{ns}{abs(lat_floor):02d}_00"
    lon_str = f"{ew}{abs(lon_floor):03d}_00"
    return f"Copernicus_DSM_COG_10_{lat_str}_{lon_str}_DEM"


def _get_tile_coords_for_bounds(bounds: Tuple[float, float, float, float]) -> List[Tuple[int, int]]:
    minx, miny, maxx, maxy = bounds
    lon_start = math.floor(minx)
    lon_end = math.floor(maxx)
    lat_start = math.floor(miny)
    lat_end = math.floor(maxy)

    coords = []
    for lat in range(lat_start, lat_end + 1):
        for lon in range(lon_start, lon_end + 1):
            coords.append((lat, lon))
    return coords


def _get_coords_for_region(region_key: str) -> List[Tuple[int, int]]:
    coord_set: Set[Tuple[int, int]] = set()
    regions_to_scan = (
        list(DEM_REGION_BBOXES.keys()) if region_key == "all" else [region_key]
    )
    for rk in regions_to_scan:
        bbox = DEM_REGION_BBOXES.get(rk)
        if not bbox:
            continue
        lat_min, lat_max, lon_min, lon_max = bbox
        for lat in range(lat_min, lat_max + 1):
            for lon in range(lon_min, lon_max + 1):
                coord_set.add((lat, lon))
    return sorted(coord_set)


def _dem_download_worker(region_key: str):
    coords = _get_coords_for_region(region_key)
    DEM_DOWNLOAD_STATE["is_downloading"] = True
    DEM_DOWNLOAD_STATE["region"] = region_key
    DEM_DOWNLOAD_STATE["completed_tiles"] = 0
    DEM_DOWNLOAD_STATE["total_tiles"] = len(coords)
    DEM_DOWNLOAD_STATE["downloaded_count"] = 0
    DEM_DOWNLOAD_STATE["error"] = ""
    DEM_DOWNLOAD_STATE["message"] = f"Memeriksa {len(coords)} grid tile DEM..."

    # Aktifkan kedua layer Ketinggian & Kelerengan sekaligus
    cfg = get_dem_config()
    cfg["ketinggian_online"] = True
    cfg["kelerengan_online"] = True
    DEM_CONFIG_FILE.write_text(json.dumps(cfg, indent=2), encoding="utf-8")

    try:
        for idx, (lat, lon) in enumerate(coords, start=1):
            tile_name = _format_copernicus_tile_name(lat, lon)
            dest_file = DEM_DIR / f"{tile_name}.tif"
            DEM_DOWNLOAD_STATE["current_tile"] = tile_name

            if dest_file.exists() and dest_file.stat().st_size > 50_000:
                DEM_DOWNLOAD_STATE["completed_tiles"] = idx
                DEM_DOWNLOAD_STATE["downloaded_count"] += 1
                DEM_DOWNLOAD_STATE["message"] = f"Tile {tile_name} sudah ada di cache offline."
                continue

            url = f"https://copernicus-dem-30m.s3.amazonaws.com/{tile_name}/{tile_name}.tif"
            temp_file = DEM_DIR / f"{tile_name}.tif.part"
            try:
                DEM_DOWNLOAD_STATE["message"] = f"Mengunduh grid {idx}/{len(coords)}: {tile_name}..."
                urllib.request.urlretrieve(url, temp_file)
                temp_file.rename(dest_file)
                DEM_DOWNLOAD_STATE["downloaded_count"] += 1
                if idx % 5 == 0:
                    sync_dem_layers_metadata_in_db()
            except urllib.error.HTTPError as http_err:
                if temp_file.exists():
                    temp_file.unlink(missing_ok=True)
                # 404 berarti koordinat tersebut adalah lautan penuh (tidak ada daratan)
                if http_err.code != 404:
                    DEM_DOWNLOAD_STATE["error"] = f"HTTP {http_err.code} pada {tile_name}"
            except Exception as exc:
                if temp_file.exists():
                    temp_file.unlink(missing_ok=True)
                DEM_DOWNLOAD_STATE["error"] = str(exc)

            DEM_DOWNLOAD_STATE["completed_tiles"] = idx

        sync_dem_layers_metadata_in_db()
        total_cached = len(get_available_dem_tifs())
        DEM_DOWNLOAD_STATE["message"] = (
            f"Selesai! Total {total_cached} tile Copernicus DEM 30m siap digunakan secara OFFLINE."
        )
    finally:
        DEM_DOWNLOAD_STATE["is_downloading"] = False


def start_background_dem_download(region_key: str) -> bool:
    if DEM_DOWNLOAD_STATE["is_downloading"]:
        return False
    thread = threading.Thread(
        target=_dem_download_worker,
        args=(region_key,),
        daemon=True,
    )
    thread.start()
    return True


def clear_all_dem_files():
    for f in DEM_DIR.glob("*.tif*"):
        f.unlink(missing_ok=True)
    sync_dem_layers_metadata_in_db()


def ensure_dem_tiles_for_bounds(bounds: Tuple[float, float, float, float]) -> List[Path]:
    """
    Mengambil tile Copernicus DEM 30m dari cache lokal backend/data_dem/.
    Jika belum ada di cache, otomatis mengunduh dari AWS Open Data (jika online).
    """
    coords = _get_tile_coords_for_bounds(bounds)
    tile_paths: List[Path] = []

    for lat, lon in coords:
        tile_name = _format_copernicus_tile_name(lat, lon)
        dest_file = DEM_DIR / f"{tile_name}.tif"

        if dest_file.exists() and dest_file.stat().st_size > 50_000:
            tile_paths.append(dest_file)
            continue

        url = f"https://copernicus-dem-30m.s3.amazonaws.com/{tile_name}/{tile_name}.tif"
        temp_file = DEM_DIR / f"{tile_name}.tif.part"
        try:
            print(f"[DEM] Mengunduh tile Copernicus DEM 30m: {url}")
            urllib.request.urlretrieve(url, temp_file)
            temp_file.rename(dest_file)
            tile_paths.append(dest_file)
            sync_dem_layers_metadata_in_db()
        except Exception as exc:
            if temp_file.exists():
                temp_file.unlink(missing_ok=True)
            print(f"[DEM] Info: Tile {tile_name} dilewati ({exc}).")

    return tile_paths


def _clip_and_vectorize_dem(
    aoi_wkt: str,
    aoi_area_ha: float,
    mode: str,  # 'ketinggian' atau 'kelerengan'
    allowed_columns: List[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    try:
        import numpy as np
        import rasterio
        from rasterio.io import MemoryFile
        from rasterio.merge import merge as rio_merge
        from rasterio.mask import mask as rio_mask
        from rasterio.features import shapes as rio_shapes
    except ImportError:
        raise RuntimeError(
            "Pustaka 'rasterio' belum terinstal. Jalankan: pip install rasterio"
        )

    aoi_geom = shapely.make_valid(shapely.from_wkt(aoi_wkt))
    tile_paths = ensure_dem_tiles_for_bounds(aoi_geom.bounds)

    if not tile_paths:
        raise RuntimeError(
            "Tile Copernicus DEM 30m untuk wilayah AOI ini belum tersedia di cache offline "
            "dan tidak dapat diunduh (periksa koneksi internet)."
        )

    # 1. Gabungkan (mosaic) seluruh tile DEM yang bersinggungan dengan AOI menjadi 1 raster mulus
    # agar tidak ada celah atau tumpang tindih di perbatasan antar tile 1x1 derajat
    src_files = [rasterio.open(p) for p in tile_paths]
    try:
        if len(src_files) == 1:
            src = src_files[0]
            out_image, out_transform = rio_mask(
                src,
                [mapping(aoi_geom)],
                crop=True,
                all_touched=True,  # Pastikan seluruh piksel yang menyentuh batas AOI ikut terpotong (100% cakupan)
                filled=True,
                nodata=-9999.0,
            )
            crs = src.crs
        else:
            mosaic, mosaic_transform = rio_merge(src_files, nodata=-9999.0)
            with MemoryFile() as memfile:
                with memfile.open(
                    driver="GTiff",
                    height=mosaic.shape[1],
                    width=mosaic.shape[2],
                    count=1,
                    dtype=mosaic.dtype,
                    crs=src_files[0].crs,
                    transform=mosaic_transform,
                    nodata=-9999.0,
                ) as mem_ds:
                    mem_ds.write(mosaic)
                    out_image, out_transform = rio_mask(
                        mem_ds,
                        [mapping(aoi_geom)],
                        crop=True,
                        all_touched=True,
                        filled=True,
                        nodata=-9999.0,
                    )
                    crs = mem_ds.crs
    finally:
        for s in src_files:
            s.close()

    elev = out_image[0].astype("float32")
    valid_mask = elev > -500.0
    if not np.any(valid_mask):
        return {
            "total_features": 0,
            "total_clipped_ha": 0.0,
            "available_columns": allowed_columns
            or (KETINGGIAN_DEFAULT_COLUMNS if mode == "ketinggian" else KELERENGAN_DEFAULT_COLUMNS),
            "rows": [],
            "clipped_geojson": {"type": "FeatureCollection", "features": []},
        }

    # Isi piksel nodata di luar batas AOI dengan nilai median valid agar gradien lereng akurat
    elev_filled = elev.copy()
    median_val = float(np.median(elev[valid_mask]))
    elev_filled[~valid_mask] = median_val

    class_grid = np.zeros(elev.shape, dtype="uint8")

    if mode == "ketinggian":
        for cls_id, _, _, low, high in ELEVATION_CLASSES:
            if cls_id == 1:
                m = valid_mask & (elev <= high)
            else:
                m = valid_mask & (elev > low) & (elev <= high)
            class_grid[m] = cls_id
    else:
        ab = aoi_geom.bounds
        center_lat = (ab[1] + ab[3]) / 2.0
        dx_deg = abs(out_transform.a)
        dy_deg = abs(out_transform.e)
        meters_per_deg_lat = 110574.0
        meters_per_deg_lon = 111320.0 * math.cos(math.radians(center_lat))
        dx_m = max(1.0, dx_deg * meters_per_deg_lon)
        dy_m = max(1.0, dy_deg * meters_per_deg_lat)

        dz_dy, dz_dx = np.gradient(elev_filled, dy_m, dx_m)
        slope_pct = np.sqrt(dz_dx ** 2 + dz_dy ** 2) * 100.0

        for cls_id, _, _, low, high in SLOPE_CLASSES:
            if cls_id == 1:
                m = valid_mask & (slope_pct <= high)
            else:
                m = valid_mask & (slope_pct > low) & (slope_pct <= high)
            class_grid[m] = cls_id

    polygons_by_class: Dict[int, List[Any]] = {}
    for geom_dict, val in rio_shapes(
        class_grid, mask=(class_grid > 0), transform=out_transform
    ):
        cls_id = int(val)
        if cls_id > 0:
            poly = shape(geom_dict)
            if not poly.is_empty:
                polygons_by_class.setdefault(cls_id, []).append(poly)

    # Gabungkan dan potong tepat di garis batas AOI
    clipped_geoms_by_class: Dict[int, Any] = {}
    for cls_id, poly_list in polygons_by_class.items():
        merged_geom = shapely.make_valid(unary_union(poly_list))
        clipped_geom = shapely.make_valid(shapely.intersection(merged_geom, aoi_geom))
        if not clipped_geom.is_empty:
            clipped_geoms_by_class[cls_id] = clipped_geom

    # Pastikan 100.00% area AOI tertutup: jika ada celah mikro di tepi AOI yang belum tertutup,
    # gabungkan celah tersebut ke kelas dengan luas poligon terbesar
    if clipped_geoms_by_class:
        union_all = shapely.make_valid(unary_union(list(clipped_geoms_by_class.values())))
        missing_sliver = shapely.make_valid(shapely.difference(aoi_geom, union_all))
        if not missing_sliver.is_empty and missing_sliver.area > 0:
            largest_cls_id = max(
                clipped_geoms_by_class.keys(),
                key=lambda k: clipped_geoms_by_class[k].area,
            )
            clipped_geoms_by_class[largest_cls_id] = shapely.make_valid(
                unary_union([clipped_geoms_by_class[largest_cls_id], missing_sliver])
            )

    class_lookup = (
        {c[0]: (c[1], c[2]) for c in ELEVATION_CLASSES}
        if mode == "ketinggian"
        else {c[0]: (c[1], c[2]) for c in SLOPE_CLASSES}
    )

    cols_meta = allowed_columns or (
        KETINGGIAN_DEFAULT_COLUMNS if mode == "ketinggian" else KELERENGAN_DEFAULT_COLUMNS
    )

    rows_data = []
    features = []
    total_clipped_ha = 0.0

    with engine.connect() as conn:
        # Hitung ulang luas eksak AOI dari geometry yang sama agar konsisten 100%
        exact_aoi_ha = float(
            conn.execute(
                text(
                    "SELECT (ST_Area(ST_SetSRID(ST_GeomFromText(:wkt), 4326)::geography) / 10000.0)"
                ),
                {"wkt": aoi_geom.wkt},
            ).scalar()
            or aoi_area_ha
            or 0.0
        )

        gid_counter = 1
        raw_area_entries = []
        for cls_id in sorted(clipped_geoms_by_class.keys()):
            c_geom = clipped_geoms_by_class[cls_id]
            row_calc = conn.execute(
                text(
                    """
                    SELECT
                        (ST_Area(ST_SetSRID(ST_GeomFromText(:wkt), 4326)::geography) / 10000.0) AS luas_ha,
                        ST_AsGeoJSON(ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromText(:wkt), 4326)), 3))) AS geojson
                    """
                ),
                {"wkt": c_geom.wkt},
            ).mappings().first()

            if not row_calc:
                continue

            luas_ha = float(row_calc["luas_ha"] or 0.0)
            if luas_ha <= 0.0001:
                continue

            raw_area_entries.append((cls_id, luas_ha, row_calc["geojson"]))

        # Normalisasi presisi pembulatan agar total baris = exact_aoi_ha (100.00%)
        raw_sum = sum(item[1] for item in raw_area_entries)
        target_aoi_ha = round(aoi_area_ha if aoi_area_ha > 0 else exact_aoi_ha, 2)

        for idx, (cls_id, raw_ha, geojson_str) in enumerate(raw_area_entries):
            cls_name, range_label = class_lookup[cls_id]
            if raw_sum > 0 and target_aoi_ha > 0:
                scaled_ha = (raw_ha / raw_sum) * target_aoi_ha
            else:
                scaled_ha = raw_ha

            if idx == len(raw_area_entries) - 1 and target_aoi_ha > 0:
                # Baris terakhir menyeimbangkan selisih pembulatan 0.01 Ha / 0.01% agar tepat 100.00%
                luas_ha_rounded = round(max(0.0, target_aoi_ha - total_clipped_ha), 2)
                persen_aoi = round(
                    max(0.0, 100.0 - sum(r["_persen_aoi"] for r in rows_data)), 2
                )
            else:
                luas_ha_rounded = round(scaled_ha, 2)
                persen_aoi = (
                    round((luas_ha_rounded / target_aoi_ha) * 100.0, 2)
                    if target_aoi_ha > 0
                    else 0.0
                )

            total_clipped_ha = round(total_clipped_ha + luas_ha_rounded, 2)

            if mode == "ketinggian":
                rec_dict = {
                    "gid": gid_counter,
                    "_no": gid_counter,
                    "KELAS_ELEV": cls_name,
                    "RENTANG_M": range_label,
                    "SUMBER": "Copernicus DEM GLO-30 (30m)",
                    "_luas_ha": luas_ha_rounded,
                    "_persen_aoi": persen_aoi,
                }
            else:
                rec_dict = {
                    "gid": gid_counter,
                    "_no": gid_counter,
                    "KELAS_LERENG": cls_name,
                    "PERSEN_LRG": range_label,
                    "SUMBER": "Copernicus DEM GLO-30 (30m)",
                    "_luas_ha": luas_ha_rounded,
                    "_persen_aoi": persen_aoi,
                }

            rows_data.append(rec_dict)
            if geojson_str:
                features.append(
                    {
                        "type": "Feature",
                        "geometry": json.loads(geojson_str),
                        "properties": rec_dict,
                    }
                )
            gid_counter += 1

    return {
        "total_features": len(rows_data),
        "total_clipped_ha": round(total_clipped_ha, 2),
        "available_columns": cols_meta,
        "rows": rows_data,
        "clipped_geojson": {
            "type": "FeatureCollection",
            "features": features,
        },
    }


def clip_dem_ketinggian_to_polygons(
    aoi_wkt: str,
    aoi_area_ha: float,
    allowed_columns: List[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return _clip_and_vectorize_dem(aoi_wkt, aoi_area_ha, "ketinggian", allowed_columns)


def clip_dem_kelerengan_to_polygons(
    aoi_wkt: str,
    aoi_area_ha: float,
    allowed_columns: List[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return _clip_and_vectorize_dem(aoi_wkt, aoi_area_ha, "kelerengan", allowed_columns)
