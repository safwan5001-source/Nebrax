'use client';

import { useTranslations } from 'next-intl';
import { Languages, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { DocumentLanguage } from '@/modules/documents/types';

/**
 * محدِّد لغة المستند — يعمل بالتوازي مع محدِّد التصميم (#633) دون خلط.
 *
 * القرار مستقلٌّ عن لغة الواجهة (UI locale) وعن اختيار القالب/التصميم. الغياب
 * (`value === null`) يعني «اتبع افتراضي المؤسسة (أو `ar` كخيار أخير)» ولا يفرض
 * قيمة صريحة على المستند. `onChange(null)` يعيد المستند إلى هذا السقوط.
 *
 * على الفاتورة المرحّلة يظهر مقفلاً — يعرض `language_frozen` (لقطة الترحيل)
 * ولا يقبل تعديلاً؛ نفس invariant الترحيل الموحّد في AWJ.
 */
export function DocumentLanguageSelector({
  value,
  tenantDefault,
  disabled = false,
  onChange,
  className,
}: {
  /** قرار المسودة (`language`). null = اترك لسقوط المستأجر ثم `ar`. */
  value: DocumentLanguage | null;
  /** افتراضي المؤسسة المعروض للمستخدم كـcontext (لا يُفرض). */
  tenantDefault?: DocumentLanguage | null;
  /** الفاتورة المرحّلة تُقفل الحقل؛ يبقى العنصر ظاهراً لعرض اللقطة المجمّدة. */
  disabled?: boolean;
  onChange: (next: DocumentLanguage | null) => void;
  className?: string;
}) {
  const t = useTranslations('documentLanguageSelector');

  const options: Array<{ id: DocumentLanguage; label: string; hint?: string }> = [
    { id: 'ar', label: t('option_ar') },
    { id: 'en', label: t('option_en') },
    { id: 'bilingual', label: t('option_bilingual'), hint: t('option_bilingual_hint') },
  ];

  const fallbackLabel = tenantDefault
    ? t('follows_tenant_default', { language: t(`option_${tenantDefault}`) })
    : t('follows_system_default');

  return (
    <div
      className={cn('flex flex-col gap-2 rounded-md border border-border bg-surface p-3', className)}
      data-testid="document-language-selector"
    >
      <div className="flex items-center gap-2">
        <Languages className="h-4 w-4 text-muted" aria-hidden="true" />
        <span className="text-sm font-medium text-text">{t('title')}</span>
      </div>

      <div
        role="radiogroup"
        aria-label={t('title')}
        className="flex flex-wrap gap-2"
      >
        {options.map((option) => {
          const selected = value === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(option.id)}
              data-testid={`document-language-${option.id}`}
              className={cn(
                'min-h-11 rounded-md border px-3 text-sm transition-colors',
                selected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-text hover:border-primary/60',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <span className="block leading-tight">{option.label}</span>
              {option.hint ? (
                <span className={cn('block text-[10px]', selected ? 'text-primary-foreground/80' : 'text-muted')}>
                  {option.hint}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted">{value === null ? fallbackLabel : t('override_hint')}</span>
        {value !== null && !disabled ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(null)}
            data-testid="document-language-reset"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            {t('reset_to_default')}
          </Button>
        ) : null}
      </div>

      {disabled ? (
        <p className="text-xs text-muted" data-testid="document-language-frozen-note">
          {t('frozen_note')}
        </p>
      ) : null}
    </div>
  );
}
