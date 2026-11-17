"""
Script Pengunduh Otomatis Data Deforestasi Hansen (Global Forest Change - lossyear)
untuk Wilayah Indonesia (Metode B: Hybrid Raster-to-Polygon).
"""
from datetime import datetime
from pathlib import Path
import sys
import urllib.request

from app.config import BASE_DIR
from app.database import SessionLocal
from app.models import BiophysicalLayer
from app.hansen_engine import HANSEN_DIR, HANSEN_DEFAULT_COLUMNS, get_available_hansen_tifs

# Daftar 13 Grid Tile 10x10 Derajat Resmi Universitas Maryland (UMD GLAD) yang mencakup seluruh daratan Indonesia
INDONESIA_TILES = {
    "sumatera_kalimantan": [
        ("10N_090E", "Aceh, Sumatera Utara, Sumatera Barat Bagian Utara"),
        ("00N_090E", "Sumatera Barat, Bengkulu, Kepulauan Mentawai"),
        ("10N_100E", "Riau, Kep. Riau, Kalbar Bagian Utara"),
        ("00N_100E", "Jambi, Sumsel, Lampung, Bangka Belitung, Kalimantan Barat, Jabar"),
        ("10N_110E", "Kalimantan Utara, Kalimantan Timur, Kalimantan Barat Daya"),
        ("00N_110E", "Kalimantan Tengah, Kalimantan Selatan, Kaltim, Jawa Tengah, Jawa Timur, Bali"),
    ],
    "jawa_nusatenggara": [
        ("00N_100E", "Jawa Barat, Banten, Sumatera Bagian Selatan"),
        ("00N_110E", "Jawa Tengah, DI Yogyakarta, Jawa Timur, Bali, NTB Barat"),
        ("10S_110E", "Pesisir Selatan Jawa Timur, Bali Selatan, Pulau Sumba Barat"),
        ("10S_120E", "Nusa Tenggara Timur (Pulau Timor, Flores Selatan, Sumba, Rote)"),
    ],
    "sulawesi_maluku_papua": [
        ("10N_120E", "Sulawesi Utara, Gorontalo, Maluku Utara"),
        ("00N_120E", "Sulawesi Tengah, Sulawesi Barat, Sulawesi Selatan, Sulawesi Tenggara, Maluku"),
        ("00N_130E", "Papua Barat, Papua Barat Daya, Papua Tengah, Papua Selatan, Kepulauan Aru"),
        ("00N_140E", "Papua Bagian Timur (Jayapura, Pegunungan Bintang, Merauke Timur)"),
        ("10S_130E", "Kepulauan Tanimbar & Merauke Bagian Selatan"),
    ],
}

ALL_13_INDONESIA_TILES = [
    ("10N_090E", "Aceh & Sumatera Utara"),
    ("00N_090E", "Sumatera Barat & Bengkulu"),
    ("10N_100E", "Riau, Kepri & Kalbar Utara"),
    ("00N_100E", "Jambi, Sumsel, Lampung, Kalbar & Jawa Barat"),
    ("10N_110E", "Kalimantan Utara & Kalimantan Timur"),
    ("00N_110E", "Kalimantan Tengah, Kalsel, Kaltim, Jateng, Jatim & Bali"),
    ("10S_110E", "Jawa Bagian Selatan, Bali Selatan & NTB"),
    ("10N_120E", "Sulawesi Utara, Gorontalo & Maluku Utara"),
    ("00N_120E", "Sulawesi Tengah, Sulsel, Sultra, Sulbar, Maluku & NTB/NTT"),
    ("10S_120E", "Nusa Tenggara Timur (Timor, Sumba, Rote)"),
    ("00N_130E", "Papua Barat, Papua Tengah, Papua Selatan & Maluku Tenggara"),
    ("10S_130E", "Kepulauan Tanimbar & Papua Selatan"),
    ("00N_140E", "Perbatasan Timur Papua (Jayapura - Merauke)"),
]

# URL Server Resmi Google Cloud Storage - UMD GLAD Hansen Global Forest Change
URLS_TEMPLATE = [
    (
        "GFC-2024-v1.12",
        "https://storage.googleapis.com/earthenginepartners-hansen/GFC-2024-v1.12/Hansen_GFC-2024-v1.12_lossyear_{tile}.tif",
    ),
    (
        "GFC-2023-v1.11",
        "https://storage.googleapis.com/earthenginepartners-hansen/GFC-2023-v1.11/Hansen_GFC-2023-v1.11_lossyear_{tile}.tif",
    ),
]


def download_tile(tile_code: str, description: str):
    HANSEN_DIR.mkdir(parents=True, exist_ok=True)

    # Cek apakah tile ini sudah pernah diunduh sebelumnya
    existing = list(HANSEN_DIR.glob(f"*lossyear_{tile_code}.tif"))
    if existing and existing[0].stat().st_size > 100_000:
        size_mb = existing[0].stat().st_size / (1024 * 1024)
        print(f"  [SKIP] Tile {tile_code} ({description}) sudah ada ({size_mb:.1f} MB).")
        return existing[0]

    for version_name, url_tpl in URLS_TEMPLATE:
        url = url_tpl.format(tile=tile_code)
        dest_file = HANSEN_DIR / f"Hansen_{version_name}_lossyear_{tile_code}.tif"
        temp_file = HANSEN_DIR / f"Hansen_{version_name}_lossyear_{tile_code}.tif.part"

        print(f"\n  [DOWNLOAD] Mengunduh Tile {tile_code} ({description})")
        print(f"  Sumber: {url}")

        def report_progress(block_num, block_size, total_size):
            if total_size > 0:
                downloaded = block_num * block_size
                pct = min(100.0, (downloaded / total_size) * 100.0)
                mb_done = downloaded / (1024 * 1024)
                mb_total = total_size / (1024 * 1024)
                sys.stdout.write(
                    f"\r  Progres: {pct:5.1f}% ({mb_done:.1f} MB / {mb_total:.1f} MB)"
                )
                sys.stdout.flush()

        try:
            urllib.request.urlretrieve(url, temp_file, reporthook=report_progress)
            print()
            temp_file.rename(dest_file)
            print(f"  [BERHASIL] Tersimpan di: {dest_file.name}")
            return dest_file
        except Exception as exc:
            if temp_file.exists():
                temp_file.unlink(missing_ok=True)
            print(f"\n  [INFO] Gagal dari {version_name} ({exc}), mencoba versi cadangan...")

    print(f"  [GAGAL] Tidak dapat mengunduh tile {tile_code}.")
    return None


def activate_hansen_layer_in_db():
    tifs = get_available_hansen_tifs()
    if not tifs:
        return

    db = SessionLocal()
    try:
        layer = (
            db.query(BiophysicalLayer)
            .filter(BiophysicalLayer.slug == "deforestasi_hansen")
            .first()
        )
        if layer:
            layer.has_data = True
            layer.feature_count = len(tifs)
            layer.source_filename = f"{len(tifs)} Tile GeoTIFF (12 Tahun Terakhir)"
            layer.available_columns = HANSEN_DEFAULT_COLUMNS
            layer.updated_at = datetime.utcnow()
            db.commit()
            print(
                f"\n[DATABASE] Tema #13 'Deforestasi Hansen' telah AKTIF ({len(tifs)} tile GeoTIFF siap digunakan)!"
            )
    finally:
        db.close()


def main():
    print("=" * 72)
    print("  PENGUNDUH DATABASE DEFORESTASI HANSEN (12 TAHUN TERAKHIR) - METODE B")
    print("  Folder Penyimpanan:", HANSEN_DIR)
    print("=" * 72)
    print("Pilih cakupan wilayah yang ingin diunduh sekarang:")
    print("  [1] Seluruh Indonesia Lengkap (13 Tile GeoTIFF, ~350-450 MB)")
    print("  [2] Pulau Sumatera & Kalimantan Saja (6 Tile Utama, ~180 MB)")
    print("  [3] Pulau Jawa, Bali & Nusa Tenggara (4 Tile, ~90 MB)")
    print("  [4] Pulau Sulawesi, Maluku & Papua (5 Tile, ~150 MB)")
    print("=" * 72)

    choice = input("Masukkan pilihan Anda (1/2/3/4) [Default: 1]: ").strip() or "1"

    if choice == "2":
        selected_tiles = INDONESIA_TILES["sumatera_kalimantan"]
    elif choice == "3":
        selected_tiles = INDONESIA_TILES["jawa_nusatenggara"]
    elif choice == "4":
        selected_tiles = INDONESIA_TILES["sulawesi_maluku_papua"]
    else:
        selected_tiles = ALL_13_INDONESIA_TILES

    print(f"\nMemulai pengunduhan {len(selected_tiles)} tile GeoTIFF Hansen lossyear...")
    for idx, (code, desc) in enumerate(selected_tiles, start=1):
        print(f"\n--- Tile {idx}/{len(selected_tiles)}: {code} ---")
        download_tile(code, desc)

    activate_hansen_layer_in_db()
    print("\nSelesai! Anda sekarang dapat langsung menganalisis '13. Deforestasi Hansen' di WebGIS.")


if __name__ == "__main__":
    main()
