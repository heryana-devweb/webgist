import React, { useMemo, useState } from 'react';
import {
  FolderKanban,
  Plus,
  MapPin,
  Calendar,
  Trash2,
  ArrowRight,
  Database,
  Search,
  FileArchive,
} from 'lucide-react';
import { apiRequest } from '../api';

export default function DashboardView({
  projects = [],
  layers = [],
  onOpenNewProject,
  onSelectProjectForAnalysis,
  onRefreshProjects,
}) {
  const [search, setSearch] = useState('');

  const filteredProjects = useMemo(() => {
    if (!search.trim()) return projects;
    const q = search.toLowerCase();
    return projects.filter(
      (p) =>
        p.project_code?.toLowerCase().includes(q) ||
        p.name?.toLowerCase().includes(q) ||
        p.location?.toLowerCase().includes(q)
    );
  }, [projects, search]);

  const activeLayersCount = useMemo(
    () => layers.filter((l) => l.has_data).length,
    [layers]
  );

  const handleDeleteProject = async (e, proj) => {
    e.stopPropagation();
    if (
      !window.confirm(
        `Yakin ingin menghapus project "${proj.name}" (${proj.project_code})?`
      )
    ) {
      return;
    }
    try {
      await apiRequest(`/projects/${proj.id}`, { method: 'DELETE' });
      await onRefreshProjects();
    } catch (err) {
      alert(err.message);
    }
  };

  const formatHa = (num) => {
    return (
      Number(num || 0).toLocaleString('id-ID', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) + ' Ha'
    );
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8 bg-slate-50 dark:bg-slate-950 transition-colors">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header (Judul Halaman: 21px Bold, letter-spacing -0.02em) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-[21px] font-bold tracking-[-0.02em] text-[#0F172A] dark:text-white">
              Project Initiatives
            </h1>
            <p className="text-[13px] text-[#475569] dark:text-slate-400 mt-0.5">
              Daftar project analisis biofisik, kelayakan, dan kredit karbon beserta areal kerja (AOI).
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenNewProject}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-xl shadow-xs flex items-center gap-2 self-start transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Project Baru</span>
          </button>
        </div>

        {/* KPI Cards (Angka KPI Utama: 26px Bold IBM Plex Sans Tabular-Nums) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center justify-between">
            <div>
              <span className="text-[13px] text-[#475569] dark:text-slate-400 font-medium">
                Total Project Dikerjakan
              </span>
              <span className="text-[26px] font-bold text-[#0F172A] dark:text-white font-mono tabular-nums block mt-1">
                {projects.length}
              </span>
            </div>
            <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <FolderKanban className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center justify-between">
            <div>
              <span className="text-[13px] text-[#475569] dark:text-slate-400 font-medium">
                Database Biofisik Aktif
              </span>
              <span className="text-[26px] font-bold text-[#0F172A] dark:text-white font-mono tabular-nums block mt-1">
                {activeLayersCount} / {layers.length || 14}
              </span>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Database className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* Card List Project Container */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-[12px] font-semibold rounded-lg font-mono tabular-nums">
                Active Projects ({filteredProjects.length})
              </span>
              <span className="text-[12px] text-[#475569] dark:text-slate-400 hidden sm:inline">
                Pilih kartu project untuk membuka Spatial Workspace
              </span>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-[#475569] absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari kode, nama, atau lokasi..."
                className="w-full pl-8 pr-3 py-1.5 text-[12px] bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[#0F172A] dark:text-white rounded-lg focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {filteredProjects.length === 0 ? (
            <div className="p-14 text-center bg-slate-50/40 dark:bg-slate-900/40 space-y-3">
              <FolderKanban className="w-9 h-9 text-[#475569] mx-auto" />
              <div className="text-[15px] font-semibold text-[#0F172A] dark:text-slate-200">
                Belum ada Project yang dibuat
              </div>
              <p className="text-[12px] text-[#475569] dark:text-slate-400 max-w-sm mx-auto">
                Klik tombol <strong>Project Baru</strong> untuk mengunggah file SHP Areal Kerja (AOI) dan memulai analisis biofisik.
              </p>
              <button
                type="button"
                onClick={onOpenNewProject}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-semibold rounded-xl inline-flex items-center gap-1.5 transition cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Project Baru</span>
              </button>
            </div>
          ) : (
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 bg-slate-50/40 dark:bg-slate-950/40">
              {filteredProjects.map((proj) => (
                <div
                  key={proj.id}
                  onClick={() => onSelectProjectForAnalysis(proj.id)}
                  className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-5 shadow-xs hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-700 transition flex flex-col justify-between group cursor-pointer"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <span className="px-2.5 py-0.5 bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 font-mono tabular-nums font-bold text-[12px] rounded-lg border border-indigo-100 dark:border-indigo-800">
                        {proj.project_code}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-mono tabular-nums text-[#475569] dark:text-slate-400 flex items-center gap-1">
                          <Calendar className="w-3 h-3" /> {proj.upload_date}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteProject(e, proj)}
                          className="p-1 rounded-md text-[#475569] hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition"
                          title="Hapus Project"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Judul Kartu: 14.5px SemiBold */}
                    <h3 className="text-[14.5px] font-semibold text-[#0F172A] dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition">
                      {proj.name}
                    </h3>
                    <p className="text-[12px] text-[#475569] dark:text-slate-400 mt-1 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-[#475569] shrink-0" />
                      <span className="truncate">{proj.location}</span>
                    </p>

                    {/* Metrik Luas & Status Analisis */}
                    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-2.5 text-[12px]">
                      <div className="bg-slate-50 dark:bg-slate-800/70 p-2.5 rounded-xl">
                        <span className="text-[11px] text-[#475569] dark:text-slate-400 block">
                          Luas Areal (AOI)
                        </span>
                        <span className="font-mono tabular-nums font-bold text-[#0F172A] dark:text-white mt-0.5 block">
                          {formatHa(proj.aoi_area_ha)}
                        </span>
                      </div>
                      <div className="bg-emerald-50/70 dark:bg-emerald-950/40 p-2.5 rounded-xl">
                        <span className="text-[11px] text-emerald-700 dark:text-emerald-400 block">
                          Tahap Analisis
                        </span>
                        <span className="font-semibold text-emerald-800 dark:text-emerald-300 mt-0.5 block">
                          Biofisik Aktif
                        </span>
                      </div>
                    </div>

                    <div className="mt-2.5 flex items-center justify-between text-[12px] text-[#475569] dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 px-3 py-1.5 rounded-lg">
                      <span>Kelayakan &amp; Karbon:</span>
                      <span className="font-medium text-[#0F172A] dark:text-slate-300">
                        Menunggu 14 Biofisik
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <span className="text-[12px] font-mono tabular-nums text-[#475569] flex items-center gap-1 truncate max-w-[140px]">
                      <FileArchive className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{proj.aoi_filename}</span>
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectProjectForAnalysis(proj.id);
                      }}
                      className="px-3 py-1.5 bg-[#0F172A] dark:bg-indigo-600 hover:bg-indigo-600 dark:hover:bg-indigo-500 text-white text-[12px] font-semibold rounded-xl flex items-center gap-1.5 transition shrink-0 cursor-pointer"
                    >
                      <span>Buka Analisis</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
