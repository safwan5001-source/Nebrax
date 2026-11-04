'use client';

/**
 * جدول سطور الكشف: **سطح المكتب** جدول كثيف (تاريخ · مرجع · وصف · مبلغ · نتيجة المحرّك · قرارك) بتنقّل لوحة مفاتيح (↑/↓ تنقّل، Enter فتح، N التالي غير المحسوم)،
 * و**الجوال** قائمة بطاقات (هدف لمس ≥ 44px). الصف نفسه لا يحمل إجراءً كتابياً: الإجراءات في لوحة التفاصيل. حالة الطابور (إرسال/إعادة/فشل) شارة على الصف.
 */
import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { decisionState } from './decision-rules';
import { DecisionBadge, LineAmount, OutcomeBadge } from './presentation';
import type { QueueJob } from './decision-queue';
import type { MatchRow, StatementLine } from './types';

export interface WorkspaceRow {
  line: StatementLine;
  match: MatchRow | null;
}

export function LinesTable({
  rows,
  runId,
  selectedId,
  onSelect,
  onNextUndecided,
  jobFor,
}: {
  rows: readonly WorkspaceRow[];
  runId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNextUndecided: () => void;
  jobFor: (lineId: string) => QueueJob | null;
}) {
  const t = useTranslations('partnerStatements');
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  const focusRow = (index: number) => {
    const element = bodyRef.current?.querySelectorAll<HTMLTableRowElement>('tr[data-row]')[index];
    element?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number, id: string) => {
    if (event.key === 'ArrowDown' && index < rows.length - 1) {
      event.preventDefault();
      focusRow(index + 1);
    } else if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      focusRow(index - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(id);
    } else if (event.key.toLowerCase() === 'n' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      onNextUndecided();
    }
  };

  const tabStop = Math.max(0, rows.findIndex((row) => row.line.id === selectedId));

  return (
    <>
      <div className="hidden overflow-x-auto rounded-md border border-border bg-surface md:block">
        <table className="w-full text-sm" aria-label={t('workspace.table_label')}>
          <thead>
            <tr className="border-b border-border text-start text-xs text-muted">
              <th scope="col" className="w-12 px-3 py-2 text-start font-medium">#</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{t('workspace.col.date')}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{t('workspace.col.reference')}</th>
              <th scope="col" className="hidden px-3 py-2 text-start font-medium 2xl:table-cell">{t('workspace.col.description')}</th>
              <th scope="col" className="px-3 py-2 text-end font-medium">{t('workspace.col.amount')}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{t('workspace.col.outcome')}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{t('workspace.col.decision')}</th>
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {rows.map(({ line, match }, index) => {
              const selected = line.id === selectedId;
              const job = jobFor(line.id);
              return (
                <tr
                  key={line.id}
                  data-row
                  data-line-id={line.id}
                  tabIndex={index === tabStop ? 0 : -1}
                  aria-selected={selected}
                  onClick={() => onSelect(line.id)}
                  onKeyDown={(event) => onKeyDown(event, index, line.id)}
                  className={cn(
                    'cursor-pointer border-b border-border last:border-0 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40',
                    selected && 'bg-primary-soft',
                  )}
                >
                  <td className="num px-3 py-2 text-muted">{line.ordinal}</td>
                  <td className="num whitespace-nowrap px-3 py-2" dir="ltr">{line.date}</td>
                  <td className="num max-w-[10rem] truncate px-3 py-2" dir="auto" title={line.reference ?? undefined}>{line.reference ?? '—'}</td>
                  <td className="hidden max-w-[16rem] truncate px-3 py-2 text-muted 2xl:table-cell" dir="auto" title={line.description ?? undefined}>{line.description ?? '—'}</td>
                  <td className="px-3 py-2 text-end"><LineAmount line={line} t={t as never} /></td>
                  <td className="px-3 py-2">{match ? <OutcomeBadge outcome={match.outcome} t={t as never} /> : <span className="text-xs text-muted">—</span>}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex flex-wrap items-center gap-1">
                      {match ? <DecisionBadge decision={match.decision} state={decisionState(match, runId)} t={t as never} /> : null}
                      <JobBadge job={job} t={t as never} />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 md:hidden" aria-label={t('workspace.table_label')}>
        {rows.map(({ line, match }) => {
          const selected = line.id === selectedId;
          const job = jobFor(line.id);
          return (
            <li key={line.id}>
              <button
                type="button"
                data-line-id={line.id}
                aria-current={selected || undefined}
                onClick={() => onSelect(line.id)}
                className={cn(
                  'flex min-h-[44px] w-full flex-col gap-2 rounded-md border bg-surface p-3.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  selected ? 'border-primary bg-primary-soft' : 'border-border',
                )}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-text" dir="auto">
                      <span className="num text-muted">#{line.ordinal}</span> {line.reference ?? line.description ?? '—'}
                    </span>
                    <span className="num block text-xs text-muted" dir="ltr">{line.date}</span>
                  </span>
                  <span className="shrink-0 text-end text-sm font-semibold"><LineAmount line={line} t={t as never} /></span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {match ? <OutcomeBadge outcome={match.outcome} t={t as never} /> : null}
                  {match ? <DecisionBadge decision={match.decision} state={decisionState(match, runId)} t={t as never} /> : null}
                  <JobBadge job={job} t={t as never} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function JobBadge({ job, t }: { job: QueueJob | null; t: (key: string, values?: Record<string, string | number>) => string }) {
  if (!job || job.status === 'done') return null;
  if (job.status === 'failed') {
    return (
      <Badge tone="negative" data-job="failed">
        <AlertTriangle className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
        {t('workspace.queue.failed')}
      </Badge>
    );
  }
  return (
    <Badge tone="warning" data-job={job.status}>
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      {job.status === 'backoff' ? t('workspace.queue.retrying', { seconds: job.retryInSeconds ?? 0 }) : t('workspace.queue.sending')}
    </Badge>
  );
}
