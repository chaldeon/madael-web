'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, Printer, Pencil } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';

const TYPE_LABEL = {
  PRO: 'Proposal',
  QUO: 'Quotation',
  AGR: 'Agreement / PKS',
  ADM: 'Surat Administrasi',
  INV: 'Invoice',
};

const STATUS_OPTIONS = ['Draft', 'Final', 'Terkirim', 'Ditandatangani'];

const STATUS_STYLES = {
  Draft: 'bg-[#F3F4F6] text-[#4B5563]',
  Final: 'bg-[#E8F0FE] text-[#1A56DB]',
  Terkirim: 'bg-[#FEF3C7] text-[#92700C]',
  Ditandatangani: 'bg-[#DCFCE7] text-[#166534]',
};

function StatusBadge({ status }) {
  return (
    <span className={`inline-block px-2.5 py-1 text-[11px] font-medium rounded ${STATUS_STYLES[status] || 'bg-[#F3F4F6] text-[#4B5563]'}`}>
      {status}
    </span>
  );
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatRupiah(value) {
  if (value === null || value === undefined || value === '') return '-';
  return 'Rp ' + Math.round(value).toLocaleString('id-ID');
}

function Field({ label, children }) {
  return (
    <div className="mb-4">
      <p className="text-xs font-medium text-[#6B6B6B] uppercase tracking-[0.04em] mb-1">{label}</p>
      <div className="text-sm text-black whitespace-pre-line">{children}</div>
    </div>
  );
}

function ProposalContent({ content }) {
  return (
    <>
      <Field label="Perihal">{content.perihal || '-'}</Field>
      <Field label="Latar Belakang">{content.latar_belakang || '-'}</Field>
      <Field label="Scope Pekerjaan">{content.scope_pekerjaan || '-'}</Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Jangka Waktu">{content.jangka_waktu || '-'}</Field>
        <Field label="Nilai Estimasi">{formatRupiah(content.nilai_estimasi)}</Field>
      </div>
      <Field label="Syarat dan Ketentuan">{content.syarat_ketentuan || '-'}</Field>
    </>
  );
}

function QuotationContent({ content }) {
  const items = content.items || [];
  return (
    <>
      <Field label="Perihal">{content.perihal || '-'}</Field>

      <div className="mb-4">
        <p className="text-xs font-medium text-[#6B6B6B] uppercase tracking-[0.04em] mb-2">Daftar Item / Layanan</p>
        <table className="w-full text-sm border border-[#E0E0E0]">
          <thead>
            <tr className="bg-[#FAFAFA] border-b border-[#E0E0E0] text-left">
              <th className="px-3 py-2 font-medium">Item</th>
              <th className="px-3 py-2 font-medium text-right">Qty</th>
              <th className="px-3 py-2 font-medium text-right">Harga Satuan</th>
              <th className="px-3 py-2 font-medium text-right">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx} className="border-b border-[#F0F0F0] last:border-0">
                <td className="px-3 py-2">{it.nama}</td>
                <td className="px-3 py-2 text-right">{it.qty}</td>
                <td className="px-3 py-2 text-right">{formatRupiah(it.harga_satuan)}</td>
                <td className="px-3 py-2 text-right">{formatRupiah(it.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end mb-4">
        <div className="w-full max-w-[280px] text-sm text-black space-y-1">
          <div className="flex justify-between"><span className="text-[#6B6B6B]">Subtotal</span><span>{formatRupiah(content.subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-[#6B6B6B]">Diskon</span><span>- {formatRupiah(content.diskon)}</span></div>
          <div className="flex justify-between font-semibold border-t border-[#E0E0E0] pt-1"><span>Total</span><span>{formatRupiah(content.total)}</span></div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Syarat Pembayaran">{content.syarat_pembayaran || '-'}</Field>
        <Field label="Masa Berlaku Quotation">{content.masa_berlaku || '-'}</Field>
      </div>
    </>
  );
}

function AgreementContent({ content }) {
  const pasal = content.pasal || [];
  return (
    <>
      <Field label="Perihal">{content.perihal || '-'}</Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Pihak Pertama">{content.pihak_pertama || '-'}</Field>
        <Field label="Pihak Kedua">{content.pihak_kedua || '-'}</Field>
      </div>
      <Field label="Scope Pekerjaan">{content.scope_pekerjaan || '-'}</Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Nilai Kontrak">{formatRupiah(content.nilai_kontrak)}</Field>
        <Field label="Jangka Waktu">{content.jangka_waktu || '-'}</Field>
      </div>
      <Field label="Syarat dan Ketentuan (umum)">{content.syarat_ketentuan || '-'}</Field>

      {pasal.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-medium text-[#6B6B6B] uppercase tracking-[0.04em] mb-2">Pasal-Pasal</p>
          <div className="space-y-3">
            {pasal.map((p, idx) => (
              <div key={idx}>
                <p className="text-sm font-semibold text-black">Pasal {idx + 1} — {p.judul || '(tanpa judul)'}</p>
                <p className="text-sm text-black whitespace-pre-line">{p.isi || '-'}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function AdministrasiContent({ content }) {
  return (
    <>
      <Field label="Perihal">{content.perihal || '-'}</Field>
      <Field label="Isi Surat">{content.isi_surat || '-'}</Field>
    </>
  );
}

export default function DocumentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();

  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const fetchDoc = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('documents')
      .select('*, clients:client_id ( id, nama_perusahaan ), employees:created_by ( id, nama )')
      .eq('id', params.id)
      .maybeSingle();

    if (error) {
      setError(error.message);
    } else if (!data) {
      setError('Dokumen tidak ditemukan.');
    } else {
      setDoc(data);
    }
    setLoading(false);
  }, [supabase, params.id]);

  useEffect(() => {
    fetchDoc();
  }, [fetchDoc]);

  const handleStatusChange = async (newStatus) => {
    setUpdatingStatus(true);
    const { error } = await supabase.from('documents').update({ status: newStatus }).eq('id', doc.id);
    setUpdatingStatus(false);
    if (error) {
      alert('Gagal update status: ' + error.message);
      return;
    }
    setDoc((d) => ({ ...d, status: newStatus }));
  };

  const handlePrint = () => window.print();

  if (loading) {
    return (
      <div className="max-w-[800px] mx-auto px-6 py-10">
        <p className="text-sm text-[#6B6B6B]">Memuat...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-[700px] mx-auto px-6 py-10">
        <p className="text-sm text-black mb-6">{error}</p>
        <Link href="/employee/documents" className="inline-flex items-center gap-1.5 text-sm text-madael-red hover:underline">
          <ArrowLeft size={15} />
          Kembali ke Dokumen
        </Link>
      </div>
    );
  }

  const content = doc.content || {};

  return (
    <div className="max-w-[800px] mx-auto px-6 py-10">
      <div className="print:hidden flex items-center justify-between flex-wrap gap-4 mb-6">
        <Link href="/employee/documents" className="inline-flex items-center gap-1.5 text-sm text-[#6B6B6B] hover:text-madael-red transition-colors">
          <ArrowLeft size={15} />
          Kembali ke Dokumen
        </Link>

        <div className="flex items-center gap-3">
          <select
            value={doc.status}
            onChange={(e) => handleStatusChange(e.target.value)}
            disabled={updatingStatus}
            className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <Link
            href={`/employee/documents/${doc.id}/edit`}
            className="flex items-center gap-1.5 border border-[#E0E0E0] px-4 py-2 text-sm font-medium text-[#4B5563] hover:border-madael-red hover:text-madael-red transition-colors"
          >
            <Pencil size={14} />
            Edit
          </Link>
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 bg-madael-red text-white px-5 py-2 text-sm font-medium tracking-[0.02em] hover:bg-madael-dark transition-colors"
          >
            <Printer size={15} />
            Download PDF
          </button>
        </div>
      </div>

      {/* Dokumen — bagian ini yang ikut ke-print */}
      <div className="bg-white border border-[#E0E0E0] print:border-0 p-8 sm:p-10">
        <div className="flex items-start justify-between border-b-2 border-madael-red pb-5 mb-6">
          <div className="flex items-center gap-3">
            <Image
              src="/logos/madael_logo_transparent.png"
              alt="Madael Consult"
              width={44}
              height={44}
              className="object-contain"
            />
            <div>
              <p className="text-sm font-semibold text-black tracking-[0.02em]">PT MADAEL PRIMA SEJAHTERA INDONESIA</p>
              <p className="text-xs text-[#6B6B6B]">client.care@madaelconsult.com</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-[#6B6B6B]">Nomor Surat</p>
            <p className="text-sm font-semibold text-black">{doc.nomor_surat}</p>
          </div>
        </div>

        <div className="flex items-center justify-between mb-6 print:hidden">
          <h1 className="font-serif text-xl text-black">{doc.judul}</h1>
          <StatusBadge status={doc.status} />
        </div>

        <div className="hidden print:block mb-6">
          <h1 className="font-serif text-xl text-black">{doc.judul}</h1>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
          <div>
            <p className="text-xs font-medium text-[#6B6B6B] uppercase tracking-[0.04em] mb-1">Jenis Dokumen</p>
            <p className="text-black">{TYPE_LABEL[doc.kode_jenis] || doc.kode_jenis}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-[#6B6B6B] uppercase tracking-[0.04em] mb-1">Tanggal Dokumen</p>
            <p className="text-black">{formatDate(doc.tanggal_dokumen)}</p>
          </div>
          {doc.clients?.nama_perusahaan && (
            <div>
              <p className="text-xs font-medium text-[#6B6B6B] uppercase tracking-[0.04em] mb-1">Klien Terkait</p>
              <p className="text-black">{doc.clients.nama_perusahaan}</p>
            </div>
          )}
          <div>
            <p className="text-xs font-medium text-[#6B6B6B] uppercase tracking-[0.04em] mb-1">Dibuat Oleh</p>
            <p className="text-black">{doc.employees?.nama || '-'}</p>
          </div>
        </div>

        <div className="border-t border-[#E0E0E0] pt-6">
          {doc.kode_jenis === 'PRO' && <ProposalContent content={content} />}
          {doc.kode_jenis === 'QUO' && <QuotationContent content={content} />}
          {doc.kode_jenis === 'AGR' && <AgreementContent content={content} />}
          {doc.kode_jenis === 'ADM' && <AdministrasiContent content={content} />}
        </div>

        {doc.catatan && (
          <div className="print:hidden border-t border-[#E0E0E0] mt-6 pt-4">
            <p className="text-xs font-medium text-[#6B6B6B] uppercase tracking-[0.04em] mb-1">Catatan Internal</p>
            <p className="text-sm text-black whitespace-pre-line">{doc.catatan}</p>
          </div>
        )}

        <p className="hidden print:block text-center text-[10px] text-[#9A9A9A] mt-10 pt-4 border-t border-[#E0E0E0]">
          Dokumen ini bersifat rahasia
        </p>
      </div>

      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print\\:border-0,
          .print\\:border-0 * {
            visibility: visible;
          }
          .print\\:border-0 {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            border: none !important;
          }
        }
      `}</style>
    </div>
  );
}
