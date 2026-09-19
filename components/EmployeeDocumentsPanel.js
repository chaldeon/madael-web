'use client';

// Daftar + upload dokumen pribadi karyawan (KTP, NPWP, Ijazah, Kontrak Kerja,
// dll). Dipakai di dua tempat:
// - app/employee/profile/page.js: self-service, employee upload/lihat/hapus
//   dokumen miliknya sendiri (canUpload=true, canDelete=true).
// - app/employee/list/dokumen/[employeeId]/page.js: admin (superadmin) lihat
//   dokumen milik karyawan lain (canUpload=false, canDelete=true untuk beres-beres).

import { useEffect, useState, useCallback } from 'react';
import { Upload, Trash2, FileText, X, ExternalLink } from 'lucide-react';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

const JENIS_OPTIONS = ['KTP', 'NPWP', 'Ijazah', 'Kontrak Kerja', 'Lainnya'];

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

export default function EmployeeDocumentsPanel({ supabase, employeeId, canUpload = true, canDelete = true }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [jenis, setJenis] = useState(JENIS_OPTIONS[0]);
  const [label, setLabel] = useState('');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState(null);

  const [busyId, setBusyId] = useState(null); // dipakai buat tombol "Lihat" & "Hapus"

  const loadDocs = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from('employee_documents')
      .select('*')
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false });
    if (error) {
      setLoadError(error.message || 'Gagal memuat daftar dokumen.');
    } else {
      setDocs(data || []);
    }
    setLoading(false);
  }, [supabase, employeeId]);

  useEffect(() => {
    if (employeeId) loadDocs();
  }, [employeeId, loadDocs]);

  const handleUpload = async () => {
    setFormError(null);
    if (!file) {
      setFormError('Pilih file dulu.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setFormError('Ukuran file maksimal 10MB.');
      return;
    }

    setUploading(true);
    const path = `${employeeId}/${jenis}-${Date.now()}-${sanitizeFileName(file.name)}`;
    const { error: uploadError } = await supabase.storage.from('employee-documents').upload(path, file, {
      contentType: file.type || 'application/octet-stream',
    });
    if (uploadError) {
      setFormError(uploadError.message || 'Gagal upload file.');
      setUploading(false);
      return;
    }

    const { error: insertError } = await supabase.from('employee_documents').insert([{
      employee_id: employeeId,
      jenis,
      label: label.trim() || null,
      file_path: path,
      file_name: file.name,
      uploaded_by: employeeId,
    }]);
    if (insertError) {
      setFormError(insertError.message || 'Gagal menyimpan data dokumen.');
      setUploading(false);
      return;
    }

    setUploading(false);
    setShowForm(false);
    setFile(null);
    setLabel('');
    setJenis(JENIS_OPTIONS[0]);
    loadDocs();
  };

  const handleView = async (doc) => {
    setBusyId(doc.id);
    const { data, error } = await supabase.storage.from('employee-documents').createSignedUrl(doc.file_path, 60 * 5);
    setBusyId(null);
    if (error || !data?.signedUrl) {
      alert('Gagal membuka dokumen: ' + (error?.message || 'terjadi kesalahan'));
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const handleDelete = async (doc) => {
    if (!window.confirm(`Hapus dokumen "${doc.file_name}"? Tindakan ini tidak bisa dibatalkan.`)) return;
    setBusyId(doc.id);
    await supabase.storage.from('employee-documents').remove([doc.file_path]);
    await supabase.from('employee_documents').delete().eq('id', doc.id);
    setBusyId(null);
    loadDocs();
  };

  if (loading) return <LoadingState label="Memuat dokumen..." />;
  if (loadError) return <ErrorState message={loadError} onRetry={loadDocs} />;

  return (
    <div>
      {canUpload && (
        <div className="flex justify-end mb-4">
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 bg-madael-red text-white px-4 py-2 text-xs font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
          >
            <Upload size={14} /> Upload Dokumen
          </button>
        </div>
      )}

      {docs.length === 0 ? (
        <div className="bg-white border border-[#E0E0E0]">
          <EmptyState message="Belum ada dokumen yang diupload." icon={FileText} />
        </div>
      ) : (
        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
                <th className="px-4 py-3 font-medium">Jenis</th>
                <th className="px-4 py-3 font-medium">Nama File</th>
                <th className="px-4 py-3 font-medium">Tanggal Upload</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id} className="border-b border-[#E0E0E0] last:border-0">
                  <td className="px-4 py-3 text-black">
                    {doc.jenis}
                    {doc.label && <div className="text-xs text-[#9A9A9A]">{doc.label}</div>}
                  </td>
                  <td className="px-4 py-3 text-[#6B6B6B]">{doc.file_name}</td>
                  <td className="px-4 py-3 text-[#6B6B6B]">
                    {new Date(doc.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => handleView(doc)}
                        disabled={busyId === doc.id}
                        className="inline-flex items-center gap-1 text-xs font-medium text-madael-red hover:text-madael-dark disabled:opacity-50"
                      >
                        <ExternalLink size={13} /> Lihat
                      </button>
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(doc)}
                          disabled={busyId === doc.id}
                          className="text-[#6B6B6B] hover:text-red-700 disabled:opacity-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] px-6" onClick={() => setShowForm(false)}>
          <div className="bg-white w-full max-w-[400px] p-6 relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setShowForm(false)} className="absolute top-4 right-4 text-[#9A9A9A] hover:text-black">
              <X size={18} />
            </button>
            <h2 className="text-sm font-medium text-black mb-4">Upload Dokumen</h2>

            {formError && <p className="text-xs text-red-600 mb-3">{formError}</p>}

            <label className="flex flex-col gap-1 mb-3">
              <span className="text-xs text-[#6B6B6B]">Jenis Dokumen</span>
              <select
                value={jenis}
                onChange={(e) => setJenis(e.target.value)}
                className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
              >
                {JENIS_OPTIONS.map((j) => (
                  <option key={j} value={j}>{j}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 mb-3">
              <span className="text-xs text-[#6B6B6B]">Keterangan (opsional)</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Contoh: Kontrak 2026-2027"
                className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
              />
            </label>

            <label className="flex flex-col gap-1 mb-5">
              <span className="text-xs text-[#6B6B6B]">File (PDF/JPG/PNG, maks 10MB)</span>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="text-sm text-black"
              />
            </label>

            <button
              onClick={handleUpload}
              disabled={uploading}
              className="w-full bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
            >
              {uploading ? 'Mengupload...' : 'Upload'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}