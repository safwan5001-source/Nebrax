'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ExternalLink, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgingResult, FinancialResult, MessageResponse } from '@/modules/intelligence/contract';

/** رابط واجهة داخلي آمن فقط: يبدأ بشرطة مائلة واحدة، بلا بروتوكول ولا `//`. */
export function safeUiPath(path: string): string | null {
  return /^\/(?!\/)[A-Za-z0-9/_-]*$/.test(path) ? path : null;
}

function isAging(result: FinancialResult): result is AgingResult {
  return result.report !== 'income_statement';
}

export function ResultWarnings({ result }: { result: FinancialResult }) {
  const t = useTranslations('intelligence.result');
  if (!isAging(result) || result.warnings.length === 0) return null;
  return (
    <ul className="space-y-2" aria-label={t('warnings')}>
      {result.warnings.map((warning, index) => (
        <li key={`${warning.code}-${index}`} role="note" className="flex gap-2 rounded border border-warning/40 bg-warning/10 p-3 text-sm text-text">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={1.7} aria-hidden="true" />
          <span>
            {warning.code === 'as_of_not_historical'
              ? t('warning.as_of_not_historical', { balance_as_of: warning.balance_as_of ?? result.generated_at })
              : t('warning.unknown', { code: warning.code })}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 py-1.5 text-sm sm:grid-cols-[9rem_1fr]">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-text">{children}</dd>
    </div>
  );
}

/**
 * الأدلة: النطاق (مع توضيح أنه تفويض لا مرشّح)، الأساس، العملة، والمصادر. لا يُظهر المخزن كمرشّح مالي أبداً.
 */
export function EvidencePanel({
  result,
  authorizationScope,
  className,
}: {
  result: FinancialResult;
  authorizationScope?: MessageResponse['scope'];
  className?: string;
}) {
  const t = useTranslations('intelligence.result');
  const aging = isAging(result);
  const branchMode = result.scope.branch.mode;

  return (
    <section aria-label={t('evidence')} className={cn('rounded border border-border bg-surface', className)}>
      <h3 className="border-b border-border px-3 py-2 text-xs font-medium text-muted">{t('evidence')}</h3>
      <dl className="divide-y divide-border px-3">
        <Row label={t('scope')}>
          <p>{t(`scope_branch.${branchMode}`)}</p>
          <p className="text-muted">{t('scope_warehouse')}</p>
          <p className="text-xs text-muted">{t('scope_warehouse_note')}</p>
          {authorizationScope ? (
            <p className="mt-1 text-xs text-muted" data-scope-kind="authorization">
              {t('scope_authorization')} — {t('scope_authorization_note')}
            </p>
          ) : null}
        </Row>
        <Row label={t('basis')}>
          <p>{aging ? t('basis_aging') : t('basis_income')}</p>
          {aging ? <p className="text-xs text-muted">{result.basis.reconciled_to_control_ledger ? t('reconciled') : t('not_reconciled')}</p> : null}
          <p className="text-xs text-muted">{t('currency_note')} · {t('timezone', { tz: result.timezone })}</p>
        </Row>
        <Row label={t('generated_at')}>
          <span dir="ltr" className="num">{result.generated_at}</span>
        </Row>
        <Row label={t('sources')}>
          <ul className="space-y-1">
            {result.sources.map((source) => {
              const href = safeUiPath(source.ui_path);
              return (
                <li key={`${source.service}-${source.ui_path}`} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {href ? (
                    <Link href={href} className="inline-flex items-center gap-1 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                      {t('open_source')}
                      <ExternalLink className="h-3.5 w-3.5 rtl:-scale-x-100" strokeWidth={1.7} aria-hidden="true" />
                    </Link>
                  ) : null}
                  <span dir="ltr" className="font-mono text-[11px] text-muted" title={t('source_api')}>{source.service}</span>
                </li>
              );
            })}
          </ul>
        </Row>
      </dl>
    </section>
  );
}
