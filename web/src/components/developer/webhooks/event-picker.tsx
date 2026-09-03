'use client';

import { useTranslations } from 'next-intl';
import { WEBHOOK_EVENTS } from '@/lib/developer';
import { cn } from '@/lib/utils';

/**
 * منتقي أنواع الأحداث — من **كتالوج العقد فقط** (`WebhookEventType`)، لا أحداث
 * مستقبلية قابلة للاختيار (§17). كل حدث: اسمه التقني حرفياً + شرح بشريّ.
 */
export function EventPicker({
  value,
  onChange,
  error,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  error?: string;
  disabled?: boolean;
}) {
  // مفاتيح الأحداث تحوي نقاطاً (`partner.created`)، وnext-intl يقسّم على النقطة في
  // `t()`؛ لذا تُقرأ خريطة الأوصاف كاملةً بـ `t.raw` وتُفهرَس بالنصّ الحرفيّ.
  const t = useTranslations('developer');
  const descriptions = t.raw('events') as Record<string, string>;

  const toggle = (event: string) => {
    onChange(value.includes(event) ? value.filter((entry) => entry !== event) : [...value, event]);
  };

  return (
    <div className={cn('space-y-1.5', error && 'rounded border border-negative/40 p-2')}>
      <div className="divide-y divide-border overflow-hidden rounded border border-border">
        {WEBHOOK_EVENTS.map((event) => {
          const checked = value.includes(event);
          return (
            <label
              key={event}
              className={cn(
                'flex cursor-pointer items-start gap-2.5 p-2.5 transition-colors',
                checked ? 'bg-primary-soft' : 'hover:bg-background',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => toggle(event)}
                className="mt-0.5 h-4 w-4 accent-[color:var(--primary)]"
              />
              <span className="min-w-0 flex-1">
                <code dir="ltr" className="font-mono text-xs text-text">{event}</code>
                <span className="mt-0.5 block text-xs text-muted">{descriptions[event]}</span>
              </span>
            </label>
          );
        })}
      </div>
      {error ? <p className="text-xs text-negative" role="alert">{error}</p> : null}
    </div>
  );
}
