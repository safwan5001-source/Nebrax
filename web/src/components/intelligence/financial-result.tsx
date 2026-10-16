'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import type { FinancialRun } from '@/modules/intelligence/store';
import { AgingView } from './aging-view';
import { EvidencePanel, ResultWarnings } from './evidence-panel';
import { IncomeStatementView } from './income-statement-view';

/** نتيجة مالية كاملة: عنوان + تنبيهات + الجدول + الأدلة. الأرقام حقيقية من تقارير أَوْج دائماً (لا من المزوّد). */
export function FinancialResult({ run }: { run: FinancialRun }) {
  const t = useTranslations('intelligence');
  const { result } = run;
  return (
    <article className="space-y-3" aria-label={t(`result.${result.report}`)}>
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
      {result.report === 'income_statement' ? <IncomeStatementView result={result} /> : <AgingView result={result} />}
      <EvidencePanel result={result} authorizationScope={run.authorizationScope} />
    </article>
  );
}
