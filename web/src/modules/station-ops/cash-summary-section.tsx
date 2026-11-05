'use client';

import { ArrowDownRight, ArrowUpRight, Equal, Info, Lock, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { formatMinorRiyal } from '@/lib/money';
import { buildCashSummaryView, type CashRowKey, type CashSummary, type UnavailableReason } from './cash-summary';
import { InlineNote } from './state-views';

/**
 * #2021 — قسم «ملخص النقد» للبائع والمشرف: ما قبضته الوردية فعلاً، ما سُلّم للخزنة، المتوقع، المعدود، الفرق.
 * قراءة فقط من حقل الخادم `cash_summary` (لا حساب هنا). كل مكوّن غير متاح يُعنوَن بسببه؛ الشبكة «للعلم» ولا تدخل النقد.
 * ملاحظة صادقة: لا نعرض رقماً ناقصاً كإجمالي حقيقي ولا نسمّي فرقاً «زيادة/عجز» إلا حين يكتمل المتوقع.
 */
type Translate = ReturnType<typeof useTranslations>;

function rowLabel(t: Translate, key: CashRowKey): string {
  switch (key) {
    case 'opening': return t('shiftDetail.cashSummary.row.opening');
    case 'sales': return t('shiftDetail.cashSummary.row.sales');
    case 'cashIn': return t('shiftDetail.cashSummary.row.cashIn');
    case 'handover': return t('shiftDetail.cashSummary.row.handover');
    case 'otherOut': return t('shiftDetail.cashSummary.row.otherOut');
    case 'expenses': return t('shiftDetail.cashSummary.row.expenses');
  }
}

function unavailableText(t: Translate, reason: UnavailableReason): string {
  switch (reason) {
    case 'permission': return t('shiftDetail.cashSummary.unavailable.permission');
    case 'basis_not_enabled': return t('shiftDetail.cashSummary.unavailable.basis_not_enabled');
    case 'not_recorded_legacy': return t('shiftDetail.cashSummary.unavailable.not_recorded_legacy');
    default: return t('shiftDetail.cashSummary.unavailable.unknown');
  }
}

function gapText(t: Translate, code: string, unattributedCount: number): string | null {
  switch (code) {
    case 'sales_cash_not_included': return t('shiftDetail.cashSummary.gap.sales_cash_not_included');
    case 'permission_sales_view': return t('shiftDetail.cashSummary.gap.permission_sales_view');
    case 'unattributed_cash_receipts': return t('shiftDetail.cashSummary.gap.unattributed_cash_receipts', { count: String(unattributedCount) });
    case 'multiple_cash_accounts': return t('shiftDetail.cashSummary.gap.multiple_cash_accounts');
    case 'legacy_closed_snapshot': return t('shiftDetail.cashSummary.gap.legacy_closed_snapshot');
    default: return t('shiftDetail.cashSummary.gap.unknown');
  }
}

export function CashSummarySection({ summary }: { summary: CashSummary }) {
  const t = useTranslations('stationOps');
  const view = buildCashSummaryView(summary);
  const money = (minor: number) => formatMinorRiyal(minor);
  const complete = view.expected.kind === 'total';
  const variance = view.variance;
  const DirectionIcon = variance?.kind === 'final' ? (variance.direction === 'overage' ? ArrowUpRight : variance.direction === 'shortage' ? ArrowDownRight : Equal) : Equal;

  return (
    <section aria-labelledby="fo-cash-summary-h" data-cash-summary={summary.state} className="space-y-3 rounded-[14px] border border-border bg-surface p-4">
      <div>
        <h2 id="fo-cash-summary-h" className="text-base font-semibold text-text">{t('shiftDetail.cashSummary.title')}</h2>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs leading-5 text-muted">
          {view.frozen ? <Lock aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} /> : null}
          {view.frozen ? t('shiftDetail.cashSummary.frozen') : t('shiftDetail.cashSummary.live')}
        </p>
      </div>

      <dl className="divide-y divide-border">
        {view.rows.map((row) => (
          <div key={row.key} data-cash-row={row.key} className="flex items-baseline justify-between gap-3 py-2.5">
            <dt className="text-sm text-muted">{rowLabel(t, row.key)}</dt>
            <dd className="text-base font-semibold text-text">
              {row.amountMinor === null ? (
                <span className="text-sm font-normal text-muted">{unavailableText(t, row.unavailable ?? 'unknown')}</span>
              ) : (
                <span className="inline-flex items-baseline gap-1">
                  <span aria-hidden="true" className="text-sm font-normal text-muted">{row.sign === 1 ? '+' : '−'}</span>
                  <span className="num">{money(row.amountMinor)}</span>
                </span>
              )}
            </dd>
          </div>
        ))}

        <div data-cash-row="expected" className="flex items-baseline justify-between gap-3 py-2.5">
          <dt className="text-sm font-semibold text-text">{complete ? t('shiftDetail.cashSummary.expected') : t('shiftDetail.cashSummary.expectedPartial')}</dt>
          <dd className={`num text-lg font-bold ${complete ? 'text-text' : 'text-warning'}`}>{money(view.expected.amountMinor)}</dd>
        </div>
        <div data-cash-row="counted" className="flex items-baseline justify-between gap-3 py-2.5">
          <dt className="text-sm text-muted">{t('shiftDetail.cashSummary.counted')}</dt>
          <dd className="text-base font-semibold text-text">
            {view.countedMinor === null ? <span className="text-sm font-normal text-muted">{t('shiftDetail.cashSummary.notCounted')}</span> : <span className="num">{money(view.countedMinor)}</span>}
          </dd>
        </div>
        <div data-cash-row="variance" className="flex items-baseline justify-between gap-3 py-2.5">
          <dt className="text-sm text-muted">{variance?.kind === 'provisional' ? t('shiftDetail.cashSummary.varianceProvisional') : t('shiftDetail.cashSummary.variance')}</dt>
          <dd className="text-base font-bold text-text">
            {variance === null ? (
              <span className="text-sm font-normal text-muted">{view.varianceHidden ? t('shiftDetail.cashSummary.unavailable.permission') : t('shiftDetail.cashSummary.notCounted')}</span>
            ) : variance.kind === 'final' ? (
              <span className="inline-flex items-center gap-1.5">
                <DirectionIcon aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
                <span className="num">{money(variance.amountMinor)}</span>
                <span className="text-sm font-semibold">{variance.direction === 'overage' ? t('shiftDetail.cashSummary.direction.overage') : variance.direction === 'shortage' ? t('shiftDetail.cashSummary.direction.shortage') : t('shiftDetail.cashSummary.direction.none')}</span>
              </span>
            ) : (
              <span className="num text-muted">{money(variance.amountMinor)}</span>
            )}
          </dd>
        </div>
      </dl>

      {variance?.kind === 'provisional' ? (
        <p role="status" className="flex items-start gap-2 rounded-[14px] border border-border bg-[color:var(--fo-warning-tint)] p-3 text-sm leading-6 text-warning">
          <TriangleAlert aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" strokeWidth={1.8} />
          <span>{t('shiftDetail.cashSummary.provisionalNote')}</span>
        </p>
      ) : null}

      {view.gaps.length > 0 ? (
        <ul className="space-y-1.5">
          {view.gaps.map((code) => {
            const text = gapText(t, code, view.unattributed?.count ?? 0);
            return text ? <li key={code}><InlineNote tone="warning">{text}</InlineNote></li> : null;
          })}
        </ul>
      ) : null}

      <div data-cash-row="network" className="rounded-[14px] border border-dashed border-border p-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-muted">{t('shiftDetail.cashSummary.network.label')}</span>
          {view.network.amountMinor === null
            ? <span className="text-sm text-muted">{unavailableText(t, view.network.unavailable ?? 'unknown')}</span>
            : <span className="num text-base font-semibold text-text">{money(view.network.amountMinor)}</span>}
        </div>
        <p className="mt-1.5 flex items-start gap-2 text-xs leading-5 text-muted">
          <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
          <span>{t('shiftDetail.cashSummary.network.note')}</span>
        </p>
      </div>

      {view.adjustments ? (
        <p role="status" className="flex items-start gap-2 rounded-[14px] border border-border bg-[color:var(--fo-warning-tint)] p-3 text-sm leading-6 text-warning">
          <TriangleAlert aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" strokeWidth={1.8} />
          <span>{t('shiftDetail.cashSummary.afterClose', { count: String(view.adjustments.count), amount: money(Math.abs(view.adjustments.netEffectMinor)) })}</span>
        </p>
      ) : null}
    </section>
  );
}
