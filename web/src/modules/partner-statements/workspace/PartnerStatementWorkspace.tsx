'use client';

/**
 * مساحة المطابقة والمراجعة `/partner-statements/[id]` (IMP-PS-A4b). **مقارنة فقط — لا قيد ولا رصيد يتغيّر.**
 *
 * الحقيقة من الخادم دائماً: الرأس (N2) · الحالة والجاهزية (`status`) · السطور/النتائج (`lines`/`matches`). لا تشغيل مطابقة تلقائي؛ `POST …/match` بنقرة صريحة.
 * القرارات تمرّ بطابور محدود (`useDecisionQueue`)؛ بعد أي تعارض/قِدَم يُعاد تحميل الحال من الخادم ولا يُعاد إرسال قرار مالي بصمت.
 * الصلاحيات: `partner_statements.view` للقراءة؛ الكتابة `reconcile` **و**قدرة `enabled` **و**مقارنة `draft` **و**تشغيلة موجودة. `suspended` قراءة فقط، `disabled` يمنع.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight, Info, Loader2, Play } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, PageHeader, Pagination } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Tabs } from '@/components/ui/tabs';
import { useCan } from '@/lib/use-can';
import { cn } from '@/lib/utils';
import { usePartnerStatementsCapability } from '../capability';
import { describeError } from '../errors';
import { fetchHeader, fetchLines, fetchMatches, fetchStatus, markReviewed, reopenReconciliation, runMatching } from './client';
import { decisionState, nextUndecidedIndex } from './decision-rules';
import type { QueueJob } from './decision-queue';
import { EventsTimeline } from './events-timeline';
import { LedgerOnlyList } from './ledger-only-list';
import { EMPTY_WORK, LineDetail, type LineWork } from './line-detail';
import { LinesTable, type WorkspaceRow } from './lines-table';
import { ReadinessPanel } from './readiness-panel';
import { ReversedPairsPanel } from './reversed-pairs';
import { SummaryBar } from './summary-bar';
import { STATEMENT_OUTCOMES, type DecisionRequest, type MatchOutcome, type MatchRow, type ReconciliationHeader, type RunSummary, type StatementLine, type StatusResponse, type UnitSnapshot } from './types';
import { useDecisionQueue } from './use-decision-queue';
import { useIsDesktop } from './use-is-desktop';

const PER_PAGE = 25;
type TabId = 'review' | 'ledger' | 'pairs' | 'events';

export function PartnerStatementWorkspace({ id }: { id: string }) {
  const t = useTranslations('partnerStatements');
  const { can, hydrated } = useCan();
  const capability = usePartnerStatementsCapability();
  const isDesktop = useIsDesktop();
  const queue = useDecisionQueue(id);

  const [header, setHeader] = useState<ReconciliationHeader | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [run, setRun] = useState<RunSummary | null>(null);
  const [ledgerChanged, setLedgerChanged] = useState<boolean | null>(null);
  const [rows, setRows] = useState<WorkspaceRow[]>([]);
  const [meta, setMeta] = useState({ current_page: 1, last_page: 1, per_page: PER_PAGE, total: 0 });
  const [outcomes, setOutcomes] = useState<MatchOutcome[]>([]);
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<TabId>('review');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [work, setWork] = useState<LineWork>(EMPTY_WORK);
  const [ledgerUnits, setLedgerUnits] = useState<UnitSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [matching, setMatching] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const seq = useRef(0);
  const advance = useRef<null | { kind: 'undecided' | 'ordinal'; ordinal?: number; visited: number }>(null);
  const matchingRef = useRef(false);

  const canView = can('partner_statements.view');
  const canWrite = can('partner_statements.reconcile') && capability.state === 'enabled';
  const runId = status?.run?.id ?? run?.id ?? null;
  const toleranceMinor = header?.policy?.amount_tolerance_minor ?? 0;
  const editable = canWrite && header?.status === 'draft' && runId !== null;

  const load = useCallback(
    async (opts: { page?: number; outcomes?: MatchOutcome[]; withHeader?: boolean } = {}) => {
      const mine = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const [nextHeader, nextStatus] = await Promise.all([opts.withHeader === false ? Promise.resolve(null) : fetchHeader(id), fetchStatus(id)]);
        if (mine !== seq.current) return;
        if (nextHeader) setHeader(nextHeader);
        setStatus(nextStatus);
        const activeRun = nextStatus.run?.id ?? null;
        const wantedPage = opts.page ?? page;
        const wantedOutcomes = opts.outcomes ?? outcomes;
        if (activeRun) {
          const matches = await fetchMatches(id, { runId: activeRun, side: 'statement', outcomes: wantedOutcomes.length > 0 ? wantedOutcomes : undefined, page: wantedPage, perPage: PER_PAGE });
          if (mine !== seq.current) return;
          setRun(matches.run);
          setLedgerChanged(matches.ledger_changed);
          setMeta(matches.meta);
          setRows(matches.data.filter((match): match is MatchRow & { line: StatementLine } => Boolean(match.line)).map((match) => ({ line: match.line as StatementLine, match })));
        } else {
          const lines = await fetchLines(id, wantedPage, PER_PAGE);
          if (mine !== seq.current) return;
          setRun(null);
          setLedgerChanged(null);
          setMeta(lines.meta);
          setRows(lines.data.map((line) => ({ line, match: null })));
        }
      } catch (err) {
        if (mine !== seq.current) return;
        capability.observe(err);
        setError(describeError(err).key);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, page, outcomes],
  );

  useEffect(() => {
    if (!hydrated || !capability.settled || !canView || capability.state === 'disabled') return;
    void load();
  }, [hydrated, capability.settled, canView, capability.state, load]);

  // وحدات الدفتر غير المطابَقة لمنتقي التجاوز (أول 50).
  useEffect(() => {
    if (!runId || !canView) return;
    let live = true;
    fetchMatches(id, { runId, side: 'ledger', outcomes: ['missing_in_statement'], page: 1, perPage: 50 })
      .then((response) => live && setLedgerUnits(response.data.flatMap((row) => (row.unit ? [row.unit] : []))))
      .catch(() => live && setLedgerUnits([]));
    return () => {
      live = false;
    };
  }, [id, runId, canView, refreshKey]);

  // اختيار مؤجَّل بعد تحميل صفحة (التالي غير المحسوم / الذهاب لسطر).
  useEffect(() => {
    const pending = advance.current;
    if (!pending || loading) return;
    if (pending.kind === 'ordinal') {
      advance.current = null;
      const found = rows.find((row) => row.line.ordinal === pending.ordinal);
      if (found) pick(found.line.id);
      return;
    }
    const matchRows = rows.map((row) => ({ decision: row.match?.decision ?? null }));
    const index = nextUndecidedIndex(matchRows, -1, runId);
    if (index >= 0 && decisionState(matchRows[index], runId) !== 'current') {
      advance.current = null;
      pick(rows[index].line.id);
      return;
    }
    if (pending.visited >= meta.last_page) {
      advance.current = null;
      setNotice({ tone: 'info', text: t('workspace.no_more_undecided') });
      return;
    }
    pending.visited += 1;
    setPage(meta.current_page >= meta.last_page ? 1 : meta.current_page + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, loading]);

  const pick = (lineId: string) => {
    if (lineId !== selectedId) setWork(EMPTY_WORK);
    setSelectedId(lineId);
    if (!isDesktop) setSheetOpen(true);
  };

  const selected = rows.find((row) => row.line.id === selectedId) ?? null;

  const nextUndecided = () => {
    const matchRows = rows.map((row) => ({ decision: row.match?.decision ?? null }));
    const from = rows.findIndex((row) => row.line.id === selectedId);
    const index = nextUndecidedIndex(matchRows, from, runId);
    if (index >= 0 && decisionState(matchRows[index], runId) !== 'current') {
      pick(rows[index].line.id);
      return;
    }
    // القرارات على تشغيلة أخرى تمنع المراجعة كالسطور بلا قرار: تُحتسب في استمرار البحث بين الصفحات.
    if (meta.last_page > 1 && (status ? status.readiness.unresolved + status.readiness.decisions_on_other_runs : 1) > 0) {
      advance.current = { kind: 'undecided', visited: 1 };
      setPage(meta.current_page >= meta.last_page ? 1 : meta.current_page + 1);
      return;
    }
    setNotice({ tone: 'info', text: t('workspace.no_more_undecided') });
  };

  const goToOrdinal = (ordinal: number) => {
    setTab('review');
    advance.current = { kind: 'ordinal', ordinal, visited: 0 };
    const target = Math.floor((ordinal - 1) / PER_PAGE) + 1;
    if (outcomes.length > 0) setOutcomes([]);
    if (target !== page || outcomes.length > 0) setPage(target);
    else {
      const found = rows.find((row) => row.line.ordinal === ordinal);
      advance.current = null;
      if (found) pick(found.line.id);
    }
  };

  const reloadAfterChange = useCallback(() => {
    setRefreshKey((key) => key + 1);
    void load({ withHeader: false });
  }, [load]);

  const submit = useCallback(
    async (request: DecisionRequest): Promise<QueueJob> => {
      const job = await queue.submit(request);
      if (job.status === 'failed') {
        capability.observe(job.error);
        const descriptor = describeError(job.error);
        // قِدَم/تعارض/حالة/منع: أعد قراءة الحال من الخادم ولا تُخفِ الخلاف (لا إعادة إرسال).
        if (descriptor.kind === 'conflict' || descriptor.kind === 'validation' && descriptor.code?.startsWith('run_') || descriptor.kind === 'forbidden') reloadAfterChange();
      }
      return job;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue.submit, reloadAfterChange],
  );

  const onDecided = useCallback(
    (job: QueueJob) => {
      queue.clearFinished(job.lineId);
      reloadAfterChange();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue.clearFinished, reloadAfterChange],
  );

  async function runMatch() {
    if (matchingRef.current) return;
    matchingRef.current = true;
    setMatching(true);
    setNotice(null);
    try {
      const result = await runMatching(id);
      setNotice({ tone: 'info', text: result.replayed ? t('workspace.match.replayed') : t('workspace.match.created') });
      setPage(1);
      setOutcomes([]);
      await load({ page: 1, outcomes: [] });
      setRefreshKey((key) => key + 1);
    } catch (err) {
      capability.observe(err);
      setNotice({ tone: 'error', text: t(`errors.${describeError(err).key}`) });
    } finally {
      matchingRef.current = false;
      setMatching(false);
    }
  }

  const counts = run?.counts ?? {};
  const toggleOutcome = (outcome: MatchOutcome) => {
    setPage(1);
    setOutcomes((current) => (current.includes(outcome) ? current.filter((value) => value !== outcome) : [...current, outcome]));
  };

  const actions = useMemo(() => [{ key: 'back', label: t('workspace.back'), icon: ArrowRight, href: '/partner-statements', variant: 'outline' as const }], [t]);
  const pageHeader = <PageHeader title={t('workspace.title')} description={t('workspace.subtitle')} actions={actions} />;

  if (hydrated && !canView) {
    return <div className="space-y-4">{pageHeader}<EmptyState titleAs="h2" title={t('state.forbidden_title')} description={t('state.forbidden_hint')} /></div>;
  }
  if (capability.state === 'disabled') {
    return (
      <div className="space-y-4">
        {pageHeader}
        <EmptyState titleAs="h2" title={t('state.disabled_title')} description={t('state.disabled_hint')} action={can('apps.view') ? <Button asChild variant="outline"><Link href="/applications">{t('state.open_applications')}</Link></Button> : undefined} />
      </div>
    );
  }
  if (error && !header) {
    return <div className="space-y-4">{pageHeader}<ErrorState message={t(`errors.${error}`)} onRetry={() => void load()} retryLabel={t('retry')} /></div>;
  }
  if (!header || !status) {
    return <div className="space-y-4">{pageHeader}<LoadingState /></div>;
  }

  const tabs = [
    { id: 'review', label: t('workspace.tabs.review'), count: status.readiness.lines_total },
    { id: 'ledger', label: t('workspace.tabs.ledger'), count: counts['ledger.missing_in_statement'] },
    { id: 'pairs', label: t('workspace.tabs.pairs') },
    { id: 'events', label: t('workspace.tabs.events') },
  ];

  const detail = (
    <LineDetail
      reconciliationId={id}
      runId={runId}
      row={selected?.match ?? null}
      bareLine={selected && !selected.match ? selected.line : null}
      toleranceMinor={toleranceMinor}
      editable={editable}
      ledgerUnits={ledgerUnits}
      job={selected ? queue.jobFor(selected.line.id) : null}
      work={work}
      onWork={(patch) => setWork((current) => ({ ...current, ...patch }))}
      submit={submit}
      onDecided={onDecided}
      onNextUndecided={editable ? nextUndecided : undefined}
    />
  );

  return (
    <div className="space-y-4" data-testid="partner-statement-workspace">
      {pageHeader}

      {capability.state === 'suspended' ? (
        <div role="status" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-warning">
          <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} aria-hidden="true" />
          <span className="leading-relaxed">{t('state.suspended_hint')}</span>
        </div>
      ) : null}

      <SummaryBar header={header} status={status} />

      {notice ? (
        <div role={notice.tone === 'error' ? 'alert' : 'status'} className={cn('rounded-md border p-3 text-sm', notice.tone === 'error' ? 'border-negative/40 bg-negative/5 text-negative' : 'border-primary/30 bg-primary-soft text-text')} data-testid="workspace-notice">
          {notice.text}
        </div>
      ) : null}

      {ledgerChanged && header.status === 'draft' ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-warning" data-testid="ledger-changed">
          <span className="min-w-0 flex-1 leading-relaxed">{t('workspace.ledger_changed')}</span>
          {canWrite ? <Button type="button" variant="outline" className="min-h-[44px] md:min-h-9" onClick={() => void runMatch()} disabled={matching}>{t('workspace.match.run_again')}</Button> : null}
        </div>
      ) : null}

      {status.blockers.some((blocker) => blocker.code === 'statement_changed') ? (
        <div role="alert" className="rounded-md border border-negative/40 bg-negative/5 p-3 text-sm text-negative" data-testid="statement-changed">{t('errors.statement_changed')}</div>
      ) : null}

      <Tabs tabs={tabs} value={tab} onChange={(next) => setTab(next as TabId)} />

      {tab === 'review' ? (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="min-w-0 space-y-3">
            {!runId ? (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface p-3" data-testid="no-run">
                <p className="min-w-0 flex-1 text-sm leading-relaxed text-muted">{t('workspace.match.no_run')}</p>
                {canWrite && header.status === 'draft' ? (
                  <Button type="button" className="min-h-[44px] md:min-h-9" onClick={() => void runMatch()} disabled={matching} data-testid="run-match">
                    {matching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />}
                    {t('workspace.match.run')}
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('workspace.filters.outcome')}>
                {STATEMENT_OUTCOMES.map((outcome) => {
                  const active = outcomes.includes(outcome);
                  return (
                    <button
                      key={outcome}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleOutcome(outcome)}
                      className={cn('min-h-[44px] rounded border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:min-h-9', active ? 'border-primary bg-primary-soft text-primary' : 'border-border text-text hover:bg-background')}
                    >
                      {t(`workspace.outcome.${outcome}`)} <span className="num text-muted">{counts[`statement.${outcome}`] ?? 0}</span>
                    </button>
                  );
                })}
                {outcomes.length > 0 ? <Button type="button" variant="ghost" className="min-h-[44px] md:min-h-9" onClick={() => { setPage(1); setOutcomes([]); }}>{t('filters.clear')}</Button> : null}
                {canWrite && header.status === 'draft' ? (
                  <Button type="button" variant="outline" className="ms-auto min-h-[44px] md:min-h-9" onClick={() => void runMatch()} disabled={matching} data-testid="run-match">
                    {matching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />}
                    {t('workspace.match.run_again')}
                  </Button>
                ) : null}
              </div>
            )}

            {error ? <ErrorState message={t(`errors.${error}`)} onRetry={() => void load()} retryLabel={t('retry')} /> : loading && rows.length === 0 ? <LoadingState /> : rows.length === 0 ? (
              <EmptyState titleAs="h2" title={outcomes.length > 0 ? t('workspace.empty_filtered') : t('workspace.empty')} />
            ) : (
              <LinesTable rows={rows} runId={runId} selectedId={selectedId} onSelect={pick} onNextUndecided={nextUndecided} jobFor={queue.jobFor} />
            )}

            <Pagination page={meta.current_page} lastPage={meta.last_page} perPage={meta.per_page} total={meta.total} perPageOptions={[PER_PAGE]} disabled={loading} onPageChange={setPage} onPerPageChange={() => {}} />
          </div>

          <aside className="min-w-0 space-y-4" aria-label={t('workspace.detail.title')}>
            {isDesktop ? (
              <div className="sticky top-4 hidden max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-md border border-border bg-surface md:flex">{detail}</div>
            ) : null}
            <ReadinessPanel
              reconciliationId={id}
              status={status}
              runId={runId}
              canWrite={canWrite}
              pendingDecisions={queue.pendingCount}
              onGoToOrdinal={goToOrdinal}
              onReview={async (note) => {
                if (!runId) return;
                try {
                  await markReviewed(id, runId, note);
                } catch (err) {
                  capability.observe(err);
                  throw err;
                } finally {
                  void load({});
                  setRefreshKey((key) => key + 1);
                }
              }}
              onReopen={async (reason) => {
                try {
                  await reopenReconciliation(id, reason);
                } catch (err) {
                  capability.observe(err);
                  throw err;
                } finally {
                  void load({});
                  setRefreshKey((key) => key + 1);
                }
              }}
            />
          </aside>
        </div>
      ) : null}

      {tab === 'ledger' ? <LedgerOnlyList reconciliationId={id} runId={runId} refreshKey={refreshKey} /> : null}
      {tab === 'pairs' ? <ReversedPairsPanel reconciliationId={id} /> : null}
      {tab === 'events' ? <EventsTimeline reconciliationId={id} refreshKey={refreshKey} /> : null}

      {/* الجوال: لوحة السطر كاملة الشاشة (السطر ← المرشّحون عمودياً ← شريط إجراءات لاصق). */}
      {!isDesktop ? (
        <>
          <Sheet open={sheetOpen && selected !== null} onOpenChange={setSheetOpen}>
            <SheetContent closeLabel={t('workspace.detail.close')} className="sm:max-w-none">
              <SheetTitle className="border-b border-border p-4 pe-14 text-base font-semibold">{t('workspace.detail.title')}</SheetTitle>
              <SheetDescription className="sr-only">{t('workspace.comparison_only')}</SheetDescription>
              {detail}
            </SheetContent>
          </Sheet>
          {runId && rows.length > 0 && !sheetOpen ? (
            <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 border-t border-border bg-surface p-3" data-testid="mobile-progress">
              <span className="num text-sm" dir="ltr">{status.readiness.resolved}/{status.readiness.lines_total}</span>
              <Button type="button" className="min-h-[44px]" onClick={nextUndecided}>{t('workspace.next_undecided')}</Button>
            </div>
          ) : null}
        </>
      ) : null}

      <p className="text-xs leading-relaxed text-muted">{t('disclaimer')}</p>
    </div>
  );
}
