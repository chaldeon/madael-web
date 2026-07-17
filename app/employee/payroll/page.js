'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { X, Plus, Pencil, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';

const STATUS_OPTIONS = ['PHL', 'Tetap'];

const EMPTY_FORM = {
  nama: '',
  client_id: '',
  posisi: '',
  status: 'PHL',
  gaji_pokok: 0,
  tunjangan: 0,
  komponen_lain: [], // [{ key, value }] saat di-edit, dikonversi ke/dari jsonb saat load/save
};

function formatRupiah(value) {
  return 'Rp ' + Math.round(value || 0).toLocaleString('id-ID');
}

function totalTunjangan(row) {
  const komponenTotal = Object.values(row.komponen_lain || {}).reduce(
    (sum, v) => sum + (Number(v) || 0),
    0
  );
  return (Number(row.tunjangan) || 0) + komponenTotal;
}

function objToPairs(obj) {
  return Object.entries(obj || {}).map(([key, value]) => ({ key, value }));
}

function pairsToObj(pairs) {
  const obj = {};
  for (const p of pairs) {
    if (p.key.trim()) obj[p.key.trim()] = Number(p.value) || 0;
  }
  return obj;
}

function NumberField({ label, value, onChange }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-[#6B6B6B]">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
      />
    </label>
  );
}

function TextField({ label, value, onChange }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-[#6B6B6B]">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
      />
    </label>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-[#6B6B6B]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
      >
        {options.map((opt) => (
          <option key={opt.value ?? opt} value={opt.value ?? opt}>
            {opt.label ?? opt}
          </option>
        ))}
      </select>
    </label>
  );
}

function EmployeeModal({ clients, form, setForm, onClose, onSubmit, saving }) {
  const set = (key) => (val) => setForm((f) => ({ ...f, [key]: val }));

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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] p-4">
      <div className="bg-white w-full max-w-[560px] max-h-[90vh] overflow-y-auto p-8 relative">
        <button onClick={onClose} className="absolute top-6 right-6 text-[#6B6B6B] hover:text-black">
          <X size={20} />
        </button>
        <h2 className="text-lg font-semibold text-black mb-6">
          {form.id ? 'Edit Employee' : 'Tambah Employee'}
        </h2>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <TextField label="Nama" value={form.nama} onChange={set('nama')} />
          <SelectField
            label="Klien"
            value={form.client_id}
            onChange={set('client_id')}
            options={[{ value: '', label: '— Pilih Klien —' }, ...clients.map((c) => ({ value: c.id, label: c.nama_klien }))]}
          />
          <TextField label="Posisi" value={form.posisi} onChange={set('posisi')} />
          <SelectField label="Status" value={form.status} onChange={set('status')} options={STATUS_OPTIONS} />
          <NumberField label="Gaji Pokok" value={form.gaji_pokok} onChange={set('gaji_pokok')} />
          <NumberField label="Tunjangan" value={form.tunjangan} onChange={set('tunjangan')} />
        </div>

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
                  type="number"
                  placeholder="0"
                  value={p.value}
                  onChange={(e) => updatePair(idx, 'value', e.target.value)}
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

        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 text-sm text-[#6B6B6B] hover:text-black transition-colors">
            Batal
          </button>
          <button
            onClick={onSubmit}
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

export default function PayrollManagerPage() {
  const supabase = createClient();

  const [clients, setClients] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterClient, setFilterClient] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: cl }, { data: emp }] = await Promise.all([
      supabase.from('payroll_clients').select('id, nama_klien').order('nama_klien', { ascending: true }),
      supabase
        .from('employees_master')
        .select('id, nama, client_id, posisi, status, gaji_pokok, tunjangan, komponen_lain, created_at')
        .order('created_at', { ascending: false }),
    ]);
    setClients(cl || []);
    setEmployees(emp || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  const clientName = (id) => clients.find((c) => c.id === id)?.nama_klien || '—';

  const filteredEmployees = useMemo(() => {
    if (!filterClient) return employees;
    return employees.filter((e) => e.client_id === filterClient);
  }, [employees, filterClient]);

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setForm({
      id: row.id,
      nama: row.nama,
      client_id: row.client_id || '',
      posisi: row.posisi || '',
      status: row.status || 'PHL',
      gaji_pokok: row.gaji_pokok || 0,
      tunjangan: row.tunjangan || 0,
      komponen_lain: objToPairs(row.komponen_lain),
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.nama.trim()) return;
    setSaving(true);

    const payload = {
      nama: form.nama.trim(),
      client_id: form.client_id || null,
      posisi: form.posisi.trim(),
      status: form.status,
      gaji_pokok: form.gaji_pokok,
      tunjangan: form.tunjangan,
      komponen_lain: pairsToObj(form.komponen_lain),
    };

    const { error } = form.id
      ? await supabase.from('employees_master').update(payload).eq('id', form.id)
      : await supabase.from('employees_master').insert(payload);

    setSaving(false);

    if (error) {
      alert('Gagal menyimpan: ' + error.message);
      return;
    }

    setModalOpen(false);
    loadData();
  };

  return (
    <div className="max-w-[1100px] mx-auto px-10 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-black">Payroll Manager</h1>
          <p className="text-sm text-[#6B6B6B] mt-1">
            Employee master data dan struktur gaji seluruh klien yang di-manage Madael.
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-madael-red text-white px-5 py-2.5 text-sm font-medium tracking-[0.02em] hover:bg-madael-dark transition-colors"
        >
          <Plus size={16} /> Tambah Employee
        </button>
      </div>

      <div className="mb-4">
        <SelectField
          label="Filter Klien"
          value={filterClient}
          onChange={setFilterClient}
          options={[{ value: '', label: 'Semua Klien' }, ...clients.map((c) => ({ value: c.id, label: c.nama_klien }))]}
        />
      </div>

      {loading ? (
        <p className="text-sm text-[#6B6B6B]">Memuat...</p>
      ) : filteredEmployees.length === 0 ? (
        <p className="text-sm text-[#6B6B6B]">Belum ada employee.</p>
      ) : (
        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
                <th className="px-4 py-3 font-medium">Nama</th>
                <th className="px-4 py-3 font-medium">Klien</th>
                <th className="px-4 py-3 font-medium">Posisi</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Gaji Pokok</th>
                <th className="px-4 py-3 font-medium text-right">Total Tunjangan</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.map((row) => (
                <tr key={row.id} className="border-b border-[#F0F0F0] last:border-0">
                  <td className="px-4 py-3 text-black">{row.nama}</td>
                  <td className="px-4 py-3 text-[#6B6B6B]">{clientName(row.client_id)}</td>
                  <td className="px-4 py-3 text-[#6B6B6B]">{row.posisi || '—'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2.5 py-1 text-[11px] font-medium rounded ${
                        row.status === 'Tetap' ? 'bg-[#E6F4EA] text-[#1E7A34]' : 'bg-[#F3F4F6] text-[#4B5563]'
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-black">{formatRupiah(row.gaji_pokok)}</td>
                  <td className="px-4 py-3 text-right text-black">{formatRupiah(totalTunjangan(row))}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(row)} className="text-[#6B6B6B] hover:text-madael-red">
                      <Pencil size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <EmployeeModal
          clients={clients}
          form={form}
          setForm={setForm}
          onClose={() => setModalOpen(false)}
          onSubmit={handleSubmit}
          saving={saving}
        />
      )}
    </div>
  );
}