'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useModalDismiss } from '@/lib/useModalDismiss';
import { formatTanggalKepegawaian, isIsoDate, tambahHari } from '@/lib/kepegawaian';
import { formatDurasi, kontrakEfektif, ringkasanDurasi } from '@/lib/kontrakRiwayat';

const inputClass =
  'w-full border border-[#E0E0E0] px-3 py-2 text-sm text-black focus:outline-none focus:border-madael-red';
const labelClass = 'block text-xs font-medium text-[#6B6B6B] mb-1';

// Modal "Perpanjang Kontrak" (PKWT/Magang). Dipakai panel Riwayat Kontrak di
// detail karyawan dan widget Kontrak Berakhir di dashboard.
//
// Props:
// - masterId: id employees_master. Modal tertutup bila null.
// - onClose: dipanggil saat modal ditutup tanpa menyimpan.
// - onDone: dipanggil setelah perpanjangan tersimpan (pemanggil memuat ulang data).
//
// Riwayat dimuat sendiri dari /api/payroll/master/[id]/contracts supaya pratinjau
// total masa kumulatif memakai data terbaru. Penyimpanan tetap divalidasi ulang
// di server; pratinjau hanya bantuan.
export default function KontrakPerpanjangModal({ masterId, onClose, onDone }) {
  const open = !!masterId;
  const [load, setLoad] = useState({ status: 'loading', data: null, error: null });
  const [form, setForm] = useState({ tanggal_mulai: '', tanggal_berakhir: '', nomor_kontrak: '', catatan: '' });
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // Isian awal saat data selesai dimuat, untuk mendeteksi form yang sudah diubah.
  const [baseline, setBaseline] = useState(null);

  useEffect(() => {
    if (!masterId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/payroll/master/${masterId}/contracts`, { cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Gagal memuat riwayat kontrak.');
        if (cancelled) return;
        const mulaiDefault = isIsoDate(body.master.kontrak_berakhir) ? tambahHari(body.master.kontrak_berakhir, 1) : '';
        const awal = { tanggal_mulai: mulaiDefault, tanggal_berakhir: '', nomor_kontrak: '', catatan: '' };
        setBaseline(awal);
        setForm(awal);
        setKonfirmasi(false);
        setError(null);
        setLoad({ status: 'ready', data: body, error: null });
      } catch (err) {
        if (!cancelled) setLoad({ status: 'error', data: null, error: err.message || 'Gagal memuat riwayat kontrak.' });
      }
    })();
    return () => { cancelled = true; };
  }, [masterId]);

  const dirty = baseline !== null && JSON.stringify(form) !== JSON.stringify(baseline);
  const handleBackdrop = useModalDismiss(open, onClose, undefined, dirty);

  const master = load.data?.master;
  const jenis = master?.jenis_hubungan_kerja;

  const { sekarang, sesudah } = useMemo(() => {
    if (!master) return { sekarang: null, sesudah: null };
    const ada = kontrakEfektif(load.data.contracts, master);
    const now = ringkasanDurasi(ada, jenis);
    if (!isIsoDate(form.tanggal_mulai) || !isIsoDate(form.tanggal_berakhir) || form.tanggal_berakhir < form.tanggal_mulai) {
      return { sekarang: now, sesudah: null };
    }
    return {
      sekarang: now,
      sesudah: ringkasanDurasi([...ada, { jenis, tanggal_mulai: form.tanggal_mulai, tanggal_berakhir: form.tanggal_berakhir }], jenis),
    };
  }, [master, load.data, form.tanggal_mulai, form.tanggal_berakhir, jenis]);

  if (!open) return null;

  const melewati = sesudah?.status === 'melewati';

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setKonfirmasi(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!isIsoDate(form.tanggal_mulai) || !isIsoDate(form.tanggal_berakhir)) {
      setError('Isi tanggal mulai dan tanggal berakhir kontrak baru.');
      return;
    }
    if (form.tanggal_berakhir < form.tanggal_mulai) {
      setError('Tanggal berakhir tidak boleh sebelum tanggal mulai.');
      return;
    }
    if (melewati && !konfirmasi) {
      setError('Centang konfirmasi untuk tetap menyimpan perpanjangan yang melewati batas.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/payroll/master/${masterId}/contracts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, konfirmasi_melebihi_batas: konfirmasi }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || 'Gagal memperpanjang kontrak.');
        setSaving(false);
        return;
      }
      setSaving(false);
      onDone?.(body);
    } catch (err) {
      setError('Terjadi kesalahan. Periksa koneksi lalu coba lagi.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] px-6" onClick={handleBackdrop}>
      <div className="w-full max-w-[480px] bg-white border-t-4 border-madael-red p-8 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-serif text-[20px] font-normal text-black">Perpanjang Kontrak</h2>
          <button type="button" onClick={onClose} className="text-[#6B6B6B] hover:text-black bg-transparent border-0 cursor-pointer" aria-label="Tutup">
            <X size={20} />
          </button>
        </div>

        {load.status === 'loading' && <p className="text-sm text-[#6B6B6B]">Memuat riwayat kontrak...</p>}
        {load.status === 'error' && <p className="text-sm text-madael-red">{load.error}</p>}

        {load.status === 'ready' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="text-sm">
              <p className="font-medium text-black">{master.nama}</p>
              <p className="text-xs text-[#6B6B6B]">
                {jenis} · berakhir {formatTanggalKepegawaian(master.kontrak_berakhir)}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Mulai Kontrak Baru</label>
                <input type="date" required value={form.tanggal_mulai} onChange={(e) => handleChange('tanggal_mulai', e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Berakhir</label>
                <input type="date" required value={form.tanggal_berakhir} onChange={(e) => handleChange('tanggal_berakhir', e.target.value)} className={inputClass} />
              </div>
            </div>
            <div>
              <label className={labelClass}>Nomor Kontrak (opsional)</label>
              <input maxLength={100} value={form.nomor_kontrak} onChange={(e) => handleChange('nomor_kontrak', e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Catatan (opsional)</label>
              <textarea maxLength={500} rows={2} value={form.catatan} onChange={(e) => handleChange('catatan', e.target.value)} className={inputClass} />
            </div>

            {sekarang && sekarang.status !== 'none' && (
              <div className="text-xs text-[#6B6B6B] border border-[#F0F0F0] bg-[#FAFAFA] px-3 py-2 space-y-1">
                <p>Total masa {jenis} saat ini: <span className="text-black">{formatDurasi(sekarang.total)}</span></p>
                {sesudah && (
                  <p>
                    Setelah perpanjangan: <span className="text-black">{formatDurasi(sesudah.total)}</span>. {sesudah.label}.
                  </p>
                )}
              </div>
            )}

            {melewati && (
              <div className="border border-red-200 bg-red-50 px-3 py-2 space-y-2">
                <p className="text-xs text-red-700">
                  Perpanjangan ini melewati batas masa {jenis} ({sesudah.dasar}). Angka batas perlu divalidasi tim legal sebelum dijadikan acuan.
                </p>
                <label className="flex items-start gap-2 text-xs text-red-800">
                  <input type="checkbox" className="mt-0.5" checked={konfirmasi} onChange={(e) => setKonfirmasi(e.target.checked)} />
                  Saya paham dan tetap ingin menyimpan perpanjangan ini.
                </label>
              </div>
            )}
            {sesudah?.status === 'mendekati' && (
              <p className="text-xs text-amber-800 bg-amber-50 px-3 py-2">
                Setelah perpanjangan ini masa {jenis} mendekati batas ({sesudah.dasar}).
              </p>
            )}

            {error && <p className="text-sm text-madael-red">{error}</p>}

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer border-0"
            >
              {saving ? 'Menyimpan...' : 'Simpan Perpanjangan'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
