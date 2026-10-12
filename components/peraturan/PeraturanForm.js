'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import {
  JENIS_OPTIONS, STATUS_OPTIONS, TOPIK_OPTIONS, LIMITS, MIN_TAHUN, MAX_TAHUN,
  EMPTY_FORM, formFromRow, buildPayload, parseKeywords, labelPeraturan,
} from '@/lib/peraturanConfig';
import { Chip, inputClass, labelClass } from '@/components/peraturan/PeraturanParts';

// Form tambah (initialRow kosong) dan ubah (initialRow = baris peraturan).
// Hak tulis ditegakkan RLS (superadmin pemegang flag); halaman pembungkusnya
// hanya menyembunyikan form dari akun lain.
export default function PeraturanForm({ initialRow = null, employee }) {
  const supabase = createClient();
  const router = useRouter();
  const editing = !!initialRow;

  const [form, setForm] = useState(() => (initialRow ? formFromRow(initialRow) : EMPTY_FORM));
  const [baseline] = useState(() => JSON.stringify(initialRow ? formFromRow(initialRow) : EMPTY_FORM));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [duplicateId, setDuplicateId] = useState(null);

  const dirty = JSON.stringify(form) !== baseline;

  // Peringatan bawaan browser kalau tab ditutup/di-refresh saat ada isian belum disimpan.
  useEffect(() => {
    if (!dirty || saving) return undefined;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, saving]);

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));
  const toggleTopik = (t) =>
    setForm((prev) => ({
      ...prev,
      topik: prev.topik.includes(t) ? prev.topik.filter((x) => x !== t) : [...prev.topik, t],
    }));

  const keywordPreview = useMemo(() => parseKeywords(form.keywordsText), [form.keywordsText]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setError('');
    setDuplicateId(null);

    const { payload, error: validationError } = buildPayload(form);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);

    if (editing) {
      const { data, error: err } = await supabase
        .from('peraturan')
        .update(payload)
        .eq('id', initialRow.id)
        .select('id');

      if (err) {
        setSaving(false);
        await handleSaveError(err, 'Gagal menyimpan perubahan peraturan.');
        return;
      }
      if (!data || data.length === 0) {
        // RLS menolak diam-diam (0 baris) atau data sudah dihapus.
        setSaving(false);
        setError('Perubahan tidak tersimpan: kamu tidak punya izin, atau peraturan ini sudah dihapus.');
        return;
      }

      const changed = Object.keys(payload).filter(
        (k) => JSON.stringify(payload[k]) !== JSON.stringify(initialRow[k] ?? (Array.isArray(payload[k]) ? [] : null))
      );
      logActivity(supabase, {
        userId: employee.id,
        aksi: 'ubah_peraturan',
        targetTable: 'peraturan',
        targetId: initialRow.id,
        detail: { peraturan: labelPeraturan(payload), judul: payload.judul, kolom_berubah: changed },
      });
      router.push(`/employee/peraturan/${initialRow.id}`);
      return;
    }

    const { data, error: err } = await supabase.from('peraturan').insert([payload]).select('id').single();
    if (err) {
      setSaving(false);
      await handleSaveError(err, 'Gagal menyimpan peraturan.');
      return;
    }

    logActivity(supabase, {
      userId: employee.id,
      aksi: 'tambah_peraturan',
      targetTable: 'peraturan',
      targetId: data.id,
      detail: { peraturan: labelPeraturan(payload), judul: payload.judul },
    });
    router.push(`/employee/peraturan/${data.id}`);
  };

  // Duplikat (jenis + nomor + tahun) ditegakkan unique index di database;
  // di sini cuma pesan yang ramah + tautan ke peraturan yang sudah ada.
  async function handleSaveError(err, fallback) {
    if (err.code === '23505') {
      setError('Peraturan dengan jenis, nomor, dan tahun yang sama sudah ada.');
      const { data } = await supabase
        .from('peraturan')
        .select('id')
        .eq('jenis', form.jenis)
        .eq('tahun', Number(form.tahun))
        .eq('nomor', form.nomor.trim())
        .maybeSingle();
      if (data?.id && data.id !== initialRow?.id) setDuplicateId(data.id);
      return;
    }
    setError(friendlyError(err, fallback, { context: editing ? 'Ubah peraturan' : 'Tambah peraturan' }));
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-[#E0E0E0] border-t-4 border-t-madael-red p-6 md:p-8">
      {error && (
        <div className="mb-5 text-xs text-red-600">
          <p>{error}</p>
          {duplicateId && (
            <Link href={`/employee/peraturan/${duplicateId}`} className="text-madael-red hover:text-madael-dark underline">
              Buka peraturan yang sudah ada
            </Link>
          )}
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-4 mb-4">
        <div>
          <label className={labelClass} htmlFor="p-jenis">Jenis *</label>
          <select id="p-jenis" value={form.jenis} onChange={set('jenis')} className={inputClass}>
            {JENIS_OPTIONS.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="p-nomor">Nomor *</label>
          <input id="p-nomor" type="text" value={form.nomor} onChange={set('nomor')} maxLength={LIMITS.nomor} className={inputClass} placeholder="Sesuai penulisan resmi" />
        </div>
        <div>
          <label className={labelClass} htmlFor="p-tahun">Tahun *</label>
          <input id="p-tahun" type="number" inputMode="numeric" min={MIN_TAHUN} max={MAX_TAHUN} value={form.tahun} onChange={set('tahun')} className={inputClass} />
        </div>
      </div>

      <div className="mb-4">
        <label className={labelClass} htmlFor="p-judul">Judul *</label>
        <input id="p-judul" type="text" value={form.judul} onChange={set('judul')} maxLength={LIMITS.judul} className={inputClass} />
      </div>

      <div className="mb-4">
        <label className={labelClass} htmlFor="p-tentang">Tentang</label>
        <textarea id="p-tentang" rows={2} value={form.tentang} onChange={set('tentang')} maxLength={LIMITS.tentang} className={inputClass} />
      </div>

      <div className="grid md:grid-cols-3 gap-4 mb-4">
        <div>
          <label className={labelClass} htmlFor="p-ditetapkan">Tanggal Ditetapkan</label>
          <input id="p-ditetapkan" type="date" value={form.tanggal_ditetapkan} onChange={set('tanggal_ditetapkan')} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="p-berlaku">Tanggal Berlaku</label>
          <input id="p-berlaku" type="date" value={form.tanggal_berlaku} onChange={set('tanggal_berlaku')} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="p-status">Status *</label>
          <select id="p-status" value={form.status} onChange={set('status')} className={inputClass}>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="mb-4">
        <label className={labelClass} htmlFor="p-ringkasan">Ringkasan</label>
        <textarea id="p-ringkasan" rows={8} value={form.ringkasan} onChange={set('ringkasan')} maxLength={LIMITS.ringkasan} className={inputClass} placeholder="Catatan internal dengan kata-kata sendiri. Teks ditampilkan apa adanya (tanpa format HTML)." />
        <p className="text-[11px] text-[#9A9A9A] mt-1">{form.ringkasan.length.toLocaleString('id-ID')} / {LIMITS.ringkasan.toLocaleString('id-ID')} karakter</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className={labelClass} htmlFor="p-url-sumber">URL Sumber Resmi</label>
          <input id="p-url-sumber" type="url" value={form.url_sumber} onChange={set('url_sumber')} className={inputClass} placeholder="https://..." />
        </div>
        <div>
          <label className={labelClass} htmlFor="p-url-pdf">URL Berkas PDF (opsional)</label>
          <input id="p-url-pdf" type="url" value={form.url_pdf} onChange={set('url_pdf')} className={inputClass} placeholder="https://..." />
        </div>
      </div>

      <fieldset className="mb-4">
        <legend className={labelClass}>Topik</legend>
        <div className="flex flex-wrap gap-2">
          {TOPIK_OPTIONS.map((t) => (
            <Chip key={t} label={t} active={form.topik.includes(t)} onClick={() => toggleTopik(t)} />
          ))}
        </div>
      </fieldset>

      <div className="mb-6">
        <label className={labelClass} htmlFor="p-keywords">Keyword</label>
        <input id="p-keywords" type="text" value={form.keywordsText} onChange={set('keywordsText')} className={inputClass} placeholder="Pisahkan dengan koma, mis. uang pisah, masa kerja" />
        {keywordPreview.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {keywordPreview.map((kw) => <Chip key={kw} label={`#${kw}`} />)}
          </div>
        )}
        <p className="text-[11px] text-[#9A9A9A] mt-1">
          Otomatis diubah ke huruf kecil dan duplikat dibuang. Maksimal {LIMITS.keywords} keyword.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
        >
          {saving ? 'Menyimpan...' : editing ? 'Simpan Perubahan' : 'Simpan Peraturan'}
        </button>
        <Link
          href={editing ? `/employee/peraturan/${initialRow.id}` : '/employee/peraturan'}
          className="text-sm font-medium tracking-[0.02em] text-[#6B6B6B] hover:text-black"
        >
          Batal
        </Link>
      </div>
    </form>
  );
}
