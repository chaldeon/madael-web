'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Trash2, PowerOff, Megaphone, Pencil } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import { notifyAllActive } from '@/lib/notify';
import { logActivity } from '@/lib/activityLog';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

const EMPTY_FORM = { judul: '', isi: '', expired_at: '' };

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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null); // null = mode buat baru, isi = mode edit row itu
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const [actingId, setActingId] = useState(null);
  const [actionError, setActionError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const { data, error } = await supabase
      .from('announcements')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      setLoadError(error.message || 'Gagal memuat daftar pengumuman.');
      setLoading(false);
      return;
    }

    setRows(data || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (status === 'allowed') loadData();
  }, [status, loadData]);

  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

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
        setFormError(error.message || 'Gagal menyimpan perubahan pengumuman.');
        return;
      }

      setRows((prev) => prev.map((r) => (r.id === data.id ? data : r)));
      setForm(EMPTY_FORM);
      setEditingId(null);

      logActivity(supabase, {
        userId: employee.id,
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
      setFormError(error.message || 'Gagal menyimpan pengumuman.');
      return;
    }

    setRows((prev) => [data, ...prev]);
    setForm(EMPTY_FORM);
    setSaving(false);

    // Broadcast — fire and forget, kegagalan notifikasi tidak menggagalkan
    // pengumuman yang sudah tersimpan.
    notifyAllActive(supabase, {
      tipe: 'pengumuman_baru',
      pesan: `Pengumuman baru: ${data.judul}`,
      link: '/employee/dashboard',
    });

    logActivity(supabase, {
      userId: employee.id,
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
      setActionError(error.message || 'Gagal menonaktifkan pengumuman.');
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === data.id ? data : r)));

    logActivity(supabase, {
      userId: employee.id,
      aksi: 'nonaktifkan_pengumuman',
      targetTable: 'announcements',
      targetId: row.id,
      detail: { judul: row.judul },
    });
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Hapus pengumuman "${row.judul}"? Tindakan ini tidak bisa dibatalkan.`)) return;

    setActionError(null);
    setActingId(row.id);

    const { error } = await supabase.from('announcements').delete().eq('id', row.id);

    setActingId(null);
    if (error) {
      setActionError(error.message || 'Gagal menghapus pengumuman.');
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    if (editingId === row.id) handleCancelEdit();

    logActivity(supabase, {
      userId: employee.id,
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

  const inputClass =
    'w-full border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';

  return (
    <div className="max-w-[900px] mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Kelola Pengumuman</h1>
        <p className="text-sm text-[#6B6B6B] mt-1">
          Pengumuman yang dibuat di sini muncul sebagai banner di dashboard semua karyawan aktif.
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
                    </div>
                    <p className="text-xs text-[#6B6B6B] whitespace-pre-wrap">{row.isi}</p>
                    <p className="text-[11px] text-[#9A9A9A] mt-2">
                      Dibuat {formatTanggalWaktu(row.created_at)}
                      {row.expired_at && ` · Berlaku sampai ${formatTanggalWaktu(row.expired_at)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={() => handleStartEdit(row)}
                      disabled={actingId === row.id}
                      className="inline-flex items-center gap-1 text-xs text-[#6B6B6B] hover:text-black font-medium disabled:opacity-50"
                    >
                      <Pencil size={12} /> Edit
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
    </div>
  );
}