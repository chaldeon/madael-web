import { NextResponse } from 'next/server';
import { FEEDBACK_MODULES } from '@/lib/feedbackConfig';
import { requireSupportAccess } from '@/lib/feedbackServer';

const PAGE_SIZE = 30;
const STATUSES = ['baru', 'diproses', 'selesai'];
const MODUL_KEYS = FEEDBACK_MODULES.map((m) => m.key);

// GET /api/feedback/admin/tickets?status=aktif|baru|diproses|selesai&modul=<key|all>&page=1
// Antrean tiket semua user. Tiket 'selesai' tetap ada (tab Riwayat), tidak dihapus.
export async function GET(request) {
  try {
    const gate = await requireSupportAccess();
    if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });
    const { admin } = gate;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'aktif';
    const modul = searchParams.get('modul') || 'all';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);

    if (status !== 'aktif' && !STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Filter status tidak valid.' }, { status: 400 });
    }
    if (modul !== 'all' && !MODUL_KEYS.includes(modul)) {
      return NextResponse.json({ error: 'Filter modul tidak valid.' }, { status: 400 });
    }

    let list = admin
      .from('feedback_tickets')
      .select('id, ticket_no, employee_id, employee_nama, jenis, modul_label, ringkasan, status, last_staff_nama, closed_by, closed_by_nama, created_at, updated_at', { count: 'exact' });
    list = status === 'aktif' ? list.in('status', ['baru', 'diproses']) : list.eq('status', status);
    if (modul !== 'all') list = list.eq('modul', modul);
    list = list
      .order('updated_at', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    // Jumlah per status (ikut filter modul) untuk label tab/chip.
    const countFor = (s) => {
      let q = admin.from('feedback_tickets').select('id', { count: 'exact', head: true }).eq('status', s);
      if (modul !== 'all') q = q.eq('modul', modul);
      return q;
    };

    const [listRes, baru, diproses, selesai] = await Promise.all([
      list, countFor('baru'), countFor('diproses'), countFor('selesai'),
    ]);

    if (listRes.error) {
      console.error('Support list error:', listRes.error);
      return NextResponse.json({ error: 'Gagal memuat tiket.' }, { status: 500 });
    }

    return NextResponse.json({
      tickets: (listRes.data || []).map(({ employee_id, closed_by, ...t }) => ({
        ...t,
        // ditutup oleh pemilik tiket (bukan tim support)?
        closed_by_owner: !!closed_by && closed_by === employee_id,
      })),
      total: listRes.count || 0,
      pageSize: PAGE_SIZE,
      counts: { baru: baru.count || 0, diproses: diproses.count || 0, selesai: selesai.count || 0 },
    });
  } catch (err) {
    console.error('Support list error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
