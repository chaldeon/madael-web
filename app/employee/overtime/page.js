'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { Timer } from 'lucide-react';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import Toast from '@/components/employee-list/Toast';
import {
  hitungDurasiMenit, JENIS_HARI_LABEL, STATUS_LEMBUR_LABEL, MAKS_ALASAN_LEMBUR,
  DURASI_MIN_MENIT, DURASI_MAKS_MENIT,
} from '@/lib/overtimeRules';

// 'YYYY-MM-DD' hari ini menurut WIB (browser bisa berada di zona waktu lain).
function hariIniJakarta() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

function formatTanggal(value) {
  if (!value) return '—';
  return new Date(value + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatJam(value) {
  return value ? value.slice(0, 5) : '—';
}

function jamTeks(menit) {
  return String(Number((menit / 60).toFixed(2))).replace('.', ',');
}

function StatusBadge({ status }) {
  const map = {
    pending: 'bg-amber-100 text-amber-800',
    approved: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
    cancelled: 'bg-[#F4F4F4] text-[#6B6B6B]',
  };
  return (
    <span className={`text-[10px] font-medium tracking-[0.04em] px-2 py-1 ${map[status] || 'bg-[#F4F4F4] text-[#6B6B6B]'}`}>
      {STATUS_LEMBUR_LABEL[status] || status?.toUpperCase()}
    </span>
  );
}

export default function OvertimePage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [form, setForm] = useState({ tanggal: hariIniJakarta(), jamMulai: '', jamSelesai: '', alasan: '' });
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmCancelId, setConfirmCancelId] = useState(null);
  const [cancelingId, setCancelingId] = useState(null);
  const [toast, setToast] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/overtime-requests');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(json.error || 'Gagal memuat riwayat lembur.');
        setLoading(false);
        return;
      }
      setRequests(json.requests || []);
    } catch (err) {
      console.error('Muat riwayat lembur error:', err);
      setLoadError('Gagal memuat riwayat lembur. Periksa koneksi lalu coba lagi.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const durasiMenit = hitungDurasiMenit(form.jamMulai, form.jamSelesai);
  const durasiValid = durasiMenit !== null && durasiMenit >= DURASI_MIN_MENIT && durasiMenit <= DURASI_MAKS_MENIT;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);

    if (!form.tanggal) { setFormError('Tanggal lembur wajib diisi.'); return; }
    if (!form.jamMulai || !form.jamSelesai) { setFormError('Jam mulai dan jam selesai wajib diisi.'); return; }
    if (!durasiValid) {
      setFormError(`Durasi lembur harus antara ${DURASI_MIN_MENIT} menit dan ${DURASI_MAKS_MENIT / 60} jam.`);
      return;
    }
    if (!form.alasan.trim()) { setFormError('Alasan lembur wajib diisi.'); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/overtime-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tanggal: form.tanggal,
          jamMulai: form.jamMulai,
          jamSelesai: form.jamSelesai,
          alasan: form.alasan.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(json.error || 'Gagal mengirim pengajuan lembur.');
        setSubmitting(false);
        return;
      }
      setRequests((prev) => [json.request, ...prev]);
      setForm((f) => ({ ...f, jamMulai: '', jamSelesai: '', alasan: '' }));
      setToast({ type: 'success', message: 'Pengajuan lembur terkirim, menunggu persetujuan.' });
    } catch (err) {
      console.error('Ajukan lembur error:', err);
      setFormError('Gagal mengirim pengajuan lembur. Periksa koneksi lalu coba lagi.');
    }
    setSubmitting(false);
  };

  const handleCancel = async (row) => {
    setCancelingId(row.id);
    try {
      const res = await fetch(`/api/overtime-requests/${row.id}/cancel`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast({ type: 'error', message: json.error || 'Gagal membatalkan pengajuan lembur.' });
        if (res.status === 409 || res.status === 404) loadData(); // status berubah di sisi lain
      } else {
        setRequests((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: 'cancelled' } : r)));
        setToast({ type: 'success', message: 'Pengajuan lembur dibatalkan.' });
      }
    } catch (err) {
      console.error('Batalkan lembur error:', err);
      setToast({ type: 'error', message: 'Gagal membatalkan pengajuan lembur. Coba lagi.' });
    }
    setCancelingId(null);
    setConfirmCancelId(null);
  };

  if (loading) {
    return (
      <div className="max-w-[760px] mx-auto px-6 py-10">
        <LoadingState label="Memuat data lembur..." />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-[760px] mx-auto px-6 py-10">
        <ErrorState message={loadError} onRetry={loadData} />
      </div>
    );
  }

  const inputClass =
    'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors w-full';

  return (
    <div className="max-w-[760px] mx-auto px-6 py-10">
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <div className="mb-6">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Ajukan Lembur</h1>
        <p className="text-sm text-[#6B6B6B] mt-1">
          Isi tanggal dan jam lembur. Admin akan meninjau pengajuanmu; jam yang disetujui bisa lebih kecil dari yang diajukan.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white border border-[#E0E0E0] p-6 mb-10">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[#6B6B6B]">Tanggal</span>
            <input
              type="date"
              value={form.tanggal}
              onChange={(e) => setForm((f) => ({ ...f, tanggal: e.target.value }))}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[#6B6B6B]">Jam Mulai</span>
            <input
              type="time"
              value={form.jamMulai}
              onChange={(e) => setForm((f) => ({ ...f, jamMulai: e.target.value }))}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[#6B6B6B]">Jam Selesai</span>
            <input
              type="time"
              value={form.jamSelesai}
              onChange={(e) => setForm((f) => ({ ...f, jamSelesai: e.target.value }))}
              className={inputClass}
            />
          </label>
        </div>

        {form.jamMulai && form.jamSelesai && (
          <p className={`text-xs mb-4 ${durasiValid ? 'text-[#6B6B6B]' : 'text-red-600'}`}>
            {durasiValid
              ? `Durasi: ${jamTeks(durasiMenit)} jam${form.jamSelesai < form.jamMulai ? ' (melewati tengah malam)' : ''}.`
              : `Durasi harus antara ${DURASI_MIN_MENIT} menit dan ${DURASI_MAKS_MENIT / 60} jam.`}
          </p>
        )}

        <label className="flex flex-col gap-1 mb-4">
          <span className="text-xs text-[#6B6B6B]">Alasan</span>
          <textarea
            value={form.alasan}
            onChange={(e) => setForm((f) => ({ ...f, alasan: e.target.value }))}
            rows={3}
            maxLength={MAKS_ALASAN_LEMBUR}
            placeholder="Contoh: Menyelesaikan laporan rekrutmen klien yang tenggatnya besok pagi."
            className={`${inputClass} resize-none`}
          />
        </label>

        <p className="text-[11px] text-[#9A9A9A] mb-4">
          Hari kerja biasa dibatasi maksimal 4 jam per hari dan 18 jam per minggu (PP 35/2021). Jenis hari ditentukan otomatis dari jadwal kerjamu.
        </p>

        {formError && <p className="text-xs text-red-600 mb-4">{formError}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
        >
          {submitting ? 'Mengirim...' : 'Kirim Pengajuan'}
        </button>
      </form>

      <h2 className="text-sm font-medium text-black mb-3">Riwayat Lembur</h2>
      {requests.length === 0 ? (
        <div className="bg-white border border-[#E0E0E0]">
          <EmptyState message="Belum ada pengajuan lembur." icon={Timer} />
        </div>
      ) : (
        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
                <th className="px-4 py-3 font-medium">Tanggal</th>
                <th className="px-4 py-3 font-medium">Jam</th>
                <th className="px-4 py-3 font-medium">Durasi</th>
                <th className="px-4 py-3 font-medium">Jenis Hari</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className="border-b border-[#E0E0E0] last:border-0 align-top">
                  <td className="px-4 py-3 text-black whitespace-nowrap">{formatTanggal(r.tanggal)}</td>
                  <td className="px-4 py-3 text-[#6B6B6B] whitespace-nowrap">{formatJam(r.jam_mulai)} – {formatJam(r.jam_selesai)}</td>
                  <td className="px-4 py-3 text-black whitespace-nowrap">
                    {jamTeks(r.durasi_menit)} jam
                    {r.status === 'approved' && r.jam_disetujui !== null && Number(r.jam_disetujui) * 60 !== r.durasi_menit && (
                      <p className="text-[11px] text-[#9A9A9A]">disetujui {String(Number(r.jam_disetujui)).replace('.', ',')} jam</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[#6B6B6B]">{JENIS_HARI_LABEL[r.jenis_hari] || r.jenis_hari}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                    {r.status === 'rejected' && r.rejection_reason && (
                      <p className="text-[11px] text-[#9A9A9A] mt-1 max-w-[180px]" title={r.rejection_reason}>{r.rejection_reason}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {r.status === 'pending' && confirmCancelId !== r.id && (
                      <button
                        onClick={() => setConfirmCancelId(r.id)}
                        className="text-xs text-madael-red hover:text-madael-dark font-medium"
                      >
                        Batalkan
                      </button>
                    )}
                    {r.status === 'pending' && confirmCancelId === r.id && (
                      <span className="inline-flex items-center gap-3 text-xs">
                        <span className="text-[#6B6B6B]">Yakin?</span>
                        <button
                          onClick={() => handleCancel(r)}
                          disabled={cancelingId === r.id}
                          className="text-madael-red hover:text-madael-dark font-medium disabled:opacity-50"
                        >
                          {cancelingId === r.id ? 'Membatalkan...' : 'Ya, batalkan'}
                        </button>
                        <button
                          onClick={() => setConfirmCancelId(null)}
                          disabled={cancelingId === r.id}
                          className="text-[#6B6B6B] hover:text-black"
                        >
                          Tidak
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
