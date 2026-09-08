'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight, History, Lock, LockOpen, Plus } from 'lucide-react';
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
import { hasPermission } from '@/lib/permissions';

/**
 * ACC-6: أقفال الفترات المحاسبية — نطاق تاريخ مغلق الطرفين يمنع **ترحيل**
 * أثرٍ محاسبي جديد داخله. المسودات تبقى قابلة للإنشاء والتعديل والحذف، وقيود
 * الفترة المقفلة تبقى كما هي (لا تُعدَّل ولا تُحذف).
 *
 * لا زرّ «تجاوز» ولا تعديل نطاق في مكانه: التصحيح تحريرٌ بسببٍ مسجَّل ثم
 * إنشاء بديل، فيبقى التاريخ الإداري كاملاً في سجل التدقيق.
 */
interface PeriodLock {
  id: string;
  start_date: string;
  end_date: string;
  status: 'active' | 'released';
  reason: string;
  created_by: string | null;
  created_at: string | null;
  released_by: string | null;
  released_at: string | null;
  release_reason: string | null;
}

interface LockEvent {
  id: string;
  lock_id: string;
  action: 'lock_created' | 'lock_released';
  actor: string | null;
  start_date: string;
  end_date: string;
  reason: string;
  created_at: string | null;
}

function useAccess(): { mounted: boolean; canView: boolean; canManage: boolean } {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const user = currentUser();
  return {
    mounted,
    canView: hasPermission(user?.permissions, user?.role, 'accounting_period_locks.view'),
    canManage: hasPermission(user?.permissions, user?.role, 'accounting_period_locks.manage'),
  };
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return value.slice(0, 10);
}

export default function AccountingPeriodLocksPage() {
  const t = useTranslations('accountingSettings');
  const tc = useTranslations('common');
  const { success, error: toastError } = useToast();
  const { mounted, canView, canManage } = useAccess();

  const [locks, setLocks] = useState<PeriodLock[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');

  const [releasing, setReleasing] = useState<PeriodLock | null>(null);
  const [releaseReason, setReleaseReason] = useState('');

  const [historyOf, setHistoryOf] = useState<PeriodLock | null>(null);
  const [events, setEvents] = useState<LockEvent[] | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    api<{ data: { locks: PeriodLock[] } }>('/accounting-settings/period-locks')
      .then((response) => setLocks(response.data.locks))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : t('loadFailed')));
  }, [t]);

  useEffect(() => {
    if (canView) load();
  }, [canView, load]);

  const activeCount = useMemo(
    () => (locks ?? []).filter((lock) => lock.status === 'active').length,
    [locks],
  );

  async function createLock() {
    setBusy(true);
    try {
      await api('/accounting-settings/period-locks', {
        method: 'POST',
        body: { start_date: startDate, end_date: endDate, reason },
      });
      success(t('lockCreated'));
      setCreateOpen(false);
      setStartDate('');
      setEndDate('');
      setReason('');
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : t('lockCreateFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function releaseLock() {
    if (!releasing) return;
    setBusy(true);
    try {
      await api(`/accounting-settings/period-locks/${releasing.id}/release`, {
        method: 'POST',
        body: { reason: releaseReason },
      });
      success(t('lockReleased'));
      setReleasing(null);
      setReleaseReason('');
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : t('lockReleaseFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function openHistory(lock: PeriodLock) {
    setHistoryOf(lock);
    setEvents(null);
    try {
      const response = await api<{ data: LockEvent[] }>(`/accounting-settings/period-locks/${lock.id}/events`);
      setEvents(response.data);
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : t('loadFailed'));
      setEvents([]);
    }
  }

  if (!mounted) return <LoadingState variant="cards" rows={4} />;

  if (!canView) {
    return <EmptyState icon={Lock} title={t('forbidden')} description={t('forbiddenHint')} />;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('backToAccountingSettings')}>
          <Link href="/accounting-settings">
            <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-text">{t('periodLocksTitle')}</h1>
          <p className="mt-1 text-sm text-muted">{t('periodLocksSubtitle')}</p>
        </div>
        {canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" strokeWidth={1.7} />
            {t('lockCreateAction')}
          </Button>
        )}
      </div>

      <p className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted">
        {t('periodLocksDraftNotice')}
      </p>

      {!canManage && (
        <p className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted">{t('locksViewOnly')}</p>
      )}

      {loadError ? (
        <p className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{loadError}</p>
      ) : locks === null ? (
        <LoadingState variant="table" rows={5} />
      ) : locks.length === 0 ? (
        <EmptyState icon={Lock} title={t('locksEmpty')} description={t('locksEmptyHint')} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('locksTableTitle', { count: activeCount })}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <THead>
                <TR>
                  <TH>{t('lockRange')}</TH>
                  <TH>{t('lockStatusColumn')}</TH>
                  <TH>{t('lockReason')}</TH>
                  <TH>{t('lockCreatedBy')}</TH>
                  <TH>{t('lockReleasedBy')}</TH>
                  <TH className="text-end">{t('lockActionsColumn')}</TH>
                </TR>
              </THead>
              <TBody>
                {locks.map((lock) => (
                  <TR key={lock.id}>
                    <TD className="whitespace-nowrap font-mono text-xs">
                      {lock.start_date} — {lock.end_date}
                    </TD>
                    <TD>
                      <Badge tone={lock.status === 'active' ? 'negative' : 'neutral'}>
                        {lock.status === 'active' ? t('lockStatusActive') : t('lockStatusReleased')}
                      </Badge>
                    </TD>
                    <TD className="max-w-xs truncate" title={lock.reason}>{lock.reason}</TD>
                    <TD className="whitespace-nowrap text-sm text-muted">
                      {lock.created_by ?? '—'}
                      <span className="block text-xs">{formatDateTime(lock.created_at)}</span>
                    </TD>
                    <TD className="whitespace-nowrap text-sm text-muted">
                      {lock.released_by ?? '—'}
                      <span className="block text-xs">{formatDateTime(lock.released_at)}</span>
                    </TD>
                    <TD className="whitespace-nowrap text-end">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => openHistory(lock)}
                        aria-label={t('lockHistoryAction')}
                        title={t('lockHistoryAction')}
                      >
                        <History className="h-4 w-4" strokeWidth={1.7} />
                      </Button>
                      {canManage && lock.status === 'active' && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => { setReleasing(lock); setReleaseReason(''); }}
                          aria-label={t('lockReleaseAction')}
                          title={t('lockReleaseAction')}
                        >
                          <LockOpen className="h-4 w-4" strokeWidth={1.7} />
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title={t('lockCreateAction')}>
        <div className="space-y-4">
          <p className="text-sm text-muted">{t('lockCreateHint')}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="lock-start">{t('lockStartDate')}</Label>
              <Input id="lock-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lock-end">{t('lockEndDate')}</Label>
              <Input id="lock-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lock-reason">{t('lockReason')}</Label>
            <Textarea id="lock-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={busy}>{tc('cancel')}</Button>
            <Button onClick={createLock} disabled={busy || !startDate || !endDate || reason.trim() === ''}>
              {tc('save')}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={releasing !== null} onClose={() => setReleasing(null)} title={t('lockReleaseAction')}>
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {t('lockReleaseConfirm', {
              start: releasing?.start_date ?? '',
              end: releasing?.end_date ?? '',
            })}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="release-reason">{t('lockReleaseReason')}</Label>
            <Textarea id="release-reason" rows={3} value={releaseReason} onChange={(e) => setReleaseReason(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setReleasing(null)} disabled={busy}>{tc('cancel')}</Button>
            <Button variant="danger" onClick={releaseLock} disabled={busy || releaseReason.trim() === ''}>
              {t('lockReleaseAction')}
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
                  <Badge tone={event.action === 'lock_created' ? 'negative' : 'neutral'}>
                    {event.action === 'lock_created' ? t('lockEventCreated') : t('lockEventReleased')}
                  </Badge>
                  <span className="font-mono text-xs text-muted">{event.start_date} — {event.end_date}</span>
                  <span className="text-xs text-muted">{formatDateTime(event.created_at)}</span>
                </div>
                <p className="mt-1 text-text">{event.reason}</p>
                <p className="text-xs text-muted">{event.actor ?? '—'}</p>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </div>
  );
}
