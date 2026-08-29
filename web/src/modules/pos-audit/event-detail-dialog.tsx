'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatDateTime } from '@/lib/formatting';
import { formatRiyal } from '@/lib/money';
import { Dialog } from '@/components/ui/dialog';
import { TechnicalDetails } from '@/components/ui/technical-details';
import {
  buildEventDiff,
  buildEventSummaryRows,
  buildTechnicalEvidence,
  eventReference,
  observedPayload,
  type AuditEventLike,
} from './event-presentation';

export interface PosAuditEvent extends AuditEventLike {
  id: string;
  pos_session_id: string;
  branch_id: string | null;
  category: string | null;
  source: 'server' | 'client_observed' | 'hybrid' | 'legacy_unknown';
  trust_level: string;
}

interface Props {
  event: PosAuditEvent | null;
  onClose: () => void;
}

/** نافذة تفاصيل الحدث — ملخص بشري أولاً، ثم الفروقات، ثم قبل/بعد والتفاصيل التقنية. */
export function EventDetailDialog({ event, onClose }: Props) {
  const t = useTranslations('posAudit');
  const locale = useLocale();

  const eventLabel = (type: string): string => String(t(`eventLabels.${type}` as never, { fallback: type }));
  const statusLabel = (status: string): string => String(t(`statusValues.${status}` as never, { fallback: status }));
  const fieldLabel = (field: string, path: string): string =>
    String(t(`fieldLabels.${field}` as never, { fallback: path }));
  const summaryFieldLabel = (field: string): string =>
    String(t(`summaryFields.${field}` as never, { fallback: field }));

  if (!event) {
    return null;
  }

  const observed = observedPayload(event.payload);
  const before = observed.before;
  const after = observed.after;
  const hasBeforeAfter = before !== undefined || after !== undefined;
  const summaryRows = buildEventSummaryRows(event, {
    formatAmount: formatRiyal,
    formatDate: (value) => formatDateTime(value, locale),
    statusLabel,
  });
  const diffs = hasBeforeAfter
    ? buildEventDiff(before ?? null, after ?? null, { formatStatus: statusLabel })
    : [];
  const reference = eventReference(event.payload);
  const showSource =
    event.source === 'client_observed' || event.source === 'hybrid' || event.source === 'legacy_unknown';

  return (
    <Dialog open onClose={onClose} title={t('eventDetails')} className="sm:max-w-2xl">
      <div className="min-w-0 space-y-5">
        <section className="min-w-0 space-y-2">
          <h2 className="text-sm font-semibold text-text">{t('humanSummary')}</h2>
          <p className="text-base font-medium text-text">{eventLabel(event.type)}</p>
          {summaryRows.length > 0 ? (
            <dl className="grid gap-2 rounded border border-border bg-background p-3 sm:grid-cols-2">
              {summaryRows.map((row) => (
                <div key={`${row.field}-${row.value}`} className="min-w-0">
                  <dt className="text-xs text-muted">{summaryFieldLabel(row.field)}</dt>
                  <dd className={`mt-0.5 break-words text-sm text-text ${row.mono ? 'num' : ''}`}>{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted">
              {event.performed_by_user?.name ?? event.actor?.name ?? '—'} · {formatDateTime(event.created_at, locale)}
            </p>
          )}
          {showSource ? (
            <p className="text-xs text-muted">
              {t('provenance')}: {t(`sources.${event.source}` as never, { fallback: event.source })}
            </p>
          ) : null}
        </section>

        {diffs.length > 0 ? (
          <section className="min-w-0 space-y-2">
            <h2 className="text-sm font-semibold text-text">{t('whatChanged')}</h2>
            <ul className="divide-y divide-border rounded border border-border">
              {diffs.map((row) => (
                <li key={row.path} className="flex min-w-0 flex-col gap-1 px-3 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                  <span className="shrink-0 text-sm text-muted">{fieldLabel(row.field, row.path)}</span>
                  <span className="num min-w-0 break-words text-sm text-text" dir="ltr">
                    <span className="text-muted">{row.before}</span>
                    <span className="mx-1.5 text-muted" aria-hidden>
                      →
                    </span>
                    <span className="font-medium">{row.after}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {hasBeforeAfter ? (
          <section className="min-w-0 space-y-2">
            <h2 className="text-sm font-semibold text-text">{t('beforeAfter')}</h2>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <TechnicalDetails
                title={t('before')}
                data={before ?? {}}
                defaultOpen={false}
                copyLabel={t('copy')}
                copiedLabel={t('copied')}
              />
              <TechnicalDetails
                title={t('after')}
                data={after ?? {}}
                defaultOpen={false}
                copyLabel={t('copy')}
                copiedLabel={t('copied')}
              />
            </div>
          </section>
        ) : null}

        {reference ? (
          <section className="min-w-0">
            <h2 className="text-sm font-semibold text-text">{t('references')}</h2>
            <p className="num mt-1 break-all text-sm text-muted" dir="ltr">
              {reference}
            </p>
          </section>
        ) : null}

        <TechnicalDetails
          title={t('technicalDetails')}
          description={t('technicalDetailsHint')}
          data={buildTechnicalEvidence(event)}
          defaultOpen={false}
          copyLabel={t('copy')}
          copiedLabel={t('copied')}
        />
      </div>
    </Dialog>
  );
}
