from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List
import json
import sys
import threading
import urllib.request

import shapely
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from sqlalchemy import text

from app.config import BASE_DIR
from app.database import SessionLocal, engine
from app.models import BiophysicalLayer

HANSEN_DIR = BASE_DIR / "data_hansen"
HANSEN_DIR.mkdir(parents=True, exist_ok=True)
HANSEN_CONFIG_FILE = HANSEN_DIR / "hansen_config.json"

# Daftar Grid Tile 10x10 Derajat Resmi Universitas Maryland (UMD GLAD) untuk Indonesia
INDONESIA_TILES_BY_REGION = {
    "all": [
        ("10N_090E", "Aceh & Sumatera Utara"),
        ("00N_090E", "Sumatera Barat & Bengkulu"),
        ("10N_100E", "Riau, Kepri & Kalbar Utara"),
        ("00N_100E", "Jambi, Sumsel, Lampung, Kalbar & Jawa Barat"),
        ("10N_110E", "Kalimantan Utara & Kalimantan Timur"),
        ("00N_110E", "Kalimantan Tengah, Kalsel, Kaltim, Jateng, Jatim & Bali"),
        ("10S_110E", "Jawa Bagian Selatan, Bali Selatan & NTB"),
        ("10N_120E", "Sulawesi Utara, Gorontalo & Maluku Utara"),
        ("00N_120E", "Sulawesi Tengah, Sulsel, Sultra, Sulbar, Maluku & NTT"),
        ("10S_120E", "Nusa Tenggara Timur (Timor, Sumba, Rote)"),
        ("00N_130E", "Papua Barat, Papua Tengah, Papua Selatan & Kep. Aru"),
        ("10S_130E", "Kepulauan Tanimbar & Papua Selatan"),
        ("00N_140E", "Perbatasan Timur Papua (Jayapura - Merauke)"),
    ],
    "sumatera_kalimantan": [
        ("10N_090E", "Aceh & Sumatera Utara"),
        ("00N_090E", "Sumatera Barat & Bengkulu"),
        ("10N_100E", "Riau, Kepri & Kalbar Utara"),
        ("00N_100E", "Jambi, Sumsel, Lampung, Kalbar & Jawa Barat"),
        ("10N_110E", "Kalimantan Utara & Kalimantan Timur"),
        ("00N_110E", "Kalimantan Tengah, Kalsel, Kaltim, Jateng, Jatim & Bali"),
    ],
    "jawa_nusatenggara": [
        ("00N_100E", "Jawa Barat & Banten"),
        ("00N_110E", "Jawa Tengah, DI Yogyakarta, Jawa Timur & Bali"),
        ("10S_110E", "Pesisir Selatan Jawa, Bali Selatan & Sumba Barat"),
        ("10S_120E", "Nusa Tenggara Timur (Timor, Flores, Sumba, Rote)"),
    ],
    "sulawesi_maluku_papua": [
        ("10N_120E", "Sulawesi Utara, Gorontalo & Maluku Utara"),
        ("00N_120E", "Sulawesi Tengah, Sulsel, Sultra, Sulbar & Maluku"),
        ("00N_130E", "Papua Barat, Papua Tengah & Papua Selatan"),
        ("10S_130E", "Kepulauan Tanimbar & Papua Selatan"),
        ("00N_140E", "Papua Bagian Timur (Jayapura - Merauke)"),
    ],
}

URLS_TEMPLATE = [
    (
        "GFC-2025-v1.13",
        "https://storage.googleapis.com/earthenginepartners-hansen/GFC-2025-v1.13/Hansen_GFC-2025-v1.13_lossyear_{tile}.tif",
    ),
    (
        "GFC-2024-v1.12",
        "https://storage.googleapis.com/earthenginepartners-hansen/GFC-2024-v1.12/Hansen_GFC-2024-v1.12_lossyear_{tile}.tif",
    ),
    (
        "GFC-2023-v1.11",
        "https://storage.googleapis.com/earthenginepartners-hansen/GFC-2023-v1.11/Hansen_GFC-2023-v1.11_lossyear_{tile}.tif",
    ),
]

HANSEN_DEFAULT_COLUMNS = [
    {
        "original_name": "TAHUN",
        "default_alias": "Tahun Deforestasi",
        "selected": True,
        "dtype": "number",
    },
    {
        "original_name": "KELAS",
        "default_alias": "Kelas Kehilangan Tutupan Pohon",
        "selected": True,
        "dtype": "text",
    },
    {
        "original_name": "PERIODE",
        "default_alias": "Rentang Tahun Analisis",
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

# State progres download di background agar bisa dipantau dari halaman web
HANSEN_DOWNLOAD_STATE: Dict[str, Any] = {
    "is_downloading": False,
    "region": "all",
    "current_tile": "",
    "completed_tiles": 0,
    "total_tiles": 0,
    "current_tile_percent": 0.0,
    "message": "",
    "error": "",
}


def get_hansen_config() -> Dict[str, int]:
    """Membaca konfigurasi rentang tahun Deforestasi Hansen (Default: 2015 s/d 2025)."""
    default_cfg = {"start_year": 2015, "end_year": 2025}
    if HANSEN_CONFIG_FILE.exists():
        try:
            data = json.loads(HANSEN_CONFIG_FILE.read_text(encoding="utf-8"))
            start_y = int(data.get("start_year", 2015))
            end_y = int(data.get("end_year", 2025))
            if 2001 <= start_y <= end_y <= 2030:
                return {"start_year": start_y, "end_year": end_y}
        except Exception:
            pass
    return default_cfg


def save_hansen_config(start_year: int, end_year: int) -> Dict[str, int]:
    start_y = max(2001, min(int(start_year), int(end_year)))
    end_y = max(start_y, min(int(end_year), 2030))
    cfg = {"start_year": start_y, "end_year": end_y}
    HANSEN_CONFIG_FILE.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    sync_hansen_layer_metadata_in_db()
    return cfg


def get_available_hansen_tifs() -> List[Path]:
    return sorted(HANSEN_DIR.glob("*.tif"))


def sync_hansen_layer_metadata_in_db():
    tifs = get_available_hansen_tifs()
    cfg = get_hansen_config()
    db = SessionLocal()
    try:
        layer = (
            db.query(BiophysicalLayer)
            .filter(BiophysicalLayer.slug == "deforestasi_hansen")
            .first()
        )
        if layer:
            if tifs:
                layer.has_data = True
                layer.feature_count = len(tifs)
                layer.source_filename = (
                    f"{len(tifs)} Tile GeoTIFF (Tahun {cfg['start_year']} - {cfg['end_year']})"
                )
                if not layer.available_columns:
                    layer.available_columns = HANSEN_DEFAULT_COLUMNS
                layer.updated_at = datetime.utcnow()
            else:
                layer.has_data = False
                layer.feature_count = 0
                layer.source_filename = None
                layer.updated_at = None
            db.commit()
    finally:
        db.close()


def _download_worker(region_key: str, start_year: int, end_year: int):
    tiles = INDONESIA_TILES_BY_REGION.get(region_key, INDONESIA_TILES_BY_REGION["all"])
    HANSEN_DOWNLOAD_STATE["is_downloading"] = True
    HANSEN_DOWNLOAD_STATE["region"] = region_key
    HANSEN_DOWNLOAD_STATE["completed_tiles"] = 0
    HANSEN_DOWNLOAD_STATE["total_tiles"] = len(tiles)
    HANSEN_DOWNLOAD_STATE["current_tile_percent"] = 0.0
    HANSEN_DOWNLOAD_STATE["error"] = ""
    HANSEN_DOWNLOAD_STATE["message"] = f"Memulai unduhan {len(tiles)} tile..."

    save_hansen_config(start_year, end_year)

    try:
        for idx, (tile_code, desc) in enumerate(tiles, start=1):
            HANSEN_DOWNLOAD_STATE["current_tile"] = f"{tile_code} ({desc})"
            HANSEN_DOWNLOAD_STATE["current_tile_percent"] = 0.0

            existing = list(HANSEN_DIR.glob(f"*lossyear_{tile_code}.tif"))
            if existing and existing[0].stat().st_size > 100_000:
                HANSEN_DOWNLOAD_STATE["completed_tiles"] = idx
                HANSEN_DOWNLOAD_STATE["current_tile_percent"] = 100.0
                HANSEN_DOWNLOAD_STATE["message"] = f"Tile {tile_code} sudah tersedia."
                sync_hansen_layer_metadata_in_db()
                continue

            downloaded_ok = False
            for version_name, url_tpl in URLS_TEMPLATE:
                url = url_tpl.format(tile=tile_code)
                dest_file = HANSEN_DIR / f"Hansen_{version_name}_lossyear_{tile_code}.tif"
                temp_file = HANSEN_DIR / f"Hansen_{version_name}_lossyear_{tile_code}.tif.part"

                def reporthook(block_num, block_size, total_size):
                    if total_size > 0:
                        pct = min(100.0, (block_num * block_size / total_size) * 100.0)
                        HANSEN_DOWNLOAD_STATE["current_tile_percent"] = round(pct, 1)

                try:
                    HANSEN_DOWNLOAD_STATE["message"] = (
                        f"Mengunduh tile {idx}/{len(tiles)}: {tile_code} ({desc})..."
                    )
                    urllib.request.urlretrieve(url, temp_file, reporthook=reporthook)
                    temp_file.rename(dest_file)
                    downloaded_ok = True
                    break
                except Exception:
                    if temp_file.exists():
                        temp_file.unlink(missing_ok=True)
                    continue

            if downloaded_ok:
                HANSEN_DOWNLOAD_STATE["completed_tiles"] = idx
                sync_hansen_layer_metadata_in_db()
            else:
                HANSEN_DOWNLOAD_STATE["error"] = f"Gagal mengunduh tile {tile_code}."

        sync_hansen_layer_metadata_in_db()
        tifs = get_available_hansen_tifs()
        HANSEN_DOWNLOAD_STATE["message"] = (
            f"Selesai! {len(tifs)} tile Deforestasi Hansen ({start_year}-{end_year}) aktif di database."
        )
    except Exception as exc:
        HANSEN_DOWNLOAD_STATE["error"] = str(exc)
    finally:
        HANSEN_DOWNLOAD_STATE["is_downloading"] = False


def start_background_hansen_download(region_key: str, start_year: int, end_year: int):
    if HANSEN_DOWNLOAD_STATE["is_downloading"]:
        return False
    thread = threading.Thread(
        target=_download_worker,
        args=(region_key, start_year, end_year),
        daemon=True,
    )
    thread.start()
    return True


def clear_all_hansen_files():
    for f in HANSEN_DIR.glob("*.tif*"):
        f.unlink(missing_ok=True)
    sync_hansen_layer_metadata_in_db()


def clip_hansen_raster_to_polygons(
    aoi_wkt: str,
    aoi_area_ha: float,
    allowed_columns: List[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Memotong (clip) file raster GeoTIFF Hansen lossyear menggunakan poligon AOI,
    memfilter sesuai rentang tahun yang dipilih user (misal 2015 s/d 2025),
    lalu mengonversi piksel di dalam AOI menjadi Poligon GeoJSON + Tabel Atribut.
    """
    try:
        import numpy as np
        import rasterio
        from rasterio.mask import mask as rio_mask
        from rasterio.features import shapes as rio_shapes
    except ImportError:
        raise RuntimeError(
            "Pustaka 'rasterio' belum terinstal. Jalankan: pip install rasterio"
        )

    tif_files = get_available_hansen_tifs()
    if not tif_files:
        raise RuntimeError(
            "Belum ada file GeoTIFF (.tif) Hansen yang diunduh. "
            "Silakan unduh melalui menu Database SHP (14) pada kartu Deforestasi Hansen."
        )

    cfg = get_hansen_config()
    start_year = cfg["start_year"]
    end_year = cfg["end_year"]

    # Kode piksel lossyear Hansen adalah (Tahun - 2000), misal 2015 -> 15, 2025 -> 25
    min_year_code = max(1, start_year - 2000)
    max_year_code = max(min_year_code, end_year - 2000)
    periode_str = f"{start_year} - {end_year}"

    aoi_geom = shapely.from_wkt(aoi_wkt)
    aoi_bounds = aoi_geom.bounds

    version_label = "Hansen GFC (30m)"
    for tif in tif_files:
        if "v1.13" in tif.name or "2025" in tif.name:
            version_label = "Hansen GFC v1.13 (30m)"
            break
        if "v1.12" in tif.name or "2024" in tif.name:
            version_label = "Hansen GFC v1.12 (30m)"
            break

    polygons_by_year: Dict[int, List[Any]] = {}

    for tif_path in tif_files:
        with rasterio.open(tif_path) as src:
            tb = src.bounds
            intersects_tile = not (
                aoi_bounds[2] < tb.left
                or aoi_bounds[0] > tb.right
                or aoi_bounds[3] < tb.bottom
                or aoi_bounds[1] > tb.top
            )
            if not intersects_tile:
                continue

            try:
                out_image, out_transform = rio_mask(
                    src, [mapping(aoi_geom)], crop=True, filled=True, nodata=0
                )
            except ValueError:
                continue

            band = out_image[0]
            valid_mask = (band >= min_year_code) & (band <= max_year_code)
            if not np.any(valid_mask):
                continue

            for geom_dict, val in rio_shapes(
                band, mask=valid_mask, transform=out_transform
            ):
                year_code = int(val)
                if min_year_code <= year_code <= max_year_code:
                    poly = shape(geom_dict)
                    if not poly.is_empty:
                        polygons_by_year.setdefault(year_code, []).append(poly)

    cols_meta = allowed_columns or HANSEN_DEFAULT_COLUMNS
    rows_data = []
    features = []
    total_clipped_ha = 0.0

    with engine.connect() as conn:
        gid_counter = 1
        for year_code in sorted(polygons_by_year.keys()):
            actual_year = 2000 + year_code
            poly_list = polygons_by_year[year_code]
            merged_geom = unary_union(poly_list)
            clipped_geom = shapely.intersection(
                shapely.make_valid(merged_geom), shapely.make_valid(aoi_geom)
            )
            if clipped_geom.is_empty:
                continue

            wkt_str = clipped_geom.wkt
            row_calc = conn.execute(
                text(
                    """
                    SELECT
                        ROUND((ST_Area(ST_SetSRID(ST_GeomFromText(:wkt), 4326)::geography) / 10000.0)::numeric, 4) AS luas_ha,
                        ST_AsGeoJSON(ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromText(:wkt), 4326)), 3))) AS geojson
                    """
                ),
                {"wkt": wkt_str},
            ).mappings().first()

            if not row_calc:
                continue

            luas_ha = float(row_calc["luas_ha"] or 0.0)
            if luas_ha <= 0.001:
                continue

            persen_aoi = (
                round((luas_ha / aoi_area_ha) * 100.0, 2)
                if aoi_area_ha > 0
                else 0.0
            )

            rec_dict = {
                "gid": gid_counter,
                "_no": gid_counter,
                "TAHUN": actual_year,
                "KELAS": f"Deforestasi Tahun {actual_year}",
                "PERIODE": periode_str,
                "SUMBER": version_label,
                "_luas_ha": round(luas_ha, 2),
                "_persen_aoi": persen_aoi,
            }
            rows_data.append(rec_dict)
            total_clipped_ha += luas_ha

            if row_calc["geojson"]:
                features.append(
                    {
                        "type": "Feature",
                        "geometry": json.loads(row_calc["geojson"]),
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
