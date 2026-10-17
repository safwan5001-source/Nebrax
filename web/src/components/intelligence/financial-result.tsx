'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import type { FinancialRun } from '@/modules/intelligence/store';
import { AgingView } from './aging-view';
import { EvidencePanel, ResultWarnings } from './evidence-panel';
import { IncomeStatementView } from './income-statement-view';

/**
 * نتيجة مالية كاملة بتسلسل: عنوان وفترة ← تنبيهات ← خلاصة وجداول (يسار/أساس) ← أدلة ونطاق ومصادر (عمود جانبي على
 * الشاشات العريضة وأسفل النتيجة على الجوال). الأرقام حقيقية من تقارير أَوْج دائماً (لا من المزوّد).
 */
export function FinancialResult({ run }: { run: FinancialRun }) {
  const t = useTranslations('intelligence');
  const { result } = run;
  return (
    <article className="awj-intel-rise space-y-3" aria-label={t(`result.${result.report}`)}>
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-text">{t(`result.${result.report}`)}</h2>
        <Badge tone="muted">
          {result.report === 'income_statement'
            ? <>{t('result.period')}: <span dir="ltr" className="num">{result.period.from} → {result.period.to}</span></>
            : <>{t('result.as_of')}: <span dir="ltr" className="num">{result.as_of}</span></>}
        </Badge>
        <Badge tone="neutral">{run.source === 'assistant' ? t('canvas.source_assistant') : t('canvas.source_canvas')}</Badge>
      </header>
      <p className="text-xs text-muted">{t('demo.figures')}</p>
      <ResultWarnings result={result} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          {result.report === 'income_statement' ? <IncomeStatementView result={result} /> : <AgingView result={result} />}
        </div>
        <EvidencePanel result={result} authorizationScope={run.authorizationScope} className="lg:sticky lg:top-2" />
      </div>
    </article>
  );
}
