import React, { useEffect, useState } from 'react';
import {
  Database,
  Users,
  LogOut,
  ShieldCheck,
  User as UserIcon,
  Lock,
  LayoutGrid,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowRight,
  Sun,
  Moon,
} from 'lucide-react';
import {
  apiRequest,
  clearAuthData,
  getStoredUser,
  getToken,
  setAuthData,
} from './api';
import BrandLogo from './components/BrandLogo';
import DashboardView from './components/DashboardView';
import NewProjectView from './components/NewProjectView';
import AnalysisView from './components/AnalysisView';
import AdminLayersView from './components/AdminLayersView';
import AdminUsersView from './components/AdminUsersView';

export default function App() {
  const [user, setUser] = useState(getStoredUser());
  const [activeTab, setActiveTab] = useState('dashboard');
  const [layers, setLayers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Toggle Tema Siang (Light) & Malam (Dark)
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('webgis_theme') === 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem('webgis_theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('webgis_theme', 'light');
    }
  }, [darkMode]);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const fetchLayers = async () => {
    if (!getToken()) return;
    try {
      const data = await apiRequest('/layers');
      setLayers(data);
    } catch {
      // ignore
    }
  };

  const fetchProjects = async () => {
    if (!getToken()) return;
    try {
      const data = await apiRequest('/projects');
      setProjects(data);
      if (data.length > 0 && !activeProjectId) {
        setActiveProjectId(data[0].id);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (user) {
      fetchLayers();
      fetchProjects();
    }
  }, [user]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      const data = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setAuthData(data.access_token, data.user);
      setUser(data.user);
      setActiveTab('dashboard');
    } catch (err) {
      setLoginError(err.message || 'Gagal login.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    clearAuthData();
    setUser(null);
    setLayers([]);
    setProjects([]);
    setActiveProjectId(null);
  };

  // =======================================================================
  // 0. HALAMAN LOGIN MINIMALIS
  // =======================================================================
  if (!user) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4 overflow-y-auto transition-colors">
        <button
          type="button"
          onClick={() => setDarkMode(!darkMode)}
          className="fixed top-4 right-4 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[#0F172A] dark:text-slate-200 text-xs font-semibold flex items-center gap-2 shadow-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
        >
          {darkMode ? (
            <>
              <Sun className="w-4 h-4 text-amber-400" />
              <span>Tema Siang</span>
            </>
          ) : (
            <>
              <Moon className="w-4 h-4 text-[#475569]" />
              <span>Tema Malam</span>
            </>
          )}
        </button>

        <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl shadow-sm border border-slate-200/90 dark:border-slate-800 p-8 sm:p-9 transition-colors">
          <div className="flex flex-col items-center text-center mb-7">
            <div className="w-16 h-16 flex items-center justify-center mb-3">
              <BrandLogo darkMode={darkMode} className="w-16 h-16" />
            </div>
            <h1 className="text-[21px] font-bold text-[#0F172A] dark:text-white tracking-[-0.02em]">
              Selamat Datang
            </h1>
            <p className="text-xs text-[#475569] dark:text-slate-400 mt-1">
              WAS tCO Project &bull; PT. Wanantara Alesha Sadana
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-[#0F172A] dark:text-slate-300 block mb-1.5">
                Email / Username
              </label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-[#475569] absolute left-3.5 top-2.5" />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Masukkan email atau username"
                  className="w-full pl-10 pr-3.5 py-2.5 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-[#0F172A] dark:text-white rounded-xl focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#0F172A] dark:text-slate-300 block mb-1.5">
                Kata Sandi
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#475569] absolute left-3.5 top-2.5" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Masukkan kata sandi"
                  className="w-full pl-10 pr-3.5 py-2.5 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-[#0F172A] dark:text-white rounded-xl focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                />
              </div>
            </div>

            {loginError && (
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-600 dark:text-rose-300">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full mt-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-xs shadow-xs flex items-center justify-center gap-2 transition cursor-pointer"
            >
              <span>{loginLoading ? 'Memverifikasi...' : 'Masuk'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2 text-xs">
            <div className="text-[11px] font-medium text-[#475569] text-center">
              Klik untuk isi cepat akun uji coba:
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setUsername('admin');
                  setPassword('admin123');
                }}
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 hover:border-indigo-400 text-left transition cursor-pointer"
              >
                <div className="font-semibold text-[#0F172A] dark:text-slate-200 text-xs">
                  Admin GIS
                </div>
                <div className="text-[11px] font-mono tabular-nums text-[#475569] dark:text-slate-400">
                  admin / admin123
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setUsername('user');
                  setPassword('user123');
                }}
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 hover:border-indigo-400 text-left transition cursor-pointer"
              >
                <div className="font-semibold text-[#0F172A] dark:text-slate-200 text-xs">
                  User Biasa
                </div>
                <div className="text-[11px] font-mono tabular-nums text-[#475569] dark:text-slate-400">
                  user / user123
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isAdmin = user.role === 'admin';

  // =======================================================================
  // 1. LAYOUT UTAMA: SIDEBAR NAVIGASI + KANVAS FULL SCREEN
  // =======================================================================
  return (
    <div className="h-screen w-screen overflow-hidden flex bg-slate-50 dark:bg-slate-950 text-[#0F172A] dark:text-slate-100 antialiased select-none transition-colors">
      {/* SIDEBAR NAVIGASI UTAMA */}
      <aside
        className={`${
          sidebarOpen ? 'w-60' : 'w-16 items-center'
        } bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between py-3.5 z-30 shrink-0 transition-all duration-200`}
      >
        <div className="w-full">
          {/* Brand Header */}
          <div
            className={`px-3.5 mb-5 flex items-center ${
              sidebarOpen ? 'justify-between' : 'justify-center'
            } gap-2`}
          >
            {sidebarOpen && (
              <div className="flex items-center gap-2.5 overflow-hidden">
                <div className="w-8 h-8 flex items-center justify-center shrink-0">
                  <BrandLogo darkMode={darkMode} className="w-8 h-8" />
                </div>
                <div className="overflow-hidden">
                  <span className="text-[14px] font-bold text-[#0F172A] dark:text-white block leading-tight tracking-tight truncate">
                    WAS tCO Project
                  </span>
                  <span className="text-[11px] font-medium text-[#475569] dark:text-slate-400 block mt-0.5 truncate">
                    PT. Wanantara Alesha Sadana
                  </span>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 rounded-lg text-[#475569] hover:text-[#0F172A] dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition shrink-0 cursor-pointer"
              title="Perluas / Ciutkan Sidebar"
            >
              {sidebarOpen ? (
                <PanelLeftClose className="w-4 h-4" />
              ) : (
                <PanelLeftOpen className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Menu Workspace (Item Layer Sidebar: 13px Medium) */}
          <div className="px-3 space-y-1">
            {sidebarOpen && (
              <span className="px-2.5 text-[10px] font-bold uppercase tracking-wider text-[#475569] dark:text-slate-500 block mb-1.5">
                Workspace
              </span>
            )}

            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              title="Dashboard Project"
              className={`w-full flex items-center ${
                sidebarOpen ? 'gap-3 px-2.5' : 'justify-center px-0'
              } py-2 rounded-xl text-[13px] transition cursor-pointer ${
                activeTab === 'dashboard' || activeTab === 'new_project'
                  ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-semibold'
                  : 'text-[#475569] dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-[#0F172A] font-medium'
              }`}
            >
              <LayoutGrid className="w-4 h-4 shrink-0" />
              {sidebarOpen && <span className="whitespace-nowrap">Dashboard Project</span>}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('analysis')}
              title="Spatial Workspace"
              className={`w-full flex items-center ${
                sidebarOpen ? 'gap-3 px-2.5' : 'justify-center px-0'
              } py-2 rounded-xl text-[13px] transition cursor-pointer ${
                activeTab === 'analysis'
                  ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-semibold'
                  : 'text-[#475569] dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-[#0F172A] font-medium'
              }`}
            >
              <Layers className="w-4 h-4 shrink-0" />
              {sidebarOpen && <span className="whitespace-nowrap">Spatial Workspace</span>}
            </button>
          </div>

          {/* Menu Administrasi */}
          {isAdmin && (
            <div className="px-3 mt-6 space-y-1">
              {sidebarOpen && (
                <span className="px-2.5 text-[10px] font-bold uppercase tracking-wider text-[#475569] dark:text-slate-500 block mb-1.5">
                  Administrasi
                </span>
              )}

              <button
                type="button"
                onClick={() => setActiveTab('layers')}
                title="Database SHP (14)"
                className={`w-full flex items-center ${
                  sidebarOpen ? 'gap-3 px-2.5' : 'justify-center px-0'
                } py-2 rounded-xl text-[13px] transition cursor-pointer ${
                  activeTab === 'layers'
                    ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-semibold'
                    : 'text-[#475569] dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-[#0F172A] font-medium'
                }`}
              >
                <Database className="w-4 h-4 shrink-0" />
                {sidebarOpen && <span className="whitespace-nowrap">Database SHP (14)</span>}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('users')}
                title="Kelola Pengguna"
                className={`w-full flex items-center ${
                  sidebarOpen ? 'gap-3 px-2.5' : 'justify-center px-0'
                } py-2 rounded-xl text-[13px] transition cursor-pointer ${
                  activeTab === 'users'
                    ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-semibold'
                    : 'text-[#475569] dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-[#0F172A] font-medium'
                }`}
              >
                <Users className="w-4 h-4 shrink-0" />
                {sidebarOpen && <span className="whitespace-nowrap">Kelola Pengguna</span>}
              </button>
            </div>
          )}
        </div>

        {/* Bagian Bawah Sidebar: Toggle Tema & User Footer */}
        <div className="px-3 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2 w-full">
          <button
            type="button"
            onClick={() => setDarkMode(!darkMode)}
            title={darkMode ? 'Ganti ke Tema Siang' : 'Ganti ke Tema Malam'}
            className={`w-full flex items-center ${
              sidebarOpen ? 'justify-between px-2.5' : 'justify-center px-0'
            } py-2 rounded-xl bg-slate-50 dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/70 dark:border-slate-700 text-[13px] font-medium text-[#0F172A] dark:text-slate-200 transition cursor-pointer`}
          >
            <div className="flex items-center gap-2.5">
              {darkMode ? (
                <Sun className="w-4 h-4 text-amber-400 shrink-0" />
              ) : (
                <Moon className="w-4 h-4 text-indigo-600 shrink-0" />
              )}
              {sidebarOpen && (
                <span>{darkMode ? 'Tema Malam' : 'Tema Siang'}</span>
              )}
            </div>
            {sidebarOpen && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-slate-700 text-[#475569] dark:text-slate-300 border border-slate-200 dark:border-slate-600">
                Ubah
              </span>
            )}
          </button>

          <div
            className={`flex items-center ${
              sidebarOpen ? 'justify-between px-2.5' : 'justify-center px-1'
            } gap-2 py-2 rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800`}
          >
            {sidebarOpen && (
              <div className="flex items-center gap-2.5 overflow-hidden">
                <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                <div className="overflow-hidden">
                  <span className="text-[12px] font-bold text-[#0F172A] dark:text-slate-100 block truncate">
                    {user.full_name}
                  </span>
                  <span className="text-[11px] text-[#475569] dark:text-slate-400 block truncate">
                    {isAdmin ? 'Administrator GIS' : 'SRN & Verra Mode'}
                  </span>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="p-1.5 rounded-lg text-[#475569] hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition shrink-0 cursor-pointer"
              title="Keluar / Logout"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* AREA KONTEN UTAMA */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {activeTab === 'dashboard' && (
          <DashboardView
            projects={projects}
            layers={layers}
            onOpenNewProject={() => setActiveTab('new_project')}
            onSelectProjectForAnalysis={(projId) => {
              setActiveProjectId(projId);
              setActiveTab('analysis');
            }}
            onRefreshProjects={fetchProjects}
          />
        )}

        {activeTab === 'new_project' && (
          <NewProjectView
            onCancel={() => setActiveTab('dashboard')}
            onProjectCreated={async (createdProj) => {
              await fetchProjects();
              setActiveProjectId(createdProj.id);
              setActiveTab('analysis');
            }}
          />
        )}

        {activeTab === 'analysis' && (
          <AnalysisView
            projects={projects}
            activeProjectId={activeProjectId}
            onSelectProjectId={(id) => setActiveProjectId(id)}
            onOpenNewProject={() => setActiveTab('new_project')}
            onBackToDashboard={() => setActiveTab('dashboard')}
            layers={layers}
            isAdmin={isAdmin}
            onGoToAdminLayers={() => setActiveTab('layers')}
          />
        )}

        {activeTab === 'layers' && isAdmin && (
          <div className="flex-1 overflow-y-auto">
            <AdminLayersView layers={layers} onRefreshLayers={fetchLayers} />
          </div>
        )}

        {activeTab === 'users' && isAdmin && (
          <div className="flex-1 overflow-y-auto">
            <AdminUsersView currentUser={user} />
          </div>
        )}
      </main>
    </div>
  );
}
