'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { X, Plus, Pencil, Trash2, Calculator } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import { hitungPPh21TER, hitungBPJS, hitungBrutoPPh21, PTKP_DATA, JKK_OPTIONS } from '@/lib/payroll/calculations';

const STATUS_OPTIONS = ['PHL', 'Tetap'];
const NPWP_OPTIONS = [
  { value: '', label: '— Belum diisi —' },
  { value: 'ada', label: 'Ada NPWP' },
  { value: 'tidak', label: 'Tidak Ada NPWP' },
];
const PTKP_OPTIONS = [
  { value: '', label: '— Belum diisi —' },
  ...Object.entries(PTKP_DATA).map(([key, v]) => ({ value: key, label: v.label })),
];
const JKK_SELECT_OPTIONS = [
  { value: '', label: '— Belum diisi —' },
  ...JKK_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
];

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const EMPTY_FORM = {
  nama: '',
  client_id: '',
  posisi: '',
  status: 'PHL',
  gaji_pokok: 0,
  tunjangan: 0,
  komponen_lain: [], // [{ key, value }] saat di-edit, dikonversi ke/dari jsonb saat load/save
  linked_employee_id: '',
  status_ptkp: '',
  npwp_status: '',
  jkk_rate: '',
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

function EmployeeModal({ clients, linkableEmployees, form, setForm, onClose, onSubmit, saving, saveError }) {
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
          <SelectField
            label="Akun Absensi (opsional)"
            value={form.linked_employee_id}
            onChange={set('linked_employee_id')}
            options={[{ value: '', label: '— Belum terhubung —' }, ...linkableEmployees.map((e) => ({ value: e.id, label: e.nama }))]}
          />
          <SelectField label="Status PTKP" value={form.status_ptkp} onChange={set('status_ptkp')} options={PTKP_OPTIONS} />
          <SelectField label="Status NPWP" value={form.npwp_status} onChange={set('npwp_status')} options={NPWP_OPTIONS} />
          <SelectField label="Tingkat Risiko JKK" value={form.jkk_rate} onChange={set('jkk_rate')} options={JKK_SELECT_OPTIONS} />
        </div>

        <p className="text-xs text-[#9A9A9A] -mt-2 mb-4">
          "Akun Absensi", PTKP, NPWP, dan JKK dipakai untuk fitur Hitung PPh21/BPJS & referensi kehadiran — boleh dikosongkan dulu kalau belum ada datanya.
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

function HitungModal({ row, periode, onClose }) {
  const supabase = createClient();
  const [attSummary, setAttSummary] = useState(null);
  const [attLoading, setAttLoading] = useState(false);

  useEffect(() => {
    if (!row.linked_employee_id) {
      setAttSummary(null);
      return;
    }
    let cancelled = false;
    setAttLoading(true);
    const [year, month] = periode.split('-').map(Number);
    const firstDay = `${periode}-01`;
    const lastDayNum = new Date(year, month, 0).getDate();
    const lastDay = `${periode}-${String(lastDayNum).padStart(2, '0')}`;

    supabase
      .from('attendance')
      .select('clock_in, status_telat')
      .eq('employee_id', row.linked_employee_id)
      .gte('tanggal', firstDay)
      .lte('tanggal', lastDay)
      .then(({ data }) => {
        if (cancelled) return;
        const rows = data || [];
        setAttSummary({
          totalHadir: rows.filter((r) => r.clock_in).length,
          totalTelat: rows.filter((r) => r.status_telat).length,
        });
        setAttLoading(false);
      });

    return () => { cancelled = true; };
  }, [supabase, row.linked_employee_id, periode]);

  const gajiPokok = Number(row.gaji_pokok) || 0; // Gross Salary — basis BPJS
  const allowance = totalTunjangan(row); // tunjangan + komponen lain
  const totalGajiTakeHome = gajiPokok + allowance;

  const bpjs = row.jkk_rate != null ? hitungBPJS(gajiPokok, row.jkk_rate) : null;
  const brutoPPh21 = bpjs ? hitungBrutoPPh21(gajiPokok, allowance, bpjs) : null;
  const pph21 = (bpjs && row.status_ptkp) ? hitungPPh21TER(brutoPPh21, row.status_ptkp) : null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] p-4">
      <div className="bg-white w-full max-w-[560px] max-h-[90vh] overflow-y-auto p-8 relative">
        <button onClick={onClose} className="absolute top-6 right-6 text-[#6B6B6B] hover:text-black">
          <X size={20} />
        </button>
        <h2 className="text-lg font-semibold text-black mb-1">Preview Hitung — {row.nama}</h2>
        <p className="text-xs text-[#9A9A9A] mb-6">Periode {periode} · belum final run/approval.</p>

        <div className="text-sm mb-6 pb-4 border-b border-[#E0E0E0] flex flex-col gap-1">
          <div className="flex justify-between">
            <span className="text-[#6B6B6B]">Gaji Pokok (Basis BPJS)</span>
            <span className="text-black">{formatRupiah(gajiPokok)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#6B6B6B]">Tunjangan + Komponen Lain</span>
            <span className="text-black">{formatRupiah(allowance)}</span>
          </div>
          <div className="flex justify-between font-medium">
            <span className="text-black">Total Gaji</span>
            <span className="text-black">{formatRupiah(totalGajiTakeHome)}</span>
          </div>
        </div>

        <div className="mb-6">
          <h3 className="text-sm font-semibold text-black mb-2">PPh21 (TER Bulanan)</h3>
          {pph21 ? (
            <div className="text-sm text-[#6B6B6B] flex flex-col gap-1">
              <div className="flex justify-between"><span>Bruto PPh21 (Gaji + BPJS ditanggung perusahaan)</span><span className="text-black">{formatRupiah(brutoPPh21)}</span></div>
              <div className="flex justify-between"><span>Kategori TER</span><span className="text-black">{pph21.category}</span></div>
              <div className="flex justify-between"><span>Tarif</span><span className="text-black">{pph21.rate}%</span></div>
              <div className="flex justify-between font-medium"><span className="text-black">PPh21 Bulanan</span><span className="text-black">{formatRupiah(pph21.pph)}</span></div>
            </div>
          ) : !bpjs ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2">
              Tingkat Risiko JKK employee ini belum diisi — bruto PPh21 butuh BPJS employer dihitung dulu. Buka Edit Employee untuk melengkapi.
            </p>
          ) : (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2">
              Status PTKP employee ini belum diisi — buka Edit Employee untuk melengkapi.
            </p>
          )}
        </div>

        <div className="mb-6">
          <h3 className="text-sm font-semibold text-black mb-2">BPJS</h3>
          {bpjs ? (
            <div className="text-sm text-[#6B6B6B] flex flex-col gap-1">
              <div className="flex justify-between"><span>Tanggungan Perusahaan</span><span className="text-black">{formatRupiah(bpjs.totalEmployer)}</span></div>
              <div className="flex justify-between"><span>Potongan Karyawan</span><span className="text-black">{formatRupiah(bpjs.totalEmployee)}</span></div>
              <div className="flex justify-between font-medium"><span className="text-black">Grand Total BPJS</span><span className="text-black">{formatRupiah(bpjs.grandTotal)}</span></div>
            </div>
          ) : (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2">
              Tingkat Risiko JKK employee ini belum diisi — buka Edit Employee untuk melengkapi.
            </p>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-black mb-2">Referensi Kehadiran</h3>
          {!row.linked_employee_id ? (
            <p className="text-xs text-[#6B6B6B] bg-[#F4F4F4] border border-[#E0E0E0] px-3 py-2">
              Employee ini belum terhubung ke akun Absensi — data kehadiran tidak tersedia. Hubungkan lewat Edit Employee.
            </p>
          ) : attLoading ? (
            <p className="text-xs text-[#9A9A9A]">Memuat data kehadiran...</p>
          ) : (
            <div className="text-sm text-[#6B6B6B] flex flex-col gap-1">
              <div className="flex justify-between"><span>Total Hadir</span><span className="text-black">{attSummary?.totalHadir ?? 0} hari</span></div>
              <div className="flex justify-between"><span>Total Telat</span><span className="text-black">{attSummary?.totalTelat ?? 0} hari</span></div>
              <p className="text-[11px] text-[#9A9A9A] mt-1">Referensi saja — belum masuk rumus otomatis di atas. Potongan (Penalty) terkait telat/tidak hadir belum diimplementasikan, bruto PPh21 di atas dihitung dengan Penalty = Rp0.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PayrollManagerPage() {
  const supabase = createClient();

  const [clients, setClients] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [linkableEmployees, setLinkableEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [filterClient, setFilterClient] = useState('');
  const [periode, setPeriode] = useState(currentMonthValue());

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const [hitungRow, setHitungRow] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [clRes, empRes, linkableRes] = await Promise.all([
      supabase.from('payroll_clients').select('id, nama_klien').order('nama_klien', { ascending: true }),
      supabase
        .from('employees_master')
        .select('id, nama, client_id, posisi, status, gaji_pokok, tunjangan, komponen_lain, linked_employee_id, status_ptkp, npwp_status, jkk_rate, created_at')
        .order('created_at', { ascending: false }),
      supabase.from('employees').select('id, nama').eq('status', 'Aktif').order('nama'),
    ]);

    if (clRes.error || empRes.error || linkableRes.error) {
      setLoadError((clRes.error || empRes.error || linkableRes.error).message || 'Gagal memuat data payroll.');
      setLoading(false);
      return;
    }

    setClients(clRes.data || []);
    setEmployees(empRes.data || []);
    setLinkableEmployees(linkableRes.data || []);
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
      linked_employee_id: row.linked_employee_id || '',
      status_ptkp: row.status_ptkp || '',
      npwp_status: row.npwp_status || '',
      jkk_rate: row.jkk_rate ?? '',
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.nama.trim()) return;
    setSaving(true);
    setSaveError(null);

    const payload = {
      nama: form.nama.trim(),
      client_id: form.client_id || null,
      posisi: form.posisi.trim(),
      status: form.status,
      gaji_pokok: form.gaji_pokok,
      tunjangan: form.tunjangan,
      komponen_lain: pairsToObj(form.komponen_lain),
      linked_employee_id: form.linked_employee_id || null,
      status_ptkp: form.status_ptkp || null,
      npwp_status: form.npwp_status || null,
      jkk_rate: form.jkk_rate === '' ? null : Number(form.jkk_rate),
    };

    const { error } = form.id
      ? await supabase.from('employees_master').update(payload).eq('id', form.id)
      : await supabase.from('employees_master').insert(payload);

    setSaving(false);

    if (error) {
      setSaveError(error.message || 'Gagal menyimpan, coba lagi.');
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

      <div className="flex flex-wrap gap-3 mb-4">
        <SelectField
          label="Filter Klien"
          value={filterClient}
          onChange={setFilterClient}
          options={[{ value: '', label: 'Semua Klien' }, ...clients.map((c) => ({ value: c.id, label: c.nama_klien }))]}
        />
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[#6B6B6B]">Periode (untuk Hitung)</span>
          <input
            type="month"
            value={periode}
            onChange={(e) => setPeriode(e.target.value)}
            className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
          />
        </label>
      </div>

      {loading ? (
        <LoadingState label="Memuat data payroll..." />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={loadData} />
      ) : filteredEmployees.length === 0 ? (
        <div className="bg-white border border-[#E0E0E0]">
          <EmptyState
            message={
              filterClient
                ? 'Tidak ada employee untuk klien ini.'
                : 'Belum ada employee. Klik "Tambah Employee" untuk mulai.'
            }
          />
        </div>
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
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => setHitungRow(row)}
                        className="inline-flex items-center gap-1 text-xs text-madael-red hover:text-madael-dark font-medium"
                      >
                        <Calculator size={14} />
                        Hitung
                      </button>
                      <button onClick={() => openEdit(row)} className="text-[#6B6B6B] hover:text-madael-red">
                        <Pencil size={16} />
                      </button>
                    </div>
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
          linkableEmployees={linkableEmployees}
          form={form}
          setForm={setForm}
          onClose={() => setModalOpen(false)}
          onSubmit={handleSubmit}
          saving={saving}
          saveError={saveError}
        />
      )}

      {hitungRow && (
        <HitungModal
          row={hitungRow}
          periode={periode}
          onClose={() => setHitungRow(null)}
        />
      )}
    </div>
  );
}