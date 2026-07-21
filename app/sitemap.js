import { supabase } from '@/lib/supabase';

const BASE_URL = 'https://madael.id';

export default async function sitemap() {
  const staticRoutes = [
    { url: `${BASE_URL}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${BASE_URL}/about`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/karir`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE_URL}/kalkulator-pph21`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/kalkulator-bpjs`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/kalkulator-lembur`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/kalkulator-pkwt`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/kalkulator-pesangon`, changeFrequency: 'monthly', priority: 0.8 },
  ].map((r) => ({ ...r, lastModified: new Date() }));

  const { data: jobs } = await supabase
    .from('job_listings')
    .select('slug, created_at')
    .eq('is_active', true);

  const jobRoutes = (jobs || []).map((job) => ({
    url: `${BASE_URL}/karir/${job.slug}`,
    lastModified: job.created_at ? new Date(job.created_at) : new Date(),
    changeFrequency: 'weekly',
    priority: 0.6,
  }));

  return [...staticRoutes, ...jobRoutes];
}