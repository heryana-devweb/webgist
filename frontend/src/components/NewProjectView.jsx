import React, { useEffect, useState } from 'react';
import {
  Upload,
  MapPin,
  Calendar,
  Hash,
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { apiRequest } from '../api';
import MapComponent from './MapComponent';

const INDONESIA_PROVINCES = [
  'Aceh',
  'Bali',
  'Banten',
  'Bengkulu',
  'DI Yogyakarta',
  'DKI Jakarta',
  'Gorontalo',
  'Jambi',
  'Jawa Barat',
  'Jawa Tengah',
  'Jawa Timur',
  'Kalimantan Barat',
  'Kalimantan Selatan',
  'Kalimantan Tengah',
  'Kalimantan Timur',
  'Kalimantan Utara',
  'Kepulauan Bangka Belitung',
  'Kepulauan Riau',
  'Lampung',
  'Maluku',
  'Maluku Utara',
  'Nusa Tenggara Barat',
  'Nusa Tenggara Timur',
  'Papua',
  'Papua Barat',
  'Papua Barat Daya',
  'Papua Pegunungan',
  'Papua Selatan',
  'Papua Tengah',
  'Riau',
  'Sulawesi Barat',
  'Sulawesi Selatan',
  'Sulawesi Tengah',
  'Sulawesi Tenggara',
  'Sulawesi Utara',
  'Sumatera Barat',
  'Sumatera Selatan',
  'Sumatera Utara',
];

export default function NewProjectView({ onCancel, onProjectCreated }) {
  const todayStr = new Date().toISOString().slice(0, 10);

  const [projectCode, setProjectCode] = useState('');
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [uploadDate, setUploadDate] = useState(todayStr);
  const [shpFile, setShpFile] = useState(null);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const fetchNextCode = async () => {
      try {
        const res = await apiRequest(
          `/projects/next-code?upload_date=${encodeURIComponent(uploadDate)}`
        );
        if (active && res.project_code) {
          setProjectCode(res.project_code);
        }
      } catch {
        const parts = uploadDate.split('-');
        if (parts.length === 3) {
          setProjectCode(`WAS-${parts[2]}${parts[1]}-1`);
        }
      }
    };
    fetchNextCode();
    return () => {
      active = false;
    };
  }, [uploadDate]);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setShpFile(file);
    setError('');
    setPreviewLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiRequest('/projects/preview-shp', {
        method: 'POST',
        body: formData,
      });
      setPreviewData(res);
    } catch (err) {
      setPreviewData(null);
      setError(err.message || 'Gagal memuat preview SHP.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleConfirmSubmit = async (e) => {
    e.preventDefault();
    if (!location) {
      setError('Silakan pilih Lokasi Provinsi terlebih dahulu.');
      return;
    }
    if (!shpFile) {
      setError('Silakan unggah file SHP Project (.zip atau .geojson) terlebih dahulu.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('project_code', projectCode);
      formData.append('name', name);
      formData.append('location', `Provinsi ${location}`);
      formData.append('upload_date', uploadDate);
      formData.append('file', shpFile);

      const res = await apiRequest('/projects', {
        method: 'POST',
        body: formData,
      });
      onProjectCreated(res.project);
    } catch (err) {
      setError(err.message || 'Gagal menyimpan project baru.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8 bg-slate-50 dark:bg-slate-950 transition-colors">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[#475569] dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-[21px] font-bold tracking-[-0.02em] text-[#0F172A] dark:text-white">
              Buat Project Analisis Baru
            </h1>
            <p className="text-[13px] text-[#475569] dark:text-slate-400">
              Lengkapi data project, pilih provinsi lokasi areal kerja, dan unggah SHP untuk pratinjau peta.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* KOLOM KIRI: Form Input Project Baru */}
          <form
            onSubmit={handleConfirmSubmit}
            className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-4"
          >
            <div>
              <label className="text-xs font-semibold text-[#0F172A] dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                <span>Kode Project (Otomatis)</span>
              </label>
              <input
                type="text"
                readOnly
                value={projectCode}
                className="w-full px-3.5 py-2.5 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 font-mono tabular-nums text-xs font-bold text-indigo-700 dark:text-indigo-300 cursor-not-allowed"
              />
              <span className="text-[11px] text-[#475569] mt-1 block">
                Format otomatis <code>WAS-ddmm-n</code> sesuai tanggal upload &amp; urutan harian.
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0F172A] dark:text-slate-300 mb-1.5">
                Nama Project
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contoh: AOI BHL 1 — Melawi"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-[#0F172A] dark:text-white placeholder:text-slate-400 focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none transition"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-[#0F172A] dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                <span>Lokasi Project (Provinsi)</span>
              </label>
              <select
                required
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-medium text-[#0F172A] dark:text-white focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none transition"
              >
                <option value="">-- Pilih Provinsi (38 Provinsi Indonesia) --</option>
                {INDONESIA_PROVINCES.map((prov) => (
                  <option key={prov} value={prov}>
                    Provinsi {prov}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#0F172A] dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                <span>Tanggal Upload</span>
              </label>
              <input
                type="date"
                required
                value={uploadDate}
                onChange={(e) => setUploadDate(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-[#0F172A] dark:text-white font-mono tabular-nums focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#0F172A] dark:text-slate-300 mb-1.5">
                Upload SHP Project (.zip / .geojson)
              </label>
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-indigo-500 bg-slate-50 dark:bg-slate-800/50 hover:bg-indigo-50/30 dark:hover:bg-indigo-950/20 rounded-xl p-5 cursor-pointer transition text-center">
                <Upload className="w-6 h-6 text-indigo-600 dark:text-indigo-400 mb-1.5" />
                <span className="text-xs font-semibold text-[#0F172A] dark:text-slate-200">
                  {shpFile ? shpFile.name : 'Pilih file .ZIP SHP atau .GeoJSON'}
                </span>
                <span className="text-[11px] text-[#475569] mt-1 font-mono tabular-nums">
                  {shpFile
                    ? `Ukuran: ${(shpFile.size / 1024).toFixed(1)} KB`
                    : 'Klik untuk unggah & tampilkan preview peta areal kerja'}
                </span>
                <input
                  type="file"
                  accept=".zip,.geojson,.json,.gpkg"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-600 dark:text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-[#475569] dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting || previewLoading || !previewData}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 text-white text-xs font-semibold shadow-xs transition flex items-center gap-1.5 cursor-pointer"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Memproses...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Konfirmasi</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* KOLOM KANAN: Preview Peta Areal Kerja */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-[14.5px] font-semibold text-[#0F172A] dark:text-white">
                  Preview Peta Areal Kerja (AOI)
                </h3>
                <p className="text-xs text-[#475569] dark:text-slate-400">
                  Pratinjau batas poligon areal kerja setelah file SHP dimasukkan
                </p>
              </div>

              {previewData && (
                <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-xl text-xs font-mono tabular-nums">
                  <span className="text-[#475569] dark:text-slate-400">
                    Poligon: <strong className="text-[#0F172A] dark:text-white">{previewData.feature_count}</strong>
                  </span>
                  <span className="text-slate-300 dark:text-slate-600">|</span>
                  <span className="text-indigo-700 dark:text-indigo-300 font-bold">
                    {previewData.aoi_area_ha?.toLocaleString('id-ID', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    Ha
                  </span>
                </div>
              )}
            </div>

            <div className="relative h-[440px] rounded-xl overflow-hidden">
              {previewLoading && (
                <div className="absolute inset-0 z-50 bg-white/85 dark:bg-slate-900/85 backdrop-blur-xs flex flex-col items-center justify-center gap-2 text-xs text-[#0F172A] dark:text-slate-200 font-semibold">
                  <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
                  <span>Membaca geometri SHP &amp; menghitung luas areal kerja...</span>
                </div>
              )}
              <MapComponent
                aoiGeojson={previewData?.aoi_geojson}
                clippedGeojson={null}
                activeColumns={[]}
                previewOnly={true}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
