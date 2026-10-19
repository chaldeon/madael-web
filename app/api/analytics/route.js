import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';

function getAnalyticsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  return new BetaAnalyticsDataClient({ credentials });
}

// Cache singkat per periode (best-effort, per instance serverless): mengurangi
// pemakaian kuota GA Data API saat halaman Statistics sering dibuka/diganti
// periode. Hanya respons sukses yang disimpan, dan hanya diisi setelah cek
// akses lolos.
const CACHE_TTL_MS = 5 * 60 * 1000;
const analyticsCache = new Map(); // period -> { at, body }

// Respons berisi data internal: private = tidak boleh di-cache proxy/CDN.
const PRIVATE_CACHE_HEADERS = { 'Cache-Control': 'private, max-age=60' };

export async function GET(request) {
  try {
    // Route ini memakai service account Google, jadi harus login + punya modul
    // Statistics (sama dengan gate halaman /employee/statistics). middleware.js
    // hanya mencocokkan /employee/*, jadi /api/* tidak terlindungi di sana.
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['statistics']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { searchParams } = new URL(request.url);
    const periodParam = searchParams.get('period');
    const validPeriods = ['weekly', 'monthly', 'annually', 'all'];
    const period = validPeriods.includes(periodParam) ? periodParam : 'monthly';

    const cached = analyticsCache.get(period);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json(cached.body, { headers: PRIVATE_CACHE_HEADERS });
    }

    // GA4 startDate bisa berupa 'NdaysAgo' atau tanggal literal (YYYY-MM-DD).
    // Untuk "all" pakai tanggal jauh ke belakang — GA4 baru ada sejak
    // pertengahan 2020-an di kebanyakan properti, jadi 2015-01-01 aman
    // dipakai sebagai batas bawah "semua waktu" (GA otomatis clip ke data
    // yang sebenarnya tersedia).
    const PERIOD_START_DATE = {
      weekly: '7daysAgo',
      monthly: '30daysAgo',
      annually: '365daysAgo',
      all: '2015-01-01',
    };

    // Granularitas chart: harian untuk periode pendek, bulanan untuk yang panjang.
    const TIME_DIMENSION = {
      weekly: 'date',
      monthly: 'date',
      annually: 'yearMonth',
      all: 'yearMonth',
    };

    const propertyId = process.env.GA_PROPERTY_ID;
    if (!propertyId) {
      return NextResponse.json(
        { error: 'GA_PROPERTY_ID belum diset di environment variables' },
        { status: 500 }
      );
    }

    const analyticsDataClient = getAnalyticsClient();
    const dateRanges = [{ startDate: PERIOD_START_DATE[period], endDate: 'today' }];

    const [summaryRes, topPagesRes, dailyRes, deviceRes, countryRes] = await Promise.all([
      // 1. Total sessions & users & pageviews
      analyticsDataClient.runReport({
        property: propertyId,
        dateRanges,
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'screenPageViews' },
        ],
      }),
      // 2. Pageviews per halaman (top 10)
      analyticsDataClient.runReport({
        property: propertyId,
        dateRanges,
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 10,
      }),
      // 3. Sessions per hari/bulan (untuk chart) — pakai granularitas bulan
      //    untuk periode panjang (annually/all) biar chart nggak penuh titik
      analyticsDataClient.runReport({
        property: propertyId,
        dateRanges,
        dimensions: [{ name: TIME_DIMENSION[period] }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ dimension: { dimensionName: TIME_DIMENSION[period] } }],
      }),
      // 4. Breakdown device category
      analyticsDataClient.runReport({
        property: propertyId,
        dateRanges,
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      }),
      // 5. Top countries
      analyticsDataClient.runReport({
        property: propertyId,
        dateRanges,
        dimensions: [{ name: 'country' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10,
      }),
    ]);

    const summaryRow = summaryRes.rows?.[0];
    const totalSessions = Number(summaryRow?.metricValues?.[0]?.value || 0);
    const totalUsers = Number(summaryRow?.metricValues?.[1]?.value || 0);
    const totalPageviews = Number(summaryRow?.metricValues?.[2]?.value || 0);

    const topPages = (topPagesRes.rows || []).map((row) => ({
      page: row.dimensionValues[0].value,
      pageviews: Number(row.metricValues[0].value),
    }));

    const sessionsPerDay = (dailyRes.rows || []).map((row) => {
      const raw = row.dimensionValues[0].value;
      // 'date' -> YYYYMMDD, 'yearMonth' -> YYYYMM
      const date = raw.length === 8
        ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
        : `${raw.slice(0, 4)}-${raw.slice(4, 6)}`;
      return { date, sessions: Number(row.metricValues[0].value) };
    });

    const deviceBreakdown = (deviceRes.rows || []).map((row) => ({
      device: row.dimensionValues[0].value,
      sessions: Number(row.metricValues[0].value),
    }));

    const topCountries = (countryRes.rows || []).map((row) => ({
      country: row.dimensionValues[0].value,
      sessions: Number(row.metricValues[0].value),
    }));

    const body = {
      period,
      totalSessions,
      totalUsers,
      totalPageviews,
      topPages,
      sessionsPerDay,
      deviceBreakdown,
      topCountries,
    };
    analyticsCache.set(period, { at: Date.now(), body });

    return NextResponse.json(body, { headers: PRIVATE_CACHE_HEADERS });
  } catch (err) {
    console.error('GA analytics error:', err);
    return NextResponse.json(
      { error: 'Gagal mengambil data Google Analytics' },
      { status: 500 }
    );
  }
}