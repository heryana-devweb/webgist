import React, { useEffect, useState } from 'react';
import {
  Database,
  Upload,
  FolderOpen,
  Settings2,
  Trash2,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Save,
  Eye,
  CloudDownload,
  Calendar,
} from 'lucide-react';
import { apiRequest } from '../api';

export default function AdminLayersView({ layers, onRefreshLayers }) {
  const [uploadingSlug, setUploadingSlug] = useState('');
  const [localFilesInfo, setLocalFilesInfo] = useState({ import_folder: '', files: [] });
  const [selectedLocalFileBySlug, setSelectedLocalFileBySlug] = useState({});
  const [editingLayer, setEditingLayer] = useState(null);
  const [editedColumns, setEditedColumns] = useState([]);
  const [sampleRows, setSampleRows] = useState([]);
  const [savingCols, setSavingCols] = useState(false);
  const [message, setMessage] = useState(null);

  // State khusus Fitur Download & Rentang Tahun Deforestasi Hansen (Default: 2015 - 2025)
  const [hansenStartYear, setHansenStartYear] = useState(2015);
  const [hansenEndYear, setHansenEndYear] = useState(2025);
  const [hansenRegion, setHansenRegion] = useState('all');
  const [hansenStatus, setHansenStatus] = useState(null);

  // State khusus Download Offline Copernicus DEM 30m (Ketinggian & Kelerengan)
  const [demRegion, setDemRegion] = useState('kalimantan');
  const [demStatus, setDemStatus] = useState(null);

  const TECHNICAL_COLS = new Set([
    'OBJECTID', 'OBJECTID_1', 'FID', 'METADATA', 'SRS_ID', 'FCODE',
    'LUAS', 'LUASWH', 'UUPP', 'TIPADM', 'SHAPE_LENG', 'SHAPE_AREA',
    'WIADKC', 'WIADKK', 'WIADPR', 'WIADKD', 'KDBBPS', 'KDCBPS', 'KDEBPS', 'KDPBPS',
  ]);

  const fetchLocalFiles = async () => {
    try {
      const data = await apiRequest('/layers/local-files');
      setLocalFilesInfo(data);
    } catch {
      // ignore
    }
  };

  const fetchHansenStatus = async () => {
    try {
      const st = await apiRequest('/layers/hansen/status');
      setHansenStatus(st);
      if (st.start_year) setHansenStartYear(st.start_year);
      if (st.end_year) setHansenEndYear(st.end_year);
      return st;
    } catch {
      return null;
    }
  };

  const fetchDemStatus = async () => {
    try {
      const st = await apiRequest('/layers/dem/status');
      setDemStatus(st);
      return st;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    fetchLocalFiles();
    fetchHansenStatus();
    fetchDemStatus();
  }, []);

  // Polling progres saat proses download offline DEM sedang berjalan
  useEffect(() => {
    if (!demStatus?.is_downloading) return;
    const timer = setInterval(async () => {
      const st = await fetchDemStatus();
      if (st && !st.is_downloading) {
        await onRefreshLayers();
        if (st.message) {
          setMessage({ type: 'success', text: st.message });
        }
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [demStatus?.is_downloading]);

  const handleTriggerDemDownload = async () => {
    setMessage(null);
    try {
      const res = await apiRequest('/layers/dem/download', {
        method: 'POST',
        body: JSON.stringify({ region: demRegion }),
      });
      setDemStatus((prev) => ({ ...(prev || {}), ...res, is_downloading: true }));
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  // Polling progres saat proses download otomatis Hansen sedang berjalan
  useEffect(() => {
    if (!hansenStatus?.is_downloading) return;
    const timer = setInterval(async () => {
      const st = await fetchHansenStatus();
      if (st && !st.is_downloading) {
        await onRefreshLayers();
        if (st.message) {
          setMessage({ type: 'success', text: st.message });
        }
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [hansenStatus?.is_downloading]);

  const handleSaveHansenYears = async () => {
    if (hansenStartYear > hansenEndYear) {
      alert('Tahun awal tidak boleh lebih besar dari tahun akhir.');
      return;
    }
    try {
      const res = await apiRequest('/layers/hansen/config', {
        method: 'PUT',
        body: JSON.stringify({
          start_year: Number(hansenStartYear),
          end_year: Number(hansenEndYear),
        }),
      });
      setMessage({ type: 'success', text: res.message });
      await fetchHansenStatus();
      await onRefreshLayers();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleTriggerHansenDownload = async () => {
    if (hansenStartYear > hansenEndYear) {
      alert('Tahun awal tidak boleh lebih besar dari tahun akhir.');
      return;
    }
    setMessage(null);
    try {
      const res = await apiRequest('/layers/hansen/download', {
        method: 'POST',
        body: JSON.stringify({
          region: hansenRegion,
          start_year: Number(hansenStartYear),
          end_year: Number(hansenEndYear),
        }),
      });
      setHansenStatus((prev) => ({ ...(prev || {}), ...res, is_downloading: true }));
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleActivateDemOnline = async (slug) => {
    setUploadingSlug(slug);
    setMessage(null);
    try {
      const res = await apiRequest(`/layers/dem/${slug}/activate`, {
        method: 'POST',
      });
      setMessage({ type: 'success', text: res.message });
      await onRefreshLayers();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setUploadingSlug('');
    }
  };

  const handleUploadZip = async (slug, file) => {
    if (!file) return;
    setUploadingSlug(slug);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiRequest(`/layers/${slug}/upload`, {
        method: 'POST',
        body: formData,
      });
      setMessage({ type: 'success', text: res.message });
      await onRefreshLayers();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setUploadingSlug('');
    }
  };

  const handleImportLocal = async (slug) => {
    const filename = selectedLocalFileBySlug[slug];
    if (!filename) {
      alert('Pilih file dari daftar folder lokal terlebih dahulu.');
      return;
    }
    setUploadingSlug(slug);
    setMessage(null);
    try {
      const res = await apiRequest(`/layers/${slug}/import-local`, {
        method: 'POST',
        body: JSON.stringify({ filename }),
      });
      setMessage({ type: 'success', text: res.message });
      await fetchHansenStatus();
      await onRefreshLayers();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setUploadingSlug('');
    }
  };

  const handleOpenColumnConfig = async (layer) => {
    setEditingLayer(layer);
    setEditedColumns(
      (layer.available_columns || []).map((c) => ({
        original_name: c.original_name,
        default_alias: c.default_alias || c.original_name,
        selected: c.selected !== false,
        dtype: c.dtype || 'text',
      }))
    );
    setSampleRows([]);
    try {
      const sample = await apiRequest(`/layers/${layer.slug}/sample`);
      setSampleRows(sample.rows || []);
    } catch {
      // ignore
    }
  };

  const moveAdminColumn = (fromIndex, toIndex) => {
    if (toIndex < 0 || toIndex >= editedColumns.length) return;
    setEditedColumns((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const handleSaveColumnConfig = async () => {
    if (!editingLayer) return;
    setSavingCols(true);
    try {
      const res = await apiRequest(`/layers/${editingLayer.slug}/columns`, {
        method: 'PUT',
        body: JSON.stringify({ columns: editedColumns }),
      });
      setMessage({ type: 'success', text: res.message });
      setEditingLayer(null);
      await onRefreshLayers();
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingCols(false);
    }
  };

  const handleClearLayer = async (layer) => {
    if (
      !window.confirm(
        `Yakin ingin menghapus seluruh data pada tema "${layer.name}"?`
      )
    ) {
      return;
    }
    try {
      const res = await apiRequest(`/layers/${layer.slug}/data`, {
        method: 'DELETE',
      });
      setMessage({ type: 'success', text: res.message });
      if (layer.slug === 'deforestasi_hansen') {
        await fetchHansenStatus();
      }
      await onRefreshLayers();
    } catch (err) {
      alert(err.message);
    }
  };

  const YEAR_OPTIONS = Array.from({ length: 25 }, (_, i) => 2001 + i); // 2001 .. 2025

  return (
    <div className="w-full px-8 py-7 space-y-6 bg-slate-50 dark:bg-slate-950 min-h-full transition-colors">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-[21px] font-bold tracking-[-0.02em] text-[#0F172A] dark:text-white">
              Database SHP &amp; Raster Referensi (14 Layer)
            </h2>
            <p className="text-[13px] text-[#475569] dark:text-slate-400">
              Unggah file SHP (<strong className="text-[#0F172A] dark:text-white">.zip</strong>), import dari folder lokal{' '}
              <code className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-1.5 py-0.5 rounded text-[#0F172A] dark:text-slate-200 font-mono text-[11px]">
                {localFilesInfo.import_folder || 'backend/data_import'}
              </code>
              , atau unduh otomatis data Deforestasi Hansen.
            </p>
          </div>
          <button
            type="button"
            onClick={fetchLocalFiles}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-[#0F172A] dark:text-slate-200 flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
          >
            <RefreshCw className="w-3.5 h-3.5 text-[#475569]" />
            <span>Refresh Folder Lokal ({localFilesInfo.files.length} file)</span>
          </button>
        </div>

        {message && (
          <div
            className={`p-4 rounded-xl border text-xs font-semibold flex items-center justify-between ${
              message.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                : 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-300'
            }`}
          >
            <span>{message.text}</span>
            <button
              type="button"
              onClick={() => setMessage(null)}
              className="underline ml-4 cursor-pointer"
            >
              Tutup
            </button>
          </div>
        )}

        {/* Modal Edit Kolom Default */}
        {editingLayer && (
          <div className="bg-slate-950/40 backdrop-blur-xs fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden">
              <div className="p-5 border-b border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold text-[#0F172A] dark:text-white text-base">
                    Pengaturan Atribut &amp; Susunan Kolom: {editingLayer.name}
                  </h3>
                  <p className="text-xs text-[#475569] dark:text-slate-400">
                    Hanya atribut yang dicentang di sini yang akan muncul pada Halaman Analisis.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      setEditedColumns((prev) =>
                        prev.map((c) => ({
                          ...c,
                          selected: !TECHNICAL_COLS.has(String(c.original_name).toUpperCase()),
                        }))
                      )
                    }
                    className="px-3 py-1.5 rounded-lg bg-[#0F172A] text-white font-semibold hover:bg-slate-800 transition cursor-pointer"
                  >
                    Pilih Kolom Utama Saja
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setEditedColumns((prev) => prev.map((c) => ({ ...c, selected: true })))
                    }
                    className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-[#0F172A] dark:text-slate-200 font-semibold hover:bg-slate-200 transition cursor-pointer"
                  >
                    Centang Semua
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setEditedColumns((prev) => prev.map((c) => ({ ...c, selected: false })))
                    }
                    className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-[#0F172A] dark:text-slate-200 font-semibold hover:bg-slate-200 transition cursor-pointer"
                  >
                    Kosongkan
                  </button>
                </div>
              </div>

              <div className="p-5 overflow-y-auto space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {editedColumns.map((col, idx) => (
                    <div
                      key={col.original_name}
                      className={`p-3 rounded-xl border space-y-2 text-xs transition ${
                        col.selected
                          ? 'border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-800 shadow-2xs'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 opacity-60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-2 font-mono font-semibold text-[#0F172A] dark:text-white cursor-pointer">
                          <input
                            type="checkbox"
                            checked={col.selected}
                            onChange={(e) => {
                              const next = [...editedColumns];
                              next[idx] = { ...col, selected: e.target.checked };
                              setEditedColumns(next);
                            }}
                            className="rounded border-slate-300 text-indigo-600"
                          />
                          <span>{col.original_name}</span>
                        </label>

                        <select
                          value={idx}
                          onChange={(e) => moveAdminColumn(idx, Number(e.target.value))}
                          className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-[11px] font-mono tabular-nums font-semibold text-indigo-700 dark:text-indigo-300"
                        >
                          {editedColumns.map((_, orderIdx) => (
                            <option key={orderIdx} value={orderIdx}>
                              Urutan #{orderIdx + 1}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <span className="text-[10px] text-[#475569] block mb-0.5">
                          Nama Kolom (Alias Default):
                        </span>
                        <input
                          type="text"
                          value={col.default_alias}
                          onChange={(e) => {
                            const next = [...editedColumns];
                            next[idx] = { ...col, default_alias: e.target.value };
                            setEditedColumns(next);
                          }}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 focus:bg-white text-xs font-medium text-[#0F172A] dark:text-white focus:border-indigo-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {sampleRows.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-[#475569] mb-2 flex items-center gap-1.5">
                      <Eye className="w-3.5 h-3.5" />
                      Pratinjau Isi Atribut
                    </h4>
                    <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl max-h-52">
                      <table className="w-full text-left border-collapse text-[12px]">
                        <thead className="bg-slate-50 dark:bg-slate-800 text-[#0F172A] dark:text-white border-b border-slate-200 dark:border-slate-700">
                          <tr>
                            {editedColumns.map((c) => (
                              <th key={c.original_name} className="py-2 px-3 border-r border-slate-200/60 dark:border-slate-700">
                                <div>{c.default_alias}</div>
                                <div className="text-[10px] font-mono text-[#475569]">
                                  ({c.original_name})
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {sampleRows.map((r, i) => (
                            <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                              {editedColumns.map((c) => (
                                <td key={c.original_name} className="py-1.5 px-3 border-r border-slate-100 dark:border-slate-800 text-[#475569] dark:text-slate-300 font-mono tabular-nums">
                                  {String(r[c.original_name] ?? '-')}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingLayer(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-200/70 dark:bg-slate-800 text-[#475569] dark:text-slate-300 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={savingCols}
                  onClick={handleSaveColumnConfig}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{savingCols ? 'Menyimpan...' : 'Simpan Pengaturan Kolom'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Grid 14 Kartu Database Biofisik */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {layers.map((layer) => {
            const isBusy = uploadingSlug === layer.slug;
            const isHansen = layer.slug === 'deforestasi_hansen';
            const isDemOnline = layer.slug === 'ketinggian' || layer.slug === 'kelerengan';
            const isDownloadingHansen = isHansen && hansenStatus?.is_downloading;

            return (
              <div
                key={layer.slug}
                className={`bg-white dark:bg-slate-900 rounded-2xl border p-5 shadow-xs flex flex-col justify-between gap-4 ${
                  layer.has_data
                    ? 'border-emerald-300 dark:border-emerald-800'
                    : 'border-slate-200/90 dark:border-slate-800'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="text-[11px] font-mono tabular-nums font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                        TEMA #{layer.order_index}
                      </span>
                      <h3 className="text-[14.5px] font-semibold text-[#0F172A] dark:text-white mt-0.5">
                        {layer.name}
                      </h3>
                      <p className="text-[12px] text-[#475569] dark:text-slate-400 mt-1 leading-relaxed">
                        {layer.description}
                      </p>
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded-full text-[11px] font-mono tabular-nums font-semibold shrink-0 flex items-center gap-1 ${
                        layer.has_data
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                          : 'bg-slate-100 dark:bg-slate-800 text-[#475569] dark:text-slate-400'
                      }`}
                    >
                      {layer.has_data ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>
                            Aktif ({layer.feature_count.toLocaleString('id-ID')}{' '}
                            {isHansen ? 'Tile' : isDemOnline ? 'Kelas' : 'Poligon'})
                          </span>
                        </>
                      ) : (
                        'Kosong'
                      )}
                    </span>
                  </div>

                  {layer.has_data && (
                    <div className="mt-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700 text-[12px] flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[#475569] dark:text-slate-300 truncate max-w-[230px]">
                        Sumber: <strong className="text-[#0F172A] dark:text-white">{layer.source_filename}</strong>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenColumnConfig(layer)}
                          className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 border border-slate-200 dark:border-slate-700 text-[#0F172A] dark:text-slate-200 font-semibold flex items-center gap-1 transition cursor-pointer"
                        >
                          <Settings2 className="w-3.5 h-3.5" />
                          <span>Atur Kolom</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleClearLayer(layer)}
                          className="p-1.5 rounded-lg text-[#475569] hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition cursor-pointer"
                          title="Hapus seluruh data pada layer ini"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* PANEL KHUSUS TEMA #13: PILIH RENTANG TAHUN (2015-2025) & DOWNLOAD OTOMATIS DATA HANSEN */}
                  {isHansen && (
                    <div className="mt-3 p-3.5 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-200/80 dark:border-indigo-800/80 space-y-3 text-[12px]">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-[#0F172A] dark:text-white flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                          Rentang Tahun Deforestasi Hansen
                        </span>
                        <button
                          type="button"
                          onClick={handleSaveHansenYears}
                          className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 font-semibold hover:bg-indigo-600 hover:text-white transition cursor-pointer"
                        >
                          Simpan Rentang Tahun
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="text-[11px] text-[#475569] dark:text-slate-400 block mb-1">
                            Dari Tahun (Awal):
                          </label>
                          <select
                            value={hansenStartYear}
                            onChange={(e) => setHansenStartYear(Number(e.target.value))}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono tabular-nums font-bold text-[#0F172A] dark:text-white"
                          >
                            {YEAR_OPTIONS.map((y) => (
                              <option key={y} value={y}>
                                Tahun {y}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[11px] text-[#475569] dark:text-slate-400 block mb-1">
                            Sampai Tahun (Akhir):
                          </label>
                          <select
                            value={hansenEndYear}
                            onChange={(e) => setHansenEndYear(Number(e.target.value))}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono tabular-nums font-bold text-[#0F172A] dark:text-white"
                          >
                            {YEAR_OPTIONS.map((y) => (
                              <option key={y} value={y}>
                                Tahun {y}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Pilihan Wilayah & Tombol Download Otomatis */}
                      <div className="pt-2 border-t border-indigo-200/60 dark:border-indigo-800/60 space-y-2">
                        <label className="text-[11px] font-semibold text-[#0F172A] dark:text-slate-200 block">
                          Download Otomatis dari Server Resmi Hansen (UMD GLAD):
                        </label>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={hansenRegion}
                            onChange={(e) => setHansenRegion(e.target.value)}
                            disabled={isDownloadingHansen}
                            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium text-[#0F172A] dark:text-white"
                          >
                            <option value="all">Seluruh Indonesia (13 Tile GeoTIFF)</option>
                            <option value="sumatera_kalimantan">Sumatera &amp; Kalimantan (6 Tile)</option>
                            <option value="jawa_nusatenggara">Jawa, Bali &amp; Nusa Tenggara (4 Tile)</option>
                            <option value="sulawesi_maluku_papua">Sulawesi, Maluku &amp; Papua (5 Tile)</option>
                          </select>

                          <button
                            type="button"
                            disabled={isDownloadingHansen}
                            onClick={handleTriggerHansenDownload}
                            className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold flex items-center gap-1.5 transition cursor-pointer shrink-0"
                          >
                            {isDownloadingHansen ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>Mengunduh...</span>
                              </>
                            ) : (
                              <>
                                <CloudDownload className="w-3.5 h-3.5" />
                                <span>Download Data Hansen</span>
                              </>
                            )}
                          </button>
                        </div>

                        {isDownloadingHansen && (
                          <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 space-y-1.5">
                            <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                              <span className="text-[#0F172A] dark:text-slate-200 font-semibold truncate">
                                {hansenStatus.message || hansenStatus.current_tile}
                              </span>
                              <span className="font-bold text-indigo-600">
                                {hansenStatus.completed_tiles}/{hansenStatus.total_tiles} Tile ({hansenStatus.current_tile_percent}%)
                              </span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                              <div
                                className="h-2 bg-indigo-600 rounded-full transition-all duration-300"
                                style={{ width: `${hansenStatus.current_tile_percent || 5}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {/* PANEL KHUSUS TEMA #3 & #4: DOWNLOAD OFFLINE & MODE ONLINE COPERNICUS DEM 30M */}
                  {isDemOnline && (
                    <div className="mt-3 p-3.5 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-200/80 dark:border-indigo-800/80 space-y-3 text-[12px]">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-bold text-[#0F172A] dark:text-white flex items-center gap-1.5">
                          <CloudDownload className="w-3.5 h-3.5 text-indigo-600" />
                          <span>Copernicus DEM GLO-30 (30m)</span>
                        </div>
                        <span className="text-[11px] font-mono tabular-nums font-semibold text-indigo-700 dark:text-indigo-300">
                          Cache Offline: {demStatus?.cached_tile_count || 0} Tile
                        </span>
                      </div>

                      <p className="text-[11px] text-[#475569] dark:text-slate-300 leading-relaxed">
                        {layer.slug === 'ketinggian'
                          ? '1 kumpulan tile DEM dipakai bersama oleh Ketinggian & Kelerengan (total luas selalu 100% AOI). Unduh per pulau untuk pemakaian 100% offline.'
                          : 'Kemiringan lereng (%) dihitung otomatis dari tile Copernicus DEM 30m (total luas selalu 100% AOI).'}
                      </p>

                      {/* Pilihan Wilayah & Tombol Download Offline DEM */}
                      <div className="space-y-2 pt-1.5 border-t border-indigo-200/60 dark:border-indigo-800/60">
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={demRegion}
                            onChange={(e) => setDemRegion(e.target.value)}
                            disabled={demStatus?.is_downloading}
                            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium text-[#0F172A] dark:text-white"
                          >
                            <option value="kalimantan">Pulau Kalimantan (~1 GB)</option>
                            <option value="sumatera">Pulau Sumatera (~950 MB)</option>
                            <option value="jawa_bali">Jawa &amp; Bali (~450 MB)</option>
                            <option value="sulawesi">Pulau Sulawesi (~650 MB)</option>
                            <option value="nusa_tenggara">Nusa Tenggara (~350 MB)</option>
                            <option value="maluku_papua">Maluku &amp; Papua (~1,2 GB)</option>
                            <option value="all">Seluruh Indonesia (~3,5 - 5 GB)</option>
                          </select>

                          <button
                            type="button"
                            disabled={demStatus?.is_downloading}
                            onClick={handleTriggerDemDownload}
                            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shrink-0"
                          >
                            {demStatus?.is_downloading ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>Mengunduh...</span>
                              </>
                            ) : (
                              <>
                                <CloudDownload className="w-3.5 h-3.5" />
                                <span>Download Offline</span>
                              </>
                            )}
                          </button>
                        </div>

                        {demStatus?.is_downloading && (
                          <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 space-y-1.5">
                            <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                              <span className="text-[#0F172A] dark:text-slate-200 font-semibold truncate">
                                {demStatus.message || demStatus.current_tile}
                              </span>
                              <span className="font-bold text-indigo-600 shrink-0 ml-2">
                                {demStatus.completed_tiles}/{demStatus.total_tiles} Grid
                              </span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                              <div
                                className="h-2 bg-indigo-600 rounded-full transition-all duration-300"
                                style={{
                                  width: `${
                                    demStatus.total_tiles
                                      ? Math.round(
                                          (demStatus.completed_tiles / demStatus.total_tiles) * 100
                                        )
                                      : 5
                                  }%`,
                                }}
                              />
                            </div>
                          </div>
                        )}

                        {!layer.has_data && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleActivateDemOnline(layer.slug)}
                            className="w-full py-1.5 px-3 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                          >
                            <span>Atau Aktifkan Mode Online (Unduh Otomatis per AOI)</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Tombol Upload SHP / Import dari data_import (Tidak tampil untuk Deforestasi Hansen, Ketinggian, & Kelerengan) */}
                {!isHansen && !isDemOnline && (
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                    {isBusy ? (
                      <div className="py-2.5 px-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[#0F172A] dark:text-slate-200 text-xs font-semibold flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                        <span>Memproses data ke dalam sistem...</span>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <label className="w-full py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer transition flex items-center justify-center gap-1.5 text-center shadow-2xs">
                          <Upload className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            {layer.has_data
                              ? 'Ganti / Upload File (.zip)'
                              : 'Upload SHP (.zip) via Browser'}
                          </span>
                          <input
                            type="file"
                            accept=".zip,.gpkg,.geojson,.json"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleUploadZip(layer.slug, f);
                              e.target.value = '';
                            }}
                            className="hidden"
                          />
                        </label>

                        {localFilesInfo.files.length > 0 && (
                          <div className="flex items-center gap-2 w-full">
                            <select
                              value={selectedLocalFileBySlug[layer.slug] || ''}
                              onChange={(e) =>
                                setSelectedLocalFileBySlug((prev) => ({
                                  ...prev,
                                  [layer.slug]: e.target.value,
                                }))
                              }
                              className="flex-1 min-w-0 truncate px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800 text-[#0F172A] dark:text-slate-200 focus:border-indigo-500 focus:outline-none"
                            >
                              <option value="">-- Pilih dari data_import --</option>
                              {localFilesInfo.files.map((f) => (
                                <option key={f.filename} value={f.filename}>
                                  {f.filename} ({f.size_mb} MB)
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => handleImportLocal(layer.slug)}
                              className="px-3 py-1.5 rounded-xl bg-slate-200/80 dark:bg-slate-800 hover:bg-slate-300/80 text-[#0F172A] dark:text-white text-xs font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer transition"
                            >
                              <FolderOpen className="w-3.5 h-3.5" />
                              <span>Import</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
