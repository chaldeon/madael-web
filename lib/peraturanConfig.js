// Konfigurasi dan helper bersama modul "Peraturan Ketenagakerjaan"
// (app/employee/peraturan, components/peraturan).
//
// PENTING: JENIS_OPTIONS, STATUS_OPTIONS, dan batas panjang di bawah harus
// sama dengan CHECK constraint di sql/20261012_peraturan_ketenagakerjaan.sql
// (peraturan) dan sql/20261013_peraturan_pasal.sql (pasal, kunci `pasal*`).
// Menambah jenis/status baru = ubah di sini DAN di constraint SQL-nya.
// TOPIK_OPTIONS sengaja tanpa constraint di database: cukup tambah di sini.

export const PERATURAN_MODULE_KEY = 'peraturan_ketenagakerjaan';

export const JENIS_OPTIONS = ['UU', 'PP', 'Perpres', 'Permenaker', 'Kepmenaker', 'SE Menaker', 'Lainnya'];
export const STATUS_OPTIONS = ['Berlaku', 'Diubah', 'Dicabut'];

// Kategori (label saja, bukan isi hukum). Satu peraturan boleh punya beberapa topik.
export const TOPIK_OPTIONS = [
  'PKWT', 'Alih Daya', 'PHK', 'Upah', 'Lembur', 'Cuti', 'BPJS', 'K3', 'Hubungan Industrial', 'Lainnya',
];

export const PAGE_SIZE = 20;
export const MIN_TAHUN = 1945;
export const MAX_TAHUN = 2100;

export const LIMITS = {
  nomor: 100,
  judulMin: 3,
  judul: 500,
  tentang: 1000,
  ringkasan: 20000,
  url: 2000,
  keywords: 30,
  keyword: 60,
  catatanRelasi: 300,
  // Pasal (tabel peraturan_pasal)
  pasalNomor: 30,
  pasalJudul: 300,
  pasalIsi: 20000,
  pasalCatatan: 2000,
  pasalUrutanMax: 1000000,
};

// Kolom yang dibutuhkan halaman detail/ubah. Sengaja TIDAK memakai select('*')
// supaya kolom internal pencarian (search_text, search_tsv) tidak ikut terkirim.
export const DETAIL_COLUMNS =
  'id, jenis, nomor, tahun, judul, tentang, tanggal_ditetapkan, tanggal_berlaku, status, ringkasan, url_sumber, url_pdf, topik, keywords, created_by, updated_by, created_at, updated_at';

// Kolom pasal. Daftar hanya memuat header (isi dimuat saat pasal dibuka);
// search_tsv sengaja tidak pernah dikirim ke klien.
export const PASAL_LIST_COLUMNS = 'id, nomor_pasal, urutan, judul';
export const PASAL_DETAIL_COLUMNS =
  'id, peraturan_id, nomor_pasal, urutan, judul, isi, catatan, created_at, updated_at';
export const PASAL_PAGE_SIZE = 50;

export const STATUS_STYLE = {
  Berlaku: 'bg-green-100 text-green-700',
  Diubah: 'bg-amber-100 text-amber-700',
  Dicabut: 'bg-red-100 text-red-700',
};

// Arah relasi disimpan sebagai (peraturan_id) <jenis_relasi> (terkait_id).
// Dua sisi tampilan: dari sisi pelaku (keluar) dan dari sisi yang dikenai (masuk).
// Dipakai halaman detail (label) dan components/peraturan/RelasiManager.js.
export const RELASI_LABEL = {
  mengubah: { keluar: 'Mengubah', masuk: 'Diubah oleh' },
  mencabut: { keluar: 'Mencabut', masuk: 'Dicabut oleh' },
  melaksanakan: { keluar: 'Melaksanakan', masuk: 'Dilaksanakan oleh' },
};

// Pilihan jenis relasi di form tambah. Relasi selalu ditambah dari sisi pelaku
// ("peraturan ini <jenis> peraturan target"); sisi sebaliknya muncul otomatis
// di halaman peraturan target.
export const RELASI_OPTIONS = Object.entries(RELASI_LABEL).map(([value, label]) => ({
  value,
  label: label.keluar,
}));

// "PP No. 35 Tahun 2021"
export function labelPeraturan(row) {
  if (!row) return '';
  return `${row.jenis} No. ${row.nomor} Tahun ${row.tahun}`;
}

// Tanggal 'YYYY-MM-DD' (kolom date) ditampilkan tanpa pergeseran zona waktu.
export function formatTanggal(value) {
  if (!value) return '-';
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '-';
  return new Date(y, m - 1, d).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatTanggalWaktu(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Normalisasi satu keyword — sama dengan trigger di database
// (huruf kecil, spasi dirapikan).
export function normalizeKeyword(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// "phk, Pesangon\nupah minimum" -> ['phk', 'pesangon', 'upah minimum'] (tanpa duplikat).
export function parseKeywords(text) {
  const seen = new Set();
  const out = [];
  String(text ?? '').split(/[,\n;]/).forEach((part) => {
    const kw = normalizeKeyword(part);
    if (kw && !seen.has(kw)) {
      seen.add(kw);
      out.push(kw);
    }
  });
  return out;
}

export function isHttpUrl(value) {
  return /^https?:\/\/\S+$/i.test(String(value ?? '').trim());
}

// Daftar kosong -> ''. Dipakai untuk mengisi input teks dari array keywords.
export function keywordsToText(keywords) {
  return (keywords || []).join(', ');
}

export const EMPTY_FORM = {
  jenis: 'UU',
  nomor: '',
  tahun: '',
  judul: '',
  tentang: '',
  tanggal_ditetapkan: '',
  tanggal_berlaku: '',
  status: 'Berlaku',
  ringkasan: '',
  url_sumber: '',
  url_pdf: '',
  topik: [],
  keywordsText: '',
};

export function formFromRow(row) {
  return {
    jenis: row.jenis,
    nomor: row.nomor ?? '',
    tahun: String(row.tahun ?? ''),
    judul: row.judul ?? '',
    tentang: row.tentang ?? '',
    tanggal_ditetapkan: row.tanggal_ditetapkan ?? '',
    tanggal_berlaku: row.tanggal_berlaku ?? '',
    status: row.status,
    ringkasan: row.ringkasan ?? '',
    url_sumber: row.url_sumber ?? '',
    url_pdf: row.url_pdf ?? '',
    topik: row.topik || [],
    keywordsText: keywordsToText(row.keywords),
  };
}

// Validasi dasar di sisi klien (cermin dari CHECK constraint). Database tetap
// penjaga akhirnya. Return { error } atau { payload } siap kirim ke Supabase.
export function buildPayload(form) {
  const nomor = form.nomor.trim();
  const judul = form.judul.trim();
  const tahun = Number(form.tahun);
  const keywords = parseKeywords(form.keywordsText);
  const urlSumber = form.url_sumber.trim();
  const urlPdf = form.url_pdf.trim();

  if (!JENIS_OPTIONS.includes(form.jenis)) return { error: 'Jenis peraturan tidak valid.' };
  if (!nomor) return { error: 'Nomor wajib diisi.' };
  if (nomor.length > LIMITS.nomor) return { error: `Nomor maksimal ${LIMITS.nomor} karakter.` };
  if (!Number.isInteger(tahun) || tahun < MIN_TAHUN || tahun > MAX_TAHUN) {
    return { error: `Tahun harus berupa angka antara ${MIN_TAHUN} dan ${MAX_TAHUN}.` };
  }
  if (judul.length < LIMITS.judulMin) return { error: 'Judul wajib diisi.' };
  if (judul.length > LIMITS.judul) return { error: `Judul maksimal ${LIMITS.judul} karakter.` };
  if (form.tentang.length > LIMITS.tentang) return { error: `Kolom "Tentang" maksimal ${LIMITS.tentang} karakter.` };
  if (form.ringkasan.length > LIMITS.ringkasan) return { error: `Ringkasan maksimal ${LIMITS.ringkasan} karakter.` };
  if (!STATUS_OPTIONS.includes(form.status)) return { error: 'Status tidak valid.' };
  if (urlSumber && (!isHttpUrl(urlSumber) || urlSumber.length > LIMITS.url)) {
    return { error: 'URL sumber resmi harus diawali http:// atau https://.' };
  }
  if (urlPdf && (!isHttpUrl(urlPdf) || urlPdf.length > LIMITS.url)) {
    return { error: 'URL PDF harus diawali http:// atau https://.' };
  }
  if (keywords.length > LIMITS.keywords) return { error: `Keyword maksimal ${LIMITS.keywords} buah.` };
  if (keywords.some((k) => k.length > LIMITS.keyword)) {
    return { error: `Setiap keyword maksimal ${LIMITS.keyword} karakter.` };
  }
  // Tanggal berlaku < tanggal ditetapkan sengaja tidak ditolak: ada peraturan
  // yang berlaku surut.

  return {
    payload: {
      jenis: form.jenis,
      nomor,
      tahun,
      judul,
      tentang: form.tentang.trim() || null,
      tanggal_ditetapkan: form.tanggal_ditetapkan || null,
      tanggal_berlaku: form.tanggal_berlaku || null,
      status: form.status,
      ringkasan: form.ringkasan.trim() || null,
      url_sumber: urlSumber || null,
      url_pdf: urlPdf || null,
      topik: form.topik,
      keywords,
    },
  };
}

// ---------------------------------------------------------------------------
// Pasal
// ---------------------------------------------------------------------------

// Rapikan nomor pasal: spasi berlebih dibuang. Huruf besar/kecil dibiarkan
// ("59A"); keunikan di database tidak membedakan huruf besar/kecil.
export function normalizeNomorPasal(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

export function labelPasal(row) {
  return row ? `Pasal ${row.nomor_pasal}` : '';
}

// Id elemen HTML untuk tautan langsung: "59A" -> "pasal-59a" (#pasal-59a).
export function pasalAnchor(nomor) {
  const slug = String(nomor ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `pasal-${slug}`;
}

export const EMPTY_PASAL_FORM = { nomor_pasal: '', urutan: '', judul: '', isi: '', catatan: '' };

export function pasalFormFromRow(row) {
  return {
    nomor_pasal: row.nomor_pasal ?? '',
    urutan: String(row.urutan ?? ''),
    judul: row.judul ?? '',
    isi: row.isi ?? '',
    catatan: row.catatan ?? '',
  };
}

// Validasi klien (cermin CHECK di sql/20261013_peraturan_pasal.sql).
// Return { error } atau { payload } (tanpa peraturan_id).
export function buildPasalPayload(form) {
  const nomor = normalizeNomorPasal(form.nomor_pasal);
  const judul = form.judul.trim();
  const isi = form.isi.trim();
  const catatan = form.catatan.trim();
  const urutan = Number(form.urutan);

  if (!nomor) return { error: 'Nomor pasal wajib diisi.' };
  if (nomor.length > LIMITS.pasalNomor) return { error: `Nomor pasal maksimal ${LIMITS.pasalNomor} karakter.` };
  if (form.urutan === '' || !Number.isInteger(urutan) || urutan < 0 || urutan > LIMITS.pasalUrutanMax) {
    return { error: `Urutan harus bilangan bulat antara 0 dan ${LIMITS.pasalUrutanMax}.` };
  }
  if (judul.length > LIMITS.pasalJudul) return { error: `Judul bab/bagian maksimal ${LIMITS.pasalJudul} karakter.` };
  if (!isi) return { error: 'Isi pasal wajib diisi.' };
  if (isi.length > LIMITS.pasalIsi) return { error: `Isi pasal maksimal ${LIMITS.pasalIsi} karakter.` };
  if (catatan.length > LIMITS.pasalCatatan) return { error: `Catatan maksimal ${LIMITS.pasalCatatan} karakter.` };

  return {
    payload: {
      nomor_pasal: nomor,
      urutan,
      judul: judul || null,
      isi,
      catatan: catatan || null,
    },
  };
}
