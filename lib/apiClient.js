// Pemanggil API JSON dari browser untuk mutasi yang divalidasi dan dicatat di
// server (status invoice/dokumen, edit dokumen, CRM). Browser tidak menulis
// langsung ke tabelnya lagi.
// Return { ok: true, data } atau { ok: false, error, status }.
export async function callJsonApi(url, method, body) {
  try {
    const res = await fetch(url, {
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
