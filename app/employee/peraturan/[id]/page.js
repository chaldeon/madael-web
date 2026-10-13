'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, FileText, Pencil, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import {
  PERATURAN_MODULE_KEY, DETAIL_COLUMNS, RELASI_LABEL, labelPeraturan, formatTanggal,
  formatTanggalWaktu, isHttpUrl,
} from '@/lib/peraturanConfig';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Chip, StatusBadge } from '@/components/peraturan/PeraturanParts';
import RelasiManager from '@/components/peraturan/RelasiManager';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RELASI_COLUMNS = 'id, jenis_relasi, catatan';
const REF_COLUMNS = 'id, jenis, nomor, tahun, judul, status';

function InfoRow({ label, children }) {
  return (
    <div>
      <span className="text-[#6B6B6B] text-xs block">{label}</span>
      <span className="text-black text-sm">{children}</span>
    </div>
  );
}

export default function PeraturanDetailPage() {
  const params = useParams();
  const id = params.id;
  const supabase = createClient();
  const router = useRouter();
  const { employee } = useModuleAccess(PERATURAN_MODULE_KEY);
  const canEdit = !!employee?.is_superadmin; // kosmetik; RLS yang menegakkan

  const [row, setRow] = useState(null);
  const [relasi, setRelasi] = useState([]); // [{ key, label, items: [{ id, ref, catatan }] }]
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // silent: muat ulang tanpa menampilkan LoadingState (dipakai setelah tambah/hapus
  // relasi supaya form tidak hilang). Objek opsi, bukan boolean, supaya aman dipakai
  // sebagai handler onRetry (yang menerima event klik).
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!UUID_RE.test(String(id))) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    setError('');
    setNotFound(false);

    const [mainRes, outRes, inRes] = await Promise.all([
      supabase
        .from('peraturan')
        .select(`${DETAIL_COLUMNS}, pembuat:created_by ( nama ), pengubah:updated_by ( nama )`)
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('peraturan_relasi')
        .select(`${RELASI_COLUMNS}, ref:terkait_id ( ${REF_COLUMNS} )`)
        .eq('peraturan_id', id),
      supabase
        .from('peraturan_relasi')
        .select(`${RELASI_COLUMNS}, ref:peraturan_id ( ${REF_COLUMNS} )`)
        .eq('terkait_id', id),
    ]);

    if (mainRes.error) {
      setError(friendlyError(mainRes.error, 'Gagal memuat peraturan.', { context: 'Detail peraturan' }));
      setLoading(false);
      return;
    }
    if (!mainRes.data) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    // Relasi bersifat tambahan: kalau gagal dimuat, detail utama tetap tampil.
    const groups = [];
    if (!outRes.error && !inRes.error) {
      Object.entries(RELASI_LABEL).forEach(([jenisRelasi, label]) => {
        const keluar = (outRes.data || []).filter((r) => r.jenis_relasi === jenisRelasi && r.ref);
        const masuk = (inRes.data || []).filter((r) => r.jenis_relasi === jenisRelasi && r.ref);
        if (keluar.length) {
          groups.push({ key: `${jenisRelasi}-keluar`, label: label.keluar, arah: 'keluar', jenisRelasi, items: keluar });
        }
        if (masuk.length) {
          groups.push({ key: `${jenisRelasi}-masuk`, label: label.masuk, arah: 'masuk', jenisRelasi, items: masuk });
        }
      });
    }

    setRow(mainRes.data);
    setRelasi(groups);
    setLoading(false);
  }, [supabase, id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError('');
    // .select() supaya terlihat kalau RLS menolak (delete diam-diam 0 baris).
    const { data, error: err } = await supabase.from('peraturan').delete().eq('id', row.id).select('id');
    setDeleting(false);

    if (err) {
      setDeleteError(friendlyError(err, 'Gagal menghapus peraturan.', { context: 'Hapus peraturan' }));
      setConfirmDelete(false);
      return;
    }
    if (!data || data.length === 0) {
      setDeleteError('Peraturan tidak terhapus: kamu tidak punya izin, atau datanya sudah tidak ada.');
      setConfirmDelete(false);
      return;
    }

    logActivity(supabase, {
      userId: employee.id,
      aksi: 'hapus_peraturan',
      targetTable: 'peraturan',
      targetId: row.id,
      detail: { peraturan: labelPeraturan(row), judul: row.judul },
    });
    router.push('/employee/peraturan');
  };

  if (loading) {
    return (
      <div className="max-w-[900px] mx-auto px-6 py-10">
        <LoadingState label="Memuat peraturan..." />
      </div>
    );
  }
  if (error) {
    return (
      <div className="max-w-[900px] mx-auto px-6 py-10">
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }
  if (notFound || !row) {
    return (
      <div className="max-w-[900px] mx-auto px-6 py-10">
        <div className="bg-white border border-[#E0E0E0]">
          <EmptyState message="Peraturan tidak ditemukan." />
        </div>
        <Link href="/employee/peraturan" className="inline-block mt-4 text-sm text-madael-red hover:text-madael-dark">
          ← Kembali ke daftar
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto px-6 py-10">
      <Link
        href="/employee/peraturan"
        className="inline-flex items-center gap-1.5 text-sm text-[#6B6B6B] hover:text-black mb-6"
      >
        <ArrowLeft size={14} />
        Kembali ke daftar
      </Link>

      <div className="bg-white border border-[#E0E0E0] border-t-4 border-t-madael-red p-6 md:p-8">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="text-xs font-medium text-madael-red tracking-[0.04em] uppercase">{labelPeraturan(row)}</span>
          <StatusBadge status={row.status} />
        </div>

        <h1 className="font-serif text-[26px] font-normal text-black tracking-[-0.02em] leading-snug">{row.judul}</h1>
        {row.tentang && <p className="text-sm text-[#3D3D3D] mt-2">{row.tentang}</p>}

        {canEdit && (
          <div className="flex flex-wrap gap-3 mt-5">
            <Link
              href={`/employee/peraturan/${row.id}/ubah`}
              className="inline-flex items-center gap-2 border border-[#E0E0E0] px-4 py-2 text-sm text-black hover:border-madael-red hover:text-madael-red transition-colors"
            >
              <Pencil size={14} />
              Ubah
            </Link>
            <button
              type="button"
              onClick={() => { setDeleteError(''); setConfirmDelete(true); }}
              className="inline-flex items-center gap-2 border border-[#E0E0E0] px-4 py-2 text-sm text-red-700 hover:border-red-300 hover:bg-red-50 transition-colors"
            >
              <Trash2 size={14} />
              Hapus
            </button>
          </div>
        )}
        {deleteError && <p className="text-xs text-red-600 mt-3">{deleteError}</p>}

        <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4 mt-6 pt-6 border-t border-[#E0E0E0]">
          <InfoRow label="Jenis">{row.jenis}</InfoRow>
          <InfoRow label="Nomor">{row.nomor}</InfoRow>
          <InfoRow label="Tahun">{row.tahun}</InfoRow>
          <InfoRow label="Tanggal Ditetapkan">{formatTanggal(row.tanggal_ditetapkan)}</InfoRow>
          <InfoRow label="Tanggal Berlaku">{formatTanggal(row.tanggal_berlaku)}</InfoRow>
          <InfoRow label="Status">{row.status}</InfoRow>
        </dl>

        {(row.url_sumber || row.url_pdf) && (
          <div className="flex flex-wrap gap-3 mt-6">
            {/* Hanya http(s) yang dijadikan tautan; database juga menolak skema lain. */}
            {isHttpUrl(row.url_sumber) && (
              <a
                href={row.url_sumber}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-madael-red hover:text-madael-dark"
              >
                <ExternalLink size={14} />
                Sumber resmi
              </a>
            )}
            {isHttpUrl(row.url_pdf) && (
              <a
                href={row.url_pdf}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-madael-red hover:text-madael-dark"
              >
                <FileText size={14} />
                Berkas PDF
              </a>
            )}
          </div>
        )}

        {row.ringkasan && (
          <div className="mt-6 pt-6 border-t border-[#E0E0E0]">
            <h2 className="text-sm font-medium text-black mb-2">Ringkasan</h2>
            {/* Teks biasa ter-escape oleh React; tidak ada HTML mentah. */}
            <p className="text-sm text-[#3D3D3D] leading-relaxed whitespace-pre-line break-words">{row.ringkasan}</p>
            <p className="text-[11px] text-[#9A9A9A] mt-3">
              Ringkasan adalah catatan internal. Rujuk teks resmi di sumbernya sebelum dipakai sebagai dasar hukum.
            </p>
          </div>
        )}

        {(row.topik?.length > 0 || row.keywords?.length > 0) && (
          <div className="mt-6 pt-6 border-t border-[#E0E0E0]">
            <h2 className="text-sm font-medium text-black mb-3">Topik & Keyword</h2>
            <div className="flex flex-wrap gap-2">
              {row.topik?.map((t) => (
                <Link key={`t-${t}`} href={`/employee/peraturan?topik=${encodeURIComponent(t)}`} className="no-underline">
                  <Chip label={t} />
                </Link>
              ))}
              {row.keywords?.map((kw) => (
                <Link key={`k-${kw}`} href={`/employee/peraturan?kw=${encodeURIComponent(kw)}`} className="no-underline">
                  <Chip label={`#${kw}`} />
                </Link>
              ))}
            </div>
          </div>
        )}

        {canEdit && (
          <RelasiManager
            peraturan={row}
            groups={relasi}
            employeeId={employee.id}
            onChanged={() => load({ silent: true })}
          />
        )}

        {!canEdit && relasi.length > 0 && (
          <div className="mt-6 pt-6 border-t border-[#E0E0E0]">
            <h2 className="text-sm font-medium text-black mb-3">Relasi Peraturan</h2>
            <div className="space-y-4">
              {relasi.map((group) => (
                <div key={group.key}>
                  <p className="text-xs text-[#6B6B6B] mb-1">{group.label}</p>
                  <ul className="space-y-1">
                    {group.items.map((item) => (
                      <li key={item.id} className="text-sm">
                        <Link href={`/employee/peraturan/${item.ref.id}`} className="text-madael-red hover:text-madael-dark">
                          {labelPeraturan(item.ref)}
                        </Link>
                        <span className="text-[#3D3D3D]"> — {item.ref.judul}</span>
                        {item.catatan && <span className="text-[#9A9A9A]"> ({item.catatan})</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-[11px] text-[#9A9A9A] mt-8">
          Dibuat {formatTanggalWaktu(row.created_at)}
          {row.pembuat?.nama && ` oleh ${row.pembuat.nama}`}
          {' · '}
          Diperbarui {formatTanggalWaktu(row.updated_at)}
          {row.pengubah?.nama && ` oleh ${row.pengubah.nama}`}
        </p>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Hapus Peraturan"
        message={<>Hapus <strong>{labelPeraturan(row)}</strong> beserta relasinya? Tindakan ini tidak bisa dibatalkan.</>}
        confirmLabel="Hapus"
        busyLabel="Menghapus..."
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
