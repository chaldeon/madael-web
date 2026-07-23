'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Upload, Trash2, FileText, ExternalLink } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

const DOKUMEN_OPTIONS = ['KTP', 'PKWT', 'Ijazah', 'Lainnya'];

function formatRupiah(value) {
  if (value === null || value === undefined || value === '') return '-';
  return 'Rp ' + Math.round(value).toLocaleString('id-ID');
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function totalTunjangan(row) {
  const komponenTotal = Object.values(row?.komponen_lain || {}).reduce((sum, v) => sum + (Number(v) || 0), 0);
  return (Number(row?.tunjangan) || 0) + komponenTotal;
}

function Field({ label, children }) {
  return (
    <div>
      <p className="text-xs font-medium text-[#6B6B6B] uppercase tracking-[0.04em] mb-1">{label}</p>
      <p className="text-sm text-black">{children}</p>
    </div>
  );
}

export default function EmployeeDetailPage() {
  const params = useParams();
  const supabase = createClient();
  const { status: accessStatus, employee: actingEmployee } = useModuleAccess('payroll');

  const [empMaster, setEmpMaster] = useState(null);
  const [clientName, setClientName] = useState('-');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const [documents, setDocuments] = useState([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState(null);

  const [namaDokumen, setNamaDokumen] = useState('KTP');
  const [namaDokumenLain, setNamaDokumenLain] = useState('');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const isSuperadmin = !!actingEmployee?.is_superadmin;

  const loadEmployee = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setNotFound(false);

    const { data, error } = await supabase
      .from('employees_master')
      .select('*, clients:client_id ( nama_klien )')
      .eq('id', params.id)
      .maybeSingle();

    if (error) {
      setLoadError(error.message || 'Gagal memuat data employee.');
      setLoading(false);
      return;
    }
    if (!data) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    setEmpMaster(data);
    setClientName(data.clients?.nama_klien || '-');
    setLoading(false);
  }, [supabase, params.id]);

  const loadDocuments = useCallback(async () => {
    setDocsLoading(true);
    setDocsError(null);
    const { data, error } = await supabase
      .from('employee_documents')
      .select('*')
      .eq('employee_id', params.id)
      .order('uploaded_at', { ascending: false });

    if (error) {
      setDocsError(error.message || 'Gagal memuat daftar dokumen.');
    } else {
      setDocuments(data || []);
    }
    setDocsLoading(false);
  }, [supabase, params.id]);

  useEffect(() => {
    if (accessStatus === 'allowed' && isSuperadmin) {
      loadEmployee();
      loadDocuments();
    }
  }, [accessStatus, isSuperadmin, loadEmployee, loadDocuments]);

  const handleUpload = async (e) => {
    e.preventDefault();
    setUploadError(null);

    const finalNamaDokumen = namaDokumen === 'Lainnya'
      ? (namaDokumenLain.trim() ? `Lainnya: ${namaDokumenLain.trim()}` : 'Lainnya')
      : namaDokumen;

    if (!file) {
      setUploadError('Pilih file terlebih dahulu.');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('nama_dokumen', finalNamaDokumen);
      formData.append('file', file);

      const res = await fetch(`/api/employee/${params.id}/documents`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mengupload dokumen.');

      setFile(null);
      setNamaDokumen('KTP');
      setNamaDokumenLain('');
      // reset input file di DOM
      const fileInput = document.getElementById('doc-file-input');
      if (fileInput) fileInput.value = '';
      loadDocuments();
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (docId) => {
    if (!confirm('Hapus dokumen ini? File di Google Drive juga akan dihapus.')) return;
    setDeletingId(docId);
    try {
      const res = await fetch(`/api/employee/${params.id}/documents?docId=${docId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menghapus dokumen.');
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    } catch (err) {
      alert(err.message);
    } finally {
      setDeletingId(null);
    }
  };

  if (accessStatus === 'loading') {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
        <LoadingState label="Memuat..." />
      </section>
    );
  }

  if (accessStatus === 'denied' || !isSuperadmin) {
    return (
      <div className="max-w-[600px] mx-auto px-6 py-10">
        <div className="w-full border-t-4 border-madael-red bg-white p-8 text-center">
          <p className="text-sm text-black mb-6">Halaman detail employee khusus superadmin.</p>
          <Link href="/employee/payroll" className="inline-block bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors">
            Kembali
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-[900px] mx-auto px-6 py-10">
        <LoadingState label="Memuat data employee..." />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-[420px] mx-auto px-6 py-10">
        <ErrorState message={loadError} onRetry={loadEmployee} />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="max-w-[600px] mx-auto px-6 py-10">
        <p className="text-sm text-black mb-6">Employee tidak ditemukan.</p>
        <Link href="/employee/payroll" className="inline-flex items-center gap-1.5 text-sm text-madael-red hover:underline">
          <ArrowLeft size={15} /> Kembali ke Payroll
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto px-6 py-10">
      <Link href="/employee/payroll" className="inline-flex items-center gap-1.5 text-sm text-[#6B6B6B] hover:text-madael-red transition-colors mb-6">
        <ArrowLeft size={15} /> Kembali ke Payroll
      </Link>

      <div className="mb-8">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">{empMaster.nama}</h1>
        <p className="text-sm text-[#6B6B6B] mt-1">{empMaster.posisi || '—'} · {clientName}</p>
      </div>

      <div className="bg-white border border-[#E0E0E0] p-8 mb-8">
        <h2 className="text-sm font-semibold text-black mb-4">Data Employee Master</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
          <Field label="Status">{empMaster.status || '-'}</Field>
          <Field label="Klien">{clientName}</Field>
          <Field label="Posisi">{empMaster.posisi || '-'}</Field>
          <Field label="Gaji Pokok">{formatRupiah(empMaster.gaji_pokok)}</Field>
          <Field label="Total Tunjangan">{formatRupiah(totalTunjangan(empMaster))}</Field>
          <Field label="Jatah Cuti Tahunan">{empMaster.jatah_cuti_tahunan ?? 12} hari</Field>
          <Field label="Nama Rekening">{empMaster.nama_rekening || '-'}</Field>
          <Field label="No Rekening">{empMaster.no_rekening || '-'}</Field>
        </div>
        <p className="text-[11px] text-[#9A9A9A] mt-5">
          Untuk edit struktur gaji, PTKP, NPWP, dsb — pakai tombol Edit di tabel Payroll.
        </p>
      </div>

      <div className="bg-white border border-[#E0E0E0] p-8">
        <h2 className="text-sm font-semibold text-black mb-1">Dokumen Employee</h2>
        <p className="text-xs text-[#6B6B6B] mb-5">KTP, PKWT, ijazah, dan dokumen lain — tersimpan di Shared Drive, dikelompokkan per employee.</p>

        <form onSubmit={handleUpload} className="border border-[#E0E0E0] p-4 mb-6">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[#6B6B6B]">Jenis Dokumen</span>
              <select
                value={namaDokumen}
                onChange={(e) => setNamaDokumen(e.target.value)}
                className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
              >
                {DOKUMEN_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </label>

            {namaDokumen === 'Lainnya' && (
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[#6B6B6B]">Keterangan</span>
                <input
                  type="text"
                  value={namaDokumenLain}
                  onChange={(e) => setNamaDokumenLain(e.target.value)}
                  placeholder="mis. Surat Referensi"
                  className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
                />
              </label>
            )}

            <label className="flex flex-col gap-1">
              <span className="text-xs text-[#6B6B6B]">File (PDF/JPG/PNG, maks 10MB)</span>
              <input
                id="doc-file-input"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="text-sm text-black file:mr-3 file:px-3 file:py-1.5 file:border-0 file:bg-[#F4F4F4] file:text-xs file:font-medium file:cursor-pointer"
              />
            </label>

            <button
              type="submit"
              disabled={uploading}
              className="flex items-center gap-2 bg-madael-red text-white px-5 py-2.5 text-sm font-medium tracking-[0.02em] hover:bg-madael-dark transition-colors disabled:opacity-60"
            >
              <Upload size={15} />
              {uploading ? 'Mengupload...' : 'Upload'}
            </button>
          </div>
          {uploadError && <p className="text-xs text-red-600 mt-3">{uploadError}</p>}
        </form>

        {docsLoading ? (
          <LoadingState label="Memuat dokumen..." />
        ) : docsError ? (
          <ErrorState message={docsError} onRetry={loadDocuments} />
        ) : documents.length === 0 ? (
          <EmptyState message="Belum ada dokumen yang diupload." />
        ) : (
          <div className="border border-[#E0E0E0] overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
                  <th className="px-4 py-3 font-medium">Dokumen</th>
                  <th className="px-4 py-3 font-medium">File</th>
                  <th className="px-4 py-3 font-medium">Diupload</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id} className="border-b border-[#F0F0F0] last:border-0">
                    <td className="px-4 py-3 text-black font-medium">{doc.nama_dokumen}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">
                      <span className="inline-flex items-center gap-1.5">
                        <FileText size={13} /> {doc.file_name}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#6B6B6B] whitespace-nowrap">{formatDate(doc.uploaded_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <a
                          href={`https://drive.google.com/file/d/${doc.drive_file_id}/view`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-madael-red hover:text-madael-dark font-medium"
                        >
                          <ExternalLink size={13} /> Buka
                        </a>
                        <button
                          onClick={() => handleDelete(doc.id)}
                          disabled={deletingId === doc.id}
                          className="text-[#9A9A9A] hover:text-madael-red disabled:opacity-50"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}