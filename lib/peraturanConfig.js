// Konfigurasi dan helper bersama modul "Peraturan Ketenagakerjaan"
// (app/employee/peraturan, components/peraturan).
//
// PENTING: JENIS_OPTIONS, STATUS_OPTIONS, dan batas panjang di bawah harus
// sama dengan CHECK constraint di sql/20261012_peraturan_ketenagakerjaan.sql
// (peraturan) dan sql/20261013_peraturan_pasal.sql (pasal, kunci `pasal*`).
// Pencarian (RPC cari_peraturan): sql/20261014_peraturan_pencarian.sql.
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
  // PDF unggahan (Google Drive). Lewat route Next.js, jadi dibatasi di bawah
  // batas body fungsi serverless Vercel (~4,5 MB), sama seperti lampiran cuti.
  pdfBytes: 4 * 1024 * 1024,
  pdfNama: 255,
  pdfDriveId: 200,
};

// Kolom yang dibutuhkan halaman detail/ubah. Sengaja TIDAK memakai select('*')
// supaya kolom internal pencarian (search_text, search_tsv, ringkasan_tsv) tidak ikut terkirim.
export const DETAIL_COLUMNS =
  'id, jenis, nomor, tahun, judul, tentang, tanggal_ditetapkan, tanggal_berlaku, status, ringkasan, url_sumber, url_pdf, pdf_drive_id, pdf_nama, pdf_ukuran, topik, keywords, created_by, updated_by, created_at, updated_at';

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

// Status "tidak murni berlaku" -> jenis relasi masuk yang menunjuk peraturan
// pengganti. Dicabut dirujuk lewat "Dicabut oleh", Diubah lewat "Diubah oleh".
// Dipakai banner di halaman detail dan penanda di halaman daftar.
export const RELASI_PENGGANTI = {
  Dicabut: 'mencabut',
  Diubah: 'mengubah',
};

// Pilihan jenis relasi di form tambah. Relasi selalu ditambah dari sisi pelaku
// ("peraturan ini <jenis> peraturan target"); sisi sebaliknya muncul otomatis
// di halaman peraturan target.
export const RELASI_OPTIONS = Object.entries(RELASI_LABEL).map(([value, label]) => ({
  value,
  label: label.keluar,
}));

// "1,2 MB" / "340 KB" untuk tampilan ukuran berkas.
export function formatUkuranBerkas(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

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

// ---------------------------------------------------------------------------
// Impor massal (CSV/XLSX) — halaman /employee/peraturan/impor
// ---------------------------------------------------------------------------

export const IMPORT_LIMITS = {
  maxRows: 500,
  maxBytes: 2 * 1024 * 1024,
  batchSize: 100,
};

// Kolom file impor, urutan = urutan di template. `aliases` = nama header lain
// yang diterima (dibandingkan setelah dinormalisasi, lihat normalizeHeader).
// Hanya data header peraturan; pasal dan PDF unggahan tidak ikut diimpor.
export const IMPORT_COLUMNS = [
  { key: 'jenis', header: 'Jenis', required: true, aliases: [] },
  { key: 'nomor', header: 'Nomor', required: true, aliases: [] },
  { key: 'tahun', header: 'Tahun', required: true, aliases: [] },
  { key: 'judul', header: 'Judul', required: true, aliases: [] },
  { key: 'tentang', header: 'Tentang', required: false, aliases: [] },
  { key: 'tanggal_ditetapkan', header: 'Tanggal Ditetapkan', required: false, aliases: ['tanggalditetapkan', 'ditetapkan'] },
  { key: 'tanggal_berlaku', header: 'Tanggal Berlaku', required: false, aliases: ['tanggalberlaku', 'berlaku'] },
  { key: 'status', header: 'Status', required: false, aliases: [] },
  { key: 'topik', header: 'Topik', required: false, aliases: [] },
  { key: 'keywords', header: 'Keyword', required: false, aliases: ['keywords', 'kata kunci'] },
  { key: 'ringkasan', header: 'Ringkasan', required: false, aliases: [] },
  { key: 'url_sumber', header: 'URL Sumber', required: false, aliases: ['urlsumber', 'url sumber resmi'] },
  { key: 'url_pdf', header: 'URL PDF', required: false, aliases: ['urlpdf'] },
];

// Baris yang judulnya diawali kata ini dianggap sisa contoh template dan ditolak.
const CONTOH_PREFIX = 'CONTOH';

// "Jenis *", "  jenis " -> "jenis"; "(opsional)" dan tanda * dibuang.
export function normalizeHeader(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Peta header file -> indeks kolom. Return { index: { key: colIndex }, missing: [header wajib yang tidak ada] }.
export function mapImportHeader(headerRow) {
  const names = (headerRow || []).map(normalizeHeader);
  const index = {};
  IMPORT_COLUMNS.forEach((col) => {
    const candidates = [normalizeHeader(col.header), ...col.aliases.map(normalizeHeader)];
    const found = names.findIndex((n) => n && candidates.includes(n));
    if (found >= 0) index[col.key] = found;
  });
  const missing = IMPORT_COLUMNS.filter((c) => c.required && !(c.key in index)).map((c) => c.header);
  return { index, missing };
}

function cellText(value) {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return String(value).trim();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function isRealDate(y, m, d) {
  if (!(y >= MIN_TAHUN && y <= MAX_TAHUN) || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Sel tanggal -> 'YYYY-MM-DD' atau '' (kosong) atau null (tidak valid).
// Diterima: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, dan serial tanggal
// Excel (angka). Format hari-bulan mengikuti kebiasaan Indonesia (bukan MM/DD).
export function parseTanggalImpor(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 61 || value > 2958465) return null; // serial Excel (setelah 1900-03-01)
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    return isRealDate(y, m, day) ? `${y}-${pad2(m)}-${pad2(day)}` : null;
  }
  const text = String(value).trim();
  if (!text) return '';
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isRealDate(y, mo, d) ? `${y}-${pad2(mo)}-${pad2(d)}` : null;
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isRealDate(y, mo, d) ? `${y}-${pad2(mo)}-${pad2(d)}` : null;
  }
  return null;
}

// Kunci pembanding duplikat. Sama dengan unique index (jenis + nomor + tahun),
// tetapi sedikit lebih ketat: huruf besar/kecil diabaikan dan nol di depan pada
// nomor murni angka dibuang ("035" = "35"), supaya beda format tidak lolos.
export function kunciPeraturan(jenis, nomor, tahun) {
  let n = String(nomor ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (/^\d+$/.test(n)) n = n.replace(/^0+(?=\d)/, '');
  return `${jenis}|${Number(tahun)}|${n}`;
}

function cocokkanOpsi(value, options) {
  const v = String(value ?? '').trim().toLowerCase();
  return options.find((o) => o.toLowerCase() === v) || null;
}

// Ubah satu baris mentah (array sel) menjadi hasil validasi.
// Return { payload, errors: [], warnings: [] }; payload = null bila ada error.
// Validasi isi memakai buildPayload yang sama dengan form tambah/ubah.
export function validateImportRow(cells, index) {
  const get = (key) => (key in index ? cells[index[key]] : '');
  const errors = [];
  const warnings = [];

  const jenisRaw = cellText(get('jenis'));
  const jenis = cocokkanOpsi(jenisRaw, JENIS_OPTIONS);
  if (!jenis) {
    errors.push(jenisRaw ? `Jenis "${jenisRaw}" tidak dikenal (pilihan: ${JENIS_OPTIONS.join(', ')}).` : 'Jenis wajib diisi.');
  }

  const statusRaw = cellText(get('status'));
  let status = 'Berlaku';
  if (statusRaw) {
    status = cocokkanOpsi(statusRaw, STATUS_OPTIONS);
    if (!status) {
      errors.push(`Status "${statusRaw}" tidak dikenal (pilihan: ${STATUS_OPTIONS.join(', ')}).`);
      status = 'Berlaku';
    }
  }

  const tahunRaw = cellText(get('tahun'));
  const judul = cellText(get('judul'));
  if (judul.toUpperCase().startsWith(CONTOH_PREFIX)) {
    errors.push('Judul diawali "CONTOH": ini baris contoh dari template. Hapus atau ganti dengan data asli.');
  }

  const ditetapkan = parseTanggalImpor(get('tanggal_ditetapkan'));
  if (ditetapkan === null) errors.push('Tanggal Ditetapkan tidak valid (pakai YYYY-MM-DD atau DD/MM/YYYY).');
  const berlaku = parseTanggalImpor(get('tanggal_berlaku'));
  if (berlaku === null) errors.push('Tanggal Berlaku tidak valid (pakai YYYY-MM-DD atau DD/MM/YYYY).');

  const topikTokens = cellText(get('topik')).split(';').map((t) => t.trim()).filter(Boolean);
  const topik = [];
  const topikAsing = [];
  topikTokens.forEach((t) => {
    const match = cocokkanOpsi(t, TOPIK_OPTIONS);
    if (!match) topikAsing.push(t);
    else if (!topik.includes(match)) topik.push(match);
  });
  if (topikAsing.length > 0) {
    warnings.push(`Topik tidak dikenal dilewati: ${topikAsing.join(', ')}.`);
  }

  // Jenis/status tidak valid sudah dilaporkan di atas; nilai pengganti dipakai
  // di sini supaya buildPayload tetap memeriksa kolom lain (tahun, judul, dst.).
  const built = buildPayload({
    jenis: jenis || 'Lainnya',
    nomor: cellText(get('nomor')),
    tahun: tahunRaw,
    judul,
    tentang: cellText(get('tentang')),
    tanggal_ditetapkan: ditetapkan || '',
    tanggal_berlaku: berlaku || '',
    status,
    ringkasan: cellText(get('ringkasan')),
    url_sumber: cellText(get('url_sumber')),
    url_pdf: cellText(get('url_pdf')),
    topik,
    keywordsText: cellText(get('keywords')),
  });

  if (built.error) errors.push(built.error);
  if (nomorBerawalanNol(cellText(get('nomor')))) {
    warnings.push('Nomor berawalan nol; untuk cek duplikat dibaca tanpa nol di depan (mis. "035" = "35").');
  }
  return { payload: errors.length > 0 ? null : built.payload, errors, warnings };
}

// Nomor "35" vs "035" dll: peringatan bila nomor murni angka berawalan nol.
export function nomorBerawalanNol(nomor) {
  return /^0\d+$/.test(String(nomor ?? '').trim());
}

// ---------------------------------------------------------------------------
// Ekspor CSV (sekaligus cadangan) — tombol di /employee/peraturan
// ---------------------------------------------------------------------------

// Kolom ekspor = kolom impor (IMPORT_COLUMNS) supaya file bisa diimpor ulang.
// Hanya data header peraturan: pasal, relasi, dan berkas PDF unggahan tidak ikut.
export const EXPORT_HEADERS = IMPORT_COLUMNS.map((c) => ({ key: c.key, label: c.header }));
export const EXPORT_SELECT = IMPORT_COLUMNS.map((c) => c.key).join(', ');
export const EXPORT_ID_CHUNK = 100;

// Satu baris tabel -> baris CSV. Topik dipisah ';' dan keyword ',' (sama dengan
// aturan impor); sisanya apa adanya (tanggal sudah 'YYYY-MM-DD' dari database).
export function peraturanToExportRow(row) {
  return {
    ...row,
    topik: (row.topik || []).join(';'),
    keywords: (row.keywords || []).join(', '),
  };
}

// Urutan file: tahun terbaru dulu, lalu jenis (urutan JENIS_OPTIONS), lalu nomor.
export function sortPeraturanExport(rows) {
  const jenisIdx = (j) => {
    const i = JENIS_OPTIONS.indexOf(j);
    return i < 0 ? JENIS_OPTIONS.length : i;
  };
  return [...rows].sort(
    (a, b) =>
      (b.tahun || 0) - (a.tahun || 0) ||
      jenisIdx(a.jenis) - jenisIdx(b.jenis) ||
      String(a.nomor ?? '').localeCompare(String(b.nomor ?? ''), 'id', { numeric: true })
  );
}
