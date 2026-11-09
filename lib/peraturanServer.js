// SERVER ONLY — gerbang akses, validasi input, dan pembanding audit untuk API
// modul Peraturan Ketenagakerjaan (app/api/peraturan). Dulu form, pasal, relasi,
// impor, dan hapus peraturan menulis langsung ke tabelnya dari browser (validasi
// hanya di form, audit fire-and-forget lewat /api/activity-log). Kini semua
// tulis lewat route; validasi, hak tulis, dan activity log ditegakkan di server.
//
// PENTING — kenapa tulis memakai klien SESI, bukan service role:
// trigger di database mengisi pelaku dari JWT sesi (auth.jwt() ->> 'email'):
// riwayat revisi peraturan dan pasal (kolom diubah_oleh) serta created_by /
// updated_by. Dengan service role JWT tidak punya email, sehingga pelaku semua
// perubahan akan tercatat kosong ("Sistem / SQL Editor"). Maka route memakai klien
// Supabase dengan cookie sesi pengguna: RLS dan trigger bekerja persis seperti
// saat browser menulis langsung. Service role hanya dipakai untuk gerbang modul
// dan activity log.

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import {
  PERATURAN_MODULE_KEY, TOPIK_OPTIONS, LIMITS,
  buildPayload, buildPasalPayload,
} from '@/lib/peraturanConfig';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// id pasal/relasi: bentuknya ditentukan skema (tidak ada di repo), jadi cukup
// dibatasi ke karakter aman. Id yang bentuknya salah untuk kolomnya ditolak
// database dengan 22P02 dan dijawab 404 oleh route.
const ID_AMAN_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function idAmanValid(id) {
  return typeof id === 'string' && ID_AMAN_RE.test(id);
}

export function jsonError(message, status, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

// Klien Supabase dengan sesi pengguna yang sedang login (cookie). Lihat catatan
// di kepala file: dipakai untuk SEMUA tulis ke tabel peraturan*.
async function bukaKlienSesi() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // no-op — route ini tidak menulis cookie
        },
      },
    }
  );
}

// Gerbang tulis: akun aktif, memegang flag peraturan_ketenagakerjaan, DAN
// superadmin (sama dengan RLS tulis di tabel dan dengan /api/peraturan/pdf).
// Return { emp, db } atau { response } (respons JSON siap kirim).
export async function gerbangTulisPeraturan(admin) {
  const access = await requireModuleAccess(admin, [PERATURAN_MODULE_KEY]);
  if (access.error) return { response: jsonError(access.error, access.status) };
  if (!access.emp.is_superadmin) {
    return { response: jsonError('Hanya superadmin yang boleh mengubah data peraturan.', 403) };
  }
  return { emp: access.emp, db: await bukaKlienSesi() };
}

// ---------------------------------------------------------------------------
// Input peraturan
// ---------------------------------------------------------------------------

const teks = (v) => (typeof v === 'string' ? v : '');

function tanggalValid(s) {
  if (s === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Bentuk form -> payload tervalidasi memakai buildPayload yang SAMA dengan form
// di browser (sumber aturan tunggal), ditambah pemeriksaan yang di browser
// dijaga oleh kontrol input: tipe data, tanggal, dan daftar topik.
// Return { payload } atau { error } (pesan siap tampil, dikirim sebagai 400).
function validasiFormPeraturan(src) {
  if (!src || typeof src !== 'object' || Array.isArray(src)) return { error: 'Data peraturan tidak valid.' };

  const tahun = typeof src.tahun === 'number' ? String(src.tahun) : teks(src.tahun);
  const topik = src.topik === undefined || src.topik === null ? [] : src.topik;
  if (!Array.isArray(topik) || topik.some((t) => typeof t !== 'string')) {
    return { error: 'Topik tidak valid.' };
  }
  if (topik.some((t) => !TOPIK_OPTIONS.includes(t))) return { error: 'Topik tidak dikenal.' };

  const tanggalDitetapkan = teks(src.tanggal_ditetapkan);
  const tanggalBerlaku = teks(src.tanggal_berlaku);
  if (!tanggalValid(tanggalDitetapkan)) return { error: 'Tanggal Ditetapkan tidak valid.' };
  if (!tanggalValid(tanggalBerlaku)) return { error: 'Tanggal Berlaku tidak valid.' };

  const built = buildPayload({
    jenis: teks(src.jenis),
    nomor: teks(src.nomor),
    tahun,
    judul: teks(src.judul),
    tentang: teks(src.tentang),
    tanggal_ditetapkan: tanggalDitetapkan,
    tanggal_berlaku: tanggalBerlaku,
    status: teks(src.status),
    ringkasan: teks(src.ringkasan),
    url_sumber: teks(src.url_sumber),
    url_pdf: teks(src.url_pdf),
    topik: [...new Set(topik)],
    keywordsText: teks(src.keywordsText),
  });
  return built.error ? { error: built.error } : { payload: built.payload };
}

// Body tambah/ubah dari form: { form: { ...bentuk EMPTY_FORM } }.
export function bacaFormPeraturan(body) {
  return validasiFormPeraturan(body?.form);
}

// Satu baris impor: payload hasil buildPayload di browser (keywords berupa
// array). Divalidasi ulang di sini; browser tidak dipercaya.
export function bacaPayloadImpor(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: 'Data baris tidak valid.' };
  }
  if (payload.keywords !== undefined && payload.keywords !== null
    && (!Array.isArray(payload.keywords) || payload.keywords.some((k) => typeof k !== 'string'))) {
    return { error: 'Keyword tidak valid.' };
  }
  return validasiFormPeraturan({
    ...payload,
    keywordsText: Array.isArray(payload.keywords) ? payload.keywords.join(', ') : '',
  });
}

// Berkas PDF hasil unggah (/api/peraturan/pdf): { fileId, nama, ukuran }.
// Return { value: null } kalau tidak ada, { value: kolom pdf_* } atau { error }.
export function bacaPdfBaru(raw) {
  if (raw === undefined || raw === null) return { value: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Data berkas PDF tidak valid.' };

  const fileId = typeof raw.fileId === 'string' ? raw.fileId.trim() : '';
  if (!fileId || fileId.length > LIMITS.pdfDriveId || !/^[A-Za-z0-9_-]+$/.test(fileId)) {
    return { error: 'ID berkas PDF tidak valid.' };
  }
  const nama = typeof raw.nama === 'string' ? raw.nama.trim() : '';
  if (!nama || nama.length > LIMITS.pdfNama) return { error: 'Nama berkas PDF tidak valid.' };
  const ukuran = Number(raw.ukuran);
  if (!Number.isInteger(ukuran) || ukuran <= 0 || ukuran > LIMITS.pdfBytes) {
    return { error: 'Ukuran berkas PDF tidak valid.' };
  }
  return { value: { pdf_drive_id: fileId, pdf_nama: nama, pdf_ukuran: ukuran } };
}

// Berkas Drive yang sudah dirujuk peraturan lain tidak boleh ditempel lagi
// (kalau tidak, menghapus salah satu peraturan bisa menghapus berkas yang sama).
// Return true bila sudah dipakai peraturan LAIN.
export async function pdfSudahDipakai(db, fileId, exceptId = null) {
  let q = db.from('peraturan').select('id').eq('pdf_drive_id', fileId).limit(1);
  if (exceptId) q = q.neq('id', exceptId);
  const { data, error } = await q;
  if (error) throw error;
  return !!(data && data.length > 0);
}

// Cari peraturan lain dengan jenis + nomor + tahun yang sama (untuk tautan
// "Buka peraturan yang sudah ada" saat kena unique index). Null bila tidak ada.
export async function cariIdDuplikat(db, payload, exceptId = null) {
  const { data } = await db
    .from('peraturan')
    .select('id')
    .eq('jenis', payload.jenis)
    .eq('tahun', payload.tahun)
    .eq('nomor', payload.nomor)
    .maybeSingle();
  return data?.id && data.id !== exceptId ? data.id : null;
}

// Daftar (topik, keywords) dibandingkan tanpa memedulikan urutan.
function bentuk(v) {
  return Array.isArray(v) ? JSON.stringify([...v].sort()) : JSON.stringify(v);
}

// Nama kolom yang berubah antara baris lama dan payload baru — detail audit.
export function kolomPeraturanBerubah(before, payload) {
  return Object.keys(payload).filter(
    (k) => bentuk(payload[k]) !== bentuk(before?.[k] ?? (Array.isArray(payload[k]) ? [] : null))
  );
}

// ---------------------------------------------------------------------------
// Input pasal
// ---------------------------------------------------------------------------

// Body pasal: { form: { nomor_pasal, urutan, judul, isi, catatan } }.
export function bacaFormPasal(body) {
  const src = body?.form;
  if (!src || typeof src !== 'object' || Array.isArray(src)) return { error: 'Data pasal tidak valid.' };
  const built = buildPasalPayload({
    nomor_pasal: teks(src.nomor_pasal),
    urutan: typeof src.urutan === 'number' ? String(src.urutan) : teks(src.urutan),
    judul: teks(src.judul),
    isi: teks(src.isi),
    catatan: teks(src.catatan),
  });
  return built.error ? { error: built.error } : { payload: built.payload };
}

export function kolomPasalBerubah(before, payload) {
  return Object.keys(payload).filter(
    (k) => JSON.stringify(payload[k]) !== JSON.stringify(before?.[k] ?? null)
  );
}
