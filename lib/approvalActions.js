// Aksi keputusan langsung dari Inbox Persetujuan (approve/tolak per baris dan
// massal). Murni (tanpa import server) — dipakai halaman Inbox di browser.
//
// Inbox TIDAK punya logika keputusan sendiri: tiap jenis memanggil route
// keputusan modulnya yang sudah ada, yang melakukan cek akses, aturan bisnis
// (kuota cuti, bentrok, transisi status), compare-and-swap, log aktivitas, dan
// notifikasi ke karyawan di server.
//
// Hanya jenis yang keputusannya bisa diambil dari informasi yang tampil di
// baris inbox (tanggal/jam/nominal) yang punya aksi langsung. Perubahan Profil
// (nilai field sengaja tidak dikirim ke inbox) dan Koreksi Absensi (perlu
// memeriksa foto bukti, hanya superadmin) tetap lewat tombol "Tinjau" ke
// halaman modulnya, supaya tidak ada persetujuan "buta".
import { MAKS_CATATAN_TOLAK_CUTI } from '@/lib/leave';
import { MAKS_ALASAN_LEMBUR } from '@/lib/overtimeRules';
import { MAX_REIMBURSEMENT_TEXT_LENGTH } from '@/lib/reimbursement';

// key = module key di MODULE_REGISTRY / PENDING_QUERIES (sama dengan item.module).
//   method / url(id)    : route keputusan yang sudah ada
//   body(mode, alasan)  : body sesuai kontrak route itu; mode 'approve' | 'reject'
//   alasanWajib         : route menolak 'reject' tanpa alasan (lembur)
//   alasanMaks          : batas panjang alasan di route
//   catatanSetuju       : keterangan singkat di dialog persetujuan (opsional)
export const DIRECT_ACTIONS = {
  leave_request_admin: {
    method: 'POST',
    url: (id) => `/api/leave-requests/${encodeURIComponent(id)}/decision`,
    body: (mode, alasan) =>
      mode === 'approve'
        ? { decision: 'approved' }
        : { decision: 'rejected', rejection_reason: alasan },
    alasanWajib: false,
    alasanMaks: MAKS_CATATAN_TOLAK_CUTI,
  },
  overtime_admin: {
    method: 'POST',
    url: (id) => `/api/overtime-requests/${encodeURIComponent(id)}/decision`,
    body: (mode, alasan) =>
      mode === 'approve'
        ? { decision: 'approved' }
        : { decision: 'rejected', rejection_reason: alasan },
    alasanWajib: true,
    alasanMaks: MAKS_ALASAN_LEMBUR,
    catatanSetuju: 'Jam disetujui mengikuti durasi yang diajukan.',
  },
  reimbursement_admin: {
    method: 'PATCH',
    url: (id) => `/api/reimbursement/${encodeURIComponent(id)}/status`,
    body: (mode, alasan) =>
      mode === 'approve' ? { action: 'approve' } : { action: 'reject', reason: alasan },
    alasanWajib: false,
    alasanMaks: MAX_REIMBURSEMENT_TEXT_LENGTH,
  },
};

export function bisaKeputusanLangsung(item) {
  return !!item && !!DIRECT_ACTIONS[item.module];
}

// item.id di respons inbox berbentuk `${module}:${idBaris}`; route keputusan
// butuh id barisnya saja.
export function idBarisDariItem(item) {
  return item.id.slice(item.module.length + 1);
}

// Batas alasan terkecil di antara semua target (aksi massal bisa campur jenis).
export function batasAlasan(targets) {
  return Math.min(...targets.map((t) => DIRECT_ACTIONS[t.module].alasanMaks));
}

export function alasanWajibUntuk(targets) {
  return targets.some((t) => DIRECT_ACTIONS[t.module].alasanWajib);
}

// Kirim satu keputusan ke route modulnya. Return { ok: true, warning? } atau
// { ok: false, error }. Tidak pernah melempar.
export async function kirimKeputusan(item, mode, alasan) {
  const config = DIRECT_ACTIONS[item.module];
  if (!config) return { ok: false, error: 'Jenis pengajuan ini tidak bisa diproses dari Inbox.' };
  try {
    const res = await fetch(config.url(idBarisDariItem(item)), {
      method: config.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config.body(mode, alasan || null)),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: json.error || 'Gagal memproses pengajuan.' };
    }
    return { ok: true, warning: json.warning || null };
  } catch {
    return { ok: false, error: 'Gagal terhubung ke server. Periksa koneksi internet kamu.' };
  }
}
