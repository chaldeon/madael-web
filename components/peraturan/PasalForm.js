'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import {
  LIMITS, PASAL_DETAIL_COLUMNS, EMPTY_PASAL_FORM, pasalFormFromRow, buildPasalPayload,
  normalizeNomorPasal,
} from '@/lib/peraturanConfig';
import { inputClass, labelClass } from '@/components/peraturan/PeraturanParts';

// Form tambah (initialRow kosong) dan ubah pasal. Hak tulis ditegakkan RLS
// (superadmin pemegang flag); PasalList hanya menyembunyikan tombolnya.
//
// onSaved(row, { again }) — row = baris lengkap hasil simpan; again = true bila
// pengguna memilih "Simpan & tambah lagi".
export default function PasalForm({
  peraturanId, peraturanLabel, initialRow = null, nextUrutan, employee, onSaved, onCancel,
}) {
  const supabase = createClient();
  const editing = !!initialRow;

  const [form, setForm] = useState(() =>
    initialRow ? pasalFormFromRow(initialRow) : { ...EMPTY_PASAL_FORM, urutan: String(nextUrutan) }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const submit = async (again) => {
    if (saving) return;
    setError('');

    const { payload, error: validationError } = buildPasalPayload(form);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);

    if (editing) {
      const { data, error: err } = await supabase
        .from('peraturan_pasal')
        .update(payload)
        .eq('id', initialRow.id)
        .select(PASAL_DETAIL_COLUMNS);
      setSaving(false);

      if (err) {
        setError(mapSaveError(err, 'Gagal menyimpan perubahan pasal.', 'Ubah pasal'));
        return;
      }
      if (!data || data.length === 0) {
        // RLS menolak diam-diam (0 baris) atau pasal sudah dihapus.
        setError('Perubahan tidak tersimpan: kamu tidak punya izin, atau pasal ini sudah dihapus.');
        return;
      }

      const changed = Object.keys(payload).filter(
        (k) => JSON.stringify(payload[k]) !== JSON.stringify(initialRow[k] ?? null)
      );
      logActivity(supabase, {
        userId: employee.id,
        aksi: 'ubah_pasal_peraturan',
        targetTable: 'peraturan_pasal',
        targetId: initialRow.id,
        detail: {
          peraturan: peraturanLabel, peraturan_id: peraturanId,
          pasal: payload.nomor_pasal, kolom_berubah: changed,
        },
      });
      onSaved(data[0], { again: false });
      return;
    }

    const { data, error: err } = await supabase
      .from('peraturan_pasal')
      .insert([{ peraturan_id: peraturanId, ...payload }])
      .select(PASAL_DETAIL_COLUMNS)
      .single();
    setSaving(false);

    if (err) {
      setError(mapSaveError(err, 'Gagal menyimpan pasal.', 'Tambah pasal'));
      return;
    }

    logActivity(supabase, {
      userId: employee.id,
      aksi: 'tambah_pasal_peraturan',
      targetTable: 'peraturan_pasal',
      targetId: data.id,
      detail: { peraturan: peraturanLabel, peraturan_id: peraturanId, pasal: data.nomor_pasal },
    });
    onSaved(data, { again });
  };

  // Unique (peraturan_id, lower(nomor_pasal)) ditegakkan database; di sini pesan ramah.
  function mapSaveError(err, fallback, context) {
    if (err.code === '23505') {
      return `Pasal ${normalizeNomorPasal(form.nomor_pasal)} sudah ada di peraturan ini.`;
    }
    return friendlyError(err, fallback, { context });
  }

  return (
    <div className="border border-[#E0E0E0] border-l-4 border-l-madael-red bg-[#FAFAFA] p-4 md:p-5 mb-4">
      <h3 className="text-sm font-medium text-black mb-4">{editing ? `Ubah Pasal ${initialRow.nomor_pasal}` : 'Tambah Pasal'}</h3>

      {error && <p className="mb-4 text-xs text-red-600">{error}</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="col-span-1">
          <label className={labelClass} htmlFor="pasal-nomor">Nomor pasal *</label>
          <input
            id="pasal-nomor"
            type="text"
            value={form.nomor_pasal}
            onChange={set('nomor_pasal')}
            maxLength={LIMITS.pasalNomor}
            placeholder="mis. 59 atau 59A"
            className={inputClass}
          />
        </div>
        <div className="col-span-1">
          <label className={labelClass} htmlFor="pasal-urutan">Urutan *</label>
          <input
            id="pasal-urutan"
            type="number"
            min={0}
            max={LIMITS.pasalUrutanMax}
            step={1}
            value={form.urutan}
            onChange={set('urutan')}
            className={inputClass}
          />
        </div>
        <div className="col-span-2">
          <label className={labelClass} htmlFor="pasal-judul">Bab / bagian (opsional)</label>
          <input
            id="pasal-judul"
            type="text"
            value={form.judul}
            onChange={set('judul')}
            maxLength={LIMITS.pasalJudul}
            className={inputClass}
          />
        </div>
      </div>
      <p className="text-[11px] text-[#9A9A9A] mt-1">
        Urutan menentukan posisi pasal di daftar (angka kecil tampil lebih dulu). Pasal berurutan dengan bab/bagian yang sama dikelompokkan.
      </p>

      <div className="mt-4">
        <label className={labelClass} htmlFor="pasal-isi">Isi pasal *</label>
        <textarea
          id="pasal-isi"
          rows={8}
          value={form.isi}
          onChange={set('isi')}
          maxLength={LIMITS.pasalIsi}
          className={`${inputClass} leading-relaxed`}
        />
        <p className="text-[11px] text-[#9A9A9A] mt-1">{form.isi.length}/{LIMITS.pasalIsi} karakter. Teks biasa, tanpa format.</p>
      </div>

      <div className="mt-4">
        <label className={labelClass} htmlFor="pasal-catatan">Catatan internal (opsional)</label>
        <textarea
          id="pasal-catatan"
          rows={2}
          value={form.catatan}
          onChange={set('catatan')}
          maxLength={LIMITS.pasalCatatan}
          className={inputClass}
        />
      </div>

      <div className="flex flex-wrap gap-3 mt-5">
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={saving}
          className="bg-madael-red text-white px-5 py-2 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
        >
          {saving ? 'Menyimpan...' : 'Simpan'}
        </button>
        {!editing && (
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={saving}
            className="border border-[#E0E0E0] bg-white px-5 py-2 text-sm text-black hover:border-madael-red hover:text-madael-red transition-colors disabled:opacity-50"
          >
            Simpan & tambah lagi
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-5 py-2 text-sm text-[#6B6B6B] hover:text-black transition-colors disabled:opacity-50"
        >
          Batal
        </button>
      </div>
    </div>
  );
}
