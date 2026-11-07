import type { Metadata, Viewport } from 'next';
import '@/modules/station-ops/fuel-ops.css';

/**
 * دخول «محطات أَوْج» (رقم الموظف + PIN) — مجموعة مسارات منفصلة عن `(fuel-ops)` عمداً: لا `StationOpsGuard` هنا لأن المستخدم لم يُصادَق بعد.
 * الجلسة الناتجة مقيَّدة خادمياً بمسارات المحطات (`station-ops`)؛ لا تصل إلى واجهات أَوْج الإدارية.
 */
export const metadata: Metadata = {
  title: 'دخول | محطات أَوْج',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function FuelOpsAuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
