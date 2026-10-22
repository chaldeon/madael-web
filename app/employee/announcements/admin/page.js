'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Trash2, PowerOff, Megaphone, Pencil, Pin, PinOff, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import { dispatchNotification } from '@/lib/notifyClient';
import { logActivity } from '@/lib/activityLogClient';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import ConfirmDialog from '@/components/ConfirmDialog';
import { friendlyError } from '@/lib/errorMessage';

const EMPTY_FORM = { judul: '', isi: '', expired_at: '', target_company_id: '', pinned: false };

function formatTanggalWaktu(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Format ISO timestamp (dari kolom expired_at) jadi string yang diterima
// input type="datetime-local" ('YYYY-MM-DDTHH:mm'), dipakai buat isi ulang
// form saat mode edit dibuka.
function toDatetimeLocalValue(isoValue) {
  if (!isoValue) return '';
  const d = new Date(isoValue);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Pengumuman dianggap aktif kalau belum ada expired_at, atau expired_at-nya
// masih di masa depan. Sama seperti logika filter yang dipakai widget banner
// di app/employee/dashboard.
function isActive(row) {
  return !row.expired_at || new Date(row.expired_at) > new Date();
}

export default function AnnouncementsAdminPage() {
  const supabase = createClient();
  const { status, employee } = useModuleAccess('announcements_admin');

  const [rows, setRows] = useState([]);
  const [companies, setCompanies] = useState([]);
  // id pengumuman (string) -> { total, dibaca }, dari RPC announcement_read_summary.
  const [readStats, setReadStats] = useState({});
  const [statsError, setStatsError] = useState(null);
  // Daftar yang belum membaca dimuat per pengumuman saat dibuka (lazy).
  const [unreadOpenId, setUnreadOpenId] = useState(null);
  const [unreadLists, setUnreadLists] = useState({});
  const [unreadLoadingId, setUnreadLoadingId] = useState(null);
  const [unreadError, setUnreadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null); // null = mode buat baru, isi = mode edit row itu
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const [actingId, setActingId] = useState(null);
  const [actionError, setActionError] = useState(null);
  // Pengumuman yang mau dihapus — membuka dialog konfirmasi (pengganti window.confirm()).
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Ringkasan "dibaca X/Y". Kegagalan di sini tidak menggagalkan halaman —
  // daftar pengumuman tetap tampil, hanya kolom pembacanya yang kosong.
  const loadReadStats = useCallback(async () => {
    const { data, error } = await supabase.rpc('announcement_read_summary');
    if (error) {
      setStatsError(friendlyError(error, 'Statistik pembaca belum bisa dimuat.'));
      return;
    }
    setStatsError(null);
    const byId = {};
    (data || []).forEach((r) => { byId[String(r.announcement_id)] = { total: r.total, dibaca: r.dibaca }; });
    setReadStats(byId);
  }, [supabase]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const [annRes, compRes] = await Promise.all([
      supabase
        .from('announcements')
        .select('*')
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('companies').select('id, nama_perusahaan').order('nama_perusahaan'),
    ]);

    const firstError = annRes.error || compRes.error;
    if (firstError) {
      setLoadError(friendlyError(firstError, 'Gagal memuat daftar pengumuman.'));
      setLoading(false);
      return;
    }

    setRows(annRes.data || []);
    setCompanies(compRes.data || []);
    setLoading(false);
    loadReadStats();
  }, [supabase, loadReadStats]);

  useEffect(() => {
    if (status === 'allowed') loadData();
  }, [status, loadData]);

  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const companyName = (id) => {
    if (id === null || id === undefined || id === '') return null;
    const c = companies.find((x) => String(x.id) === String(id));
    return c ? c.nama_perusahaan : 'Perusahaan tidak ditemukan';
  };

  // Urutan tampil: pin di atas, lalu terbaru. Query sudah mengurutkan begitu,
  // tapi baris baru / hasil edit disisipkan di sisi client, jadi urutkan ulang.
  const sortRows = (list) =>
    [...list].sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      return new Date(b.created_at) - new Date(a.created_at);
    });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);

    if (!form.judul.trim() || !form.isi.trim()) {
      setFormError('Judul dan isi pengumuman wajib diisi.');
      return;
    }

    setSaving(true);

    const payload = {
      judul: form.judul.trim(),
      isi: form.isi.trim(),
      expired_at: form.expired_at ? new Date(form.expired_at).toISOString() : null,
      target_company_id: form.target_company_id || null,
      pinned: Boolean(form.pinned),
    };

    // Mode edit: update row yang sedang diedit, tidak broadcast notifikasi
    // ulang (biar tidak spam tiap kali admin cuma benerin typo).
    if (editingId) {
      const { data, error } = await supabase
        .from('announcements')
        .update(payload)
        .eq('id', editingId)
        .select()
        .single();

      setSaving(false);
      if (error) {
        setFormError(friendlyError(error, 'Gagal menyimpan perubahan pengumuman.'));
        return;
      }

      setRows((prev) => sortRows(prev.map((r) => (r.id === data.id ? data : r))));
      setForm(EMPTY_FORM);
      setEditingId(null);
      // Target bisa berubah, jadi audiens (Y) ikut berubah.
      setUnreadLists({});
      setUnreadOpenId(null);
      loadReadStats();

      logActivity({
        aksi: 'edit_pengumuman',
        targetTable: 'announcements',
        targetId: data.id,
        detail: { judul: data.judul },
      });
      return;
    }

    // Mode buat baru.
    const { data, error } = await supabase
      .from('announcements')
      .insert([{ ...payload, created_by: employee.id }])
      .select()
      .single();

    if (error) {
      setSaving(false);
      setFormError(friendlyError(error, 'Gagal menyimpan pengumuman.'));
      return;
    }

    setRows((prev) => sortRows([data, ...prev]));
    setForm(EMPTY_FORM);
    setSaving(false);
    loadReadStats();

    // Broadcast — fire and forget, kegagalan notifikasi tidak menggagalkan
    // pengumuman yang sudah tersimpan.
    dispatchNotification('pengumuman_baru', data.id);

    logActivity({
      aksi: 'buat_pengumuman',
      targetTable: 'announcements',
      targetId: data.id,
      detail: { judul: data.judul },
    });
  };

  const handleStartEdit = (row) => {
    setFormError(null);
    setEditingId(row.id);
    setForm({
      judul: row.judul,
      isi: row.isi,
      expired_at: toDatetimeLocalValue(row.expired_at),
      target_company_id: row.target_company_id === null || row.target_company_id === undefined ? '' : String(row.target_company_id),
      pinned: Boolean(row.pinned),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  };

  // "Nonaktifkan sekarang" — set expired_at ke waktu saat ini, tanpa hapus
  // riwayatnya. Ini jalur aman default, sama seperti pola Nonaktifkan di
  // Employee List (soft-expire, bukan hapus permanen).
  const handleExpireNow = async (row) => {
    setActionError(null);
    setActingId(row.id);

    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('announcements')
      .update({ expired_at: nowIso })
      .eq('id', row.id)
      .select()
      .single();

    setActingId(null);
    if (error) {
      setActionError(friendlyError(error, 'Gagal menonaktifkan pengumuman.'));
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === data.id ? data : r)));

    logActivity({
      aksi: 'nonaktifkan_pengumuman',
      targetTable: 'announcements',
      targetId: row.id,
      detail: { judul: row.judul },
    });
  };

  // Pin / lepas pin — tidak broadcast ulang notifikasi, sama seperti edit.
  const handleTogglePin = async (row) => {
    setActionError(null);
    setActingId(row.id);

    const { data, error } = await supabase
      .from('announcements')
      .update({ pinned: !row.pinned })
      .eq('id', row.id)
      .select()
      .single();

    setActingId(null);
    if (error) {
      setActionError(friendlyError(error, 'Gagal mengubah status pin pengumuman.'));
      return;
    }
    setRows((prev) => sortRows(prev.map((r) => (r.id === data.id ? data : r))));

    logActivity({
      aksi: 'edit_pengumuman',
      targetTable: 'announcements',
      targetId: row.id,
      detail: { judul: row.judul, pinned: data.pinned },
    });
  };

  const handleToggleUnread = async (row) => {
    setUnreadError(null);
    if (unreadOpenId === row.id) {
      setUnreadOpenId(null);
      return;
    }
    setUnreadOpenId(row.id);
    if (unreadLists[row.id]) return;

    setUnreadLoadingId(row.id);
    const { data, error } = await supabase.rpc('announcement_unread_list', {
      p_announcement_id: String(row.id),
    });
    setUnreadLoadingId(null);
    if (error) {
      setUnreadError(friendlyError(error, 'Gagal memuat daftar yang belum membaca.'));
      return;
    }
    setUnreadLists((prev) => ({ ...prev, [row.id]: data || [] }));
  };

  const handleDelete = (row) => setDeleteTarget(row);

  // Dialog tetap terbuka (tombol busy) selama penghapusan berjalan, lalu menutup.
  // Kalau gagal, pesan error tampil inline lewat actionError seperti sebelumnya.
  const handleConfirmDelete = async () => {
    const row = deleteTarget;
    if (!row) return;

    setActionError(null);
    setActingId(row.id);

    const { error } = await supabase.from('announcements').delete().eq('id', row.id);

    setActingId(null);
    setDeleteTarget(null);
    if (error) {
      setActionError(friendlyError(error, 'Gagal menghapus pengumuman.'));
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    if (editingId === row.id) handleCancelEdit();

    logActivity({
      aksi: 'hapus_pengumuman',
      targetTable: 'announcements',
      targetId: row.id,
      detail: { judul: row.judul },
    });
  };

  if (status === 'loading') {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
        <LoadingState label="Memuat data..." />
      </section>
    );
  }

  if (status === 'denied') {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4] px-6">
        <div className="w-full max-w-[420px] border-t-4 border-madael-red bg-white p-8 text-center">
          <p className="text-sm text-black mb-6">Halaman ini khusus pemegang akses Kelola Pengumuman.</p>
          <Link
            href="/employee/dashboard"
            className="inline-block bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
          >
            Kembali
          </Link>
        </div>
      </section>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-[900px] mx-auto px-6 py-10">
        <ErrorState message={loadError} onRetry={loadData} />
      </div>
    );
  }

  const renderReaders = (row) => {
    const stat = readStats[String(row.id)];
    if (!stat) {
      return statsError ? <p className="text-[11px] text-[#9A9A9A] mt-1">{statsError}</p> : null;
    }
    const belum = Math.max(stat.total - stat.dibaca, 0);
    const open = unreadOpenId === row.id;
    const list = unreadLists[row.id];
    return (
      <div className="mt-2">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[11px] text-[#6B6B6B]">
            <Users size={12} /> Dibaca {stat.dibaca}/{stat.total}
          </span>
          {belum > 0 && (
            <button
              type="button"
              onClick={() => handleToggleUnread(row)}
              className="text-[11px] text-madael-red hover:text-madael-dark font-medium"
            >
              {open ? 'Sembunyikan' : `Lihat ${belum} yang belum membaca`}
            </button>
          )}
        </div>
        {open && (
          <div className="mt-2 border border-[#E0E0E0] bg-[#FAFAFA] p-3 max-h-[220px] overflow-y-auto">
            {unreadLoadingId === row.id ? (
              <LoadingState label="Memuat daftar..." />
            ) : unreadError ? (
              <p className="text-xs text-red-600">{unreadError}</p>
            ) : (list || []).length === 0 ? (
              <p className="text-xs text-[#6B6B6B]">Semua sudah membaca.</p>
            ) : (
              <ul className="space-y-1">
                {list.map((e) => (
                  <li key={e.id} className="text-xs text-black flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate">
                      {e.nama}{e.employee_id ? <span className="text-[#9A9A9A]"> · {e.employee_id}</span> : null}
                    </span>
                    <span className="text-[#9A9A9A] shrink-0">{e.perusahaan || '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    );
  };

  const inputClass =
    'w-full border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';

  return (
    <div className="max-w-[900px] mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Kelola Pengumuman</h1>
        <p className="text-sm text-[#6B6B6B] mt-1">
          Pengumuman yang dibuat di sini muncul sebagai banner di dashboard karyawan aktif — semua karyawan atau satu perusahaan saja.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white border border-[#E0E0E0] p-5 mb-8">
        <p className="text-sm font-medium text-black mb-4">{editingId ? 'Edit Pengumuman' : 'Buat Pengumuman Baru'}</p>

        {formError && <p className="text-xs text-red-600 mb-3">{formError}</p>}

        <div className="mb-3">
          <label className="block text-xs text-[#6B6B6B] mb-1">Judul</label>
          <input type="text" value={form.judul} onChange={set('judul')} className={inputClass} placeholder="Mis. Libur Nasional 25 Desember" />
        </div>

        <div className="mb-3">
          <label className="block text-xs text-[#6B6B6B] mb-1">Isi Pengumuman</label>
          <textarea value={form.isi} onChange={set('isi')} rows={4} className={inputClass} placeholder="Tulis isi pengumuman di sini..." />
        </div>

        <div className="mb-4 max-w-[260px]">
          <label className="block text-xs text-[#6B6B6B] mb-1">Berlaku Sampai (opsional)</label>
          <input type="datetime-local" value={form.expired_at} onChange={set('expired_at')} className={inputClass} />
          <p className="text-[11px] text-[#9A9A9A] mt-1">Kosongkan kalau tidak ada batas waktu — pengumuman tetap tampil sampai dinonaktifkan manual.</p>
        </div>

        <div className="mb-3 max-w-[360px]">
          <label className="block text-xs text-[#6B6B6B] mb-1">Ditujukan Untuk</label>
          <select value={form.target_company_id} onChange={set('target_company_id')} className={inputClass}>
            <option value="">Semua karyawan</option>
            {companies.map((c) => (
              <option key={c.id} value={String(c.id)}>{c.nama_perusahaan}</option>
            ))}
          </select>
          <p className="text-[11px] text-[#9A9A9A] mt-1">Pilih perusahaan untuk menampilkan pengumuman hanya ke karyawan perusahaan itu.</p>
        </div>

        <label className="mb-4 flex items-center gap-2 text-sm text-black cursor-pointer w-fit">
          <input
            type="checkbox"
            checked={form.pinned}
            onChange={(e) => setForm((prev) => ({ ...prev, pinned: e.target.checked }))}
            className="accent-madael-red"
          />
          Pin di bagian atas dashboard
        </label>

        <button
          type="submit"
          disabled={saving}
          className="bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
        >
          {saving ? 'Menyimpan...' : editingId ? 'Simpan Perubahan' : 'Terbitkan Pengumuman'}
        </button>
        {editingId && (
          <button
            type="button"
            onClick={handleCancelEdit}
            disabled={saving}
            className="ml-3 text-sm font-medium tracking-[0.02em] text-[#6B6B6B] hover:text-black disabled:opacity-50"
          >
            Batal
          </button>
        )}
      </form>

      {actionError && <p className="text-xs text-red-600 mb-4">{actionError}</p>}

      <p className="text-sm font-medium text-black mb-4">Riwayat Pengumuman</p>

      {loading ? (
        <LoadingState label="Memuat pengumuman..." />
      ) : rows.length === 0 ? (
        <EmptyState message="Belum ada pengumuman." icon={Megaphone} />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const active = isActive(row);
            return (
              <div key={row.id} className="bg-white border border-[#E0E0E0] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium text-black truncate">{row.judul}</p>
                      <span className={`text-[10px] font-medium tracking-[0.04em] px-2 py-0.5 shrink-0 ${
                        active ? 'bg-green-100 text-green-700' : 'bg-[#F4F4F4] text-[#9A9A9A]'
                      }`}>
                        {active ? 'AKTIF' : 'NONAKTIF'}
                      </span>
                      {row.pinned && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium tracking-[0.04em] px-2 py-0.5 shrink-0 bg-madael-red/10 text-madael-red">
                          <Pin size={10} /> PIN
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#6B6B6B] whitespace-pre-wrap">{row.isi}</p>
                    <p className="text-[11px] text-[#9A9A9A] mt-2">
                      Dibuat {formatTanggalWaktu(row.created_at)}
                      {row.expired_at && ` · Berlaku sampai ${formatTanggalWaktu(row.expired_at)}`}
                      {` · Untuk: ${row.target_company_id ? companyName(row.target_company_id) : 'Semua karyawan'}`}
                    </p>
                    {renderReaders(row)}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={() => handleStartEdit(row)}
                      disabled={actingId === row.id}
                      className="inline-flex items-center gap-1 text-xs text-[#6B6B6B] hover:text-black font-medium disabled:opacity-50"
                    >
                      <Pencil size={12} /> Edit
                    </button>
                    <button
                      onClick={() => handleTogglePin(row)}
                      disabled={actingId === row.id}
                      className="inline-flex items-center gap-1 text-xs text-[#6B6B6B] hover:text-black font-medium disabled:opacity-50"
                    >
                      {row.pinned ? <><PinOff size={12} /> Lepas Pin</> : <><Pin size={12} /> Pin</>}
                    </button>
                    {active && (
                      <button
                        onClick={() => handleExpireNow(row)}
                        disabled={actingId === row.id}
                        className="inline-flex items-center gap-1 text-xs text-[#6B6B6B] hover:text-black font-medium disabled:opacity-50"
                      >
                        <PowerOff size={12} /> Nonaktifkan
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(row)}
                      disabled={actingId === row.id}
                      className="inline-flex items-center gap-1 text-xs text-madael-red hover:text-madael-dark font-medium disabled:opacity-50"
                    >
                      <Trash2 size={12} /> Hapus
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Hapus Pengumuman"
        message={deleteTarget ? `Hapus pengumuman "${deleteTarget.judul}"? Tindakan ini tidak bisa dibatalkan.` : ''}
        confirmLabel="Hapus"
        busy={Boolean(deleteTarget) && actingId === deleteTarget.id}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}