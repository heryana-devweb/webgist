import React, { useEffect, useState } from 'react';
import { Users, UserPlus, Trash2, Shield, User as UserIcon } from 'lucide-react';
import { apiRequest } from '../api';

export default function AdminUsersView({ currentUser }) {
  const [users, setUsers] = useState([]);
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const loadUsers = async () => {
    try {
      const data = await apiRequest('/users');
      setUsers(data);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiRequest('/users', {
        method: 'POST',
        body: JSON.stringify({
          username,
          full_name: fullName,
          password,
          role,
        }),
      });
      setUsername('');
      setFullName('');
      setPassword('');
      setRole('user');
      await loadUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (u) => {
    if (!window.confirm(`Hapus akun "${u.username}"?`)) return;
    try {
      await apiRequest(`/users/${u.id}`, { method: 'DELETE' });
      await loadUsers();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="w-full px-10 py-9 grid grid-cols-1 lg:grid-cols-12 gap-8 bg-white">
      <div className="lg:col-span-4 bg-[#f8f9fa] rounded-2xl border border-zinc-200/70 p-6 h-fit">
        <h3 className="font-semibold text-zinc-900 text-sm flex items-center gap-2 mb-4">
          <UserPlus className="w-4 h-4 text-zinc-500" strokeWidth={1.75} />
          Tambah Pengguna Baru
        </h3>

        <form onSubmit={handleCreateUser} className="space-y-4 text-xs">
          <div>
            <label className="block font-medium text-zinc-700 mb-1.5">Username</label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="misal: analis_gis"
              className="w-full px-3 py-2 rounded-lg bg-white border border-zinc-200 text-zinc-900 focus:border-indigo-600 focus:outline-none"
            />
          </div>
          <div>
            <label className="block font-medium text-zinc-700 mb-1.5">Nama Lengkap</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="misal: Budi Santoso"
              className="w-full px-3 py-2 rounded-lg bg-white border border-zinc-200 text-zinc-900 focus:border-indigo-600 focus:outline-none"
            />
          </div>
          <div>
            <label className="block font-medium text-zinc-700 mb-1.5">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimal 6 karakter"
              className="w-full px-3 py-2 rounded-lg bg-white border border-zinc-200 text-zinc-900 focus:border-indigo-600 focus:outline-none"
            />
          </div>
          <div>
            <label className="block font-medium text-zinc-700 mb-1.5">Role Akses</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white border border-zinc-200 text-zinc-900 focus:border-indigo-600 focus:outline-none"
            >
              <option value="user">User Biasa (Project &amp; Analisis AOI)</option>
              <option value="admin">Admin (Kelola Database SHP &amp; User)</option>
            </select>
          </div>

          {error && (
            <div className="p-2.5 rounded-lg bg-red-50 text-red-600 border border-red-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium transition cursor-pointer shadow-2xs"
          >
            {loading ? 'Menyimpan...' : 'Buat Akun'}
          </button>
        </form>
      </div>

      <div className="lg:col-span-8 space-y-4">
        <h3 className="font-semibold text-zinc-900 text-sm flex items-center gap-2">
          <Users className="w-4 h-4 text-zinc-500" strokeWidth={1.75} />
          Daftar Pengguna ({users.length})
        </h3>

        <div className="overflow-x-auto border border-zinc-200/80 rounded-xl bg-white">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-[#f8f9fa] text-zinc-500 border-b border-zinc-200/80">
              <tr>
                <th className="py-3 px-4 font-medium">Username</th>
                <th className="py-3 px-4 font-medium">Nama Lengkap</th>
                <th className="py-3 px-4 font-medium">Role</th>
                <th className="py-3 px-4 font-medium text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-[#f8f9fa]">
                  <td className="py-3 px-4 font-mono font-semibold text-zinc-900">{u.username}</td>
                  <td className="py-3 px-4 text-zinc-600">{u.full_name}</td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-zinc-100 text-zinc-800 font-semibold">
                      {u.role === 'admin' ? (
                        <Shield className="w-3 h-3 text-zinc-600" strokeWidth={1.75} />
                      ) : (
                        <UserIcon className="w-3 h-3 text-zinc-500" strokeWidth={1.75} />
                      )}
                      {u.role === 'admin' ? 'Admin' : 'User Biasa'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    {u.id !== currentUser?.id && (
                      <button
                        type="button"
                        onClick={() => handleDeleteUser(u)}
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 transition cursor-pointer"
                        title="Hapus User"
                      >
                        <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
