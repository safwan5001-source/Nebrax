'use client';

/** اتجاه التصميم: «المكتب الواثق» — أدوات رأس صغيرة باسم واضح وحلقة تركيز موحّدة. */
import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { Moon, Sun } from 'lucide-react';
import { Button } from '../ui/button';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const t = useTranslations('common');
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-11 w-11"
      aria-label={t('themeToggle')}
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      {mounted && theme === 'dark' ? (
        <Sun className="h-4 w-4" strokeWidth={1.7} />
      ) : (
        <Moon className="h-4 w-4" strokeWidth={1.7} />
      )}
    </Button>
  );
}
