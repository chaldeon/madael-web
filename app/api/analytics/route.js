import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { NextResponse } from 'next/server';

function getAnalyticsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  return new BetaAnalyticsDataClient({ credentials });
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const daysParam = searchParams.get('days');
    const validDays = ['7', '30', '90'];
    const days = validDays.includes(daysParam) ? daysParam : '30';

    const propertyId = process.env.GA_PROPERTY_ID;
    if (!propertyId) {
      return NextResponse.json(
        { error: 'GA_PROPERTY_ID belum diset di environment variables' },
        { status: 500 }
      );
    }

    const analyticsDataClient = getAnalyticsClient();
    const dateRanges = [{ startDate: `${days}daysAgo`, endDate: 'today' }];

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
      // 3. Sessions per hari (untuk chart)
      analyticsDataClient.runReport({
        property: propertyId,
        dateRanges,
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
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
      const raw = row.dimensionValues[0].value; // format YYYYMMDD
      const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
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

    return NextResponse.json({
      days: Number(days),
      totalSessions,
      totalUsers,
      totalPageviews,
      topPages,
      sessionsPerDay,
      deviceBreakdown,
      topCountries,
    });
  } catch (err) {
    console.error('GA analytics error:', err);
    return NextResponse.json(
      { error: 'Gagal mengambil data Google Analytics', detail: err.message },
      { status: 500 }
    );
  }
}