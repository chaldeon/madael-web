import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase-admin';
import { DEFAULT_MODULE_ACCESS } from '@/lib/employeeModules';
import { highestEmployeeNumber, formatEmployeeId } from '@/lib/employeeId';

const VALID_STATUS = ['Aktif', 'Nonaktif'];

// Terima "Ya"/"Tidak"/true/false/1/0 dari kolom Excel jadi boolean.
function parseBool(val) {
  if (typeof val === 'boolean') return val;
  const s = String(val ?? '').trim().toLowerCase();
  return s === 'ya' || s === 'yes' || s === 'true' || s === '1';
}

function normStatus(val) {
  const s = String(val ?? '').trim();
  const found = VALID_STATUS.find((v) => v.toLowerCase() === s.toLowerCase());
  return found || 'Aktif';
}

// Bulk import employee dari template Excel. Baris diproses satu-satu
// (bukan paralel) supaya nomor Employee ID auto-generate tidak tabrakan
// antar baris dan tidak membombardir Supabase Auth Admin API sekaligus.
export async function POST(request) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll() {
            // no-op — route ini tidak perlu set cookie baru
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Belum login.' }, { status: 401 });
    }

    const { data: requester } = await supabase
      .from('employees')
      .select('is_superadmin')
      .eq('email', user.email)
      .maybeSingle();

    if (!requester?.is_superadmin) {
      return NextResponse.json(
        { error: 'Hanya superadmin yang boleh menambah employee.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const rows = Array.isArray(body.rows) ? body.rows : [];

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Tidak ada baris data untuk diproses.' }, { status: 400 });
    }
    if (rows.length > 500) {
      return NextResponse.json(
        { error: 'Maksimal 500 baris per upload. Bagi file jadi beberapa batch.' },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    // Load sekali di awal: daftar perusahaan (buat resolve nama -> client_id,
    // sekaligus bikin baru kalau belum ada) dan employee_id tertinggi yang
    // sudah dipakai (buat auto-generate ID baris yang kolom Employee ID-nya kosong).
    const [{ data: companies }, { data: existingEmployees }] = await Promise.all([
      admin.from('companies').select('id, nama_perusahaan'),
      admin.from('employees').select('employee_id, email'),
    ]);

    const companyList = companies || [];
    const existingEmails = new Set((existingEmployees || []).map((e) => (e.email || '').toLowerCase()));
    let runningMax = highestEmployeeNumber((existingEmployees || []).map((e) => e.employee_id));

    const findOrCreateCompany = async (namaPerusahaan) => {
      const trimmed = (namaPerusahaan || '').trim();
      if (!trimmed) return null;
      const existing = companyList.find((c) => c.nama_perusahaan.toLowerCase() === trimmed.toLowerCase());
      if (existing) return existing.id;

      const { data, error } = await admin
        .from('companies')
        .insert([{ nama_perusahaan: trimmed, tipe: ['client'] }])
        .select('id, nama_perusahaan')
        .single();
      if (error) return null;
      companyList.push(data);
      return data.id;
    };

    const results = [];
    const seenEmailsInBatch = new Set();

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2; // baris 1 = header di Excel
      const row = rows[i] || {};
      const nama = String(row.nama || '').trim();
      const email = String(row.email || '').trim().toLowerCase();
      let employeeId = String(row.employee_id || '').trim().toUpperCase();
      const perusahaan = String(row.perusahaan || '').trim();
      const status = normStatus(row.status);
      const isSuperadmin = parseBool(row.superadmin);

      if (!nama || !email) {
        results.push({ row: rowNum, email: email || '(kosong)', status: 'error', error: 'Nama dan Email wajib diisi.' });
        continue;
      }
      if (!email.includes('@')) {
        results.push({ row: rowNum, email, status: 'error', error: 'Format email tidak valid.' });
        continue;
      }
      if (existingEmails.has(email) || seenEmailsInBatch.has(email)) {
        results.push({ row: rowNum, email, status: 'error', error: 'Email sudah terdaftar / duplikat di file.' });
        continue;
      }

      if (!employeeId) {
        runningMax += 1;
        employeeId = formatEmployeeId(runningMax);
      }

      seenEmailsInBatch.add(email);

      const clientId = perusahaan ? await findOrCreateCompany(perusahaan) : null;

      const tempPassword = Math.random().toString(36).slice(-10) + 'Aa1!';
      const { data: authUser, error: authError } = await admin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
      });

      if (authError) {
        results.push({ row: rowNum, email, status: 'error', error: 'Gagal buat akun: ' + authError.message });
        continue;
      }

      const { data: empRow, error: empError } = await admin
        .from('employees')
        .insert([{
          nama,
          employee_id: employeeId,
          email,
          client_id: clientId,
          status,
          is_superadmin: isSuperadmin,
        }])
        .select()
        .single();

      if (empError) {
        await admin.auth.admin.deleteUser(authUser.user.id);
        results.push({ row: rowNum, email, status: 'error', error: 'Gagal simpan data: ' + empError.message });
        continue;
      }

      if (!isSuperadmin) {
        const defaultRows = DEFAULT_MODULE_ACCESS.map((module_name) => ({
          employee_id: empRow.id,
          module_name,
        }));
        await admin.from('employee_modules').insert(defaultRows);
      }

      results.push({
        row: rowNum,
        email,
        status: 'success',
        nama,
        employee_id: employeeId,
        tempPassword,
      });
    }

    const successCount = results.filter((r) => r.status === 'success').length;
    const errorCount = results.length - successCount;

    return NextResponse.json(
      { success: true, total: results.length, successCount, errorCount, results },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json({ error: 'Terjadi kesalahan server: ' + err.message }, { status: 500 });
  }
}