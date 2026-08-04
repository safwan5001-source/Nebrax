import type { Metadata } from 'next';
import { IBM_Plex_Sans_Arabic, IBM_Plex_Mono } from 'next/font/google';
import { getLocale, getMessages } from 'next-intl/server';
import { Providers } from '@/components/providers';
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
  title: 'نبراس ERP',
  description: 'نظام محاسبي سحابي متعدد المستأجرين',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  return (
    <html lang={locale} dir={dir} className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers locale={locale} messages={messages}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
