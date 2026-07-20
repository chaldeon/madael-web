export default function robots() {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/employee/', '/admin/', '/login', '/api/'],
      },
    ],
    sitemap: 'https://madael.id/sitemap.xml',
  };
}