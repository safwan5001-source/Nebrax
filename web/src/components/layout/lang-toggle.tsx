'use client';

import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Languages } from 'lucide-react';
import { Button } from '../ui/button';

export function LangToggle() {
  const locale = useLocale();
  const router = useRouter();

  function toggle() {
    const next = locale === 'ar' ? 'en' : 'ar';
    document.cookie = `locale=${next};path=/;max-age=31536000`;
    router.refresh();
  }

  return (
    <Button variant="ghost" size="icon" aria-label="تبديل اللغة" onClick={toggle}>
      <span className="text-xs font-semibold">{locale === 'ar' ? 'EN' : 'ع'}</span>
      <Languages className="sr-only h-4 w-4" />
    </Button>
  );
}
