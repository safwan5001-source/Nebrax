'use client';

/** اتجاه التصميم: «المكتب الواثق» — أدوات رأس صغيرة باسم واضح وحلقة تركيز موحّدة. */
import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Languages } from 'lucide-react';
import { Button } from '../ui/button';

/** يبدّل لغة الواجهة (ملف تعريف الارتباط + إعادة الرسم من الخادم) — مصدر واحد للزر وقائمة الحساب. */
export function switchLocale(current: string, refresh: () => void): void {
  const next = current === 'ar' ? 'en' : 'ar';
  document.cookie = `locale=${next};path=/;max-age=31536000`;
  refresh();
}

export function LangToggle() {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations('common');

  function toggle() {
    switchLocale(locale, () => router.refresh());
  }

  // WCAG 2.5.3 (Label in Name): الاسم المُتاح يحوي النصّ المرئي حرفياً — «EN» أو «ع» — فلا يفوت مستخدمَ التحكّم الصوتي.
  const visible = locale === 'ar' ? 'EN' : 'ع';

  return (
    <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={`${t('languageToggle')} (${visible})`} onClick={toggle}>
      <span className="text-xs font-semibold">{visible}</span>
      <Languages className="sr-only h-4 w-4" />
    </Button>
  );
}
