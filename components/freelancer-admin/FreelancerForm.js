'use client';

import { FREELANCER_TEXT_MAX } from '@/lib/freelancerAdminConfig';

const inputClass =
  'w-full border border-[#E0E0E0] px-4 py-2.5 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors disabled:bg-[#F4F4F4] disabled:text-[#6B6B6B]';
const labelClass = 'block text-xs font-medium text-[#3D3D3D] mb-1.5';

// Kolom data dasar Freelancer (yang diisi/dikelola admin), dipakai halaman Tambah
// dan halaman Detail/Edit. Komponen terkontrol: state ada di halaman pemanggil.
//   form        : { nama_lengkap, email, no_whatsapp, alamat, tanggal_bergabung }
//   onChange    : (field, value) => void
//   emailLocked : true di halaman edit (email = identitas login, tidak diubah di sini)
//   disabled    : true saat menyimpan
export default function FreelancerForm({ form, onChange, emailLocked = false, disabled = false }) {
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="fl-nama" className={labelClass}>Nama Lengkap *</label>
        <input
          id="fl-nama"
          type="text"
          value={form.nama_lengkap}
          maxLength={FREELANCER_TEXT_MAX.nama_lengkap}
          disabled={disabled}
          onChange={(e) => onChange('nama_lengkap', e.target.value)}
          className={inputClass}
          autoComplete="off"
        />
      </div>

      <div>
        <label htmlFor="fl-email" className={labelClass}>Email *</label>
        <input
          id="fl-email"
          type="email"
          value={form.email}
          maxLength={FREELANCER_TEXT_MAX.email}
          disabled={disabled || emailLocked}
          onChange={(e) => onChange('email', e.target.value)}
          className={inputClass}
          autoComplete="off"
        />
        <p className="text-xs text-[#9A9A9A] mt-1.5">
          {emailLocked
            ? 'Email dipakai untuk login dan tidak bisa diubah dari sini.'
            : 'Undangan untuk membuat password dikirim ke email ini. Harus berbeda dari email karyawan.'}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="fl-wa" className={labelClass}>Nomor WhatsApp</label>
          <input
            id="fl-wa"
            type="tel"
            value={form.no_whatsapp}
            maxLength={FREELANCER_TEXT_MAX.no_whatsapp}
            disabled={disabled}
            onChange={(e) => onChange('no_whatsapp', e.target.value)}
            placeholder="081234567890"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="fl-tanggal" className={labelClass}>Tanggal Bergabung</label>
          <input
            id="fl-tanggal"
            type="date"
            value={form.tanggal_bergabung}
            disabled={disabled}
            onChange={(e) => onChange('tanggal_bergabung', e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor="fl-alamat" className={labelClass}>Alamat</label>
        <textarea
          id="fl-alamat"
          rows={3}
          value={form.alamat}
          maxLength={FREELANCER_TEXT_MAX.alamat}
          disabled={disabled}
          onChange={(e) => onChange('alamat', e.target.value)}
          className={`${inputClass} resize-y`}
        />
      </div>
    </div>
  );
}
