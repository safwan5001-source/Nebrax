'use client';

import { useLocale, useTranslations } from 'next-intl';
import { ArrowDownRight, ArrowUpRight, CircleAlert, CircleCheck, Equal, Info, RefreshCw } from 'lucide-react';
import { formatMinorRiyal } from '@/lib/money';
import { useSettlementPreview } from './data';
import { formatLitersFixedFromMl } from './format';
import { Quantity } from './quantity';
import type { Station } from './schemas';
import { blockerKey, differenceDirection, hasFinanceLayer, stateKey, type SettlementPreview } from './settlement-preview';

/**
 * معاينة تسوية الوردية — قراءة فقط داخل شاشة التسليم (P1-3a).
 *
 * - **لا تكتب شيئاً ولا تُرسل شيئاً**: لا بيع ولا سداد ولا حركة مخزون؛ تُعنوَن «معاينة فقط» وتُحدَّث بطلب المستخدم وحده.
 * - **كل رقم من الخادم** وبحسب صلاحية المستخدم: من لا يملك رؤية المبيعات يرى الجاهزية والمانعات واللترات فقط (غياب مفتاح المبالغ ≠ صفر).
 * - البوابة مغلقة (404) أو لا صلاحية إغلاق ⇒ لا شيء يُعرض والشاشة كما كانت حرفياً.
 * - نصوص الموظف لا تحوي مصطلحات ERP/محاسبة (يحرسها `app-only.test.ts`)؛ القيود المتوقعة متاحة في الـAPI لا في التطبيق.
 */
export function SettlementPreviewSection({ station, shiftId }: { station: Station; shiftId: string }) {
  const { allowed, state, retained, reload } = useSettlementPreview(station, shiftId);
  const t = useTranslations('stationOps');
  const preview = state.status === 'success' ? state.data : retained;

  if (!allowed) return null;
  if (preview === null) {
    if (state.status === 'error' && (state.error.kind === 'offline' || state.error.kind === 'server' || state.error.kind === 'invalid_shape')) {
      return <p role="status" data-settlement-error="" className="text-sm text-warning">{t('settlement.unavailable')}</p>;
    }
    return null; // تحميل أو مغلقة (404) أو ممنوعة: لا قسم
  }

  return <PreviewBody preview={preview} refreshing={state.status === 'loading'} onRefresh={reload} />;
}

function PreviewBody({ preview, refreshing, onRefresh }: { preview: SettlementPreview; refreshing: boolean; onRefresh: () => void }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const finance = hasFinanceLayer(preview);
  const blockers = Array.from(new Set(preview.blockers.map(blockerKey)));
  const difference = preview.declaration?.difference_vs_reference_minor;
  const direction = differenceDirection(difference);

  return (
    <section aria-labelledby="fo-settlement-h" data-settlement-preview={preview.ready ? 'ready' : 'blocked'} data-settlement-hash={preview.preview_hash} className="space-y-4 rounded-[14px] border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="fo-settlement-h" className="text-base font-semibold text-text">{t('settlement.title')}</h2>
          <p className="mt-0.5 flex items-start gap-1.5 text-xs leading-5 text-muted"><Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />{t('settlement.previewOnly')}</p>
        </div>
        <button type="button" onClick={onRefresh} disabled={refreshing} data-settlement-refresh="" aria-label={t('settlement.refresh')} title={t('settlement.refresh')} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] border border-[color:var(--fo-control)] bg-surface text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60">
          <RefreshCw aria-hidden="true" className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} strokeWidth={1.8} />
        </button>
      </div>

      <p className="flex items-center gap-2 text-sm font-semibold text-text" data-settlement-status={preview.ready ? 'ready' : 'blocked'}>
        {preview.ready
          ? <CircleCheck aria-hidden="true" className="h-4 w-4 shrink-0 text-positive" strokeWidth={1.9} />
          : <CircleAlert aria-hidden="true" className="h-4 w-4 shrink-0 text-warning" strokeWidth={1.9} />}
        {preview.ready ? t('settlement.ready') : t('settlement.notReady')}
      </p>

      {blockers.length > 0 ? (
        <div data-settlement-blockers="">
          <h3 className="text-sm font-semibold text-text">{t('settlement.blockersTitle')}</h3>
          <ul className="mt-1 space-y-1.5">
            {blockers.map((key) => (
              <li key={key} className="flex items-start gap-2 text-sm leading-6 text-warning"><CircleAlert aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" strokeWidth={1.8} />{t(`settlement.blocker.${key}`)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul className="divide-y divide-border" data-settlement-lines="">
        {preview.lines.map((line) => (
          <li key={line.nozzle_id} className="space-y-1 py-3 text-sm" data-settlement-line={line.nozzle_id}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium text-text">{t('settlement.nozzle', { number: line.nozzle_number })}</span>
              {finance ? <span className="text-xs text-muted" data-settlement-state={stateKey(line.state)}>{t(`settlement.state.${stateKey(line.state)}`)}</span> : null}
            </div>
            <dl className="grid grid-cols-3 gap-2 text-xs">
              <div><dt className="text-muted">{t('settlement.metered')}</dt><dd className="font-semibold text-text">{line.metered_milliliters === null ? '—' : <Quantity value={formatLitersFixedFromMl(line.metered_milliliters, locale)} unit={t('unit.liter')} />}</dd></div>
              {finance ? (
                <>
                  <div><dt className="text-muted">{t('settlement.documented')}</dt><dd className="font-semibold text-text">{line.erp_milliliters === undefined ? '—' : <Quantity value={formatLitersFixedFromMl(line.erp_milliliters, locale)} unit={t('unit.liter')} />}</dd></div>
                  <div><dt className="text-muted">{t('settlement.remaining')}</dt><dd className="font-semibold text-text">{line.residual_milliliters == null ? '—' : <Quantity value={formatLitersFixedFromMl(line.residual_milliliters, locale)} unit={t('unit.liter')} />}</dd></div>
                </>
              ) : null}
            </dl>
            {finance && line.expected_gross_minor != null ? (
              <p className="flex items-baseline justify-between gap-3 text-xs text-muted"><span>{t('settlement.expectedValue')}</span><span className="num text-sm font-semibold text-text">{formatMinorRiyal(line.expected_gross_minor)}</span></p>
            ) : null}
          </li>
        ))}
      </ul>

      {!finance ? <p className="text-xs leading-5 text-muted" data-settlement-hidden="">{t('settlement.hiddenAmounts')}</p> : null}

      {finance && preview.declaration && preview.reference ? (
        <div data-settlement-reference="">
          <h3 className="text-sm font-semibold text-text">{t('settlement.reference.title')}</h3>
          <dl className="mt-1 divide-y divide-border text-sm">
            <div className="flex items-baseline justify-between gap-3 py-2.5"><dt className="text-muted">{t('settlement.reference.declared')}</dt><dd className="num font-semibold text-text">{formatMinorRiyal(preview.declaration.declared_total_minor)}</dd></div>
            <div className="flex items-baseline justify-between gap-3 py-2.5"><dt className="text-muted">{t('settlement.reference.expected')}</dt><dd className="num font-semibold text-text">{formatMinorRiyal(preview.reference.total_minor)}</dd></div>
            {direction !== null && difference != null ? (
              <div className="flex items-baseline justify-between gap-3 py-2.5">
                <dt className="text-muted">{t('settlement.reference.difference')}</dt>
                <dd className="inline-flex items-center gap-1.5 font-bold text-text" data-settlement-direction={direction}>
                  {direction === 'over' ? <ArrowUpRight aria-hidden="true" className="h-4 w-4" strokeWidth={2} /> : direction === 'short' ? <ArrowDownRight aria-hidden="true" className="h-4 w-4" strokeWidth={2} /> : <Equal aria-hidden="true" className="h-4 w-4" strokeWidth={2} />}
                  <span className="num">{formatMinorRiyal(Math.abs(difference))}</span>
                  <span className="text-sm font-semibold">{t(`settlement.reference.${direction === 'short' ? 'short' : direction === 'over' ? 'over' : 'match'}`)}</span>
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}

      {finance && preview.allocation && preview.variances ? (
        <div data-settlement-allocation="">
          <h3 className="text-sm font-semibold text-text">{t('settlement.allocation.title')}</h3>
          {preview.allocation.rows.length === 0 && preview.variances.shortage_minor === 0 && preview.variances.surplus.length === 0 && preview.variances.held_for_withheld.length === 0 ? (
            <p className="mt-1 text-sm text-muted">{t('settlement.allocation.empty')}</p>
          ) : (
            <ul className="mt-1 divide-y divide-border text-sm">
              {preview.allocation.rows.map((row, index) => (
                <li key={`${row.payment_method_id}-${row.target_ref}-${index}`} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="min-w-0"><span className="font-medium text-text">{row.method ?? '—'}</span><span className="block text-xs text-muted">{row.target_kind === 'erp_walk_in' ? t('settlement.allocation.toRecorded') : t('settlement.allocation.toRemaining')}</span></span>
                  <span className="num shrink-0 font-semibold text-text">{formatMinorRiyal(row.amount_minor)}</span>
                </li>
              ))}
              {preview.variances.shortage_minor > 0 ? <li className="flex items-baseline justify-between gap-3 py-2 text-warning" data-settlement-shortage=""><span>{t('settlement.allocation.shortage')}</span><span className="num font-semibold">{formatMinorRiyal(preview.variances.shortage_minor)}</span></li> : null}
              {preview.variances.surplus.map((row) => <li key={`s-${row.payment_method_id}`} className="flex items-baseline justify-between gap-3 py-2 text-warning" data-settlement-surplus=""><span>{t('settlement.allocation.surplus')} · {row.method ?? '—'}</span><span className="num font-semibold">{formatMinorRiyal(row.amount_minor)}</span></li>)}
              {preview.variances.held_for_withheld.map((row) => <li key={`h-${row.payment_method_id}`} className="flex items-baseline justify-between gap-3 py-2 text-muted" data-settlement-held=""><span>{t('settlement.allocation.held')} · {row.method ?? '—'}</span><span className="num font-semibold">{formatMinorRiyal(row.amount_minor)}</span></li>)}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
