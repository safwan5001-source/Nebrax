'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MessageSquareText, Play, Settings2 } from 'lucide-react';
import Link from 'next/link';
import { EmptyState, LoadingState, PageHeader } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { TOOL_NAMES, toolKey, type ToolName } from '@/modules/intelligence/contract';
import { checkDate, checkPeriod, monthStart, type DateIssue } from '@/modules/intelligence/dates';
import { gateFor } from '@/modules/intelligence/gate';
import { useIntelligence } from '@/modules/intelligence/store';
import { FinancialResult } from './financial-result';
import { StateNotice } from './state-notice';

function issueText(t: (key: string) => string, issue: DateIssue | null): string | null {
  if (!issue) return null;
  return t(`date_${issue}`);
}

/**
 * مساحة الذكاء المالي: تشغيل **صريح** لأداة قراءة من السجل المغلق. لا يُقرأ رقم قبل الضغط على «تشغيل»،
 * ولا يُرسَل طلب إن لم تكن الحالة المقروءة للتوّ جاهزة. الأرقام من الخادم كما هي.
 */
export function IntelligenceCanvas() {
  const t = useTranslations('intelligence');
  const tc = useTranslations('intelligence.canvas');
  const store = useIntelligence();
  const gate = gateFor(store, 'financial');
  const today = store.status?.clock.today ?? '';

  const [tool, setTool] = useState<ToolName>('finance.income_statement');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [asOf, setAsOf] = useState('');
  const [touched, setTouched] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const scrollToResult = useRef(false);

  // الحالة تُقرأ طازجةً عند دخول المساحة (صلاحية/موافقة قد تتغيّر بين الزيارات).
  const { refreshStatus, identity } = store;
  useEffect(() => { if (identity) void refreshStatus(); }, [identity, refreshStatus]);

  // «اليوم» من ساعة المؤسسة (الخادم) لا ساعة المتصفح؛ التواريخ الافتراضية تُملأ مرة واحدة.
  useEffect(() => {
    if (!today) return;
    setFrom((value) => value || monthStart(today));
    setTo((value) => value || today);
    setAsOf((value) => value || today);
  }, [today]);

  const isIncome = tool === 'finance.income_statement';
  const issues = useMemo(() => {
    if (!today) return { from: null, to: null, range: null, asOf: null };
    return { ...checkPeriod(from, to, today), asOf: checkDate(asOf, today) };
  }, [from, to, asOf, today]);
  const invalid = isIncome ? Boolean(issues.from || issues.to || issues.range) : Boolean(issues.asOf);
  const allowedTools = TOOL_NAMES.filter((name) => store.status?.financial_tools.includes(name));

  async function run() {
    setTouched(true);
    if (invalid || gate.kind !== 'ready') return;
    store.dismissFinancialError();
    scrollToResult.current = true;
    const ok = await store.runFinancial({ tool, arguments: isIncome ? { from, to } : { as_of: asOf } });
    if (!ok) scrollToResult.current = false;
  }

  const active = store.activeRun;

  // بعد تشغيل صريح: أظهر النتيجة (على الجوال تكون خلف النموذج). بلا تمرير سلس — يحترم Reduced Motion بطبيعته.
  const activeId = active?.id;
  useEffect(() => {
    if (!activeId || !scrollToResult.current) return;
    scrollToResult.current = false;
    const el = resultRef.current;
    // فقط إن كانت النتيجة تحت نصف الشاشة (الجوال)؛ على الشاشات العريضة تبقى ظاهرة بجوار النموذج فلا نحرّك الصفحة.
    if (el && typeof el.scrollIntoView === 'function' && el.getBoundingClientRect().top > window.innerHeight * 0.55) {
      el.scrollIntoView({ block: 'start' });
    }
  }, [activeId]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('canvas.title')}
        description={t('canvas.description')}
        actionsSlot={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="muted">{tc('read_only')}</Badge>
            <Button type="button" variant="outline" onClick={store.openPanel}>
              <MessageSquareText className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              {t('canvas.ask_assistant')}
            </Button>
            {store.status?.abilities.manage_consent ? (
              <Button asChild variant="ghost">
                <Link href="/intelligence/settings"><Settings2 className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />{t('panel.open_settings')}</Link>
              </Button>
            ) : null}
          </div>
        }
      />

      {gate.kind === 'loading' ? <LoadingState variant="cards" rows={2} label={t('canvas.checking')} /> : null}
      {gate.kind === 'error' ? (
        <StateNotice notice={gate.error.notice} code={gate.error.code} onRetry={() => void store.refreshStatus()} />
      ) : null}
      {gate.kind === 'blocked' ? (
        <StateNotice notice={gate.notice} canManageConsent={store.status?.abilities.manage_consent === true} />
      ) : null}

      {gate.kind === 'ready' ? (
        <>
          <form
            className="space-y-3 rounded border border-border bg-surface p-3"
            aria-label={tc('controls')}
            onSubmit={(event) => { event.preventDefault(); void run(); }}
          >
            <fieldset className="min-w-0">
              <legend className="mb-1 text-xs font-medium text-muted">{tc('tool')}</legend>
              <div role="radiogroup" aria-label={tc('tool')} className="grid grid-cols-3 gap-1 rounded border border-border bg-background p-0.5 sm:inline-grid sm:grid-cols-[repeat(3,auto)]">
                {allowedTools.map((name) => (
                  <label key={name} className="relative cursor-pointer">
                    <input
                      type="radio"
                      name="ai-tool"
                      value={name}
                      checked={tool === name}
                      onChange={() => setTool(name)}
                      className="peer sr-only"
                    />
                    <span className="flex min-h-11 items-center justify-center rounded px-3 text-center text-sm font-medium leading-tight text-muted transition-colors hover:text-text peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-primary/50 sm:min-h-9">
                      {tc(`tools.${toolKey(name)}`)}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap items-end gap-3">
              {isIncome ? (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="ai-from">{tc('from')}</Label>
                    <Input id="ai-from" type="date" dir="ltr" value={from} max={today} onChange={(event) => setFrom(event.target.value)} aria-invalid={Boolean(touched && issues.from) || undefined} />
                    {touched && issues.from ? <p role="alert" className="text-xs text-negative">{issueText(tc, issues.from)}</p> : null}
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="ai-to">{tc('to')}</Label>
                    <Input id="ai-to" type="date" dir="ltr" value={to} max={today} onChange={(event) => setTo(event.target.value)} aria-invalid={Boolean(touched && (issues.to || issues.range)) || undefined} />
                    {touched && (issues.to || issues.range) ? <p role="alert" className="text-xs text-negative">{issueText(tc, issues.to ?? issues.range)}</p> : null}
                  </div>
                </>
              ) : (
                <div className="space-y-1">
                  <Label htmlFor="ai-as-of">{tc('as_of')}</Label>
                  <Input id="ai-as-of" type="date" dir="ltr" value={asOf} max={today} onChange={(event) => setAsOf(event.target.value)} aria-invalid={Boolean(touched && issues.asOf) || undefined} />
                  {touched && issues.asOf ? <p role="alert" className="text-xs text-negative">{issueText(tc, issues.asOf)}</p> : null}
                </div>
              )}
              <Button type="submit" disabled={store.financialPending} className="h-11 sm:h-9">
                <Play className="h-4 w-4 rtl:-scale-x-100" strokeWidth={1.7} aria-hidden="true" />
                {store.financialPending ? tc('running') : tc('run')}
              </Button>
              {today ? <p className="w-full text-[11px] text-muted sm:ms-auto sm:w-auto">{tc('today', { date: today })}</p> : null}
            </div>
          </form>

          {store.runs.length > 0 ? (
            <nav aria-label={tc('history')} className="flex items-center gap-2">
              <span className="shrink-0 text-xs text-muted" title={tc('history_note')}>{tc('history')}</span>
              <ul className="flex min-w-0 gap-1.5 overflow-x-auto pb-1">
                {store.runs.map((run) => (
                  <li key={run.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => store.setActiveRunId(run.id)}
                      aria-current={active?.id === run.id || undefined}
                      className={cn(
                        'flex min-h-11 flex-col items-start justify-center rounded border border-border px-3 py-1 text-start text-xs hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:min-h-9',
                        active?.id === run.id && 'border-primary bg-primary-soft',
                      )}
                    >
                      <span className="font-medium">{t(`result.${run.result.report}`)}</span>
                      <span dir="ltr" className="num text-[11px] text-muted">
                        {run.result.report === 'income_statement' ? `${run.result.period.from} → ${run.result.period.to}` : run.result.as_of}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}

          {store.financialError ? (
            <StateNotice
              notice={store.financialError.notice}
              code={store.financialError.code}
              canManageConsent={store.status?.abilities.manage_consent === true}
              onRetry={store.financialError.retryable ? () => void run() : undefined}
            />
          ) : null}

          {store.financialPending && !active ? (
            <div role="status" aria-busy="true" aria-label={tc('loading')} className="space-y-2">
              <Skeleton className="h-8 w-1/3" /><Skeleton className="h-16 w-full" /><Skeleton className="h-40 w-full" />
            </div>
          ) : null}

          <div ref={resultRef} aria-busy={store.financialPending} className={cn('min-w-0 scroll-mt-2 transition-opacity', store.financialPending && active && 'opacity-60')}>
            {active ? (
              <FinancialResult key={active.id} run={active} />
            ) : !store.financialPending ? (
              <EmptyState title={tc('empty_title')} description={tc('empty_body')} />
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
