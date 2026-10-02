import type { Metadata } from 'next';
import { IBM_Plex_Sans_Arabic, IBM_Plex_Mono } from 'next/font/google';
import { getLocale, getMessages } from 'next-intl/server';
import { Providers } from '@/components/providers';
import { BRAND } from '@/lib/brand';
import { AWJ_THEME_PRE_PAINT_SCRIPT } from '@/lib/awj-theme';
import { buildAwjUiPrePaintScript } from '@/lib/awj-ui-gate';
import './globals.css';

// خطوط ذاتية الاستضافة (next/font) — تُبنى محلياً فلا طلب CDN حاجب للعرض
// (يمنع اختفاء النص عند بطء/حجب fonts.googleapis.com) مع display: swap.
const sans = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-ibm-sans',
});
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-ibm-mono',
});
export const metadata: Metadata = {
  title: BRAND.displayName,
  description: 'منصة سحابية متكاملة لإدارة المؤسسات',
  icons: {
    icon: '/api/company-browser-icon',
    apple: '/api/company-browser-icon',
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  return (
    <html lang={locale} dir={dir} className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* AWJ v3 theme pre-paint (Horizon 3): sets data-awj-theme="ink" before first
            paint when that is the stored preference, so Ink never flashes to Default
            first. Separate from next-themes' own injected script (Light/Dark), and
            never touches data-awj-ui — see src/lib/awj-theme.ts. suppressHydrationWarning
            above covers the attribute this adds outside React's own render. */}
        <script dangerouslySetInnerHTML={{ __html: AWJ_THEME_PRE_PAINT_SCRIPT }} />
        {/* AWJ v3 rollout pre-paint (Horizon 5): applies data-awj-ui="3" before first paint
            when the stored choice or the build default says so. Inert while
            NEXT_PUBLIC_AWJ_UI_DEFAULT is unset (today) — see src/lib/awj-ui-gate.ts. */}
        <script dangerouslySetInnerHTML={{ __html: buildAwjUiPrePaintScript() }} />
      </head>
      <body suppressHydrationWarning>
        <Providers locale={locale} messages={messages}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
