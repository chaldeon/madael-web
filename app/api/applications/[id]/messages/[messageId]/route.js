import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { MESSAGE_COLUMNS, requireJobPortalAccess } from '@/lib/applicationMessages';
import { checkApplicationScope } from '@/lib/jobPortalServer';

// PATCH /api/applications/[id]/messages/[messageId]
// HR mengonfirmasi sudah menekan Send di WhatsApp: 'wa_dibuka' → 'wa_terkirim'.
// Sistem tidak bisa melihat isi WhatsApp, jadi ini murni konfirmasi manual
// dan hanya berlaku untuk entri channel whatsapp yang masih 'wa_dibuka'.
export async function PATCH(request, { params }) {
  try {
    const { id, messageId } = await params;
    const admin = createAdminClient();

    const access = await requireJobPortalAccess(admin);
    if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

    const scopeCheck = await checkApplicationScope(admin, access.scope, id);
    if (scopeCheck.error) return NextResponse.json({ error: scopeCheck.error }, { status: scopeCheck.status });

    const { data, error } = await admin
      .from('application_messages')
      .update({ status: 'wa_terkirim', confirmed_at: new Date().toISOString() })
      .eq('id', messageId)
      .eq('application_id', id)
      .eq('channel', 'whatsapp')
      .eq('status', 'wa_dibuka')
      .select(MESSAGE_COLUMNS)
      .maybeSingle();

    if (error) {
      console.error('Konfirmasi pesan WhatsApp gagal:', error);
      return NextResponse.json({ error: 'Gagal menyimpan konfirmasi.' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json(
        { error: 'Pesan tidak ditemukan atau sudah dikonfirmasi.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, message: data });
  } catch (err) {
    console.error('Messages PATCH unexpected error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server.' }, { status: 500 });
  }
}
