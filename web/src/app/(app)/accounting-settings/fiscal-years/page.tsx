'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, ArrowRight, CircleAlert, History, Info, Lock, LockOpen, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { EmptyState, LoadingState } from '@/components/nebrax';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { formatDateTime } from '@/lib/formatting';
import { hasPermission } from '@/lib/permissions';

/**
 * FISCAL-2: السنوات المالية والإقفال السنوي.
 *
 * الإقفال يصفّر حسابات النتيجة مقابل الأرباح المرحّلة، والفتح يعكس قيد
 * الإقفال بجيلٍ مسجَّل. لا زرّ «تجاوز» لقفل الفترة: إن كان قفلٌ نشط يشمل تاريخ
 * الإقفال ظهر مانعاً صريحاً في لوحة الجاهزية ليُحرَّر أولاً بصلاحيته المستقلة.
 */
interface Generation {
  id: string;
  generation: number;
  status: 'active' | 'reversed';
  journal_entry_id: string | null;
  reversal_entry_id: string | null;
  total_revenue: number;
  total_expense: number;
  net_income: number;
  closed_by: string | null;
  closed_at: string | null;
  reopened_by: string | null;
  reopened_at: string | null;
  reopen_reason: string | null;
}

interface FiscalYearRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: 'open' | 'closing' | 'closed' | 'reopening';
  created_by: string | null;
  created_at: string | null;
  active_generation: number | null;
  closed_without_journal: boolean;
  generations: Generation[];
}

interface ReadinessItem {
  severity: 'blocker' | 'warning' | 'info';
  code: string;
  message: string;
  details: Record<string, unknown>;
}

interface Readiness {
  blockers: ReadinessItem[];
  warnings: ReadinessItem[];
  info: ReadinessItem[];
  can_close: boolean;
}

interface LockEvent {
  id: string;
  action: string;
  actor: string | null;
  generation: number | null;
  reason: string | null;
  created_at: string | null;
}

function useAccess() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const user = currentUser();
  return {
    mounted,
    canView: hasPermission(user?.permissions, user?.role, 'fiscal_years.view'),
    canManage: hasPermission(user?.permissions, user?.role, 'fiscal_years.manage'),
    canClose: hasPermission(user?.permissions, user?.role, 'fiscal_years.close'),
    canReopen: hasPermission(user?.permissions, user?.role, 'fiscal_years.reopen'),
  };
}

function money(halalas: number): string {
  return (halalas / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function FiscalYearsPage() {
  const t = useTranslations('accountingSettings');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { success, error: toastError } = useToast();
  const { mounted, canView, canManage, canClose, canReopen } = useAccess();

  const [years, setYears] = useState<FiscalYearRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [closing, setClosing] = useState<FiscalYearRow | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const [reopening, setReopening] = useState<FiscalYearRow | null>(null);
  const [reopenReason, setReopenReason] = useState('');

  const [historyOf, setHistoryOf] = useState<FiscalYearRow | null>(null);
  const [events, setEvents] = useState<LockEvent[] | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    api<{ data: { fiscal_years: FiscalYearRow[] } }>('/accounting-settings/fiscal-years')
      .then((response) => setYears(response.data.fiscal_years))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : t('loadFailed')));
  }, [t]);

  useEffect(() => {
    if (canView) load();
  }, [canView, load]);

  async function createYear() {
    setBusy(true);
    try {
      await api('/accounting-settings/fiscal-years', {
        method: 'POST',
        body: { name, start_date: startDate, end_date: endDate },
      });
      success(t('fyCreated'));
      setCreateOpen(false);
      setName('');
      setStartDate('');
      setEndDate('');
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : t('fyCreateFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function openCloseDialog(year: FiscalYearRow) {
    setClosing(year);
    setReadiness(null);
    setAcknowledged(false);
    try {
      const response = await api<{ data: { readiness: Readiness } }>(
        `/accounting-settings/fiscal-years/${year.id}/readiness`,
      );
      setReadiness(response.data.readiness);
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : t('loadFailed'));
      setClosing(null);
    }
  }

  async function confirmClose() {
    if (!closing) return;
    setBusy(true);
    try {
      await api(`/accounting-settings/fiscal-years/${closing.id}/close`, { method: 'POST' });
      success(t('fyClosed'));
      setClosing(null);
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : t('fyCloseFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmReopen() {
    if (!reopening) return;
    setBusy(true);
    try {
      await api(`/accounting-settings/fiscal-years/${reopening.id}/reopen`, {
        method: 'POST',
        body: { reason: reopenReason },
      });
      success(t('fyReopened'));
      setReopening(null);
      setReopenReason('');
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : t('fyReopenFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function openHistory(year: FiscalYearRow) {
    setHistoryOf(year);
    setEvents(null);
    try {
      const response = await api<{ data: LockEvent[] }>(`/accounting-settings/fiscal-years/${year.id}/events`);
      setEvents(response.data);
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : t('loadFailed'));
      setEvents([]);
    }
  }

  if (!mounted) return <LoadingState variant="cards" rows={4} />;

  if (!canView) {
    return <EmptyState icon={Lock} title={t('forbidden')} description={t('fyForbiddenHint')} />;
  }

  const statusTone = (status: FiscalYearRow['status']) =>
    status === 'closed' ? 'negative' : status === 'open' ? 'positive' : 'warning';

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('backToAccountingSettings')}>
          <Link href="/accounting-settings">
            <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-text">{t('fiscalYearsTitle')}</h1>
          <p className="mt-1 text-sm text-muted">{t('fiscalYearsSubtitle')}</p>
        </div>
        {canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" strokeWidth={1.7} />
            {t('fyCreateAction')}
          </Button>
        )}
      </div>

      <p className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted">{t('fiscalYearsNotice')}</p>

      {loadError ? (
        <p className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{loadError}</p>
      ) : years === null ? (
        <LoadingState variant="table" rows={4} />
      ) : years.length === 0 ? (
        <EmptyState icon={Lock} title={t('fyEmpty')} description={t('fyEmptyHint')} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('fiscalYearsTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <THead>
                <TR>
                  <TH>{t('fyName')}</TH>
                  <TH>{t('fyRange')}</TH>
                  <TH>{t('lockStatusColumn')}</TH>
                  <TH>{t('fyGeneration')}</TH>
                  <TH>{t('fyResult')}</TH>
                  <TH className="text-end">{t('lockActionsColumn')}</TH>
                </TR>
              </THead>
              <TBody>
                {years.map((year) => {
                  const active = year.generations.find((g) => g.status === 'active');

                  return (
                    <TR key={year.id}>
                      <TD className="whitespace-nowrap font-medium text-text">{year.name}</TD>
                      <TD className="whitespace-nowrap font-mono text-xs">
                        {year.start_date} — {year.end_date}
                      </TD>
                      <TD>
                        <Badge tone={statusTone(year.status)}>{t(`fyStatus_${year.status}`)}</Badge>
                      </TD>
                      <TD className="whitespace-nowrap text-sm text-muted">
                        {active ? `#${active.generation}` : '—'}
                        {year.closed_without_journal && (
                          <span className="block text-xs">{t('fyNoJournal')}</span>
                        )}
                        {active?.closed_by && (
                          <span className="block text-xs">
                            {active.closed_by} · {formatDateTime(active.closed_at, locale)}
                          </span>
                        )}
                      </TD>
                      <TD className="whitespace-nowrap text-sm">
                        {active ? (
                          <span className={active.net_income < 0 ? 'text-negative' : 'text-positive'}>
                            {money(active.net_income)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </TD>
                      <TD className="whitespace-nowrap text-end">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openHistory(year)}
                          aria-label={t('lockHistoryAction')}
                          title={t('lockHistoryAction')}
                        >
                          <History className="h-4 w-4" strokeWidth={1.7} />
                        </Button>
                        {canClose && year.status === 'open' && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openCloseDialog(year)}
                            aria-label={t('fyCloseAction')}
                            title={t('fyCloseAction')}
                          >
                            <Lock className="h-4 w-4" strokeWidth={1.7} />
                          </Button>
                        )}
                        {canReopen && year.status === 'closed' && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => { setReopening(year); setReopenReason(''); }}
                            aria-label={t('fyReopenAction')}
                            title={t('fyReopenAction')}
                          >
                            <LockOpen className="h-4 w-4" strokeWidth={1.7} />
                          </Button>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title={t('fyCreateAction')}>
        <div className="space-y-4">
          <p className="text-sm text-muted">{t('fyCreateHint')}</p>
          <div className="space-y-1.5">
            <Label htmlFor="fy-name">{t('fyName')}</Label>
            <Input id="fy-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fy-start">{t('lockStartDate')}</Label>
              <Input id="fy-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fy-end">{t('lockEndDate')}</Label>
              <Input id="fy-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={busy}>{tc('cancel')}</Button>
            <Button onClick={createYear} disabled={busy || !name.trim() || !startDate || !endDate}>
              {tc('save')}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={closing !== null} onClose={() => setClosing(null)} title={t('fyCloseAction')} className="max-w-2xl">
        {readiness === null ? (
          <LoadingState variant="table" rows={3} />
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-text">
              {t('fyCloseConfirm', { name: closing?.name ?? '', end: closing?.end_date ?? '' })}
            </p>

            <ReadinessGroup
              items={readiness.blockers}
              icon={CircleAlert}
              title={t('fyBlockers')}
              tone="text-negative"
              empty={t('fyNoBlockers')}
            />
            <ReadinessGroup
              items={readiness.warnings}
              icon={AlertTriangle}
              title={t('fyWarnings')}
              tone="text-warning"
            />
            <ReadinessGroup items={readiness.info} icon={Info} title={t('fyInfo')} tone="text-muted" />

            {readiness.warnings.length > 0 && readiness.can_close && (
              <label className="flex items-start gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                <span>{t('fyAcknowledgeWarnings')}</span>
              </label>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setClosing(null)} disabled={busy}>{tc('cancel')}</Button>
              <Button
                variant="danger"
                onClick={confirmClose}
                disabled={busy || !readiness.can_close || (readiness.warnings.length > 0 && !acknowledged)}
              >
                {t('fyCloseAction')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog open={reopening !== null} onClose={() => setReopening(null)} title={t('fyReopenAction')}>
        <div className="space-y-4">
          <p className="text-sm text-text">
            {t('fyReopenConfirm', { name: reopening?.name ?? '' })}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="fy-reopen-reason">{t('fyReopenReason')}</Label>
            <Textarea
              id="fy-reopen-reason"
              rows={3}
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setReopening(null)} disabled={busy}>{tc('cancel')}</Button>
            <Button variant="danger" onClick={confirmReopen} disabled={busy || reopenReason.trim() === ''}>
              {t('fyReopenAction')}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={historyOf !== null} onClose={() => setHistoryOf(null)} title={t('lockHistoryAction')}>
        {events === null ? (
          <LoadingState variant="table" rows={2} />
        ) : events.length === 0 ? (
          <p className="text-sm text-muted">{t('lockHistoryEmpty')}</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {events.map((event) => (
              <li key={event.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={event.action === 'year_closed' ? 'negative' : 'neutral'}>
                    {t(`fyEvent_${event.action}`)}
                  </Badge>
                  {event.generation !== null && (
                    <span className="font-mono text-xs text-muted">#{event.generation}</span>
                  )}
                  <span className="text-xs text-muted">{formatDateTime(event.created_at, locale)}</span>
                </div>
                {event.reason && <p className="mt-1 text-text">{event.reason}</p>}
                <p className="text-xs text-muted">{event.actor ?? '—'}</p>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </div>
  );
}

function ReadinessGroup({
  items,
  icon: Icon,
  title,
  tone,
  empty,
}: {
  items: ReadinessItem[];
  icon: typeof Info;
  title: string;
  tone: string;
  empty?: string;
}) {
  if (items.length === 0 && empty === undefined) return null;

  return (
    <section className="space-y-1.5">
      <h3 className={`flex items-center gap-1.5 text-sm font-medium ${tone}`}>
        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.7} />
        {title} ({items.length})
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.code} className="rounded border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-text">
              {item.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
