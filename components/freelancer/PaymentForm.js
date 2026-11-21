'use client';

import { useState } from 'react';
import { callJsonApi } from '@/lib/apiClient';
import {
  PROFILE_PAYMENT_FIELDS,
  PROFILE_PAYMENT_LABEL,
  PROFILE_TEXT_MAX,
  validatePaymentInput,
} from '@/lib/freelancerProfile';

const inputClass =
  'w-full border border-[#E0E0E0] px-4 py-2.5 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors disabled:bg-[#F4F4F4] disabled:text-[#6B6B6B]';
const labelClass = 'block text-xs font-medium text-[#3D3D3D] mb-1.5';

// Batas ketikan per kolom. Nama bank dan nama pemilik mengikuti PROFILE_TEXT_MAX;
// rekening (40) dan NPWP/NIK (30) mengikuti batas teks mentah di VALIDATOR
// (lib/freelancerProfile.js) yang menampung spasi/strip/titik pemisah.
const MAX_LENGTH = {
  nama_bank: PROFILE_TEXT_MAX.nama_bank,
  nomor_rekening: 40,
  nama_pemilik_rekening: PROFILE_TEXT_MAX.nama_pemilik_rekening,
  npwp_nik: 30,
};

const PETUNJUK = {
  nama_bank: 'Contoh: BCA, Mandiri, BNI.',
  nomor_rekening: 'Angka 5–25 digit (spasi dan strip boleh).',
  nama_pemilik_rekening: 'Sesuai nama yang tertera di buku tabungan atau aplikasi bank.',
  npwp_nik: '15 atau 16 digit angka (titik, strip, dan spasi boleh).',
};

const INPUT_MODE = { nomor_rekening: 'numeric', npwp_nik: 'numeric' };

function nilaiAwal(payment) {
  return Object.fromEntries(PROFILE_PAYMENT_FIELDS.map((key) => [key, payment?.[key] ?? '']));
}

// Form data pembayaran (nama bank, nomor rekening, nama pemilik, NPWP/NIK).
// API: PATCH /api/freelancer/me/profile (FRE-TOOL-05). Validasi di sini memakai
// aturan yang sama dengan server (validatePaymentInput) hanya untuk pesan cepat;
// server tetap penjaga sebenarnya dan menormalisasi nilai (rekening/NPWP-NIK
// disimpan sebagai angka saja).
//
// State form diinisialisasi dari `payment` saat dipasang. Pemanggil memberi `key`
// baru setelah simpan berhasil supaya form dipasang ulang dengan nilai yang sudah
// dinormalisasi server.
//
// DATA SENSITIF: nilai tidak pernah dicatat ke console atau dimasukkan ke pesan.
// Props: payment (objek 4 kolom milik sendiri), onSaved(profile, tidakBerubah).
export default function PaymentForm({ payment, onSaved }) {
  const [awal] = useState(() => nilaiAwal(payment));
  const [values, setValues] = useState(awal);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const berubah = PROFILE_PAYMENT_FIELDS.some((key) => values[key].trim() !== awal[key].trim());

  const handleChange = (key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setFormError(null);
  };

  const handleSubmit = async () => {
    const input = Object.fromEntries(PROFILE_PAYMENT_FIELDS.map((key) => [key, values[key].trim()]));
    const { error } = validatePaymentInput(input);
    if (error) {
      setFormError(error);
      return;
    }

    setSaving(true);
    setFormError(null);
    const res = await callJsonApi('/api/freelancer/me/profile', 'PATCH', input);
    setSaving(false);
    if (!res.ok) {
      setFormError(res.error);
      return;
    }
    onSaved(res.data.profile, !!res.data.tidakBerubah);
  };

  return (
    <div>
      <p className="text-sm text-[#6B6B6B] mb-4">
        Isi keempat data berikut agar profil kamu dianggap lengkap. Data ini hanya dapat kamu lihat dan ubah sendiri.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {PROFILE_PAYMENT_FIELDS.map((key) => (
          <div key={key}>
            <label htmlFor={`fl-pay-${key}`} className={labelClass}>
              {PROFILE_PAYMENT_LABEL[key]} *
            </label>
            <input
              id={`fl-pay-${key}`}
              type="text"
              inputMode={INPUT_MODE[key]}
              value={values[key]}
              maxLength={MAX_LENGTH[key]}
              disabled={saving}
              onChange={(e) => handleChange(key, e.target.value)}
              className={inputClass}
              autoComplete="off"
            />
            <p className="text-xs text-[#9A9A9A] mt-1.5">{PETUNJUK[key]}</p>
          </div>
        ))}
      </div>

      {formError && (
        <p role="alert" className="text-sm text-black border-l-4 border-madael-red bg-[#FFF5F5] px-3 py-2 mt-4">
          {formError}
        </p>
      )}

      <div className="mt-5">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving || !berubah}
          className="bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Menyimpan...' : 'Simpan Data Pembayaran'}
        </button>
      </div>
    </div>
  );
}
