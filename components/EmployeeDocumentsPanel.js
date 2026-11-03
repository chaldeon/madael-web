'use client';

// Daftar + upload dokumen pribadi karyawan (KTP, NPWP, Ijazah, Kontrak Kerja,
// dll). SEMUA lewat /api/employee/[id]/documents (server): file baru ke Google
// Drive, file lama di Supabase Storage tetap bisa dilihat/dihapus. Hak akses
// (siapa boleh melihat/menghapus apa) diputuskan server; panel hanya menampilkan
// tombol Hapus pada dokumen yang `can_delete`-nya true.
//
// Dipakai di tiga tempat (employeeId boleh id employees atau employees_master):
// - app/employee/profile/page.js: self-service karyawan (canUpload).
// - app/employee/payroll/[id]/page.js: HR (superadmin) melihat + upload.
// - app/employee/list/dokumen/[employeeId]/page.js: HR melihat + beres-beres.

import { useEffect, useState, useCallback } from 'react';
import { Upload, Trash2, FileText, X, ExternalLink } from 'lucide-react';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import { friendlyCaught } from '@/lib/errorMessage';
import { UPLOAD_MAX_BYTES, UPLOAD_MAX_LABEL, PESAN_UKURAN_UPLOAD, readUploadJson } from '@/lib/uploadLimits';
import { JENIS_DOKUMEN_OPTIONS, KETERANGAN_MAX_LENGTH } from '@/lib/employeeDocumentsConfig';
import Toast from '@/components/employee-list/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';

export default function EmployeeDocumentsPanel({ employeeId, canUpload = true }) {
  const apiBase = `/api/employee/${encodeURIComponent(employeeId)}/documents`;

  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [jenis, setJenis] = useState(JENIS_DOKUMEN_OPTIONS[0]);
  const [label, setLabel] = useState('');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState(null);

  const [busyId, setBusyId] = useState(null); // dipakai buat tombol "Hapus"
  // Dokumen yang mau dihapus — membuka dialog konfirmasi (pengganti window.confirm()).
  const [deleteTarget, setDeleteTarget] = useState(null);
  // Notifikasi non-blocking (pengganti alert()) — { type: 'error'|'success', message }
  const [toast, setToast] = useState(null);
  const dismissToast = useCallback(() => setToast(null), []);

  // Memuat ulang daftar tanpa menyalakan layar "Memuat..." (dipakai setelah
  // upload/hapus supaya tabel tidak berkedip).
  const fetchDocs = useCallback(async () => {
    try {
      const res = await fetch(apiBase);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) throw new Error((body && body.error) || 'Gagal memuat daftar dokumen.');
      setDocs(body.documents || []);
      setLoadError(null);
    } catch (err) {
      setLoadError(friendlyCaught(err, 'Gagal memuat daftar dokumen.'));
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    if (employeeId) fetchDocs();
  }, [employeeId, fetchDocs]);

  const retryLoad = () => {
    setLoading(true);
    setLoadError(null);
    fetchDocs();
  };

  const handleUpload = async () => {
    setFormError(null);
    if (!file) {
      setFormError('Pilih file dulu.');
      return;
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      setFormError(PESAN_UKURAN_UPLOAD);
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('jenis', jenis);
      formData.append('label', label.trim());
      formData.append('file', file);
      const res = await fetch(apiBase, { method: 'POST', body: formData });
      await readUploadJson(res, 'Gagal upload file.');
    } catch (err) {
      setFormError(friendlyCaught(err, 'Gagal upload file.'));
      setUploading(false);
      return;
    }

    setUploading(false);
    setShowForm(false);
    setFile(null);
    setLabel('');
    setJenis(JENIS_DOKUMEN_OPTIONS[0]);
    fetchDocs();
  };

  const handleDelete = (doc) => setDeleteTarget(doc);

  // Dialog tetap terbuka (tombol busy) selama penghapusan berjalan. Kalau server
  // menolak/gagal, dialog ditutup dengan pesan error — bukan seolah berhasil.
  const handleConfirmDelete = async () => {
    const doc = deleteTarget;
    if (!doc) return;
    setBusyId(doc.id);
    try {
      const res = await fetch(`${apiBase}?docId=${encodeURIComponent(doc.id)}`, { method: 'DELETE' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error((body && body.error) || 'Gagal menghapus dokumen.');
      setToast({ type: 'success', message: 'Dokumen dihapus.' });
    } catch (err) {
      setToast({ type: 'error', message: friendlyCaught(err, 'Gagal menghapus dokumen.') });
    }
    setBusyId(null);
    setDeleteTarget(null);
    fetchDocs();
  };

  if (loading) return <LoadingState label="Memuat dokumen..." />;
  if (loadError) return <ErrorState message={loadError} onRetry={retryLoad} />;

  return (
    <div>
      <Toast toast={toast} onDismiss={dismissToast} />
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
                    {doc.judul}
                    {doc.keterangan && <div className="text-xs text-[#9A9A9A]">{doc.keterangan}</div>}
                  </td>
                  <td className="px-4 py-3 text-[#6B6B6B]">{doc.file_name}</td>
                  <td className="px-4 py-3 text-[#6B6B6B]">
                    {doc.uploaded_at
                      ? new Date(doc.uploaded_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
                      : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      <a
                        href={`${apiBase}/${encodeURIComponent(doc.id)}/file`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-madael-red hover:text-madael-dark"
                      >
                        <ExternalLink size={13} /> Lihat
                      </a>
                      {doc.can_delete && (
                        <button
                          onClick={() => handleDelete(doc)}
                          disabled={busyId === doc.id}
                          className="text-[#6B6B6B] hover:text-red-700 disabled:opacity-50"
                          aria-label={`Hapus ${doc.file_name}`}
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
                {JENIS_DOKUMEN_OPTIONS.map((j) => (
                  <option key={j} value={j}>{j}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 mb-3">
              <span className="text-xs text-[#6B6B6B]">Keterangan (opsional)</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={KETERANGAN_MAX_LENGTH}
                placeholder="Contoh: Kontrak 2026-2027"
                className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
              />
            </label>

            <label className="flex flex-col gap-1 mb-5">
              <span className="text-xs text-[#6B6B6B]">File (PDF/JPG/PNG, maks {UPLOAD_MAX_LABEL})</span>
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

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Hapus Dokumen"
        message={deleteTarget ? `Hapus dokumen "${deleteTarget.file_name}"? File di penyimpanan juga ikut dihapus dan tidak bisa dibatalkan.` : ''}
        confirmLabel="Hapus"
        busy={Boolean(deleteTarget) && busyId === deleteTarget.id}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}