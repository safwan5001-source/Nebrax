'use client';

/** رأس المساحة: الطرف · الدور · الفترة · النطاق · الملف · العملة · السياسة المجمَّدة · الإجماليات · الحالة · شريط التقدّم (محسوم/إجمالي من الخادم) + الوسم الدائم «مقارنة فقط». */
import { useTranslations } from 'next-intl';
import { ShieldCheck } from 'lucide-react';
import { scopeLabel, periodLabel, StatusBadge } from '../columns';
import { formatMinor, partnerDisplayName } from '../contract';
import type { ReconciliationHeader, StatusResponse } from './types';

export function SummaryBar({ header, status }: { header: ReconciliationHeader; status: StatusResponse | null }) {
  const t = useTranslations('partnerStatements');
  const total = status?.readiness.lines_total ?? header.line_count;
  const resolved = status?.readiness.resolved ?? 0;
  const otherRuns = status?.readiness.decisions_on_other_runs ?? 0;
  const percent = total > 0 ? Math.min(100, Math.round((resolved / total) * 100)) : 0;

  return (
    <section aria-label={t('workspace.summary.title')} className="space-y-3 rounded-md border border-border bg-surface p-3 md:p-4" data-testid="summary-bar">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-text" dir="auto">{partnerDisplayName(header)}</h2>
          <p className="text-sm text-muted">
            {t(`role.${header.role}`)} · {scopeLabel(header, t as never)} · <span className="num" dir="ltr">{periodLabel(header)}</span>
          </p>
          <p className="truncate text-xs text-muted" dir="auto">{header.original_filename ?? '—'}</p>
        </div>
        <StatusBadge status={header.status} t={t as never} />
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted sm:grid-cols-4">
        <div><dt>{t('workspace.summary.lines')}</dt><dd className="num text-sm text-text">{header.line_count}</dd></div>
        <div><dt>{t('workspace.summary.totals')}</dt><dd className="num text-sm text-text" dir="ltr">{formatMinor(header.total_debit_minor)} / {formatMinor(header.total_credit_minor)}</dd></div>
        <div><dt>{t('workspace.summary.currency')}</dt><dd className="text-sm text-text">{header.currency}</dd></div>
        <div>
          <dt>{t('workspace.summary.policy')}</dt>
          <dd className="text-sm text-text">
            {header.policy ? t('workspace.summary.policy_value', { days: header.policy.date_tolerance_days, amount: formatMinor(header.policy.amount_tolerance_minor) }) : '—'}
          </dd>
        </div>
      </dl>

      <div className="space-y-1" data-testid="progress">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="font-medium text-text">{t('workspace.progress.label')}</span>
          <span className="num text-text" dir="ltr" data-testid="progress-count">{resolved}/{total}</span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={resolved}
          aria-label={t('workspace.progress.label')}
          className="h-2 overflow-hidden rounded bg-border"
        >
          <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
        {otherRuns > 0 ? <p className="text-xs text-warning" data-testid="other-runs">{t('workspace.progress.other_runs', { count: otherRuns })}</p> : null}
      </div>

      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted" data-testid="comparison-only">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.7} aria-hidden="true" />
        <span>{t('workspace.comparison_only')}</span>
      </p>
    </section>
  );
}
