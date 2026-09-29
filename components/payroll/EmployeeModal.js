'use client';

import { useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useModalDismiss } from '@/lib/useModalDismiss';
import { STATUS_OPTIONS, NPWP_OPTIONS, PTKP_OPTIONS, JKK_SELECT_OPTIONS, formatNumberDisplay } from '@/lib/payrollConfig';
import NumberField from '@/components/payroll/NumberField';
import TextField from '@/components/payroll/TextField';
import SelectField from '@/components/payroll/SelectField';

export default function EmployeeModal({ clients, linkableEmployees, form, setForm, onClose, onSubmit, saving, saveError, isDirty }) {
  const set = (key) => (val) => setForm((f) => ({ ...f, [key]: val }));
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const handleModalBackdrop = useModalDismiss(true, onClose, undefined, isDirty);

  const updatePair = (idx, field, val) => {
    setForm((f) => {
      const next = [...f.komponen_lain];
      next[idx] = { ...next[idx], [field]: val };
      return { ...f, komponen_lain: next };
    });
  };
  const addPair = () => setForm((f) => ({ ...f, komponen_lain: [...f.komponen_lain, { key: '', value: 0 }] }));
  const removePair = (idx) =>
    setForm((f) => ({ ...f, komponen_lain: f.komponen_lain.filter((_, i) => i !== idx) }));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] p-4" onClick={handleModalBackdrop}>
      <div className="bg-white w-full max-w-[560px] max-h-[90vh] overflow-y-auto p-8 relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-6 right-6 text-[#6B6B6B] hover:text-black">
          <X size={20} />
        </button>
        <h2 className="text-lg font-semibold text-black mb-6">
          {form.id ? 'Edit Employee' : 'Tambah Employee'}
        </h2>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <SelectField
              label="Akun Absensi (Nama)"
              value={form.linked_employee_id}
              onChange={(val) => {
                const picked = linkableEmployees.find((e) => e.id === val);
                setForm((f) => ({
                  ...f,
                  linked_employee_id: val,
                  // Kalau memilih akun, nama ikut akun itu (satu sumber
                  // kebenaran = Employee List). Kalau balik ke "tidak ada
                  // akun", nama dikosongkan lagi supaya admin sadar harus
                  // isi manual, bukan diam-diam mempertahankan nama akun
                  // yang baru saja dilepas.
                  nama: picked?.nama || '',
                  client_id: f.client_id || picked?.client_id || '',
                }));
                setPendingConfirm(false);
              }}
              options={[{ value: '', label: '— Tidak ada akun (payroll-only) —' }, ...linkableEmployees.map((e) => ({ value: e.id, label: e.nama }))]}
            />
            {form.linked_employee_id ? (
              <p className="text-xs text-[#9A9A9A] mt-1">
                Nama: <span className="font-medium text-black">{form.nama || '—'}</span> (ikut Employee List, tidak bisa diketik manual di sini)
              </p>
            ) : (
              <div className="mt-2">
                <TextField label="Nama (manual, tanpa akun)" value={form.nama} onChange={set('nama')} />
              </div>
            )}
          </div>
          <SelectField
            label="Klien"
            value={form.client_id}
            onChange={set('client_id')}
            options={[{ value: '', label: '— Pilih Klien —' }, ...clients.map((c) => ({ value: c.id, label: c.nama_perusahaan }))]}
          />
          <TextField label="Posisi" value={form.posisi} onChange={set('posisi')} />
          <SelectField label="Status" value={form.status} onChange={set('status')} options={STATUS_OPTIONS} />
          <NumberField label="Gaji Pokok" value={form.gaji_pokok} onChange={set('gaji_pokok')} />
          <NumberField label="Allowance (Transport/Travel/Communication)" value={form.tunjangan} onChange={set('tunjangan')} />
          <SelectField label="Status PTKP" value={form.status_ptkp} onChange={set('status_ptkp')} options={PTKP_OPTIONS} />
          <SelectField label="Status NPWP" value={form.npwp_status} onChange={set('npwp_status')} options={NPWP_OPTIONS} />
          <TextField label="Nomor NPWP" value={form.npwp} onChange={set('npwp')} />
          <SelectField label="Tingkat Risiko JKK" value={form.jkk_rate} onChange={set('jkk_rate')} options={JKK_SELECT_OPTIONS} />
          <TextField label="Nomor BPJS Kesehatan" value={form.no_bpjs_kesehatan} onChange={set('no_bpjs_kesehatan')} />
          <TextField label="Nomor BPJS Ketenagakerjaan" value={form.no_bpjs_ketenagakerjaan} onChange={set('no_bpjs_ketenagakerjaan')} />
          <TextField label="Nama Rekening" value={form.nama_rekening} onChange={set('nama_rekening')} />
          <TextField label="No Rekening" value={form.no_rekening} onChange={set('no_rekening')} />
          <NumberField label="Jatah Cuti Tahunan (hari)" value={form.jatah_cuti_tahunan} onChange={set('jatah_cuti_tahunan')} />
        </div>

        <p className="text-xs text-[#9A9A9A] -mt-2 mb-4">
          Ini satu-satunya tempat isi/ubah NPWP, PTKP, JKK, no. rekening &amp; BPJS — Payslip &amp; Payroll Run otomatis narik dari sini, tidak diinput ulang di sana. Kalau employee ini punya akun absensi, pilih dari dropdown "Akun Absensi" — itu yang menyambungkan baris ini ke semua modul lain (Payslip, Absensi, dst). Kalau tidak punya akun (payroll-only), isi nama manual.
        </p>

        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[#6B6B6B]">Komponen Lain</span>
            <button onClick={addPair} className="text-xs text-madael-red hover:underline">
              + Tambah komponen
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {form.komponen_lain.map((p, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <input
                  type="text"
                  placeholder="mis. tunjangan_makan"
                  value={p.key}
                  onChange={(e) => updatePair(idx, 'key', e.target.value)}
                  className="flex-1 border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  value={formatNumberDisplay(p.value)}
                  onChange={(e) => updatePair(idx, 'value', e.target.value.replace(/[^\d]/g, ''))}
                  className="w-32 border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red"
                />
                <button onClick={() => removePair(idx)} className="text-[#6B6B6B] hover:text-madael-red">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {form.komponen_lain.length === 0 && (
              <p className="text-xs text-[#6B6B6B]">Belum ada komponen tambahan.</p>
            )}
          </div>
        </div>

        {pendingConfirm && (
          <div className="flex flex-col gap-2 bg-amber-50 border border-amber-300 text-amber-800 text-xs px-3 py-3 mb-4">
            <p>
              Employee ini belum terhubung ke akun absensi — sisa cuti dan penalty telat tidak akan
              terhitung otomatis untuk employee ini. Lanjutkan tanpa link akun?
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setPendingConfirm(false)} className="text-[#6B6B6B] hover:text-black">
                Batal
              </button>
              <button
                onClick={() => {
                  setPendingConfirm(false);
                  onSubmit();
                }}
                className="font-medium underline hover:text-amber-900"
              >
                Lanjutkan Tanpa Link
              </button>
            </div>
          </div>
        )}
        {saveError && (
          <div className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 mb-4">
            <span>{saveError}</span>
            <button onClick={onSubmit} className="shrink-0 underline font-medium hover:text-red-900">
              Coba Lagi
            </button>
          </div>
        )}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 text-sm text-[#6B6B6B] hover:text-black transition-colors">
            Batal
          </button>
          <button
            onClick={() => {
              if (!form.linked_employee_id) {
                setPendingConfirm(true);
                return;
              }
              onSubmit();
            }}
            disabled={saving || !form.nama.trim()}
            className="bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.02em] hover:bg-madael-dark transition-colors disabled:opacity-40"
          >
            {saving ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  );
}
