import { PlatformShell } from '@/components/platform/platform-shell';

/** كل صفحات لوحة المنصة المصادَق عليها. صفحة الدخول خارج هذه المجموعة فتبقى على AuthShell. */
export default function PlatformConsoleLayout({ children }: { children: React.ReactNode }) {
  return <PlatformShell>{children}</PlatformShell>;
}
