import type { Metadata } from 'next';

// صفحات الرابط العام لا تُفهرس ولا تُسرّب الرمز عبر Referer.
export const metadata: Metadata = {
  title: 'الدفع الإلكتروني · Online payment',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default function PayLayout({ children }: { children: React.ReactNode }) {
  return children;
}
