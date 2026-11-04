'use client';

import { useEffect, useState } from 'react';
import { useModalDismiss } from '@/lib/useModalDismiss';
import {
  JENIS_CUTI, JENIS_CUTI_DEFAULT, LAMPIRAN_MAKS_BYTES, MAKS_HARI_LAMPAU_INPUT_HR,
} from '@/lib/leave';

const MAKS_ALASAN = 500;
const FORM_AWAL = { employeeId: '', jenis: JENIS_CUTI_DEFAULT, tanggalMulai: '', tanggalSelesai: '', alasan: '' };

// Dialog HR untuk mencatat cuti/sakit/izin atas nama karyawan
// (POST /api/leave-requests/admin). Pengajuan yang dicatat langsung berstatus
// disetujui; aturan kuota, bentrok, dan lampiran dicek di server.
//
// Dipasang hanya saat dialog terbuka ({open && <LeaveOnBehalfDialog />}), jadi
// form dan daftar karyawan selalu segar tiap dibuka.
//
// Props:
// - onClose: dipanggil saat dialog ditutup tanpa menyimpan
// - onSaved(json): dipanggil setelah berhasil menyimpan (json = respons API)
export default function LeaveOnBehalfDialog({ onClose, onSaved }) {
  const [karyawan, setKaryawan] = useState([]);
  const [loadingKaryawan, setLoadingKaryawan] = useState(true);
  const [karyawanError, setKaryawanError] = useState(null);
  const [form, setForm] = useState(FORM_AWAL);
  const [lampiran, setLampiran] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Muat daftar karyawan aktif saat dialog dibuka.
  useEffect(() => {
    let batal = false;
    (async () => {
      try {
        const res = await fetch('/api/leave-requests/admin/karyawan');
        const json = await res.json().catch(() => ({}));
        if (batal) return;
        if (!res.ok) {
          setKaryawanError(json.error || 'Gagal memuat daftar karyawan.');
          return;
        }
        setKaryawan(json.employees || []);
      } catch {
        if (!batal) setKaryawanError('Gagal memuat daftar karyawan. Periksa koneksi internet kamu.');
      } finally {
        if (!batal) setLoadingKaryawan(false);
      }
    })();
    return () => { batal = true; };
  }, []);

  const isDirty =
    form.employeeId !== '' || form.tanggalMulai !== '' || form.tanggalSelesai !== '' ||
    form.alasan.trim() !== '' || lampiran !== null || form.jenis !== JENIS_CUTI_DEFAULT;
  const handleBackdropClick = useModalDismiss(
    !saving,
    onClose,
    'Tutup dialog ini? Data yang sudah diisi tidak akan tersimpan.',
    isDirty
  );

  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleFile = (e) => {
    const f = e.target.files?.[0] || null;
    if (f && f.size > LAMPIRAN_MAKS_BYTES) {
      setError('Ukuran lampiran maksimal 4MB.');
      e.target.value = '';
      setLampiran(null);
      return;
    }
    setError(null);
    setLampiran(f);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setError(null);
    if (!form.employeeId) { setError('Pilih karyawan terlebih dahulu.'); return; }
    if (!form.tanggalMulai || !form.tanggalSelesai) { setError('Tanggal mulai dan tanggal selesai wajib diisi.'); return; }
    if (form.tanggalSelesai < form.tanggalMulai) { setError('Tanggal selesai tidak boleh sebelum tanggal mulai.'); return; }
    if (!form.alasan.trim()) { setError('Alasan wajib diisi.'); return; }

    setSaving(true);
    try {
      const payload = new FormData();
      payload.append('employeeId', form.employeeId);
      payload.append('jenis', form.jenis);
      payload.append('tanggalMulai', form.tanggalMulai);
      payload.append('tanggalSelesai', form.tanggalSelesai);
      payload.append('alasan', form.alasan.trim());
      if (lampiran) payload.append('lampiran', lampiran);

      const res = await fetch('/api/leave-requests/admin', { method: 'POST', body: payload });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'Gagal mencatat pengajuan.');
        return;
      }
      onSaved?.(json);
    } catch {
      setError('Gagal mencatat pengajuan. Periksa koneksi internet kamu.');
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';
  const wajibLampiran = JENIS_CUTI[form.jenis]?.lampiranWajibMinHari;

  return (
    <div className="fixed inset-0 z-[1000] bg-black/40 flex items-center justify-center px-4" onClick={handleBackdropClick}>
      <form
        onSubmit={handleSubmit}
        className="bg-white border-t-4 border-madael-red w-full max-w-[480px] max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-serif text-xl text-black mb-1">Catat Cuti / Sakit / Izin</h2>
        <p className="text-xs text-[#6B6B6B] mb-4">
          Atas nama karyawan. Langsung berstatus disetujui, kuota cuti tahunan ikut terpotong, dan karyawan diberi notifikasi.
        </p>

        <div className="flex flex-col gap-4 mb-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[#6B6B6B]">Karyawan</span>
            <select value={form.employeeId} onChange={set('employeeId')} disabled={loadingKaryawan || saving} className={inputClass}>
              <option value="">{loadingKaryawan ? 'Memuat karyawan...' : 'Pilih karyawan'}</option>
              {karyawan.map((k) => (
                <option key={k.id} value={k.id}>{k.nama || '(tanpa nama)'}</option>
              ))}
            </select>
            {karyawanError && <span className="text-xs text-red-600">{karyawanError}</span>}
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-[#6B6B6B]">Jenis</span>
            <select value={form.jenis} onChange={set('jenis')} disabled={saving} className={inputClass}>
              {Object.entries(JENIS_CUTI).map(([key, cfg]) => (
                <option key={key} value={key}>{cfg.label}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[#6B6B6B]">Tanggal mulai</span>
              <input type="date" value={form.tanggalMulai} onChange={set('tanggalMulai')} disabled={saving} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[#6B6B6B]">Tanggal selesai</span>
              <input type="date" value={form.tanggalSelesai} onChange={set('tanggalSelesai')} min={form.tanggalMulai || undefined} disabled={saving} className={inputClass} />
            </label>
          </div>
          <p className="text-[11px] text-[#9A9A9A] -mt-2">
            Hanya di tahun berjalan; tanggal mulai paling jauh {MAKS_HARI_LAMPAU_INPUT_HR} hari ke belakang. Hari dihitung dari jadwal kerja karyawan.
          </p>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-[#6B6B6B]">Alasan</span>
            <textarea
              value={form.alasan}
              onChange={set('alasan')}
              rows={3}
              maxLength={MAKS_ALASAN}
              disabled={saving}
              className={`${inputClass} resize-none`}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-[#6B6B6B]">
              Lampiran {wajibLampiran ? `(wajib untuk ${wajibLampiran} hari kerja atau lebih, mis. surat dokter)` : '(opsional)'}
            </span>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={handleFile}
              disabled={saving}
              className="text-sm text-[#6B6B6B] file:mr-3 file:border file:border-[#E0E0E0] file:bg-white file:px-3 file:py-1.5 file:text-xs file:text-black"
            />
          </label>
        </div>

        {error && <p className="text-xs text-red-600 mb-4">{error}</p>}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleBackdropClick}
            disabled={saving}
            className="border border-[#E0E0E0] text-black px-5 py-2 text-sm hover:border-madael-red transition-colors disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={saving || loadingKaryawan}
            className="bg-madael-red text-white px-5 py-2 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
          >
            {saving ? 'Menyimpan...' : 'Catat'}
          </button>
        </div>
      </form>
    </div>
  );
}
