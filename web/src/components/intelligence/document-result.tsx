'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';
import type { DocumentEntry, DocumentProjection } from '@/modules/intelligence/contract';
import { safeUiPath } from './evidence-panel';

/**
 * قيمة حقل مستند: **نصّ خام فقط**. محتوى المستند بيانات غير موثوقة — لا HTML ولا Markdown ولا روابط ولا
 * تفسير؛ React يهرّب كل نصّ، و`dir="auto"` يضبط اتجاه النص المختلط، والمنقَّح يُعرض وسماً لا قيمة.
 */
function EntryValue({ entry, currency }: { entry: DocumentEntry; currency: string | null }) {
  const t = useTranslations('intelligence.document');
  if (entry.redacted) {
    return <Badge tone="muted" data-redacted="">{t('redacted')}</Badge>;
  }
  if (entry.type === 'money' && entry.decimal !== undefined) {
    return currency === null || currency === 'SAR'
      ? <Money value={entry.decimal} />
      : <span dir="ltr" className="num">{entry.decimal} {currency}</span>;
  }
  if (entry.type === 'flag') return <span>{entry.value ? t('yes') : t('no')}</span>;
  return <span dir="auto" className="break-words">{String(entry.value ?? '')}</span>;
}

/** مفاتيح الحقول المعروفة (قائمة الخادم البيضاء). أي مفتاح آخر يُعرض كما هو بخط ثابت لا كنصّ مترجَم. */
const KNOWN_FIELDS = new Set([
  'document_number', 'document_date', 'issuer_name', 'recipient_name', 'currency', 'external_reference', 'purchase_order_number',
  'price_includes_tax', 'subtotal_minor', 'discount_minor', 'tax_amount_minor', 'total_amount_minor',
  'description', 'sku', 'unit', 'quantity', 'unit_price_minor', 'total_minor',
]);

function fieldLabel(t: (key: string) => string, key: string): string {
  return KNOWN_FIELDS.has(key) ? t(`fields.${key}`) : key;
}

/** إسقاط مستند كامل مضغوط: الأساس والحالة أولاً، ثم الحقول، ثم البنود، ثم التنبيهات والمصدر. */
export function DocumentProjectionView({ projection }: { projection: DocumentProjection }) {
  const t = useTranslations('intelligence.document');
  const currencyEntry = projection.fields.find((entry) => entry.key === 'currency' && !entry.redacted);
  const currency = typeof currencyEntry?.value === 'string' ? currencyEntry.value.toUpperCase() : null;
  const href = projection.sources[0] ? safeUiPath(projection.sources[0].ui_path) : null;
  const typeKey = projection.document.document_type;
  const statusKey = projection.document.status;

  return (
    <article className="awj-intel-rise space-y-3" data-result="document_projection" aria-label={t('title')}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral">{['purchase_invoice', 'expense', 'delivery_note'].includes(typeKey) ? t(`type.${typeKey}`) : typeKey}</Badge>
        <Badge tone="positive">{['reviewed', 'ready_for_draft', 'creating_draft', 'draft_created'].includes(statusKey) ? t(`status.${statusKey}`) : statusKey}</Badge>
        <Badge tone="muted"><ShieldCheck className="h-3 w-3" strokeWidth={1.7} aria-hidden="true" />{t('basis_reviewed')}</Badge>
        {projection.basis.redacted_values > 0 ? <Badge tone="warning">{t('redacted_count', { count: projection.basis.redacted_values })}</Badge> : null}
      </div>
      <p className="text-xs leading-relaxed text-muted">{t('real_data')}</p>

      {projection.fields.length === 0 ? <p className="text-sm text-muted">{t('no_fields')}</p> : (
        <dl className="divide-y divide-border rounded border border-border bg-surface px-3">
          {projection.fields.map((entry) => (
            <div key={entry.key} className="grid grid-cols-[minmax(0,8rem)_1fr] gap-3 py-2 text-sm">
              <dt className="text-xs text-muted">{fieldLabel(t, entry.key)}</dt>
              <dd className="min-w-0 text-text">
                <EntryValue entry={entry} currency={currency} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {projection.truncated.fields ? <p className="text-xs text-muted">{t('truncated_fields')}</p> : null}

      <section aria-label={t('lines')} className="space-y-2">
        <h3 className="text-xs font-medium text-muted">{t('lines')} · <span className="num">{projection.lines.length}</span></h3>
        {projection.lines.length === 0 ? <p className="text-sm text-muted">{t('no_lines')}</p> : (
          <ol className="space-y-2">
            {projection.lines.map((line) => (
              <li key={line.index} className="rounded border border-border bg-surface p-3 text-sm">
                <dl className="grid grid-cols-[minmax(0,7rem)_1fr] gap-x-3 gap-y-1">
                  {line.fields.map((entry) => (
                    <div key={entry.key} className="contents">
                      <dt className="text-xs text-muted">{fieldLabel(t, entry.key)}</dt>
                      <dd className="min-w-0"><EntryValue entry={entry} currency={currency} /></dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ol>
        )}
        {projection.truncated.lines ? <p className="text-xs text-muted">{t('truncated_lines')}</p> : null}
      </section>

      {projection.warnings.length > 0 ? (
        <section aria-label={t('warnings')} className="space-y-1">
          <h3 className="text-xs font-medium text-muted">{t('warnings')}</h3>
          <ul className="space-y-1">
            {projection.warnings.map((warning, index) => (
              <li key={`${index}-${warning.slice(0, 12)}`} role="note" dir="auto" className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs break-words">{warning}</li>
            ))}
          </ul>
          {projection.truncated.warnings ? <p className="text-xs text-muted">{t('truncated_warnings')}</p> : null}
        </section>
      ) : null}

      <footer className="space-y-1 border-t border-border pt-2 text-xs text-muted">
        <p>{t('untrusted')}</p>
        <p>
          {t('read_at')}: <span dir="ltr" className="num">{projection.generated_at}</span>
          {projection.document.page_count > 0 ? <> · {t('pages')}: <span className="num">{projection.document.page_count}</span></> : null}
        </p>
        {href ? (
          <Link href={href} className="inline-flex items-center gap-1 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            {t('open')}
            <ExternalLink className="h-3.5 w-3.5 rtl:-scale-x-100" strokeWidth={1.7} aria-hidden="true" />
          </Link>
        ) : null}
      </footer>
    </article>
  );
}
