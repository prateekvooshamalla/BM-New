import { Helmet } from 'react-helmet-async';
import { BRAND_CONFIG } from '@bharat-makaan/config';

interface SeoHeadProps {
  title: string;
  description: string;
  canonicalPath: string;
  jsonLd?: Record<string, unknown>;
}

export function SeoHead({ title, description, canonicalPath, jsonLd }: SeoHeadProps) {
  const baseUrl = import.meta.env.VITE_PUBLIC_APP_URL || 'https://bharatmakaan.com';
  const canonicalUrl = `${baseUrl.replace(/\/$/, '')}${canonicalPath}`;
  const fullTitle = `${title} | ${BRAND_CONFIG.name}`;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonicalUrl} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:type" content="website" />
      {jsonLd && (
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      )}
    </Helmet>
  );
}
