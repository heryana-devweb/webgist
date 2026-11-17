import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  SlidersHorizontal,
  Download,
  FileSpreadsheet,
  AlertCircle,
  Loader2,
  Search,
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  FolderKanban,
  Plus,
  Database,
  Map as MapIcon,
  Tag,
  Table2,
  Scale,
  Users,
  ShieldAlert,
  Banknote,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Check,
} from 'lucide-react';
import { apiRequest, downloadTableExport } from '../api';
import MapComponent from './MapComponent';

const TECHNICAL_NON_GROUP_COLS = new Set([
  'OBJECTID',
  'OBJECTID_1',
  'FID',
  'GID',
  'ID',
  'LUAS',
  'LUASWH',
  'SHAPE_LENG',
  'SHAPE_LE_1',
  'SHAPE_AREA',
  'SHAPE_LEN',
]);

export default function AnalysisView({
  projects = [],
  activeProjectId,
  onSelectProjectId,
  onOpenNewProject,
  onBackToDashboard,
  layers = [],
  onGoToAdminLayers,
  isAdmin,
}) {
  // 4 Tab Utama Spatial Workspace sesuai Referensi:
  // 'ringkasan' | 'biofisik' | 'kelayakan' | 'karbon'
  const [workspaceTab, setWorkspaceTab] = useState('biofisik');

  const [projectDetail, setProjectDetail] = useState(null);
  const [loadingProject, setLoadingProject] = useState(false);

  const [activeLayerSlug, setActiveLayerSlug] = useState(
    layers[0]?.slug || 'administrasi_wilayah'
  );
  const [bioSidebarOpen, setBioSidebarOpen] = useState(true);

  const [clipCache, setClipCache] = useState({});
  const [loadingClip, setLoadingClip] = useState(false);
  const [clipError, setClipError] = useState('');

  // Kontrol Peta di Header Atas Peta (Atribut Simbologi, Label Default Nonaktif, Opasitas, Drawer Tabel)
  const [legendAttrKey, setLegendAttrKey] = useState('');
  const [showMapLabels, setShowMapLabels] = useState(false);
  const [layerOpacity, setLayerOpacity] = useState(0.75);
  const [tableDrawerOpen, setTableDrawerOpen] = useState(true);
  const [drawerHeight, setDrawerHeight] = useState(240);
  const [zoomTargetGid, setZoomTargetGid] = useState(null);
  const isResizingRef = useRef(false);

  // Kustomisasi Kolom, Sort By, Pencarian, & Filter Tahun Hansen
  const [customColumnsByLayer, setCustomColumnsByLayer] = useState({});
  const [showColumnCustomizer, setShowColumnCustomizer] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: '_luas_ha', direction: 'desc' });
  const [selectedHansenYears, setSelectedHansenYears] = useState(null);
  const [hansenYearDropdownOpen, setHansenYearDropdownOpen] = useState(false);
  const [savingSettingsState, setSavingSettingsState] = useState(''); // '' | 'saving' | 'saved'
  const saveTimerRef = useRef(null);

  useEffect(() => {
    if (!activeProjectId && projects.length > 0) {
      onSelectProjectId(projects[0].id);
    }
  }, [activeProjectId, projects]);

  useEffect(() => {
    if (!activeProjectId) {
      setProjectDetail(null);
      return;
    }
    let active = true;
    setLoadingProject(true);
    apiRequest(`/projects/${activeProjectId}`)
      .then((data) => {
        if (active) setProjectDetail(data);
      })
      .catch(() => {
        if (active) setProjectDetail(null);
      })
      .finally(() => {
        if (active) setLoadingProject(false);
      });
    return () => {
      active = false;
    };
  }, [activeProjectId]);

  // Drag Resizer antara Peta & Tabel Atribut
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizingRef.current) return;
      const nextHeight = window.innerHeight - e.clientY;
      if (nextHeight >= 120 && nextHeight <= window.innerHeight * 0.65) {
        setDrawerHeight(nextHeight);
      }
    };
    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = '';
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const selectedLayerMeta = useMemo(
    () => layers.find((l) => l.slug === activeLayerSlug) || layers[0] || null,
    [layers, activeLayerSlug]
  );

  const activeLayersCount = useMemo(
    () => layers.filter((l) => l.has_data).length,
    [layers]
  );

  // Helper inisialisasi kolom dari hasil clip
  const buildOrderedColsFromRes = (res) => {
    const adminEnabledCols = (res.available_columns || []).filter(
      (c) => c.selected !== false
    );
    return [
      {
        key: '_no',
        original_name: 'NOMOR',
        label: 'Nomor',
        selected: true,
        isSystem: true,
        isTechnical: false,
      },
      ...adminEnabledCols.map((c) => {
        const upperName = String(c.original_name).toUpperCase();
        return {
          key: c.original_name,
          original_name: c.original_name,
          label: c.default_alias || c.original_name,
          selected: true,
          isSystem: false,
          isTechnical: TECHNICAL_NON_GROUP_COLS.has(upperName),
        };
      }),
      {
        key: '_luas_ha',
        original_name: 'LUAS_HA',
        label: 'Luas (Ha)',
        selected: true,
        isSystem: true,
        isTechnical: false,
      },
      {
        key: '_persen_aoi',
        original_name: 'PERSEN_AOI',
        label: 'Persentase AOI (%)',
        selected: true,
        isSystem: true,
        isTechnical: false,
      },
    ];
  };

  // Helper simpan permanen pengaturan kolom & preferensi ke PostgreSQL (debounced)
  const schedulePersistLayerSettings = (projId, slug, payload) => {
    if (!projId || !slug) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSavingSettingsState('saving');
    saveTimerRef.current = setTimeout(async () => {
      try {
        await apiRequest(`/projects/${projId}/clip/${slug}/settings`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setSavingSettingsState('saved');
        setTimeout(() => setSavingSettingsState(''), 2000);
      } catch {
        setSavingSettingsState('');
      }
    }, 350);
  };

  // Pastikan data Administrasi Wilayah selalu dimuat untuk Peta di Tab Ringkasan Project
  useEffect(() => {
    if (!projectDetail) return;
    const adminLayerMeta = layers.find((l) => l.slug === 'administrasi_wilayah');
    if (!adminLayerMeta || !adminLayerMeta.has_data) return;

    const adminCacheKey = `${projectDetail.id}__administrasi_wilayah`;
    if (clipCache[adminCacheKey]) return;

    let active = true;
    apiRequest(`/projects/${projectDetail.id}/clip/administrasi_wilayah`)
      .then((res) => {
        if (!active) return;
        setClipCache((prev) => ({ ...prev, [adminCacheKey]: res }));
        const initialCols =
          Array.isArray(res.saved_custom_columns) && res.saved_custom_columns.length > 0
            ? res.saved_custom_columns
            : buildOrderedColsFromRes(res);
        setCustomColumnsByLayer((prev) => ({
          ...prev,
          [adminCacheKey]: prev[adminCacheKey] || initialCols,
        }));
      })
      .catch(() => {
        // ignore background preload error
      });

    return () => {
      active = false;
    };
  }, [projectDetail, layers]);

  const loadOrClipLayer = (projId, slug, force = false) => {
    const cacheKey = `${projId}__${slug}`;
    setLoadingClip(true);
    setClipError('');

    apiRequest(`/projects/${projId}/clip/${slug}${force ? '?force=true' : ''}`)
      .then((res) => {
        setClipCache((prev) => ({ ...prev, [cacheKey]: res }));
        const initialCols =
          Array.isArray(res.saved_custom_columns) && res.saved_custom_columns.length > 0
            ? res.saved_custom_columns
            : buildOrderedColsFromRes(res);

        setCustomColumnsByLayer((prev) => ({
          ...prev,
          [cacheKey]: initialCols,
        }));

        // Terapkan preferensi tersimpan jika ada (tahun Hansen, atribut peta, sort)
        const prefs = res.saved_preferences || {};
        if (prefs.legend_attr_key) {
          setLegendAttrKey(prefs.legend_attr_key);
        }
        if (prefs.sort_config?.key) {
          setSortConfig(prefs.sort_config);
        }
        if (slug === 'deforestasi_hansen' && Array.isArray(prefs.selected_hansen_years)) {
          setSelectedHansenYears(prefs.selected_hansen_years);
        }
      })
      .catch((err) => {
        setClipError(err.message || 'Gagal memuat analisis layer ini.');
      })
      .finally(() => {
        setLoadingClip(false);
      });
  };

  // Muat hasil clipping tersimpan (atau jalankan clipping otomatis jika belum pernah disimpan)
  useEffect(() => {
    if (!projectDetail || !selectedLayerMeta) return;
    if (!selectedLayerMeta.has_data) {
      setClipError('');
      return;
    }

    const cacheKey = `${projectDetail.id}__${selectedLayerMeta.slug}`;
    if (clipCache[cacheKey]) {
      setClipError('');
      const prefs = clipCache[cacheKey]?.saved_preferences || {};
      if (prefs.legend_attr_key) setLegendAttrKey(prefs.legend_attr_key);
      if (prefs.sort_config?.key) setSortConfig(prefs.sort_config);
      return;
    }

    loadOrClipLayer(projectDetail.id, selectedLayerMeta.slug, false);
  }, [projectDetail, selectedLayerMeta]);

  const currentCacheKey =
    projectDetail && selectedLayerMeta
      ? `${projectDetail.id}__${selectedLayerMeta.slug}`
      : '';

  const activeLayerResult = currentCacheKey ? clipCache[currentCacheKey] : null;
  const activeColumns = currentCacheKey
    ? customColumnsByLayer[currentCacheKey] || []
    : [];

  // Data Administrasi Wilayah khusus untuk peta di Tab Ringkasan Project
  const adminCacheKey = projectDetail
    ? `${projectDetail.id}__administrasi_wilayah`
    : '';
  const adminLayerResult = adminCacheKey ? clipCache[adminCacheKey] : null;
  const adminColumns = adminCacheKey
    ? customColumnsByLayer[adminCacheKey] || []
    : [];

  // Daftar tahun unik pada data Deforestasi Hansen
  const availableHansenYears = useMemo(() => {
    if (selectedLayerMeta?.slug !== 'deforestasi_hansen' || !activeLayerResult?.rows) {
      return [];
    }
    const yearsSet = new Set();
    activeLayerResult.rows.forEach((r) => {
      if (r.TAHUN !== undefined && r.TAHUN !== null && r.TAHUN !== '') {
        yearsSet.add(Number(r.TAHUN));
      }
    });
    return Array.from(yearsSet).sort((a, b) => a - b);
  }, [selectedLayerMeta, activeLayerResult]);

  // Reset pilihan tahun Hansen hanya jika belum ada preferensi tersimpan di database
  useEffect(() => {
    if (selectedLayerMeta?.slug === 'deforestasi_hansen' && availableHansenYears.length > 0) {
      const savedYears = activeLayerResult?.saved_preferences?.selected_hansen_years;
      if (Array.isArray(savedYears)) {
        setSelectedHansenYears(savedYears);
      } else {
        setSelectedHansenYears(availableHansenYears);
      }
    } else {
      setSelectedHansenYears(null);
    }
  }, [currentCacheKey, availableHansenYears.length]);

  const selectableMapColumns = useMemo(
    () => activeColumns.filter((c) => c.key !== '_no'),
    [activeColumns]
  );

  const visibleColumns = useMemo(() => {
    return activeColumns.filter((c) => c.selected);
  }, [activeColumns]);

  const handleToggleColumn = (colKey) => {
    if (!currentCacheKey) return;
    setCustomColumnsByLayer((prev) => {
      const nextCols = (prev[currentCacheKey] || []).map((c) =>
        c.key === colKey ? { ...c, selected: !c.selected } : c
      );
      schedulePersistLayerSettings(projectDetail?.id, selectedLayerMeta?.slug, {
        custom_columns: nextCols,
      });
      return { ...prev, [currentCacheKey]: nextCols };
    });
  };

  const handleRenameColumn = (colKey, newLabel) => {
    if (!currentCacheKey) return;
    setCustomColumnsByLayer((prev) => {
      const nextCols = (prev[currentCacheKey] || []).map((c) =>
        c.key === colKey ? { ...c, label: newLabel } : c
      );
      schedulePersistLayerSettings(projectDetail?.id, selectedLayerMeta?.slug, {
        custom_columns: nextCols,
      });
      return { ...prev, [currentCacheKey]: nextCols };
    });
  };

  const handleMoveColumn = (fromIndex, toIndex) => {
    if (!currentCacheKey) return;
    const currentList = customColumnsByLayer[currentCacheKey] || [];
    if (toIndex < 0 || toIndex >= currentList.length) return;

    setCustomColumnsByLayer((prev) => {
      const nextCols = [...(prev[currentCacheKey] || [])];
      const [moved] = nextCols.splice(fromIndex, 1);
      nextCols.splice(toIndex, 0, moved);
      schedulePersistLayerSettings(projectDetail?.id, selectedLayerMeta?.slug, {
        custom_columns: nextCols,
      });
      return { ...prev, [currentCacheKey]: nextCols };
    });
  };

  const handleSelectAllColumns = (selectAll) => {
    if (!currentCacheKey) return;
    setCustomColumnsByLayer((prev) => {
      const nextCols = (prev[currentCacheKey] || []).map((c) => ({
        ...c,
        selected: selectAll ? !c.isTechnical : c.isSystem,
      }));
      schedulePersistLayerSettings(projectDetail?.id, selectedLayerMeta?.slug, {
        custom_columns: nextCols,
      });
      return { ...prev, [currentCacheKey]: nextCols };
    });
  };

  const handleSortColumn = (colKey) => {
    setSortConfig((prev) => {
      const nextSort =
        prev.key === colKey
          ? { key: colKey, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
          : { key: colKey, direction: 'asc' };
      schedulePersistLayerSettings(projectDetail?.id, selectedLayerMeta?.slug, {
        preferences: { sort_config: nextSort },
      });
      return nextSort;
    });
  };

  const updateSelectedHansenYearsAndSave = (nextYears) => {
    setSelectedHansenYears(nextYears);
    schedulePersistLayerSettings(projectDetail?.id, selectedLayerMeta?.slug, {
      preferences: { selected_hansen_years: nextYears },
    });
  };

  const processedRows = useMemo(() => {
    if (!activeLayerResult?.rows) return [];
    let rows = activeLayerResult.rows.map((r) => ({ ...r }));

    // Filter khusus tahun pada tabel Deforestasi Hansen
    if (
      selectedLayerMeta?.slug === 'deforestasi_hansen' &&
      Array.isArray(selectedHansenYears)
    ) {
      rows = rows.filter((r) => selectedHansenYears.includes(Number(r.TAHUN)));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      rows = rows.filter((r) =>
        visibleColumns.some((col) =>
          String(r[col.key] ?? '')
            .toLowerCase()
            .includes(q)
        )
      );
    }

    if (sortConfig.key && sortConfig.key !== '_no') {
      const { key, direction } = sortConfig;
      const factor = direction === 'asc' ? 1 : -1;

      rows = [...rows].sort((a, b) => {
        const valA = a[key];
        const valB = b[key];

        const numA = Number(valA);
        const numB = Number(valB);
        if (
          valA !== null &&
          valA !== '' &&
          valB !== null &&
          valB !== '' &&
          !Number.isNaN(numA) &&
          !Number.isNaN(numB)
        ) {
          return (numA - numB) * factor;
        }

        return (
          String(valA ?? '').localeCompare(String(valB ?? ''), 'id-ID', {
            numeric: true,
            sensitivity: 'base',
          }) * factor
        );
      });
    }

    let numberedRows = rows.map((r, idx) => ({
      ...r,
      _no: idx + 1,
    }));

    if (sortConfig.key === '_no' && sortConfig.direction === 'desc') {
      numberedRows = [...numberedRows].reverse();
    }

    return numberedRows;
  }, [
    activeLayerResult,
    selectedLayerMeta,
    selectedHansenYears,
    visibleColumns,
    searchQuery,
    sortConfig,
  ]);

  const handleExport = async (format) => {
    if (!activeLayerResult) return;
    try {
      await downloadTableExport({
        layer_name: `${projectDetail?.project_code || 'AOI'}_${activeLayerResult.layer_name}`,
        format,
        columns: visibleColumns.map((c) => ({
          key: c.key,
          label: c.label.trim() || c.original_name,
        })),
        rows: processedRows,
      });
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

  if (projects.length === 0) {
    return (
      <div className="flex-1 p-12 flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 max-w-md w-full text-center space-y-4 shadow-xs">
          <FolderKanban className="w-9 h-9 text-indigo-600 mx-auto" />
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            Belum Ada Project yang Dipilih
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Silakan buat project baru dengan mengunggah SHP Areal Kerja (AOI) terlebih dahulu.
          </p>
          <button
            type="button"
            onClick={onOpenNewProject}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs inline-flex items-center gap-1.5 transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Buat Project Baru</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50 dark:bg-slate-950">
      {/* =====================================================================
          TOP BAR WORKSPACE: ACTIVE PROJECT SELECTOR & 4 MENU UTAMA WORKFLOW
          ===================================================================== */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0 z-20">
        {/* Kiri: Tombol Kembali ke Dashboard + Selector Project Aktif */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBackToDashboard}
            className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
            title="Kembali ke Dashboard Project"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5">
            <span className="px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-mono font-bold text-[11px] rounded">
              {projectDetail?.project_code || '...'}
            </span>
            <select
              value={activeProjectId || ''}
              onChange={(e) => onSelectProjectId(Number(e.target.value))}
              className="bg-transparent text-xs font-bold text-slate-900 dark:text-white focus:outline-none cursor-pointer pr-1"
            >
              {projects.map((p) => (
                <option
                  key={p.id}
                  value={p.id}
                  className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                >
                  {p.name}
                </option>
              ))}
            </select>
            <span className="ml-1 pl-2.5 border-l border-slate-200 dark:border-slate-700 font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
              {formatHa(projectDetail?.aoi_area_ha)}
            </span>
          </div>
        </div>

        {/* Kanan: 4 MENU UTAMA WORKFLOW */}
        <nav className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200/80 dark:border-slate-700 overflow-x-auto">
          {[
            { key: 'ringkasan', num: 1, label: 'Ringkasan Project' },
            { key: 'biofisik', num: 2, label: 'Analisis Biofisik' },
            { key: 'kelayakan', num: 3, label: 'Analisis Kelayakan' },
            { key: 'karbon', num: 4, label: 'Analisis Kredit Karbon' },
          ].map((tab) => {
            const active = workspaceTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setWorkspaceTab(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                  active
                    ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span
                  className={`w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center ${
                    active
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {tab.num}
                </span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </header>

      {/* =====================================================================
          TAB 1: RINGKASAN PROJECT
          ===================================================================== */}
      {workspaceTab === 'ringkasan' && (
        <div className="flex-1 overflow-y-auto p-5 lg:p-6 bg-slate-50 dark:bg-slate-950">
          <div className="max-w-6xl mx-auto space-y-5">
            {/* Banner Status (Judul Halaman: 21px Bold, tracking -0.02em) */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-full text-[11px] font-semibold flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Geoprocessing Biofisik Aktif ({activeLayersCount}/14 Layer)
                  </span>
                  <span className="text-[12px] text-[#475569] font-mono tabular-nums">
                    {projectDetail?.aoi_filename}
                  </span>
                </div>
                <h2 className="text-[21px] font-bold tracking-[-0.02em] text-[#0F172A] dark:text-white mt-1.5">
                  Ringkasan Eksekutif — {projectDetail?.name}
                </h2>
                <p className="text-[13px] text-[#475569] dark:text-slate-400 mt-0.5">
                  Lokasi: {projectDetail?.location} &bull; Tanggal Upload:{' '}
                  <span className="font-mono tabular-nums">{projectDetail?.upload_date}</span>
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setWorkspaceTab('biofisik')}
                  className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs transition cursor-pointer"
                >
                  <MapIcon className="w-3.5 h-3.5" />
                  <span>Buka Peta Biofisik</span>
                </button>
              </div>
            </div>

            {/* 4 Kartu Metrik Utama (Angka KPI Utama: 26px Bold IBM Plex Sans Tabular-Nums) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                <span className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider">
                  Luas Lahan Total (AOI)
                </span>
                <div className="text-[26px] font-bold text-[#0F172A] dark:text-white font-mono tabular-nums mt-1">
                  {formatHa(projectDetail?.aoi_area_ha)}
                </div>
                <span className="text-[12px] text-[#475569] mt-1 block">
                  Poligon batas AOI tervalidasi di PostGIS
                </span>
              </div>

              <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                <span className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider">
                  Analisis Administrasi Wilayah
                </span>
                <div className="text-[26px] font-bold text-emerald-600 dark:text-emerald-400 font-mono tabular-nums mt-1">
                  {activeLayerResult ? `${activeLayerResult.total_features} Poligon` : 'Siap Analisis'}
                </div>
                <span className="text-[12px] text-emerald-700 dark:text-emerald-400 font-medium mt-1 block">
                  Tahap 1 Biofisik Aktif
                </span>
              </div>

              <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                <span className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider">
                  Luas Proyek Layak (Eligible)
                </span>
                <div className="text-[15px] font-bold text-[#475569] dark:text-slate-400 mt-2">
                  Menunggu 14 Biofisik
                </div>
                <span className="text-[12px] text-[#475569] mt-1 block">
                  Dihitung setelah seluruh metode biofisik selesai
                </span>
              </div>

              <div className="bg-[#0F172A] text-white p-4 rounded-2xl shadow-xs">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Estimasi Kredit Karbon
                </span>
                <div className="text-[15px] font-bold text-emerald-400 font-mono tabular-nums mt-2">
                  Menunggu Tahap Biofisik
                </div>
                <span className="text-[12px] text-slate-300 mt-1 block">
                  tCO₂e / tahun (SRN &amp; Verra)
                </span>
              </div>
            </div>

            {/* Preview Peta Administrasi Wilayah di Tab Ringkasan */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[14.5px] font-semibold text-[#0F172A] dark:text-white">
                  Peta Administrasi Wilayah — {projectDetail?.name}
                </h3>
                <span className="text-[12px] font-mono tabular-nums text-indigo-600 dark:text-indigo-400 font-bold">
                  {projectDetail?.location}
                </span>
              </div>
              <div className="h-80 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800">
                <MapComponent
                  aoiGeojson={projectDetail?.aoi_geojson}
                  clippedGeojson={adminLayerResult?.clipped_geojson}
                  activeColumns={adminColumns}
                  previewOnly={!adminLayerResult}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 2: ANALISIS BIOFISIK (SIDEBAR 14 LAYER + PETA + RESIZABLE TABEL)
          ===================================================================== */}
      {workspaceTab === 'biofisik' && (
        <div className="flex-1 flex overflow-hidden">
          {/* Panel Kiri: Daftar 14 Data Biofisik (Collapsible) */}
          <aside
            className={`${
              bioSidebarOpen ? 'w-72' : 'w-14 items-center'
            } bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col shrink-0 h-full overflow-hidden transition-all duration-200`}
          >
            <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-800/50 w-full">
              {bioSidebarOpen && (
                <>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    Data Biofisik (14)
                  </span>
                  <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                    {activeLayersCount} / 14 Tersedia
                  </span>
                </>
              )}
              <button
                type="button"
                onClick={() => setBioSidebarOpen(!bioSidebarOpen)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
                title={bioSidebarOpen ? 'Ciutkan Panel Biofisik' : 'Perluas Panel Biofisik'}
              >
                {bioSidebarOpen ? (
                  <PanelLeftClose className="w-4 h-4" />
                ) : (
                  <PanelLeftOpen className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* Daftar 14 Layer (Item Layer Sidebar: 13px Medium) */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 w-full">
              {layers.map((layer) => {
                const isActive = selectedLayerMeta?.slug === layer.slug;
                const dotColor = layer.has_data ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700';
                return (
                  <button
                    key={layer.slug}
                    type="button"
                    onClick={() => setActiveLayerSlug(layer.slug)}
                    title={`${layer.order_index}. ${layer.name}`}
                    className={`w-full flex items-center ${
                      bioSidebarOpen ? 'justify-between px-2.5' : 'justify-center px-1'
                    } py-2 rounded-xl text-left text-[13px] transition cursor-pointer ${
                      isActive
                        ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-200 font-semibold border border-indigo-200 dark:border-indigo-800'
                        : 'text-[#475569] dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-[#0F172A] font-medium border border-transparent'
                    }`}
                  >
                    {bioSidebarOpen ? (
                      <>
                        <span className="truncate pr-2">
                          <span className="font-mono tabular-nums mr-1">{layer.order_index}.</span>
                          {layer.name}
                        </span>
                        <span className={`w-2 h-2 rounded-full ${dotColor} shrink-0`} />
                      </>
                    ) : (
                      <span className="font-mono tabular-nums text-[12px]">{layer.order_index}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Legenda Status di Bawah Sidebar Layer */}
            {bioSidebarOpen && (
              <div className="p-2.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-[10px] text-slate-500 dark:text-slate-400 flex items-center justify-between w-full">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" /> Tersedia
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-400" /> 0 Ha
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-700" /> Kosong
                </span>
              </div>
            )}
          </aside>

          {/* Area Kanan: Split-Screen Peta Interaktif (Atas) + Tabel Atribut (Bawah) */}
          <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-100 dark:bg-slate-950">
            {/* Header Kontrol Layer Aktif di Atas Peta */}
            <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-[11px] font-semibold rounded-md border border-indigo-200 dark:border-indigo-800">
                  Active Layer
                </span>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  {selectedLayerMeta?.order_index}. {selectedLayerMeta?.name}
                </h2>
                {savingSettingsState === 'saving' && (
                  <span className="text-[11px] text-slate-400 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Menyimpan...
                  </span>
                )}
                {savingSettingsState === 'saved' && (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                    <Check className="w-3 h-3" /> Tersimpan
                  </span>
                )}
              </div>

              {selectedLayerMeta?.has_data && (
                <div className="flex flex-wrap items-center gap-2">
                  {/* Tombol Clip Ulang (Force Re-clip) */}
                  <button
                    type="button"
                    disabled={loadingClip}
                    onClick={() =>
                      projectDetail &&
                      selectedLayerMeta &&
                      loadOrClipLayer(projectDetail.id, selectedLayerMeta.slug, true)
                    }
                    title="Hitung ulang clipping dari database SHP/DEM terbaru"
                    className="px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${loadingClip ? 'animate-spin' : ''}`} />
                    <span>Clip Ulang</span>
                  </button>

                  {/* Dropdown Atribut Peta */}
                  {selectableMapColumns.length > 0 && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-slate-500 dark:text-slate-400">Atribut:</span>
                      <select
                        value={legendAttrKey}
                        onChange={(e) => {
                          const nextVal = e.target.value;
                          setLegendAttrKey(nextVal);
                          schedulePersistLayerSettings(
                            projectDetail?.id,
                            selectedLayerMeta?.slug,
                            { preferences: { legend_attr_key: nextVal } }
                          );
                        }}
                        className="px-2.5 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-medium text-slate-800 dark:text-slate-200 text-xs focus:outline-none"
                      >
                        {selectableMapColumns.map((col) => (
                          <option key={col.key} value={col.key}>
                            {col.label || col.original_name} ({col.original_name})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Toggle Label Peta */}
                  <button
                    type="button"
                    onClick={() => setShowMapLabels(!showMapLabels)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                      showMapLabels
                        ? 'bg-slate-900 dark:bg-indigo-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <Tag className="w-3 h-3" />
                    <span>{showMapLabels ? 'Label Aktif' : 'Label Nonaktif'}</span>
                  </button>

                  {/* Slider Transparansi / Opasitas */}
                  <div className="hidden sm:flex items-center gap-1.5 text-xs bg-slate-50 dark:bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700">
                    <span className="text-slate-500 dark:text-slate-400 text-[11px]">
                      Opasitas:
                    </span>
                    <input
                      type="range"
                      min="0.2"
                      max="1"
                      step="0.05"
                      value={layerOpacity}
                      onChange={(e) => setLayerOpacity( parseFloat(e.target.value) )}
                      className="clean-slider w-16"
                    />
                  </div>

                  {/* Tombol Buka/Tutup Pengaturan Susunan Kolom */}
                  <button
                    type="button"
                    onClick={() => setShowColumnCustomizer(!showColumnCustomizer)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition cursor-pointer ${
                      showColumnCustomizer
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>Susun Kolom ({visibleColumns.length})</span>
                  </button>

                  {/* Toggle Buka/Tutup Tabel Atribut */}
                  <button
                    type="button"
                    onClick={() => setTableDrawerOpen(!tableDrawerOpen)}
                    className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Table2 className="w-3.5 h-3.5" />
                    <span>Tabel Atribut</span>
                  </button>
                </div>
              )}
            </div>

            {/* Jika Database Layer Belum Aktif -> Tampilkan Pemberitahuan di Atas Peta */}
            {selectedLayerMeta && !selectedLayerMeta.has_data && (
              <div className="m-4 p-4 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-2xl flex flex-wrap items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                  <div className="text-xs">
                    <span className="font-bold text-slate-900 dark:text-white block">
                      Database &ldquo;{selectedLayerMeta.name}&rdquo; Belum Tersedia / Belum Aktif
                    </span>
                    <span className="text-slate-600 dark:text-slate-300">
                      Saat ini analisis data baru aktif pada database yang bertanda hijau (seperti Administrasi Wilayah).
                    </span>
                  </div>
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={onGoToAdminLayers}
                    className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Database className="w-3.5 h-3.5" />
                    <span>Kelola Database SHP</span>
                  </button>
                )}
              </div>
            )}

            {/* Modal/Panel Susun Kolom (Jika Dibuka) */}
            {showColumnCustomizer && selectedLayerMeta?.has_data && (
              <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-3.5 space-y-2.5 shrink-0 max-h-52 overflow-y-auto">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800 dark:text-white">
                    Pengaturan Urutan &amp; Nama Kolom (Kolom 1, Kolom 2, dst.)
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleSelectAllColumns(true)}
                      className="text-indigo-600 font-semibold hover:underline cursor-pointer"
                    >
                      Centang Semua
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectAllColumns(false)}
                      className="text-slate-500 font-semibold hover:underline cursor-pointer"
                    >
                      Sembunyikan Atribut
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                  {activeColumns.map((col, idx) => (
                    <div
                      key={col.key}
                      className={`p-2 rounded-xl border text-xs flex flex-col gap-1.5 ${
                        col.selected
                          ? 'bg-slate-50 dark:bg-slate-800 border-indigo-200 dark:border-indigo-800'
                          : 'bg-slate-50/40 dark:bg-slate-900 border-slate-200 dark:border-slate-800 opacity-55'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <select
                          value={idx}
                          onChange={(e) => handleMoveColumn(idx, Number(e.target.value))}
                          className="px-1.5 py-0.5 rounded bg-indigo-600 text-white font-bold text-[10px] cursor-pointer"
                        >
                          {activeColumns.map((_, orderIdx) => (
                            <option key={orderIdx} value={orderIdx}>
                              Kolom {orderIdx + 1}
                            </option>
                          ))}
                        </select>
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => handleMoveColumn(idx, idx - 1)}
                            className="p-0.5 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowLeft className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === activeColumns.length - 1}
                            onClick={() => handleMoveColumn(idx, idx + 1)}
                            className="p-0.5 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={col.selected}
                          onChange={() => handleToggleColumn(col.key)}
                          className="rounded border-slate-300 text-indigo-600"
                        />
                        <span className="font-mono text-[10px] text-slate-500 truncate">
                          {col.original_name}
                        </span>
                      </label>

                      <input
                        type="text"
                        value={col.label}
                        onChange={(e) => handleRenameColumn(col.key, e.target.value)}
                        className="w-full px-2 py-1 text-[11px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* KANVAS PETA LEAFLET */}
            <div className="flex-1 relative min-h-[140px] w-full">
              {(loadingClip || loadingProject) && (
                <div className="absolute inset-0 z-30 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xs flex flex-col items-center justify-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
                  <span>
                    Memproses Clipping Spasial &ldquo;{selectedLayerMeta?.name}&rdquo;...
                  </span>
                </div>
              )}

              <MapComponent
                aoiGeojson={projectDetail?.aoi_geojson}
                clippedGeojson={
                  selectedLayerMeta?.has_data
                    ? activeLayerResult?.clipped_geojson
                    : null
                }
                activeColumns={activeColumns}
                previewOnly={!selectedLayerMeta?.has_data}
                legendAttrKey={legendAttrKey}
                onChangeLegendAttrKey={setLegendAttrKey}
                showMapLabels={showMapLabels}
                opacity={layerOpacity}
                zoomTargetGid={zoomTargetGid}
              />
            </div>

            {/* RESIZER HANDLE ANTARA PETA & TABEL ATRIBUT */}
            {tableDrawerOpen && selectedLayerMeta?.has_data && (
              <>
                <div
                  onMouseDown={() => {
                    isResizingRef.current = true;
                    document.body.style.cursor = 'row-resize';
                  }}
                  className="h-2 bg-slate-200 dark:bg-slate-800 hover:bg-indigo-500 cursor-row-resize flex items-center justify-center transition-colors shrink-0"
                  title="Tarik ke atas/bawah untuk mengubah tinggi tabel"
                >
                  <div className="w-10 h-1 rounded-full bg-slate-400" />
                </div>

                {/* PANEL BAWAH: TABEL ATRIBUT INTERAKTIF */}
                <div
                  style={{ height: `${drawerHeight}px` }}
                  className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex flex-col shrink-0 max-h-[55vh]"
                >
                  {/* Toolbar Tabel */}
                  <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/60 dark:bg-slate-800/40 shrink-0">
                    <div>
                      <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                        Tabel Atribut: {selectedLayerMeta?.name}
                      </h3>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">
                        Menampilkan {processedRows.length} baris dari{' '}
                        {activeLayerResult?.total_features || 0} poligon terpotong AOI.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {/* Dropdown Filter Tahun Khusus Tabel Deforestasi Hansen */}
                      {selectedLayerMeta?.slug === 'deforestasi_hansen' &&
                        availableHansenYears.length > 0 && (
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() =>
                                setHansenYearDropdownOpen(!hansenYearDropdownOpen)
                              }
                              className="flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-indigo-400 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-[#0F172A] dark:text-slate-200 transition cursor-pointer"
                            >
                              <span className="text-[#475569] dark:text-slate-400 font-medium">
                                Tahun:
                              </span>
                              <span className="font-mono tabular-nums text-indigo-700 dark:text-indigo-300">
                                {(selectedHansenYears || []).length ===
                                availableHansenYears.length
                                  ? `Semua (${availableHansenYears.length})`
                                  : (selectedHansenYears || []).length === 0
                                  ? 'Tidak ada'
                                  : (selectedHansenYears || []).length <= 2
                                  ? (selectedHansenYears || []).join(', ')
                                  : `${(selectedHansenYears || []).length} tahun dipilih`}
                              </span>
                              <ArrowDown className="w-3 h-3 text-[#475569]" />
                            </button>

                            {hansenYearDropdownOpen && (
                              <div className="absolute right-0 mt-1.5 w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl p-2.5 z-40 space-y-2 text-[12px]">
                                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-1.5">
                                  <span className="font-bold text-[#0F172A] dark:text-white text-[11px]">
                                    Pilih Tahun Tabel
                                  </span>
                                  <div className="flex items-center gap-1.5 text-[11px]">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateSelectedHansenYearsAndSave(availableHansenYears)
                                      }
                                      className="text-indigo-600 font-semibold hover:underline cursor-pointer"
                                    >
                                      Semua
                                    </button>
                                    <span className="text-slate-300">|</span>
                                    <button
                                      type="button"
                                      onClick={() => updateSelectedHansenYearsAndSave([])}
                                      className="text-[#475569] font-semibold hover:underline cursor-pointer"
                                    >
                                      Reset
                                    </button>
                                  </div>
                                </div>

                                <div className="max-h-44 overflow-y-auto space-y-1">
                                  {availableHansenYears.map((yr) => {
                                    const isChecked = (
                                      selectedHansenYears || []
                                    ).includes(yr);
                                    return (
                                      <label
                                        key={yr}
                                        className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer text-[#0F172A] dark:text-slate-200 font-mono tabular-nums"
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={() => {
                                            const cur = selectedHansenYears || [];
                                            const next = cur.includes(yr)
                                              ? cur.filter((y) => y !== yr)
                                              : [...cur, yr].sort((a, b) => a - b);
                                            updateSelectedHansenYearsAndSave(next);
                                          }}
                                          className="rounded border-slate-300 text-indigo-600"
                                        />
                                        <span>Tahun {yr}</span>
                                      </label>
                                    );
                                  })}
                                </div>

                                <button
                                  type="button"
                                  onClick={() => setHansenYearDropdownOpen(false)}
                                  className="w-full py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[#0F172A] dark:text-slate-200 font-semibold text-[11px] hover:bg-slate-200 transition cursor-pointer"
                                >
                                  Selesai
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                      {/* Sort By */}
                      <div className="hidden md:flex items-center gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1 rounded-lg text-[11px]">
                        <span className="text-slate-400">Sort:</span>
                        <select
                          value={sortConfig.key || ''}
                          onChange={(e) =>
                            setSortConfig((prev) => ({
                              ...prev,
                              key: e.target.value,
                            }))
                          }
                          className="bg-transparent font-semibold text-slate-800 dark:text-slate-200 focus:outline-none"
                        >
                          {visibleColumns.map((col) => (
                            <option key={col.key} value={col.key}>
                              {col.label || col.original_name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() =>
                            setSortConfig((prev) => ({
                              ...prev,
                              direction: prev.direction === 'asc' ? 'desc' : 'asc',
                            }))
                          }
                          className="px-1.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold cursor-pointer"
                        >
                          {sortConfig.direction === 'asc' ? '↑' : '↓'}
                        </button>
                      </div>

                      {/* Cari Atribut */}
                      <div className="relative">
                        <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-2" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Cari atribut..."
                          className="pl-7 pr-2.5 py-1 text-[11px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg w-36 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => handleExport('xlsx')}
                        className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer"
                      >
                        <FileSpreadsheet className="w-3 h-3" />
                        <span>Export Excel</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExport('csv')}
                        className="px-2 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer"
                      >
                        <Download className="w-3 h-3" />
                        <span>CSV</span>
                      </button>
                    </div>
                  </div>

                  {/* Kontainer Tabel (Isi Tabel 12px & Baris Total Selalu Terlihat di Bawah) */}
                  <div className="flex-1 min-h-0 overflow-auto">
                    <table className="w-full text-left text-[12px] border-collapse">
                      <thead className="bg-slate-50 dark:bg-slate-800/80 text-[#475569] dark:text-slate-300 sticky top-0 z-10 border-b border-slate-200 dark:border-slate-700 text-[12px]">
                        <tr>
                          {visibleColumns.map((col, cIdx) => {
                            const isSorted = sortConfig.key === col.key;
                            const isArea =
                              col.key === '_luas_ha' || col.key === '_persen_aoi';
                            return (
                              <th
                                key={col.key}
                                onClick={() => handleSortColumn(col.key)}
                                className={`py-2.5 px-4 font-semibold cursor-pointer select-none hover:bg-slate-100 dark:hover:bg-slate-800 transition ${
                                  isArea ? 'text-right' : ''
                                }`}
                              >
                                <div
                                  className={`flex items-center gap-1.5 ${
                                    isArea ? 'justify-end' : 'justify-between'
                                  }`}
                                >
                                  <span>
                                    <span className="font-mono tabular-nums text-[#475569] mr-1">
                                      #{cIdx + 1}
                                    </span>
                                    <span className="text-[#0F172A] dark:text-white">
                                      {col.label || col.original_name}
                                    </span>
                                  </span>
                                  <span>
                                    {isSorted ? (
                                      sortConfig.direction === 'asc' ? (
                                        <ArrowUp className="w-3 h-3 text-indigo-600" />
                                      ) : (
                                        <ArrowDown className="w-3 h-3 text-indigo-600" />
                                      )
                                    ) : (
                                      <ArrowUpDown className="w-3 h-3 text-slate-400" />
                                    )}
                                  </span>
                                </div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-[12px]">
                        {processedRows.map((row, rIdx) => (
                          <tr
                            key={rIdx}
                            onClick={() => {
                              if (row.gid !== undefined) setZoomTargetGid(row.gid);
                            }}
                            className="hover:bg-indigo-50/50 dark:hover:bg-indigo-950/30 cursor-pointer transition"
                          >
                            {visibleColumns.map((col) => {
                              const val = row[col.key];
                              const isNo = col.key === '_no';
                              const isHa = col.key === '_luas_ha';
                              const isPct = col.key === '_persen_aoi';
                              const isYearCol = String(col.key).toUpperCase().includes('TAHUN');
                              const isNumeric = typeof val === 'number' || isNo || isHa || isPct;
                              return (
                                <td
                                  key={col.key}
                                  className={`py-2 px-4 ${
                                    isNumeric ? 'font-mono tabular-nums' : ''
                                  } ${
                                    isNo
                                      ? 'text-[#475569]'
                                      : isHa
                                      ? 'font-bold text-[#0F172A] dark:text-white text-right'
                                      : isPct
                                      ? 'font-semibold text-indigo-700 dark:text-indigo-400 text-right'
                                      : 'text-[#0F172A] dark:text-slate-200 font-medium'
                                  }`}
                                >
                                  {val !== undefined && val !== null && val !== ''
                                    ? typeof val === 'number' && !isNo && !isYearCol
                                      ? val.toLocaleString('id-ID', {
                                          minimumFractionDigits: isHa || isPct ? 2 : 0,
                                          maximumFractionDigits: 2,
                                        }) + (isPct ? '%' : '')
                                      : String(val)
                                    : '-'}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                      {/* BARIS TOTAL DI BAGIAN BAWAH TABEL ANALISIS */}
                      <tfoot className="bg-slate-100 dark:bg-slate-800 font-bold text-[#0F172A] dark:text-white sticky bottom-0 z-10 border-t-2 border-slate-200 dark:border-slate-700 text-[12px]">
                        <tr>
                          {visibleColumns.map((col, idx) => {
                            if (col.key === '_luas_ha') {
                              const sumHa = processedRows.reduce(
                                (acc, r) => acc + Number(r._luas_ha || 0),
                                0
                              );
                              return (
                                <td
                                  key={col.key}
                                  className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-[#0F172A] dark:text-white"
                                >
                                  {sumHa.toLocaleString('id-ID', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}{' '}
                                  Ha
                                </td>
                              );
                            }
                            if (col.key === '_persen_aoi') {
                              const sumPct = processedRows.reduce(
                                (acc, r) => acc + Number(r._persen_aoi || 0),
                                0
                              );
                              return (
                                <td
                                  key={col.key}
                                  className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-indigo-700 dark:text-indigo-300"
                                >
                                  {sumPct.toLocaleString('id-ID', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}
                                  %
                                </td>
                              );
                            }
                            return (
                              <td
                                key={col.key}
                                className="py-2.5 px-4 text-[#0F172A] dark:text-white font-semibold"
                              >
                                {idx === 0 ? (
                                  <span>
                                    Total (
                                    <span className="font-mono tabular-nums">
                                      {processedRows.length}
                                    </span>{' '}
                                    baris)
                                  </span>
                                ) : (
                                  ''
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 3: ANALISIS KELAYAKAN (KERANGKA REFERENSI - TAHAP BERIKUTNYA)
          ===================================================================== */}
      {workspaceTab === 'kelayakan' && (
        <div className="flex-1 overflow-y-auto p-5 lg:p-6 bg-slate-50 dark:bg-slate-950">
          <div className="max-w-6xl mx-auto space-y-5">
            <div className="p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                <div className="text-xs">
                  <span className="font-bold text-slate-900 dark:text-white block">
                    Modul Analisis Kelayakan (*Feasibility Assessment*) — Menunggu Seluruh Metode Biofisik Selesai
                  </span>
                  <span className="text-slate-600 dark:text-slate-300">
                    Saat ini logika sistem berfokus pada penyelesaian Analisis Biofisik (Tahap 1: Administrasi Wilayah). Perhitungan otomatis kelayakan akan diaktifkan setelah ke-14 analisis biofisik selesai.
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setWorkspaceTab('biofisik')}
                className="px-3 py-1.5 bg-indigo-600 text-white rounded-xl text-xs font-semibold shrink-0 cursor-pointer"
              >
                Ke Analisis Biofisik
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 opacity-75">
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3">
                <div className="flex items-center gap-2.5 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-600 flex items-center justify-center">
                    <Scale className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      1. Legalitas Lahan &amp; Kepemilikan Hak Karbon
                    </h3>
                    <span className="text-[11px] text-slate-400">
                      Kesesuaian Permen LHK NEK &amp; Verra Title to Carbon
                    </span>
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  Akan dihitung otomatis dari hasil tumpang susun Fungsi Kawasan Hutan &amp; Batas Administrasi.
                </p>
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3">
                <div className="flex items-center gap-2.5 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950 text-emerald-600 flex items-center justify-center">
                    <Users className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      2. Sosial, Tenurial &amp; Safeguards (FPIC)
                    </h3>
                    <span className="text-[11px] text-slate-400">
                      Identifikasi desa sekitar hutan &amp; klaim tenurial
                    </span>
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  Menggunakan daftar Desa/Kecamatan hasil clip Administrasi Wilayah ({activeLayerResult?.total_features || 0} poligon teridentifikasi).
                </p>
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3">
                <div className="flex items-center gap-2.5 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950 text-amber-600 flex items-center justify-center">
                    <ShieldAlert className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      3. Penilaian Risiko Non-Permanensi (*Buffer Risk*)
                    </h3>
                    <span className="text-[11px] text-slate-400">
                      AFOLU Non-Permanence Risk Assessment
                    </span>
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  Akan dihitung otomatis setelah layer Kebakaran Lahan, Kelerengan, dan Deforestasi aktif.
                </p>
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3">
                <div className="flex items-center gap-2.5 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center">
                    <Banknote className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      4. Estimasi Kelayakan Finansial
                    </h3>
                    <span className="text-[11px] text-slate-400">
                      Proyeksi CAPEX, OPEX &amp; IRR Proyek
                    </span>
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  Akan diaktifkan setelah modul Analisis Kredit Karbon selesai.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 4: ANALISIS KREDIT KARBON (KERANGKA REFERENSI - TAHAP BERIKUTNYA)
          ===================================================================== */}
      {workspaceTab === 'karbon' && (
        <div className="flex-1 overflow-y-auto p-5 lg:p-6 bg-slate-50 dark:bg-slate-950">
          <div className="max-w-6xl mx-auto space-y-5">
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Pemodelan &amp; Simulasi Kredit Karbon (NER / VCU / SPE-GRK)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Metode perhitungan stok karbon &amp; faktor emisi akan dikerjakan setelah seluruh 14 metode analisis biofisik selesai.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setWorkspaceTab('biofisik')}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shrink-0 cursor-pointer"
              >
                Kembali ke Analisis Biofisik
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
