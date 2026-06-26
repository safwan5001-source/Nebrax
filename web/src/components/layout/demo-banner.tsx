'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, X } from 'lucide-react';
import { isDemo } from '@/lib/demo';

export function DemoBanner() {
  const t = useTranslations('demo');
  const [hidden, setHidden] = useState(false);

  if (hidden || !isDemo()) return null;

  return (
    <div className="no-print flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning">
      <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.8} />
      <span className="font-medium">{t('banner')}</span>
      <button
        type="button"
        onClick={() => setHidden(true)}
        aria-label={t('close')}
        className="ms-auto shrink-0 text-warning/70 transition-colors hover:text-warning"
      >
        <X className="h-4 w-4" strokeWidth={1.8} />
      </button>
    </div>
  );
}
