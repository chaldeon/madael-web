'use client';

import { useState } from 'react';

// Dropdown perusahaan (companies) + opsi tambah baru inline — dipakai di
// form Tambah & Edit Employee. Perusahaan baru langsung tersimpan ke
// `companies`, tabel yang sama dipakai Payroll Manager/CRM/dll.
export default function CompanySelect({ value, onChange, companies, onAddCompany, inputClass, labelClass }) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    const id = await onAddCompany(newName);
    setSaving(false);
    if (id) {
      onChange(id);
      setAdding(false);
      setNewName('');
    }
  };

  return (
    <div>
      <label className={labelClass}>Perusahaan</label>
      {!adding ? (
        <div className="flex gap-2">
          <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
            <option value="">— Pilih Perusahaan —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.nama_perusahaan}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="shrink-0 px-3 text-sm text-madael-red hover:text-madael-dark whitespace-nowrap"
          >
            + Baru
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nama perusahaan baru"
            className={inputClass}
          />
          <button
            type="button"
            disabled={saving}
            onClick={handleAdd}
            className="shrink-0 px-3 text-sm bg-madael-red text-white hover:bg-madael-dark disabled:opacity-50"
          >
            {saving ? '...' : 'Simpan'}
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setNewName(''); }}
            className="shrink-0 px-2 text-sm text-[#6B6B6B] hover:text-black"
          >
            Batal
          </button>
        </div>
      )}
    </div>
  );
}
