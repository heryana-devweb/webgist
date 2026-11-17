const API_BASE = '/api';

export function getToken() {
  return localStorage.getItem('webgis_token');
}

export function setAuthData(token, user) {
  localStorage.setItem('webgis_token', token);
  localStorage.setItem('webgis_user', JSON.stringify(user));
}

export function clearAuthData() {
  localStorage.removeItem('webgis_token');
  localStorage.removeItem('webgis_user');
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem('webgis_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function apiRequest(endpoint, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (response.status === 401 && endpoint !== '/auth/login') {
    clearAuthData();
    window.location.reload();
    throw new Error('Sesi berakhir, silakan login kembali.');
  }

  if (!response.ok) {
    let errDetail = 'Terjadi kesalahan pada server.';
    try {
      const errData = await response.json();
      errDetail = errData.detail || errDetail;
    } catch {
      // ignore json parse error
    }
    throw new Error(errDetail);
  }

  return response.json();
}

export async function downloadTableExport({ layer_name, format, columns, rows }) {
  const token = getToken();
  const response = await fetch(`${API_BASE}/analysis/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ layer_name, format, columns, rows }),
  });

  if (!response.ok) {
    let errDetail = 'Gagal mengekspor tabel.';
    try {
      const errData = await response.json();
      errDetail = errData.detail || errDetail;
    } catch {
      // ignore
    }
    throw new Error(errDetail);
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = layer_name.toLowerCase().replace(/\s+/g, '_');
  a.href = url;
  a.download = `analisis_${safeName}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
