'use client';

export const dynamic = 'force-dynamic';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus, X } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';

const TYPE_LABEL = {
  PRO: 'Proposal',
  QUO: 'Quotation',
  AGR: 'Agreement',
  ADM: 'Administrasi',
};

const inputClass =
  'w-full border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';
const labelClass = 'block text-xs font-medium text-[#6B6B6B] mb-1';
const textareaClass = inputClass + ' resize-y min-h-[90px]';

function formatRupiah(value) {
  return 'Rp ' + Math.round(value || 0).toLocaleString('id-ID');
}

function emptyItem() {
  return { id: crypto.randomUUID(), nama: '', qty: 1, harga_satuan: 0 };
}

function emptyPasal() {
  return { id: crypto.randomUUID(), judul: '', isi: '' };
}

function NewDocumentForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const type = (searchParams.get('type') || '').toUpperCase();
  const supabase = createClient();

  const [clients, setClients] = useState([]);
  const [employeeId, setEmployeeId] = useState(null);
  const [loadingContext, setLoadingContext] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  // ---- Field umum ----
  const [judul, setJudul] = useState('');
  const [clientId, setClientId] = useState('');
  const [tanggalDokumen, setTanggalDokumen] = useState(() => new Date().toISOString().slice(0, 10));
  const [catatan, setCatatan] = useState('');

  // ---- PRO ----
  const [proPerihal, setProPerihal] = useState('');
  const [proLatarBelakang, setProLatarBelakang] = useState('');
  const [proScope, setProScope] = useState('');
  const [proJangkaWaktu, setProJangkaWaktu] = useState('');
  const [proNilaiEstimasi, setProNilaiEstimasi] = useState(0);
  const [proSyarat, setProSyarat] = useState('');

  // ---- QUO ----
  const [quoPerihal, setQuoPerihal] = useState('');
  const [quoItems, setQuoItems] = useState([emptyItem()]);
  const [quoDiskon, setQuoDiskon] = useState(0);
  const [quoSyaratPembayaran, setQuoSyaratPembayaran] = useState('');
  const [quoMasaBerlaku, setQuoMasaBerlaku] = useState('');

  // ---- AGR ----
  const [agrPerihal, setAgrPerihal] = useState('');
  const [agrPihakPertama, setAgrPihakPertama] = useState('PT. Madael Prima Sejahtera Indonesia');
  const [agrPihakKedua, setAgrPihakKedua] = useState('');
  const [agrScope, setAgrScope] = useState('');
  const [agrNilaiKontrak, setAgrNilaiKontrak] = useState(0);
  const [agrJangkaWaktu, setAgrJangkaWaktu] = useState('');
  const [agrSyarat, setAgrSyarat] = useState('');
  const [agrPasal, setAgrPasal] = useState([emptyPasal()]);

  // ---- ADM ----
  const [admPerihal, setAdmPerihal] = useState('');
  const [admIsiSurat, setAdmIsiSurat] = useState('');

  const loadContext = useCallback(async () => {
    setLoadingContext(true);
    const [{ data: cl }, { data: { user } }] = await Promise.all([
      supabase.from('clients').select('id, nama_perusahaan').eq('is_active', true).order('nama_perusahaan'),
      supabase.auth.getUser(),
    ]);
    setClients(cl || []);

    if (user) {
      const { data: emp } = await supabase
        .from('employees')
        .select('id')
        .eq('email', user.email)
        .maybeSingle();
      setEmployeeId(emp?.id || null);
    }
    setLoadingContext(false);
  }, [supabase]);

  useEffect(() => {
    loadContext();
  }, [loadContext]);

  // Sync nilai default pihak kedua saat klien dipilih (Agreement)
  useEffect(() => {
    if (type === 'AGR' && clientId) {
      const c = clients.find((cl) => cl.id === clientId);
      if (c) setAgrPihakKedua(c.nama_perusahaan);
    }
  }, [clientId, clients, type]);

  const updateItem = (id, field, value) => {
    setQuoItems((items) => items.map((it) => (it.id === id ? { ...it, [field]: value } : it)));
  };
  const addItem = () => setQuoItems((items) => [...items, emptyItem()]);
  const removeItem = (id) => setQuoItems((items) => (items.length > 1 ? items.filter((it) => it.id !== id) : items));

  const quoSubtotal = quoItems.reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.harga_satuan) || 0), 0);
  const quoTotal = Math.max(quoSubtotal - (Number(quoDiskon) || 0), 0);

  const updatePasal = (id, field, value) => {
    setAgrPasal((list) => list.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  };
  const addPasal = () => setAgrPasal((list) => [...list, emptyPasal()]);
  const removePasal = (id) => setAgrPasal((list) => (list.length > 1 ? list.filter((p) => p.id !== id) : list));

  const buildContent = () => {
    if (type === 'PRO') {
      return {
        perihal: proPerihal,
        latar_belakang: proLatarBelakang,
        scope_pekerjaan: proScope,
        jangka_waktu: proJangkaWaktu,
        nilai_estimasi: Number(proNilaiEstimasi) || 0,
        syarat_ketentuan: proSyarat,
      };
    }
    if (type === 'QUO') {
      return {
        perihal: quoPerihal,
        items: quoItems.map((it) => ({
          nama: it.nama,
          qty: Number(it.qty) || 0,
          harga_satuan: Number(it.harga_satuan) || 0,
          subtotal: (Number(it.qty) || 0) * (Number(it.harga_satuan) || 0),
        })),
        subtotal: quoSubtotal,
        diskon: Number(quoDiskon) || 0,
        total: quoTotal,
        syarat_pembayaran: quoSyaratPembayaran,
        masa_berlaku: quoMasaBerlaku,
      };
    }
    if (type === 'AGR') {
      return {
        perihal: agrPerihal,
        pihak_pertama: agrPihakPertama,
        pihak_kedua: agrPihakKedua,
        scope_pekerjaan: agrScope,
        nilai_kontrak: Number(agrNilaiKontrak) || 0,
        jangka_waktu: agrJangkaWaktu,
        syarat_ketentuan: agrSyarat,
        pasal: agrPasal.map((p) => ({ judul: p.judul, isi: p.isi })),
      };
    }
    if (type === 'ADM') {
      return {
        perihal: admPerihal,
        isi_surat: admIsiSurat,
      };
    }
    return {};
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);

    if (!judul.trim()) {
      setFormError('Judul dokumen wajib diisi.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/documents/generate-number', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kode: type }),
      });
      const numberData = await res.json();

      if (!res.ok) {
        setFormError(numberData.error || 'Gagal generate nomor surat.');
        setSubmitting(false);
        return;
      }

      const { data, error } = await supabase
        .from('documents')
        .insert([
          {
            nomor_surat: numberData.nomor_surat,
            kode_jenis: type,
            judul,
            client_id: clientId || null,
            created_by: employeeId,
            status: 'Draft',
            content: buildContent(),
            catatan,
            tanggal_dokumen: tanggalDokumen,
          },
        ])
        .select()
        .single();

      if (error) {
        setFormError('Gagal menyimpan dokumen: ' + error.message);
        setSubmitting(false);
        return;
      }

      router.push(`/employee/documents/${data.id}`);
    } catch (err) {
      setFormError('Terjadi kesalahan tak terduga.');
      setSubmitting(false);
    }
  };

  if (!TYPE_LABEL[type]) {
    return (
      <div className="max-w-[700px] mx-auto px-6 py-10">
        <p className="text-sm text-black mb-6">
          Jenis dokumen tidak valid. Buka halaman ini lewat tombol &quot;Buat Dokumen Baru&quot; di daftar dokumen.
        </p>
        <Link href="/employee/documents" className="inline-flex items-center gap-1.5 text-sm text-madael-red hover:underline">
          <ArrowLeft size={15} />
          Kembali ke Dokumen
        </Link>
      </div>
    );
  }

  if (loadingContext) {
    return (
      <div className="max-w-[700px] mx-auto px-6 py-10">
        <p className="text-sm text-[#6B6B6B]">Memuat...</p>
      </div>
    );
  }

  return (
    <div className="max-w-[800px] mx-auto px-6 py-10">
      <Link href="/employee/documents" className="inline-flex items-center gap-1.5 text-sm text-[#6B6B6B] hover:text-madael-red transition-colors mb-6">
        <ArrowLeft size={15} />
        Kembali ke Dokumen
      </Link>

      <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em] mb-1">
        Buat Dokumen — {TYPE_LABEL[type]}
      </h1>
      <p className="text-sm text-[#6B6B6B] mb-8">Nomor surat akan digenerate otomatis saat disimpan.</p>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Field umum */}
        <div className="bg-white border border-[#E0E0E0] p-6 space-y-4">
          <h2 className="text-sm font-semibold text-black mb-2">Informasi Umum</h2>

          <div>
            <label className={labelClass}>Judul Dokumen *</label>
            <input className={inputClass} value={judul} onChange={(e) => setJudul(e.target.value)} required />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Klien Terkait (opsional)</label>
              <select className={inputClass} value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">— Tidak terkait klien —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.nama_perusahaan}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Tanggal Dokumen</label>
              <input type="date" className={inputClass} value={tanggalDokumen} onChange={(e) => setTanggalDokumen(e.target.value)} />
            </div>
          </div>

          <div>
            <label className={labelClass}>Catatan Internal</label>
            <textarea className={textareaClass} rows={2} value={catatan} onChange={(e) => setCatatan(e.target.value)} />
          </div>
        </div>

        {/* PROPOSAL */}
        {type === 'PRO' && (
          <div className="bg-white border border-[#E0E0E0] p-6 space-y-4">
            <h2 className="text-sm font-semibold text-black mb-2">Detail Proposal</h2>
            <div>
              <label className={labelClass}>Perihal</label>
              <input className={inputClass} value={proPerihal} onChange={(e) => setProPerihal(e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Latar Belakang</label>
              <textarea className={textareaClass} value={proLatarBelakang} onChange={(e) => setProLatarBelakang(e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Scope Pekerjaan</label>
              <textarea className={textareaClass} value={proScope} onChange={(e) => setProScope(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Jangka Waktu</label>
                <input className={inputClass} value={proJangkaWaktu} onChange={(e) => setProJangkaWaktu(e.target.value)} placeholder="mis. 6 bulan" />
              </div>
              <div>
                <label className={labelClass}>Nilai Estimasi (Rp)</label>
                <input type="number" className={inputClass} value={proNilaiEstimasi} onChange={(e) => setProNilaiEstimasi(e.target.value)} />
              </div>
            </div>
            <div>
              <label className={labelClass}>Syarat dan Ketentuan</label>
              <textarea className={textareaClass} value={proSyarat} onChange={(e) => setProSyarat(e.target.value)} />
            </div>
          </div>
        )}

        {/* QUOTATION */}
        {type === 'QUO' && (
          <div className="bg-white border border-[#E0E0E0] p-6 space-y-4">
            <h2 className="text-sm font-semibold text-black mb-2">Detail Quotation</h2>
            <div>
              <label className={labelClass}>Perihal</label>
              <input className={inputClass} value={quoPerihal} onChange={(e) => setQuoPerihal(e.target.value)} />
            </div>

            <div>
              <label className={labelClass}>Daftar Item / Layanan</label>
              <div className="space-y-2">
                {quoItems.map((it) => (
                  <div key={it.id} className="grid grid-cols-[1fr_70px_120px_120px_28px] gap-2 items-center">
                    <input
                      className={inputClass}
                      placeholder="Nama item/layanan"
                      value={it.nama}
                      onChange={(e) => updateItem(it.id, 'nama', e.target.value)}
                    />
                    <input
                      type="number"
                      className={inputClass}
                      placeholder="Qty"
                      value={it.qty}
                      onChange={(e) => updateItem(it.id, 'qty', e.target.value)}
                    />
                    <input
                      type="number"
                      className={inputClass}
                      placeholder="Harga satuan"
                      value={it.harga_satuan}
                      onChange={(e) => updateItem(it.id, 'harga_satuan', e.target.value)}
                    />
                    <p className="text-sm text-black text-right pr-1">
                      {formatRupiah((Number(it.qty) || 0) * (Number(it.harga_satuan) || 0))}
                    </p>
                    <button
                      type="button"
                      onClick={() => removeItem(it.id)}
                      className="text-[#9A9A9A] hover:text-madael-red transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addItem}
                className="mt-3 flex items-center gap-1.5 text-xs font-medium text-madael-red hover:underline"
              >
                <Plus size={14} />
                Tambah Baris
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Diskon (Rp)</label>
                <input type="number" className={inputClass} value={quoDiskon} onChange={(e) => setQuoDiskon(e.target.value)} />
              </div>
              <div>
                <label className={labelClass}>Masa Berlaku Quotation</label>
                <input className={inputClass} value={quoMasaBerlaku} onChange={(e) => setQuoMasaBerlaku(e.target.value)} placeholder="mis. 14 hari" />
              </div>
            </div>

            <div className="border-t border-[#E0E0E0] pt-3 text-sm text-black space-y-1">
              <div className="flex justify-between"><span className="text-[#6B6B6B]">Subtotal</span><span>{formatRupiah(quoSubtotal)}</span></div>
              <div className="flex justify-between"><span className="text-[#6B6B6B]">Diskon</span><span>- {formatRupiah(quoDiskon)}</span></div>
              <div className="flex justify-between font-semibold"><span>Total</span><span>{formatRupiah(quoTotal)}</span></div>
            </div>

            <div>
              <label className={labelClass}>Syarat Pembayaran</label>
              <textarea className={textareaClass} rows={2} value={quoSyaratPembayaran} onChange={(e) => setQuoSyaratPembayaran(e.target.value)} />
            </div>
          </div>
        )}

        {/* AGREEMENT */}
        {type === 'AGR' && (
          <div className="bg-white border border-[#E0E0E0] p-6 space-y-4">
            <h2 className="text-sm font-semibold text-black mb-2">Detail Agreement</h2>
            <div>
              <label className={labelClass}>Perihal</label>
              <input className={inputClass} value={agrPerihal} onChange={(e) => setAgrPerihal(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Pihak Pertama</label>
                <input className={inputClass} value={agrPihakPertama} onChange={(e) => setAgrPihakPertama(e.target.value)} />
              </div>
              <div>
                <label className={labelClass}>Pihak Kedua</label>
                <input className={inputClass} value={agrPihakKedua} onChange={(e) => setAgrPihakKedua(e.target.value)} placeholder="Terisi otomatis kalau pilih klien di atas" />
              </div>
            </div>
            <div>
              <label className={labelClass}>Scope Pekerjaan</label>
              <textarea className={textareaClass} value={agrScope} onChange={(e) => setAgrScope(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Nilai Kontrak (Rp)</label>
                <input type="number" className={inputClass} value={agrNilaiKontrak} onChange={(e) => setAgrNilaiKontrak(e.target.value)} />
              </div>
              <div>
                <label className={labelClass}>Jangka Waktu</label>
                <input className={inputClass} value={agrJangkaWaktu} onChange={(e) => setAgrJangkaWaktu(e.target.value)} placeholder="mis. 12 bulan" />
              </div>
            </div>
            <div>
              <label className={labelClass}>Syarat dan Ketentuan (umum)</label>
              <textarea className={textareaClass} value={agrSyarat} onChange={(e) => setAgrSyarat(e.target.value)} />
            </div>

            <div>
              <label className={labelClass}>Pasal-Pasal</label>
              <div className="space-y-3">
                {agrPasal.map((p, idx) => (
                  <div key={p.id} className="border border-[#E0E0E0] p-3 relative">
                    <p className="text-xs font-medium text-[#6B6B6B] mb-2">Pasal {idx + 1}</p>
                    <input
                      className={inputClass + ' mb-2'}
                      placeholder="Judul pasal"
                      value={p.judul}
                      onChange={(e) => updatePasal(p.id, 'judul', e.target.value)}
                    />
                    <textarea
                      className={textareaClass}
                      rows={2}
                      placeholder="Isi pasal"
                      value={p.isi}
                      onChange={(e) => updatePasal(p.id, 'isi', e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => removePasal(p.id)}
                      className="absolute top-2 right-2 text-[#9A9A9A] hover:text-madael-red transition-colors"
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addPasal}
                className="mt-3 flex items-center gap-1.5 text-xs font-medium text-madael-red hover:underline"
              >
                <Plus size={14} />
                Tambah Pasal
              </button>
            </div>
          </div>
        )}

        {/* ADMINISTRASI */}
        {type === 'ADM' && (
          <div className="bg-white border border-[#E0E0E0] p-6 space-y-4">
            <h2 className="text-sm font-semibold text-black mb-2">Detail Surat Administrasi</h2>
            <div>
              <label className={labelClass}>Perihal</label>
              <input className={inputClass} value={admPerihal} onChange={(e) => setAdmPerihal(e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Isi Surat</label>
              <textarea className={textareaClass} rows={6} value={admIsiSurat} onChange={(e) => setAdmIsiSurat(e.target.value)} />
            </div>
          </div>
        )}

        {formError && <p className="text-sm text-madael-red">{formError}</p>}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.02em] hover:bg-madael-dark transition-colors disabled:opacity-60"
          >
            {submitting ? 'Menyimpan...' : 'Simpan Dokumen'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function NewDocumentPage() {
  return (
    <Suspense fallback={<div className="max-w-[700px] mx-auto px-6 py-10"><p className="text-sm text-[#6B6B6B]">Memuat...</p></div>}>
      <NewDocumentForm />
    </Suspense>
  );
}
