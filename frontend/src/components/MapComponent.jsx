import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';

const CATEGORY_PALETTE = [
  '#4f46e5', // indigo
  '#0d9488', // teal
  '#d97706', // amber
  '#059669', // emerald
  '#7c3aed', // violet
  '#0284c7', // sky
  '#e11d48', // rose
  '#65a30d', // lime
  '#2563eb', // blue
  '#ea580c', // orange
  '#9333ea', // purple
  '#ca8a04', // yellow
];

export default function MapComponent({
  aoiGeojson,
  clippedGeojson,
  activeColumns = [],
  previewOnly = false,
  legendAttrKey: externalLegendAttrKey,
  onChangeLegendAttrKey,
  showMapLabels = false,
  opacity = 0.75,
  zoomTargetGid = null,
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const aoiLayerRef = useRef(null);
  const clippedLayerRef = useRef(null);
  const tileLayerRef = useRef(null);
  const featureLayersByGidRef = useRef({});
  const categoryBoundsMapRef = useRef({});

  const [basemap, setBasemap] = useState('osm');
  const [internalLegendKey, setInternalLegendKey] = useState('');

  const selectableMapColumns = useMemo(
    () => (activeColumns || []).filter((c) => c.key !== '_no'),
    [activeColumns]
  );

  const legendAttrKey =
    externalLegendAttrKey !== undefined ? externalLegendAttrKey : internalLegendKey;

  useEffect(() => {
    if (selectableMapColumns.length > 0) {
      const nonSystem = selectableMapColumns.filter((c) => !c.isSystem);
      const preferred = nonSystem[0]?.key || selectableMapColumns[0]?.key || '';
      if (!legendAttrKey || !selectableMapColumns.some((c) => c.key === legendAttrKey)) {
        if (onChangeLegendAttrKey) {
          onChangeLegendAttrKey(preferred);
        } else {
          setInternalLegendKey(preferred);
        }
      }
    }
  }, [selectableMapColumns]);

  // Hitung kategori unik & warnanya untuk Kotak Legenda Mengambang
  const legendData = useMemo(() => {
    const features = clippedGeojson?.features || [];
    if (!features.length || !legendAttrKey) {
      return { colorMap: new Map(), items: [] };
    }

    const statsMap = new Map();
    features.forEach((f) => {
      const props = f.properties || {};
      const rawVal = props[legendAttrKey];
      const valStr =
        rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== ''
          ? String(rawVal).trim()
          : 'Tidak Diketahui';
      const luas = Number(props._luas_ha || 0);

      if (!statsMap.has(valStr)) {
        statsMap.set(valStr, { value: valStr, count: 1, luas_ha: luas });
      } else {
        const cur = statsMap.get(valStr);
        cur.count += 1;
        cur.luas_ha = Number((cur.luas_ha + luas).toFixed(2));
      }
    });

    const sortedItems = Array.from(statsMap.values()).sort((a, b) =>
      a.value.localeCompare(b.value, 'id-ID', {
        numeric: true,
        sensitivity: 'base',
      })
    );

    const colorMap = new Map();
    const items = sortedItems.map((item, idx) => {
      const color = CATEGORY_PALETTE[idx % CATEGORY_PALETTE.length];
      colorMap.set(item.value, color);
      return { ...item, color };
    });

    return { colorMap, items };
  }, [clippedGeojson, legendAttrKey]);

  const activeLegendColLabel = useMemo(() => {
    const found = selectableMapColumns.find((c) => c.key === legendAttrKey);
    return found ? found.label || found.original_name : 'Kategori';
  }, [selectableMapColumns, legendAttrKey]);

  // Inisialisasi Peta Leaflet
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [-2.5, 118.0],
      zoom: 5,
      zoomControl: true,
    });

    tileLayerRef.current = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }
    ).addTo(map);

    mapInstanceRef.current = map;

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Ganti Basemap
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    if (basemap === 'satellite') {
      tileLayerRef.current = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: 'Tiles &copy; Esri',
          maxZoom: 19,
        }
      ).addTo(map);
    } else {
      tileLayerRef.current = L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 19,
        }
      ).addTo(map);
    }
  }, [basemap]);

  // Update Opasitas secara real-time saat slider digeser
  useEffect(() => {
    if (clippedLayerRef.current) {
      clippedLayerRef.current.eachLayer((layer) => {
        if (layer.setStyle) {
          layer.setStyle({ fillOpacity: opacity });
        }
      });
    }
  }, [opacity]);

  // Zoom ke poligon saat baris tabel diklik
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !zoomTargetGid) return;
    const targetLayer = featureLayersByGidRef.current[zoomTargetGid];
    if (targetLayer && targetLayer.getBounds) {
      map.fitBounds(targetLayer.getBounds(), { padding: [60, 60], maxZoom: 13 });
      targetLayer.openPopup();
    }
  }, [zoomTargetGid]);

  // Render AOI & Hasil Clipping
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (aoiLayerRef.current) {
      map.removeLayer(aoiLayerRef.current);
      aoiLayerRef.current = null;
    }
    if (clippedLayerRef.current) {
      map.removeLayer(clippedLayerRef.current);
      clippedLayerRef.current = null;
    }
    featureLayersByGidRef.current = {};
    categoryBoundsMapRef.current = {};

    const hasClipped =
      clippedGeojson &&
      clippedGeojson.features &&
      clippedGeojson.features.length > 0;

    if (hasClipped) {
      clippedLayerRef.current = L.geoJSON(clippedGeojson, {
        style: (feature) => {
          const props = feature?.properties || {};
          const rawVal = legendAttrKey ? props[legendAttrKey] : null;
          const valStr =
            rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== ''
              ? String(rawVal).trim()
              : 'Tidak Diketahui';
          const fillColor =
            legendData.colorMap.get(valStr) || CATEGORY_PALETTE[0];

          return {
            color: '#1e293b',
            weight: 1.3,
            fillColor,
            fillOpacity: opacity,
          };
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties || {};
          if (props.gid !== undefined) {
            featureLayersByGidRef.current[props.gid] = layer;
          }

          const rawVal = legendAttrKey ? props[legendAttrKey] : null;
          const valStr =
            rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== ''
              ? String(rawVal).trim()
              : 'Tidak Diketahui';

          if (!categoryBoundsMapRef.current[valStr]) {
            categoryBoundsMapRef.current[valStr] = [];
          }
          categoryBoundsMapRef.current[valStr].push(layer);

          if (showMapLabels && legendAttrKey) {
            const labelVal = props[legendAttrKey];
            if (labelVal !== undefined && labelVal !== null && String(labelVal).trim() !== '') {
              layer.bindTooltip(String(labelVal), {
                permanent: true,
                direction: 'center',
                className: 'map-polygon-label',
              });
            }
          }

          const selectedCols = selectableMapColumns.filter((c) => c.selected);
          const rowsHtml = selectedCols
            .map((col) => {
              const raw = props[col.key];
              const isYearCol = String(col.key).toUpperCase().includes('TAHUN');
              const val =
                raw !== undefined && raw !== null
                  ? typeof raw === 'number'
                    ? isYearCol
                      ? String(raw)
                      : raw.toLocaleString('id-ID')
                    : raw
                  : '-';
              return `<div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px solid #f1f5f9;">
                <span style="color:#64748b;font-size:11px;">${col.label || col.original_name}:</span>
                <strong style="color:#0f172a;font-size:11px;text-align:right;">${val}</strong>
              </div>`;
            })
            .join('');

          layer.bindPopup(
            `<div style="padding:14px;font-size:12px;">
              <div style="border-bottom:1px solid #f1f5f9;padding-bottom:6px;margin-bottom:6px;">
                <span style="font-size:10px;font-family:monospace;color:#4f46e5;font-weight:700;">Poligon #${props._no || ''}</span>
                <h4 style="font-weight:700;color:#0f172a;font-size:13px;margin-top:2px;">${valStr}</h4>
              </div>
              <div>${rowsHtml}</div>
            </div>`
          );
        },
      }).addTo(map);
    }

    if (aoiGeojson && aoiGeojson.features && aoiGeojson.features.length > 0) {
      aoiLayerRef.current = L.geoJSON(aoiGeojson, {
        interactive: previewOnly,
        style: previewOnly
          ? {
              color: '#4f46e5',
              weight: 2,
              fillColor: '#4f46e5',
              fillOpacity: 0.2,
            }
          : {
              color: '#1e293b',
              weight: 1.3,
              fillOpacity: 0,
            },
      }).addTo(map);

      try {
        const bounds = aoiLayerRef.current.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [32, 32] });
        }
      } catch {
        // ignore bounds error
      }
    }
  }, [
    aoiGeojson,
    clippedGeojson,
    legendAttrKey,
    legendData,
    showMapLabels,
    selectableMapColumns,
    previewOnly,
  ]);

  const handleZoomToCategory = (categoryVal) => {
    const map = mapInstanceRef.current;
    const layersList = categoryBoundsMapRef.current[categoryVal];
    if (!map || !layersList || layersList.length === 0) return;

    const group = L.featureGroup(layersList);
    if (group.getBounds().isValid()) {
      map.fitBounds(group.getBounds(), { padding: [50, 50], maxZoom: 13 });
      layersList[0].openPopup();
    }
  };

  return (
    <div className="relative w-full h-full overflow-hidden">
      <div ref={mapContainerRef} className="w-full h-full z-10" />

      {/* Kotak Legenda Mengambang (Kiri Bawah Peta, Isi Legenda 12px) */}
      {!previewOnly && legendData.items.length > 0 && (
        <div className="absolute bottom-3 left-3 z-20 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xs rounded-2xl shadow-lg border border-slate-200 dark:border-slate-800 p-3.5 w-64 max-h-60 overflow-y-auto">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2 mb-2">
            <span className="text-[12px] font-bold text-[#0F172A] dark:text-white truncate">
              Legenda: {activeLegendColLabel}
            </span>
            <span className="text-[10px] text-[#475569] dark:text-slate-400 shrink-0 ml-2">
              Klik untuk zoom
            </span>
          </div>
          <div className="space-y-1 text-[12px]">
            {legendData.items.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => handleZoomToCategory(item.value)}
                className="w-full flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 p-1 rounded-lg transition cursor-pointer"
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  <span
                    className="w-3 h-3 rounded-xs shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                  <span
                    className="truncate text-[#0F172A] dark:text-slate-200 font-medium text-[12px]"
                    title={item.value}
                  >
                    {item.value}
                  </span>
                </div>
                <span className="font-mono tabular-nums text-[12px] text-[#475569] dark:text-slate-400 shrink-0">
                  {item.luas_ha.toLocaleString('id-ID', {
                    maximumFractionDigits: 1,
                  })}{' '}
                  Ha
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Kontrol Kanan Atas Peta (Basemap Switcher sesuai Referensi) */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
        <div className="bg-white/95 dark:bg-slate-900/95 rounded-lg shadow border border-slate-200 dark:border-slate-800 p-0.5 flex text-xs font-semibold">
          <button
            type="button"
            onClick={() => setBasemap('osm')}
            className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
              basemap === 'osm'
                ? 'bg-slate-900 dark:bg-indigo-600 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Peta Jalan
          </button>
          <button
            type="button"
            onClick={() => setBasemap('satellite')}
            className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
              basemap === 'satellite'
                ? 'bg-slate-900 dark:bg-indigo-600 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Satelit
          </button>
        </div>
      </div>
    </div>
  );
}
