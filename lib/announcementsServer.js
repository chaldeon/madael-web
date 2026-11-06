// SERVER ONLY — validasi input & pemeriksaan pendukung untuk API pengumuman
// (app/api/announcements). Dulu admin menulis langsung ke tabel `announcements`
// dari browser; kini semua tulis lewat route yang memakai service role, jadi
// validasi, created_by, dan jejak audit ditegakkan di server.

export const ANNOUNCEMENT_JUDUL_MAX = 200;
export const ANNOUNCEMENT_ISI_MAX = 10000;

// Merapikan & memvalidasi body untuk buat / edit pengumuman.
// Return { value: { judul, isi, expired_at, target_company_id, pinned } }
// atau { error } (pesan siap tampil, dikirim sebagai 400).
export function normalizeAnnouncementInput(body) {
  const judul = typeof body?.judul === 'string' ? body.judul.trim() : '';
  const isi = typeof body?.isi === 'string' ? body.isi.trim() : '';
  if (!judul || !isi) return { error: 'Judul dan isi pengumuman wajib diisi.' };
  if (judul.length > ANNOUNCEMENT_JUDUL_MAX) {
    return { error: `Judul maksimal ${ANNOUNCEMENT_JUDUL_MAX} karakter.` };
  }
  if (isi.length > ANNOUNCEMENT_ISI_MAX) {
    return { error: `Isi pengumuman maksimal ${ANNOUNCEMENT_ISI_MAX} karakter.` };
  }

  let expiredAt = null;
  if (body?.expired_at !== undefined && body?.expired_at !== null && body?.expired_at !== '') {
    if (typeof body.expired_at !== 'string') return { error: 'Tanggal kedaluwarsa tidak valid.' };
    const d = new Date(body.expired_at);
    if (Number.isNaN(d.getTime())) return { error: 'Tanggal kedaluwarsa tidak valid.' };
    expiredAt = d.toISOString();
  }

  let target = body?.target_company_id;
  if (target === undefined || target === null || target === '') {
    target = null;
  } else if (typeof target === 'string' || typeof target === 'number') {
    target = String(target).trim() || null;
  } else {
    return { error: 'Perusahaan target tidak valid.' };
  }

  return {
    value: {
      judul,
      isi,
      expired_at: expiredAt,
      target_company_id: target,
      pinned: body?.pinned === true,
    },
  };
}

// Perusahaan target harus ada (tidak bergantung pada tipe kolom id).
// Return null kalau valid, atau string pesan error (400).
export async function periksaPerusahaanTarget(admin, targetCompanyId) {
  if (targetCompanyId === null || targetCompanyId === undefined) return null;
  const { data, error } = await admin
    .from('companies')
    .select('id')
    .eq('id', targetCompanyId)
    .maybeSingle();
  if (error) {
    // 22P02 = nilai bukan format id yang valid
    if (error.code === '22P02') return 'Perusahaan target tidak valid.';
    throw error;
  }
  return data ? null : 'Perusahaan target tidak ditemukan.';
}

// Nama field yang berubah antara baris lama dan patch — untuk detail audit.
export function fieldPengumumanBerubah(before, patch) {
  const berubah = [];
  for (const [key, nilai] of Object.entries(patch)) {
    const lama = before?.[key];
    if (key === 'expired_at') {
      const a = lama ? new Date(lama).getTime() : null;
      const b = nilai ? new Date(nilai).getTime() : null;
      if (a !== b) berubah.push(key);
    } else if (key === 'target_company_id') {
      if (String(lama ?? '') !== String(nilai ?? '')) berubah.push(key);
    } else if (key === 'pinned') {
      if (Boolean(lama) !== Boolean(nilai)) berubah.push(key);
    } else if ((lama ?? null) !== (nilai ?? null)) {
      berubah.push(key);
    }
  }
  return berubah;
}
