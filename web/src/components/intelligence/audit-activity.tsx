'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import type { AuditEvent } from '@/modules/intelligence/contract';

const TONES = { allowed: 'positive', denied: 'warning', error: 'negative' } as const;

/** آخر أحداث التدقيق (وصفية فقط) — تُعرض لمن يملك `ai.audit.view` وحده؛ لا نصوص أسئلة ولا أجوبة في الجدول أصلاً. */
export function AuditActivity({ events, failed }: { events: AuditEvent[] | null; failed: boolean }) {
  const t = useTranslations('intelligence.settings');
  return (
    <section aria-label={t('audit')} className="rounded border border-border bg-surface">
      <div className="border-b border-border px-4 py-2">
        <h2 className="text-sm font-medium">{t('audit')}</h2>
        <p className="text-[11px] text-muted">{t('audit_note')}</p>
      </div>
      {failed ? <p role="alert" className="p-4 text-sm text-negative">{t('audit_error')}</p> : null}
      {!failed && events === null ? <div className="space-y-2 p-4" aria-busy="true"><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-2/3" /></div> : null}
      {!failed && events !== null && events.length === 0 ? <p className="p-4 text-sm text-muted">{t('audit_empty')}</p> : null}
      {!failed && events !== null && events.length > 0 ? (
        <Table aria-label={t('audit')}>
          <THead>
            <TR>
              <TH scope="col">{t('audit_event')}</TH>
              <TH scope="col">{t('audit_outcome')}</TH>
              <TH scope="col">{t('audit_reason')}</TH>
              <TH scope="col">{t('audit_time')}</TH>
            </TR>
          </THead>
          <TBody>
            {events.map((event) => (
              <TR key={event.id}>
                <TD><span dir="ltr" className="font-mono text-xs">{event.event}{event.tool ? ` · ${event.tool}` : ''}</span></TD>
                <TD><Badge tone={TONES[event.outcome] ?? 'muted'}>{t(`outcome.${event.outcome}`)}</Badge></TD>
                <TD><span dir="ltr" className="font-mono text-xs text-muted">{event.reason}</span></TD>
                <TD><span dir="ltr" className="num text-xs">{event.occurred_at}</span></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : null}
    </section>
  );
}
