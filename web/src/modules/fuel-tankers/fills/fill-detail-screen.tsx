'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, SearchX } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/formatting';
import { classifyError, hasPermission } from '../access';
import { TankerFillAttachments } from '../attachments/tanker-fill-attachments';
import { listStations, type StationOption } from '../settings-client';
import { ForbiddenState } from '../states';
import { usePermissions } from '../use-permissions';
import { getFill } from './client';
import { litersOf, type AttemptRow, type FillDetail, type Operation } from './logic';
import { OperationDialog } from './operation-dialog';
import { AttemptChip, BlockerBadges, InventoryStatusBadge, MinorAmount, ReadinessBadge, TechnicalId, VoidedBadge, reasonLabel } from './parts';
import { FILLS_HREF, FILLS_PERMISSION } from './routes';

type Phase = 'loading' | 'ready' | 'not_found' | 'forbidden' | 'error';

const OUTCOME_TONE = { succeeded: 'positive', rejected: 'warning', failed: 'negative' } as const;

/**
 * TANKER-PR6B-5 — تفاصيل سند التعبئة في مساحة الدمج المخزني: الرقم الإلكتروني (FTF) والسند الورقي **حقلان منفصلان**، حقائق الترحيل والعكس، التكلفة والقيود (لمن تُرسَل له فقط)،
 * الحسابات التاريخية، وسجل المحاولات. **الأزرار من `data.actions` الخادم وحدها** (لا استنتاج من الحالة أو الصلاحيات هنا): غياب الصلاحية ⇒ لا زر لا زر معطّل.
 * الترحيل والعكس عبر `OperationDialog` (معاينة ← تأكيد ← نتيجة صادقة). حالة السند ونتيجة آخر محاولة منفصلتان.
 */
export function FillDetailScreen({ fillId }: { fillId: string }) {
  const t = useTranslations('fuelTankerFills');
  const locale = useLocale();
  const permissions = usePermissions();
  const canView = hasPermission(permissions, FILLS_PERMISSION);
  const [detail, setDetail] = useState<FillDetail | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [stations, setStations] = useState<StationOption[]>([]);
  const sequence = useRef(0);

  /** `silent`: إعادة قراءة بعد عملية (لا شاشة تحميل ولا إخفاء للتفاصيل الحالية). */
  const load = useCallback(async (silent = false) => {
    const mine = ++sequence.current;
    if (!silent) setPhase('loading');
    try {
      const data = await getFill(fillId);
      if (mine !== sequence.current) return;
      setDetail(data);
      setRefreshFailed(false);
      setPhase('ready');
    } catch (error) {
      if (mine !== sequence.current) return;
      if (silent) { setRefreshFailed(true); return; }
      const problem = error instanceof Error && error.message === 'invalid_id' ? 'not_found' : classifyError(error, 'record');
      setPhase(problem === 'not_found' ? 'not_found' : problem === 'forbidden' ? 'forbidden' : 'error');
    }
  }, [fillId]);

  useEffect(() => { if (canView) void load(); }, [canView, load]);
  useEffect(() => { if (canView) listStations().then(setStations).catch(() => setStations([])); }, [canView]);

  if (permissions === null) return <LoadingState variant="cards" rows={3} />;
  if (!canView || phase === 'forbidden') return <ForbiddenState required={FILLS_PERMISSION} />;
  if (phase === 'not_found') {
    // 404 على سجل بمعرّف: غير موجود أو خارج نطاقك أو الميزة مغلقة — لا يُميَّز (لا تسريب).
    return (
      <EmptyState icon={SearchX} titleAs="h1" title={t('detail.notFoundTitle')} description={t('detail.notFoundBody')}
        action={<Button asChild variant="outline"><Link href={FILLS_HREF}>{t('back')}</Link></Button>} />
    );
  }
  if (phase === 'error' && detail === null) return <ErrorState message={t('detail.loadFailed')} onRetry={() => void load()} />;
  if (detail === null) return <LoadingState variant="cards" rows={3} />;

  const { actions, inventory } = detail;
  const showPost = actions.preview_post || actions.post;
  const showReverse = actions.preview_reversal || actions.reverse;
  const stationName = detail.fuel_station_id ? stations.find((station) => station.id === detail.fuel_station_id)?.name ?? null : null;
  const posting = inventory.posting;
  const costVisible = posting !== null && posting.posted_cost_minor !== undefined;
  const lastAttempt = inventory.attempts[0] ?? null;

  return (
    <div className="space-y-4" data-fill-detail="" data-inventory-status={detail.inventory_status}>
      <Link href={FILLS_HREF} className="inline-flex items-center gap-1 text-sm text-primary hover:underline max-md:min-h-11">
        <ArrowRight className="h-4 w-4 rtl:rotate-0 rotate-180" aria-hidden="true" />{t('back')}
      </Link>

      <PageHeader
        eyebrow={t('eyebrow')}
        title={<span className="flex flex-wrap items-center gap-2"><bdi className="num" dir="ltr">{detail.number}</bdi><InventoryStatusBadge status={detail.inventory_status} />{detail.status === 'voided' ? <VoidedBadge /> : null}</span>}
        description={t(`detail.statusHint.${detail.inventory_status}`)}
        actionsSlot={showPost || showReverse ? (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row" data-actions="">
            {showPost ? <Button type="button" className="max-md:min-h-11" onClick={() => setOperation('post')} data-action="post">{t('actions.post')}</Button> : null}
            {showReverse ? <Button type="button" variant="danger" className="max-md:min-h-11" onClick={() => setOperation('reverse')} data-action="reverse">{t('actions.reverse')}</Button> : null}
          </div>
        ) : undefined}
      />
      {refreshFailed ? <ErrorState message={t('detail.refreshFailed')} onRetry={() => void load(true)} /> : null}

      <Card>
        <CardHeader><CardTitle>{t('detail.basics')}</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Item label={t('field.number')} value={<bdi className="num" dir="ltr">{detail.number}</bdi>} />
            <Item label={t('field.voucher')} value={<bdi className="num" dir="ltr" data-voucher="">{detail.voucher_number ?? '—'}</bdi>} />
            <Item label={t('field.owner')} value={detail.owner ? <bdi>{detail.owner.name}</bdi> : '—'} />
            <Item label={t('field.tanker')} value={detail.tanker ? <bdi>{detail.tanker.plate_number}</bdi> : '—'} />
            <Item label={t('field.station')} value={stationName ? <bdi>{stationName}</bdi> : '—'} />
            <Item label={t('field.quantity')} value={<span className="num" dir="ltr" title={`${detail.quantity_milliliters} ml`}>{detail.quantity_liters ?? litersOf(detail.quantity_milliliters)} {t('liters')}</span>} />
            <Item label={t('field.recordedAt')} value={<span className="num">{detail.recorded_at ? formatDateTime(detail.recorded_at, locale) : '—'}</span>} />
            <Item label={t('field.notes')} value={detail.notes ? <span className="whitespace-pre-wrap">{detail.notes}</span> : '—'} />
            {detail.voided_at ? <Item label={t('field.voidedAt')} value={<span className="num">{formatDateTime(detail.voided_at, locale)}</span>} /> : null}
            {detail.void_reason ? <Item label={t('field.voidReason')} value={<span className="whitespace-pre-wrap">{detail.void_reason}</span>} /> : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('detail.inventory')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2" data-state-row="">
            <InventoryStatusBadge status={detail.inventory_status} />
            {detail.readiness ? <ReadinessBadge value={detail.readiness.readiness} /> : null}
            {detail.readiness?.historical ? <Badge tone="neutral" data-historical-badge="">{t('detail.historicalBadge')}</Badge> : null}
            {detail.readiness?.overdue ? <Badge tone="warning">{t('detail.overdueBadge')}</Badge> : null}
          </div>
          {lastAttempt ? <div data-last-attempt=""><AttemptChip attempt={lastAttempt} /></div> : null}
          {detail.readiness && detail.readiness.blockers.length > 0 ? <BlockerBadges codes={detail.readiness.blockers} /> : null}

          {posting === null ? (
            <p className="text-sm text-muted" data-no-posting="">{t('detail.noPosting')}</p>
          ) : (
            <dl className="grid gap-4 sm:grid-cols-2" data-posting-facts="">
              <Item label={t('posting.postedBy')} value={posting.posted_by?.name ? <bdi>{posting.posted_by.name}</bdi> : '—'} />
              <Item label={t('posting.postedAt')} value={<span className="num">{posting.posted_at ? formatDateTime(posting.posted_at, locale) : '—'}</span>} />
              <Item label={t('posting.quantity')} value={<span className="num" dir="ltr">{litersOf(posting.quantity_milliliters)} {t('liters')}</span>} />
              {costVisible ? <Item label={t('posting.cost')} value={<MinorAmount minor={posting.posted_cost_minor} />} /> : null}
              {costVisible && posting.journal_entry ? <Item label={t('posting.journal')} value={<bdi className="num" dir="ltr" data-journal="">{posting.journal_entry.number ?? posting.journal_entry.id}</bdi>} /> : null}
              {posting.status === 'reversed' ? (
                <>
                  <Item label={t('posting.reversedBy')} value={posting.reversed_by?.name ? <bdi>{posting.reversed_by.name}</bdi> : '—'} />
                  <Item label={t('posting.reversedAt')} value={<span className="num">{posting.reversed_at ? formatDateTime(posting.reversed_at, locale) : '—'}</span>} />
                  <Item label={t('posting.reversalReason')} value={posting.reversal_reason ? <span className="whitespace-pre-wrap" data-reversal-reason="">{posting.reversal_reason}</span> : '—'} />
                  {costVisible && posting.reversal_journal_entry ? <Item label={t('posting.reversalJournal')} value={<bdi className="num" dir="ltr">{posting.reversal_journal_entry.number ?? posting.reversal_journal_entry.id}</bdi>} /> : null}
                </>
              ) : null}
            </dl>
          )}

          {posting !== null && !costVisible ? <p role="note" className="text-xs text-muted" data-cost-hidden="">{t('posting.costHidden')}</p> : null}

          {inventory.accounts !== null ? (
            <section aria-label={t('accounts.title')} className="space-y-2" data-accounts="">
              <h3 className="text-sm font-medium text-text">{t('accounts.title')}</h3>
              <p className="text-xs text-muted">{t('accounts.hint')}</p>
              <dl className="grid gap-3 sm:grid-cols-2">
                <Item label={t('accounts.clearing')} value={<AccountText code={inventory.accounts.clearing.code} name={inventory.accounts.clearing.name} />} />
                <Item label={t('accounts.inventory')} value={<AccountText code={inventory.accounts.inventory.code} name={inventory.accounts.inventory.name} />} />
              </dl>
            </section>
          ) : null}

          {posting !== null && costVisible ? (
            <details className="rounded-md border border-border px-3 py-2" data-movements="">
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-text">{t('posting.technical')}</summary>
              <dl className="grid gap-3 pb-2 sm:grid-cols-2">
                <Item label={t('posting.stockMovement')} value={<TechnicalId value={posting.stock_movement_id} />} />
                <Item label={t('posting.costMovement')} value={<TechnicalId value={posting.cost_movement_id} />} />
                {posting.status === 'reversed' ? (
                  <>
                    <Item label={t('posting.reversalStockMovement')} value={<TechnicalId value={posting.reversal_stock_movement_id} />} />
                    <Item label={t('posting.reversalCostMovement')} value={<TechnicalId value={posting.reversal_cost_movement_id} />} />
                  </>
                ) : null}
              </dl>
            </details>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('attempts.title')}</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted">{t('attempts.hint')}</p>
          {inventory.attempts.length === 0 ? (
            <p className="text-sm text-muted" data-no-attempts="">{t('attempts.empty')}</p>
          ) : (
            <ul className="divide-y divide-border rounded border border-border" data-attempts="">
              {inventory.attempts.map((attempt) => <AttemptItem key={attempt.id} attempt={attempt} locale={locale} />)}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('detail.attachments')}</CardTitle></CardHeader>
        <CardContent><TankerFillAttachments fillId={detail.id} /></CardContent>
      </Card>

      {operation !== null ? (
        <OperationDialog
          key={operation}
          operation={operation}
          fillId={detail.id}
          fillNumber={detail.number}
          quantityMilliliters={detail.quantity_milliliters}
          actions={actions}
          onChanged={() => void load(true)}
          onClose={() => setOperation(null)}
        />
      ) : null}
    </div>
  );
}

function AttemptItem({ attempt, locale }: { attempt: AttemptRow; locale: string }) {
  const t = useTranslations('fuelTankerFills');
  return (
    <li className="space-y-1 p-3 text-sm" data-attempt={attempt.outcome} data-operation={attempt.operation}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-text">{t(`operation.${attempt.operation}`)}</span>
          <Badge tone={OUTCOME_TONE[attempt.outcome]}>{t(`attempt.outcome.${attempt.outcome}`)}</Badge>
        </span>
        <span className="num text-xs text-muted">{attempt.attempted_at ? formatDateTime(attempt.attempted_at, locale) : '—'}</span>
      </div>
      {attempt.reason_code ? <p className="text-xs text-muted">{t('attempts.reason')}: {reasonLabel(t, attempt.reason_code)}</p> : null}
      {attempt.actor?.name ? <p className="text-xs text-muted">{t('attempts.actor')}: <bdi>{attempt.actor.name}</bdi></p> : null}
    </li>
  );
}

function AccountText({ code, name }: { code: string | null; name: string | null }) {
  if (!code && !name) return <>—</>;
  return <span>{code ? <bdi className="num" dir="ltr">{code}</bdi> : null}{code && name ? ' — ' : null}{name ? <bdi>{name}</bdi> : null}</span>;
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm text-text">{value}</dd>
    </div>
  );
}
