'use client';

import { useTranslations } from 'next-intl';
import type { ApiField } from '@/modules/developer/docs/openapi-types';
import { cn } from '@/lib/utils';

/**
 * جدول حقول مقروء مشتقّ من مخطّط JSON (§12) — لا JSON خام يُغرَق به القارئ. عمود
 * الحقل والنوع بخط Mono؛ والمطلوب/القابل للعدم/للقراءة تُعرَض نصّاً لا لوناً وحده (§24).
 * المخطّطات المتداخلة المُسمّاة تُوسَّع بـ `<details>` فتبقى مفهومة بلا تسطيحٍ مربِك.
 */
export function FieldTable({
  fields,
  schemas,
  depth = 0,
  className,
}: {
  fields: ApiField[];
  schemas: Record<string, ApiField[]>;
  depth?: number;
  className?: string;
}) {
  const t = useTranslations('developer.docs');

  if (fields.length === 0) return null;

  /** اسم مخطّط متداخل يمكن توسيعه (يجرّد «array of»)، أو null. */
  const nestedName = (type: string): string | null => {
    const match = /^(?:array of )?([A-Za-z_]\w*)$/.exec(type);
    const name = match?.[1];
    return name && depth < 2 && schemas[name] ? name : null;
  };

  return (
    <div className={cn('overflow-hidden rounded border border-border', className)}>
      {/* ترويسة الجدول — تظهر من md فأعلى؛ على الجوال تُستبدل بتسميات مضمّنة. */}
      <div className="hidden border-b border-border bg-background px-3 py-2 text-xs font-medium text-muted md:grid md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,2fr)] md:gap-3">
        <span>{t('fieldName')}</span>
        <span>{t('fieldType')}</span>
        <span>{t('fieldDesc')}</span>
      </div>

      <div className="divide-y divide-border">
        {fields.map((field) => {
          const nested = nestedName(field.type);
          return (
            <div key={field.name} className="px-3 py-2.5 md:grid md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,2fr)] md:gap-3">
              {/* الحقل */}
              <div className="min-w-0">
                <code dir="ltr" className="font-mono text-sm text-text">{field.name}</code>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                  {field.required ? <span className="text-negative">{t('fieldRequired')}</span> : null}
                  {field.nullable ? <span className="text-muted">{t('nullable')}</span> : null}
                  {field.readOnly ? <span className="text-muted">{t('readOnly')}</span> : null}
                </span>
              </div>

              {/* النوع + القيود */}
              <div className="mt-1 min-w-0 md:mt-0">
                <code dir="ltr" className="block font-mono text-xs text-muted">{field.type}</code>
                {field.constraints ? (
                  <span dir="ltr" className="mt-0.5 block break-words font-mono text-[11px] text-muted/80">{field.constraints}</span>
                ) : null}
              </div>

              {/* الوصف + المثال + المخطّط المتداخل */}
              <div className="mt-1 min-w-0 md:mt-0">
                {field.description ? <p dir="auto" className="text-xs leading-relaxed text-text">{field.description}</p> : null}
                {field.example !== undefined ? (
                  <p dir="ltr" className="mt-0.5 break-words font-mono text-[11px] text-muted">
                    {t('fieldExample')}: {field.example}
                  </p>
                ) : null}
                {nested ? (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-xs font-medium text-primary marker:content-none [&::-webkit-details-marker]:hidden">
                      {t('nestedSchema', { type: nested })}
                    </summary>
                    <FieldTable fields={schemas[nested]} schemas={schemas} depth={depth + 1} className="mt-2" />
                  </details>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
