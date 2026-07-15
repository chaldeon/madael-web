import { createClient } from '@supabase/supabase-js';

// PERINGATAN: client ini bypass semua RLS policy.
// Jangan pernah import file ini di komponen client ('use client') —
// service role key harus tetap di server.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}