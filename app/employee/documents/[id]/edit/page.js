'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';

const JENIS_LABEL = {
  PRO: 'Proposal',
  QUO: 'Quotation',
  PROQUO: 'Proposal & Quotation',
  AGR: 'Agreement / PKS',
  ADM: 'Surat Administrasi',
};

const DEFAULT_FEE_NOTE =
  'Fee kami belum termasuk PPN 11%, dan sudah termasuk PPh 2% yang berlaku, serta biaya di luar kantong ("OPE") terkait pekerjaan yang harus ditagihkan di muka.';

function inputClass() {
  return 'w-full border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';
}

function Label({ children, required }) {
  return (
    <label className="block text-xs font-medium text-[#6B6B6B] uppercase tracking-[0.04em] mb-1.5">
      {children} {required && <span className="text-madael-red">*</span>}
    </label>
  );
}

function FieldBlock({ label, required, children }) {
  return (
    <div className="mb-5">
      <Label required={required}>{label}</Label>
      {children}
    </div>
  );
}

function TextListEditor({ label, values, onChange, placeholder }) {
  return (
    <FieldBlock label={label}>
      <textarea
        value={values}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder={placeholder || 'Satu poin per baris'}
        className={inputClass()}
      />
      <p className="text-[11px] text-[#9A9A9A] mt-1">Tulis satu poin per baris.</p>
    </FieldBlock>
  );
}

// content dari DB untuk PROQUO/AGR/ADM menyimpan array (experts, others_points, points per fase)
// tapi editor TextListEditor & textarea poin butuh string multi-baris — ini konversi baliknya.
function toMultiline(value) {
  if (Array.isArray(value)) return value.join('\n');
  return value || '';
}

function normalizeContentForEdit(type, raw) {
  const content = { ...raw };
  if (type === 'PROQUO') {
    content.experts = toMultiline(content.experts);
    content.others_points = toMultiline(content.others_points);
    content.phases = (content.phases || [{ title: 'Phase I', points: '' }]).map((p) => ({
      ...p,
      points: toMultiline(p.points),
    }));
    content.fee_details = content.fee_details || [{ phase_label: 'Phase I', amount_note: '' }];
  }
  if (type === 'QUO') {
    content.items = content.items || [{ nama: '', qty: 1, harga_satuan: 0, subtotal: 0 }];
    content.diskon = content.diskon || 0;
  }
  if (type === 'AGR' || type === 'ADM') {
    content.pasal = content.pasal || [{ judul: '', isi: '' }];
  }
  return content;
}

// ---------- Field groups per jenis (sama seperti new/page.js) ----------

function ProposalFields({ content, setContent }) {
  const set = (key, value) => setContent((c) => ({ ...c, [key]: value }));
  return (
    <>
      <FieldBlock label="Perihal" required>
        <input className={inputClass()} value={content.perihal} onChange={(e) => set('perihal', e.target.value)} />
      </FieldBlock>
      <FieldBlock label="Latar Belakang">
        <textarea rows={4} className={inputClass()} value={content.latar_belakang} onChange={(e) => set('latar_belakang', e.target.value)} />
      </FieldBlock>
      <FieldBlock label="Scope Pekerjaan" required>
        <textarea rows={5} className={inputClass()} value={content.scope_pekerjaan} onChange={(e) => set('scope_pekerjaan', e.target.value)} />
      </FieldBlock>
      <div className="grid grid-cols-2 gap-4">
        <FieldBlock label="Jangka Waktu">
          <input className={inputClass()} value={content.jangka_waktu} onChange={(e) => set('jangka_waktu', e.target.value)} />
        </FieldBlock>
        <FieldBlock label="Nilai Estimasi (Rp)">
          <input type="number" className={inputClass()} value={content.nilai_estimasi} onChange={(e) => set('nilai_estimasi', e.target.value)} />
        </FieldBlock>
      </div>
      <FieldBlock label="Syarat dan Ketentuan">
        <textarea rows={4} className={inputClass()} value={content.syarat_ketentuan} onChange={(e) => set('syarat_ketentuan', e.target.value)} />
      </FieldBlock>
    </>
  );
}

function QuotationFields({ content, setContent }) {
  const set = (key, value) => setContent((c) => ({ ...c, [key]: value }));

  const updateItem = (idx, key, value) => {
    setContent((c) => {
      const items = [...c.items];
      items[idx] = { ...items[idx], [key]: value };
      if (key === 'qty' || key === 'harga_satuan') {
        const qty = Number(items[idx].qty) || 0;
        const harga = Number(items[idx].harga_satuan) || 0;
        items[idx].subtotal = qty * harga;
      }
      return { ...c, items };
    });
  };

  const addItem = () => setContent((c) => ({ ...c, items: [...c.items, { nama: '', qty: 1, harga_satuan: 0, subtotal: 0 }] }));
  const removeItem = (idx) => setContent((c) => ({ ...c, items: c.items.filter((_, i) => i !== idx) }));

  const subtotal = useMemo(() => content.items.reduce((sum, it) => sum + (Number(it.subtotal) || 0), 0), [content.items]);
  const total = subtotal - (Number(content.diskon) || 0);

  return (
    <>
      <FieldBlock label="Perihal" required>
        <input className={inputClass()} value={content.perihal} onChange={(e) => set('perihal', e.target.value)} />
      </FieldBlock>

      <div className="mb-5">
        <Label>Daftar Item / Layanan</Label>
        <div className="border border-[#E0E0E0]">
          {content.items.map((it, idx) => (
            <div key={idx} className="flex items-center gap-2 p-2 border-b border-[#F0F0F0] last:border-0">
              <input
                className="flex-1 border border-[#E0E0E0] px-2 py-1.5 text-sm focus:outline-none focus:border-madael-red"
                placeholder="Nama item"
                value={it.nama}
                onChange={(e) => updateItem(idx, 'nama', e.target.value)}
              />
              <input
                type="number"
                className="w-20 border border-[#E0E0E0] px-2 py-1.5 text-sm focus:outline-none focus:border-madael-red"
                placeholder="Qty"
                value={it.qty}
                onChange={(e) => updateItem(idx, 'qty', e.target.value)}
              />
              <input
                type="number"
                className="w-32 border border-[#E0E0E0] px-2 py-1.5 text-sm focus:outline-none focus:border-madael-red"
                placeholder="Harga satuan"
                value={it.harga_satuan}
                onChange={(e) => updateItem(idx, 'harga_satuan', e.target.value)}
              />
              <span className="w-32 text-sm text-right text-[#6B6B6B]">Rp {Number(it.subtotal || 0).toLocaleString('id-ID')}</span>
              <button type="button" onClick={() => removeItem(idx)} className="text-[#9A9A9A] hover:text-madael-red">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addItem}
          className="mt-2 flex items-center gap-1.5 text-xs font-medium text-madael-red hover:text-madael-dark"
        >
          <Plus size={14} /> Tambah Item
        </button>
      </div>

      <FieldBlock label="Diskon (Rp)">
        <input type="number" className={inputClass()} value={content.diskon} onChange={(e) => set('diskon', e.target.value)} />
      </FieldBlock>

      <div className="flex justify-end mb-5 text-sm">
        <div className="w-full max-w-[280px] space-y-1">
          <div className="flex justify-between text-[#6B6B6B]"><span>Subtotal</span><span>Rp {subtotal.toLocaleString('id-ID')}</span></div>
          <div className="flex justify-between font-semibold border-t border-[#E0E0E0] pt-1 text-black"><span>Total</span><span>Rp {total.toLocaleString('id-ID')}</span></div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FieldBlock label="Syarat Pembayaran">
          <textarea rows={3} className={inputClass()} value={content.syarat_pembayaran} onChange={(e) => set('syarat_pembayaran', e.target.value)} />
        </FieldBlock>
        <FieldBlock label="Masa Berlaku Quotation">
          <input className={inputClass()} value={content.masa_berlaku} onChange={(e) => set('masa_berlaku', e.target.value)} />
        </FieldBlock>
      </div>
    </>
  );
}

function ProposalQuotationFields({ content, setContent }) {
  const set = (key, value) => setContent((c) => ({ ...c, [key]: value }));

  const updatePhase = (idx, key, value) => setContent((c) => {
    const phases = [...c.phases];
    phases[idx] = { ...phases[idx], [key]: value };
    return { ...c, phases };
  });
  const addPhase = () => setContent((c) => ({ ...c, phases: [...c.phases, { title: `Phase ${c.phases.length + 1}`, points: '' }] }));
  const removePhase = (idx) => setContent((c) => ({ ...c, phases: c.phases.filter((_, i) => i !== idx) }));

  const updateFee = (idx, key, value) => setContent((c) => {
    const fee_details = [...c.fee_details];
    fee_details[idx] = { ...fee_details[idx], [key]: value };
    return { ...c, fee_details };
  });
  const addFee = () => setContent((c) => ({ ...c, fee_details: [...c.fee_details, { phase_label: '', amount_note: '' }] }));
  const removeFee = (idx) => setContent((c) => ({ ...c, fee_details: c.fee_details.filter((_, i) => i !== idx) }));

  return (
    <>
      <FieldBlock label="Perihal" required>
        <input className={inputClass()} value={content.perihal} onChange={(e) => set('perihal', e.target.value)} />
      </FieldBlock>
      <FieldBlock label="Description on Provided Services" required>
        <textarea rows={4} className={inputClass()} value={content.description_services} onChange={(e) => set('description_services', e.target.value)} />
      </FieldBlock>

      <div className="mb-5">
        <Label>Scope of Work (per fase)</Label>
        <div className="space-y-3">
          {content.phases.map((p, idx) => (
            <div key={idx} className="border border-[#E0E0E0] p-3">
              <div className="flex items-center gap-2 mb-2">
                <input
                  className="flex-1 border border-[#E0E0E0] px-2 py-1.5 text-sm font-medium focus:outline-none focus:border-madael-red"
                  placeholder="Judul fase, mis. Phase I"
                  value={p.title}
                  onChange={(e) => updatePhase(idx, 'title', e.target.value)}
                />
                <button type="button" onClick={() => removePhase(idx)} className="text-[#9A9A9A] hover:text-madael-red">
                  <Trash2 size={15} />
                </button>
              </div>
              <textarea
                rows={3}
                placeholder="Satu poin per baris"
                className={inputClass()}
                value={p.points}
                onChange={(e) => updatePhase(idx, 'points', e.target.value)}
              />
            </div>
          ))}
        </div>
        <button type="button" onClick={addPhase} className="mt-2 flex items-center gap-1.5 text-xs font-medium text-madael-red hover:text-madael-dark">
          <Plus size={14} /> Tambah Fase
        </button>
      </div>

      <TextListEditor label="Experts" values={content.experts} onChange={(v) => set('experts', v)} placeholder="Satu nama per baris" />

      <FieldBlock label="Period of Service">
        <input className={inputClass()} value={content.period} onChange={(e) => set('period', e.target.value)} />
      </FieldBlock>

      <div className="mb-5">
        <Label>Details of Fee (per fase)</Label>
        <div className="space-y-2">
          {content.fee_details.map((f, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                className="w-40 border border-[#E0E0E0] px-2 py-1.5 text-sm focus:outline-none focus:border-madael-red"
                placeholder="Fase, mis. Phase I"
                value={f.phase_label}
                onChange={(e) => updateFee(idx, 'phase_label', e.target.value)}
              />
              <input
                className="flex-1 border border-[#E0E0E0] px-2 py-1.5 text-sm focus:outline-none focus:border-madael-red"
                placeholder="Keterangan fee, mis. IDR 50.000.000 (gross)"
                value={f.amount_note}
                onChange={(e) => updateFee(idx, 'amount_note', e.target.value)}
              />
              <button type="button" onClick={() => removeFee(idx)} className="text-[#9A9A9A] hover:text-madael-red">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addFee} className="mt-2 flex items-center gap-1.5 text-xs font-medium text-madael-red hover:text-madael-dark">
          <Plus size={14} /> Tambah Baris Fee
        </button>
      </div>

      <FieldBlock label="Fee not Included">
        <textarea rows={3} className={inputClass()} value={content.fee_not_included} onChange={(e) => set('fee_not_included', e.target.value)} />
      </FieldBlock>

      <TextListEditor label="Others" values={content.others_points} onChange={(v) => set('others_points', v)} />
    </>
  );
}

function AgreementFields({ content, setContent }) {
  const set = (key, value) => setContent((c) => ({ ...c, [key]: value }));

  const updatePasal = (idx, key, value) => setContent((c) => {
    const pasal = [...c.pasal];
    pasal[idx] = { ...pasal[idx], [key]: value };
    return { ...c, pasal };
  });
  const addPasal = () => setContent((c) => ({ ...c, pasal: [...c.pasal, { judul: '', isi: '' }] }));
  const removePasal = (idx) => setContent((c) => ({ ...c, pasal: c.pasal.filter((_, i) => i !== idx) }));

  return (
    <>
      <FieldBlock label="Perihal" required>
        <input className={inputClass()} value={content.perihal} onChange={(e) => set('perihal', e.target.value)} />
      </FieldBlock>
      <div className="grid grid-cols-2 gap-4">
        <FieldBlock label="Pihak Pertama (Konsultan)" required>
          <input className={inputClass()} value={content.pihak_pertama} onChange={(e) => set('pihak_pertama', e.target.value)} />
        </FieldBlock>
        <FieldBlock label="Pihak Kedua (Klien)" required>
          <input className={inputClass()} value={content.pihak_kedua} onChange={(e) => set('pihak_kedua', e.target.value)} />
        </FieldBlock>
      </div>
      <FieldBlock label="Scope Pekerjaan" required>
        <textarea rows={4} className={inputClass()} value={content.scope_pekerjaan} onChange={(e) => set('scope_pekerjaan', e.target.value)} />
      </FieldBlock>
      <div className="grid grid-cols-2 gap-4">
        <FieldBlock label="Nilai Kontrak (Rp, opsional)">
          <input className={inputClass()} value={content.nilai_kontrak} onChange={(e) => set('nilai_kontrak', e.target.value)} placeholder="Kosongkan kalau tidak ada nilai tetap" />
        </FieldBlock>
        <FieldBlock label="Jangka Waktu">
          <input className={inputClass()} value={content.jangka_waktu} onChange={(e) => set('jangka_waktu', e.target.value)} />
        </FieldBlock>
      </div>
      <FieldBlock label="Syarat dan Ketentuan (umum)">
        <textarea rows={3} className={inputClass()} value={content.syarat_ketentuan} onChange={(e) => set('syarat_ketentuan', e.target.value)} />
      </FieldBlock>

      <div className="mb-2">
        <Label>Pasal-Pasal</Label>
        <div className="space-y-3">
          {content.pasal.map((p, idx) => (
            <div key={idx} className="border border-[#E0E0E0] p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-[#6B6B6B] w-14">Pasal {idx + 1}</span>
                <input
                  className="flex-1 border border-[#E0E0E0] px-2 py-1.5 text-sm font-medium focus:outline-none focus:border-madael-red"
                  placeholder="Judul pasal, mis. TUJUAN PERJANJIAN"
                  value={p.judul}
                  onChange={(e) => updatePasal(idx, 'judul', e.target.value)}
                />
                <button type="button" onClick={() => removePasal(idx)} className="text-[#9A9A9A] hover:text-madael-red">
                  <Trash2 size={15} />
                </button>
              </div>
              <textarea
                rows={3}
                placeholder="Isi pasal"
                className={inputClass()}
                value={p.isi}
                onChange={(e) => updatePasal(idx, 'isi', e.target.value)}
              />
            </div>
          ))}
        </div>
        <button type="button" onClick={addPasal} className="mt-2 flex items-center gap-1.5 text-xs font-medium text-madael-red hover:text-madael-dark">
          <Plus size={14} /> Tambah Pasal
        </button>
      </div>
    </>
  );
}

// ---------- Halaman utama ----------

export default function EditDocumentPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();

  const [docMeta, setDocMeta] = useState(null); // { id, nomor_surat, kode_jenis }
  const [judul, setJudul] = useState('');
  const [clientId, setClientId] = useState('');
  const [tanggalDokumen, setTanggalDokumen] = useState('');
  const [catatan, setCatatan] = useState('');
  const [content, setContent] = useState(null);

  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [canEdit, setCanEdit] = useState(null); // null = belum dicek, true/false setelah resolve

  const checkCanEdit = useCallback(async (createdBy) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setCanEdit(false); return; }
    const { data: emp } = await supabase
      .from('employees')
      .select('id, is_superadmin')
      .eq('email', user.email)
      .maybeSingle();
    if (!emp) { setCanEdit(false); return; }
    if (emp.is_superadmin || emp.id === createdBy) { setCanEdit(true); return; }
    const { data: mod } = await supabase
      .from('employee_modules')
      .select('module_name')
      .eq('employee_id', emp.id)
      .eq('module_name', 'document_manage')
      .maybeSingle();
    setCanEdit(!!mod);
  }, [supabase]);

  const loadClients = useCallback(async () => {
    const { data } = await supabase
      .from('clients')
      .select('id, nama_perusahaan, pic_nama')
      .eq('is_active', true)
      .order('nama_perusahaan', { ascending: true });
    setClients(data || []);
  }, [supabase]);

  const loadDoc = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setNotFound(false);
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('id', params.id)
      .maybeSingle();

    if (error) {
      setLoadError(error.message || 'Gagal memuat data dokumen.');
      setLoading(false);
      return;
    }
    if (!data) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    setDocMeta({ id: data.id, nomor_surat: data.nomor_surat, kode_jenis: data.kode_jenis });
    setJudul(data.judul || '');
    setClientId(data.client_id || '');
    setTanggalDokumen(data.tanggal_dokumen ? data.tanggal_dokumen.slice(0, 10) : '');
    setCatatan(data.catatan || '');
    setContent(normalizeContentForEdit(data.kode_jenis, data.content || {}));
    setLoading(false);
    checkCanEdit(data.created_by);
  }, [supabase, params.id, checkCanEdit]);

  useEffect(() => {
    loadClients();
    loadDoc();
  }, [loadClients, loadDoc]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!judul.trim()) {
      setError('Judul dokumen wajib diisi.');
      return;
    }
    if (!content.perihal || !content.perihal.trim()) {
      setError('Perihal wajib diisi.');
      return;
    }

    setSaving(true);
    try {
      const type = docMeta.kode_jenis;
      const finalContent = { ...content };

      if (type === 'PROQUO') {
        finalContent.experts = content.experts.split('\n').map((s) => s.trim()).filter(Boolean);
        finalContent.others_points = content.others_points.split('\n').map((s) => s.trim()).filter(Boolean);
        finalContent.phases = content.phases.map((p) => ({
          ...p,
          points: p.points.split('\n').map((s) => s.trim()).filter(Boolean),
        }));
      }
      if (type === 'QUO') {
        const subtotal = content.items.reduce((sum, it) => sum + (Number(it.subtotal) || 0), 0);
        finalContent.subtotal = subtotal;
        finalContent.total = subtotal - (Number(content.diskon) || 0);
      }

      const { error: updateError } = await supabase
        .from('documents')
        .update({
          judul: judul.trim(),
          client_id: clientId || null,
          content: finalContent,
          catatan: catatan.trim() || null,
          tanggal_dokumen: tanggalDokumen,
        })
        .eq('id', docMeta.id);

      if (updateError) throw new Error(updateError.message);

      router.push(`/employee/documents/${docMeta.id}`);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-[800px] mx-auto px-6 py-10">
        <LoadingState label="Memuat dokumen..." />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-[420px] mx-auto px-6 py-10">
        <ErrorState message={loadError} onRetry={loadDoc} />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="max-w-[700px] mx-auto px-6 py-10">
        <p className="text-sm text-black mb-6">Dokumen tidak ditemukan.</p>
        <Link href="/employee/documents" className="inline-flex items-center gap-1.5 text-sm text-madael-red hover:underline">
          <ArrowLeft size={15} />
          Kembali ke Dokumen
        </Link>
      </div>
    );
  }

  if (canEdit === false) {
    return (
      <div className="max-w-[700px] mx-auto px-6 py-10">
        <p className="text-sm text-black mb-6">Kamu tidak punya akses untuk mengedit dokumen ini — hanya pembuat dokumen atau yang punya izin "Kelola Dokumen" yang bisa.</p>
        <Link href={`/employee/documents/${params.id}`} className="inline-flex items-center gap-1.5 text-sm text-madael-red hover:underline">
          <ArrowLeft size={15} />
          Kembali ke Dokumen
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-[800px] mx-auto px-6 py-10">
      <Link href={`/employee/documents/${docMeta.id}`} className="inline-flex items-center gap-1.5 text-sm text-[#6B6B6B] hover:text-madael-red transition-colors mb-6">
        <ArrowLeft size={15} />
        Kembali ke Dokumen
      </Link>

      <div className="mb-8">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Edit — {JENIS_LABEL[docMeta.kode_jenis] || docMeta.kode_jenis}</h1>
        <p className="text-sm text-[#6B6B6B] mt-1">Nomor Surat: <span className="font-medium text-black">{docMeta.nomor_surat}</span> (tidak berubah)</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white border border-[#E0E0E0] p-8 sm:p-10">
        <FieldBlock label="Judul Dokumen (internal)" required>
          <input className={inputClass()} value={judul} onChange={(e) => setJudul(e.target.value)} />
        </FieldBlock>

        <div className="grid grid-cols-2 gap-4">
          <FieldBlock label="Klien Terkait">
            <select className={inputClass()} value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">— Tidak ada / belum dipilih —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nama_perusahaan}{c.pic_nama ? ` (${c.pic_nama})` : ''}
                </option>
              ))}
            </select>
          </FieldBlock>
          <FieldBlock label="Tanggal Dokumen">
            <input type="date" className={inputClass()} value={tanggalDokumen} onChange={(e) => setTanggalDokumen(e.target.value)} />
          </FieldBlock>
        </div>

        <div className="border-t border-[#E0E0E0] pt-6 mt-2">
          {docMeta.kode_jenis === 'PRO' && <ProposalFields content={content} setContent={setContent} />}
          {docMeta.kode_jenis === 'QUO' && <QuotationFields content={content} setContent={setContent} />}
          {docMeta.kode_jenis === 'PROQUO' && <ProposalQuotationFields content={content} setContent={setContent} />}
          {docMeta.kode_jenis === 'AGR' && <AgreementFields content={content} setContent={setContent} />}
          {docMeta.kode_jenis === 'ADM' && <AgreementFields content={content} setContent={setContent} />}
        </div>

        <FieldBlock label="Catatan Internal (opsional)">
          <textarea rows={2} className={inputClass()} value={catatan} onChange={(e) => setCatatan(e.target.value)} />
        </FieldBlock>

        {error && <p className="text-sm text-madael-red mb-4">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <Link href={`/employee/documents/${docMeta.id}`} className="px-5 py-2.5 text-sm font-medium text-[#4B5563] hover:text-black transition-colors">
            Batal
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.02em] hover:bg-madael-dark transition-colors disabled:opacity-60"
          >
            {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
          </button>
        </div>
      </form>
    </div>
  );
}