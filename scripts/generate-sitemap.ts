#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';

export const STATIC_PUBLIC_ROUTES = [
  '/',
  '/buy',
  '/rent',
  '/projects',
  '/compare',
  '/book-visit',
  '/for-professionals',
  '/pricing',
  '/about',
  '/contact',
  '/auth/login',
  '/auth/register',
];

export function buildSitemapXml(baseUrl = 'https://bharatmakaan.com', extraPaths: string[] = []): string {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const now = new Date().toISOString().slice(0, 10);
  const all = [...STATIC_PUBLIC_ROUTES, ...extraPaths];
  const urls = all
    .map(
      (p) => `  <url>
    <loc>${cleanBase}${p}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${p === '/' ? 'daily' : 'weekly'}</changefreq>
    <priority>${p === '/' ? '1.0' : '0.8'}</priority>
  </url>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outPath = path.resolve(process.cwd(), 'apps/web/public/sitemap.xml');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buildSitemapXml(process.env.VITE_PUBLIC_APP_URL), 'utf8');
  console.log(`Generated sitemap at ${outPath}`);
}
