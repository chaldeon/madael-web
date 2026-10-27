// Pemanggil API jadwal kerja & template shift dari browser. Semua penulisan
// work_schedule dan shift_templates lewat route server di /api/attendance/schedule
// (divalidasi dan dicek aksesnya di server); browser hanya membaca.
// Return { ok: true, data } atau { ok: false, error, status }.
export async function callScheduleApi(path, method, body) {
  try {
    const res = await fetch(`/api/attendance/schedule${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, status: res.status, error: data?.error || 'Permintaan gagal. Silakan coba lagi.' };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'Koneksi bermasalah. Periksa internet kamu lalu coba lagi.' };
  }
}
