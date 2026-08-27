import createNextIntlPlugin from 'next-intl/plugin';

// Keep the request-config path explicit so local CI and Vercel resolve the same next-intl entrypoint.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 2_592_000,
  },
};

export default withNextIntl(nextConfig);
