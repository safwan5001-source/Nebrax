'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowDownRight, ArrowUpRight, CircleAlert, CircleCheck, Equal, Info, Lock, TriangleAlert } from 'lucide-react';
import { SAUDI_RIYAL_SYMBOL, formatMinorRiyal } from '@/lib/money';
import {
  directionOf, intentPayload, isDirty, isKnownGap, isKnownNozzleStatus, parseInputs, previewDifference, previewDrawer, savedMatches, seedInputs,
  type CollectionMethod, type CollectionView, type Direction,
} from './collection';
import { useShiftCollection } from './data';
import { formatLitersFixedFromMl } from './format';
import type { IntentStore } from './intents';
import { Quantity } from './quantity';
import type { Station } from './schemas';
import { InlineNote, LoadingBlock } from './state-views';
import { opsWriteCollection, type WriteResult } from './write-client';
import { shouldClearIntentKey } from './write-outcome';
import { NumberField, SecondaryButton, SectionCard, WriteNotice } from './write-ui';

/**
 * إقرار تحصيل الوردية — مبيعات العدادات × السعر الفعّال ↔ ما حُصِّل حسب طريقة الدفع.
 *
 * - **كل رقم من الخادم**: الكميات والأسعار والمبيعات والفرق. المعاينة المحلية (الفرق/الدرج) تُحسب من مدخلات المستخدم وأرقام الخادم نفسها
 *   وتُعنوَن «معاينة»؛ الخادم يعيد حسابها عند الحفظ ويجمّدها عند التسليم.
 * - **لا مبلغ غير موثوق**: القراءة الناقصة/الشاذة أو سعر غير متاح ⇒ «غير متاح» بسببه، لا رقم جزئي كإجمالي ولا فرق نهائي.
 * - **تشغيلي فقط**: لا سند قبض ولا فاتورة ولا قيد. المطابقة ليست إثباتاً لتحصيل مالي مسجَّل، والبيع الآجل والتسويات غير المسجّلة غير محتسبة.
 * - البوابة مغلقة (404) ⇒ لا شيء يُعرض والشاشة كما كانت حرفياً.
 */

type Translate = ReturnType<typeof useTranslations>;

export interface CollectionStatus {
  enabled: boolean;
  /** يوجد إقرار محفوظ للوردية. */
  saved: boolean;
  /** المدخلات الحالية تختلف عن المحفوظ (أو لا إقرار بعد). */
  dirty: boolean;
}

function DirectionBadge({ difference }: { difference: number }) {
  const t = useTranslations('stationOps');
  const direction: Direction = directionOf(difference);
  const Icon = direction === 'overage' ? ArrowUpRight : direction === 'shortage' ? ArrowDownRight : Equal;
  return (
    <span className="inline-flex items-center gap-1.5 text-base font-bold text-text" data-collection-direction={direction}>
      <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
      <span className="num">{formatMinorRiyal(Math.abs(difference))}</span>
      <span className="text-sm font-semibold">{t(`collection.recon.direction.${direction}`)}</span>
    </span>
  );
}

function gapText(t: Translate, code: string): string {
  return isKnownGap(code) ? t(`collection.gap.${code}`) : t('collection.gap.unknown');
}

function methodName(method: { name: string; name_en?: string | null }, locale: string): string {
  return locale === 'en' && method.name_en ? method.name_en : method.name;
}

function Disclaimers({ view }: { view: CollectionView }) {
  const t = useTranslations('stationOps');
  const known = ['operational_not_financial_proof', 'credit_sales_excluded', 'unrecorded_settlements_excluded'] as const;
  const items = known.filter((code) => view.disclaimers.includes(code));
  if (items.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1.5 border-t border-border pt-3" data-collection-disclaimers="">
      {items.map((code) => (
        <li key={code} className="flex items-start gap-2 text-xs leading-5 text-muted"><Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />{t(`collection.disclaimer.${code}`)}</li>
      ))}
    </ul>
  );
}

/** مبيعات العدادات: لترات + مبلغ (إن اكتمل وكان مرئياً) + تفصيل المنتجات + ثغرات. */
function SalesBlock({ view }: { view: CollectionView }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const sales = view.sales;
  const problemNozzles = sales.nozzles.filter((n) => n.status !== 'ok' && n.status !== 'no_movement');
  return (
    <div data-collection-sales={sales.complete ? 'complete' : 'incomplete'}>
      <h3 className="text-sm font-semibold text-text">{t('collection.sales.title')}</h3>
      <dl className="mt-1 divide-y divide-border text-sm">
        <div className="flex items-baseline justify-between gap-3 py-2.5">
          <dt className="text-muted">{t('collection.sales.liters')}</dt>
          <dd className="text-base font-semibold text-text" data-collection-liters="">
            <Quantity value={formatLitersFixedFromMl(sales.milliliters, locale)} unit={t('unit.liter')} />
            {!sales.milliliters_complete ? <span className="ms-1 text-xs font-normal text-warning">{t('collection.sales.partial')}</span> : null}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 py-2.5">
          <dt className="text-muted">{t('collection.sales.amount')}</dt>
          <dd className="text-base font-bold text-text" data-collection-sales-amount="">
            {!sales.visible
              ? <span className="text-sm font-normal text-muted">{t('collection.sales.hidden')}</span>
              : sales.amount_minor === null
                ? <span className="text-sm font-normal text-muted">{t('collection.sales.unavailable')}</span>
                : <span className="num">{formatMinorRiyal(sales.amount_minor)}</span>}
          </dd>
        </div>
      </dl>

      {sales.visible && sales.products.length > 0 ? (
        <ul className="mt-1 divide-y divide-border" data-collection-products="">
          {sales.products.map((product) => (
            <li key={product.fuel_product_id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium text-text">{product.name ?? t('notSet')}</span>
                <span className="block text-xs text-muted">
                  <Quantity value={formatLitersFixedFromMl(product.milliliters, locale)} unit={t('unit.liter')} />
                  {product.price_per_liter_minor != null ? <> · <span className="num">{formatMinorRiyal(product.price_per_liter_minor)}</span> {t('collection.sales.perLiter')}</> : null}
                </span>
              </span>
              <span className="num shrink-0 font-semibold text-text">{product.amount_minor != null ? formatMinorRiyal(product.amount_minor) : <span className="text-xs font-normal text-muted">{t('collection.sales.unavailableShort')}</span>}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {sales.gaps.length > 0 ? (
        <ul className="mt-2 space-y-1.5" data-collection-gaps="">
          {sales.gaps.map((code) => (
            <li key={code} className="flex items-start gap-2 text-sm leading-6 text-warning"><TriangleAlert aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" strokeWidth={1.8} />{gapText(t, code)}</li>
          ))}
        </ul>
      ) : null}
      {problemNozzles.length > 0 ? (
        <ul className="mt-1 space-y-1" data-collection-nozzles="">
          {problemNozzles.map((nozzle) => (
            <li key={nozzle.nozzle_id} className="text-xs text-muted">{t('collection.nozzle', { number: nozzle.nozzle_number })}: {isKnownNozzleStatus(nozzle.status) ? t(`collection.nozzleStatus.${nozzle.status}`) : t('collection.nozzleStatus.unknown')}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** نقد الدرج مفصولاً: العهدة، المسلَّم للخزنة، المعدود، ونقد المبيعات الذي يدلّ عليه الدرج. */
function DrawerBlock({ view, countedMinor, cashDeclaredMinor }: { view: CollectionView; countedMinor: number | null; cashDeclaredMinor: number | null }) {
  const t = useTranslations('stationOps');
  const drawer = view.drawer;
  const counted = drawer.frozen ? drawer.counted_cash_minor : countedMinor;
  const preview = previewDrawer(view, countedMinor, cashDeclaredMinor);
  const implied = drawer.frozen ? (drawer.implied_sales_cash.amount_minor ?? null) : (preview?.impliedSalesCashMinor ?? null);
  const cross = drawer.frozen ? (drawer.implied_sales_cash.declared_difference_minor ?? null) : (preview?.crossDifferenceMinor ?? null);
  return (
    <div data-collection-drawer={drawer.frozen ? 'frozen' : 'live'}>
      <h3 className="text-sm font-semibold text-text">{t('collection.drawer.title')}</h3>
      <dl className="mt-1 divide-y divide-border text-sm">
        <div className="flex items-baseline justify-between gap-3 py-2.5"><dt className="text-muted">{t('collection.drawer.opening')}</dt><dd className="num font-semibold text-text" data-drawer-opening="">{formatMinorRiyal(drawer.opening_float_minor)}</dd></div>
        <div className="flex items-baseline justify-between gap-3 py-2.5"><dt className="text-muted">{t('collection.drawer.handover')}</dt><dd className="num font-semibold text-text" data-drawer-handover="">{formatMinorRiyal(drawer.treasury_handover_minor)}</dd></div>
        <div className="flex items-baseline justify-between gap-3 py-2.5">
          <dt className="text-muted">{t('collection.drawer.counted')}</dt>
          <dd className="font-semibold text-text" data-drawer-counted="">{counted === null ? <span className="text-sm font-normal text-muted">{t('collection.drawer.countedMissing')}</span> : <span className="num">{formatMinorRiyal(counted)}</span>}</dd>
        </div>
        {drawer.implied_sales_cash.visible ? (
          <>
            <div className="flex items-baseline justify-between gap-3 py-2.5"><dt className="text-muted">{drawer.frozen ? t('collection.drawer.implied') : t('collection.drawer.impliedPreview')}</dt><dd className="font-semibold text-text" data-drawer-implied="">{implied === null ? '—' : <span className="num">{formatMinorRiyal(implied)}</span>}</dd></div>
            <div className="flex items-baseline justify-between gap-3 py-2.5"><dt className="text-muted">{t('collection.drawer.cross')}</dt><dd className="font-semibold text-text" data-drawer-cross="">{cross === null ? '—' : <DirectionBadge difference={cross} />}</dd></div>
          </>
        ) : null}
      </dl>
      {drawer.implied_sales_cash.visible ? <p className="mt-1 text-xs leading-5 text-muted">{t('collection.drawer.note')}</p> : null}
    </div>
  );
}

/** عرض للقراءة فقط (تفاصيل الوردية للمشرف، وبعد التسليم): الإقرار المحفوظ أو المجمَّد، المبيعات، المطابقة، الدرج. */
export function CollectionReadOnly({ view }: { view: CollectionView }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const declaration = view.declaration;
  const frozen = view.state === 'frozen';
  const recon = view.reconciliation;
  return (
    <section aria-labelledby="fo-collection-ro-h" data-collection-readonly={view.state} className="space-y-4 rounded-[14px] border border-border bg-surface p-4">
      <div>
        <h2 id="fo-collection-ro-h" className="text-base font-semibold text-text">{t('collection.title')}</h2>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs leading-5 text-muted">{frozen ? <Lock aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} /> : null}{frozen ? t('collection.frozen') : t('collection.live')}</p>
      </div>
      <SalesBlock view={view} />
      <div>
        <h3 className="text-sm font-semibold text-text">{t('collection.entry.title')}</h3>
        {declaration === null ? (
          <p className="mt-1 text-sm text-muted" data-collection-none="">{t('collection.none')}</p>
        ) : (
          <ul className="mt-1 divide-y divide-border" data-collection-lines="">
            {declaration.lines.map((line) => (
              <li key={line.payment_method_id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 font-medium text-text">{methodName(line, locale)}<span className="ms-2 text-xs font-normal text-muted">{line.settlement_type === 'cash' ? t('collection.entry.type.cash') : t('collection.entry.type.bank')}</span></span>
                <span className="num shrink-0 font-semibold text-text">{formatMinorRiyal(line.amount_minor)}</span>
              </li>
            ))}
            <li className="flex items-baseline justify-between gap-3 py-2 text-sm"><span className="font-semibold text-text">{t('collection.entry.total')}</span><span className="num font-bold text-text" data-collection-total="">{formatMinorRiyal(declaration.collected_total_minor)}</span></li>
          </ul>
        )}
      </div>
      {declaration !== null ? (
        <div data-collection-recon="">
          <h3 className="text-sm font-semibold text-text">{t('collection.recon.title')}</h3>
          <div className="mt-1 text-sm">
            {!recon.visible ? <span className="text-muted">{t('collection.recon.hidden')}</span>
              : recon.final && recon.difference_minor !== null ? <DirectionBadge difference={recon.difference_minor} />
              : <span className="text-warning">{t('collection.recon.notFinal')}</span>}
          </div>
        </div>
      ) : null}
      {declaration !== null ? <DrawerBlock view={view} countedMinor={null} cashDeclaredMinor={null} /> : null}
      <Disclaimers view={view} />
    </section>
  );
}

/** قسم الإدخال في شاشة تسليم الوردية. */
export function CollectionEntrySection({ station, shiftId, countedMinor, intents, onStatus }: {
  station: Station;
  shiftId: string;
  /** النقد المعدود المُدخل في خطوة التسليم (للمعاينة فقط). */
  countedMinor: number | null;
  intents: IntentStore;
  onStatus?: (status: CollectionStatus) => void;
}) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const { state, retained, reload } = useShiftCollection(station, shiftId, { autoRefresh: true });
  const [override, setOverride] = useState<{ view: CollectionView; base: CollectionView | null } | null>(null);
  const queried = state.status === 'success' ? state.data : retained;
  const view = override && (state.status !== 'success' || state.data === override.base) ? override.view : queried;

  const [raw, setRaw] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<WriteResult | null>(null);
  const [savedNote, setSavedNote] = useState<'saved' | 'unchanged' | null>(null);
  const [methodsNotice, setMethodsNotice] = useState(false);
  const sending = useRef(false);
  const previousIds = useRef<string | null>(null);

  // الحقول تُزرع مرة واحدة من آخر إقرار محفوظ؛ لا يغيّر التحديث التلقائي ما كتبه المستخدم.
  useEffect(() => {
    if (view && raw === null) setRaw(seedInputs(view.methods));
  }, [view, raw]);

  // تنبيه تغيّر قائمة الطرق (تفعيل/تعطيل من إعدادات المحطة) بين جلبين.
  const idsKey = view ? view.methods.map((m) => m.id).sort().join(',') : null;
  useEffect(() => {
    if (idsKey === null) return;
    if (previousIds.current !== null && previousIds.current !== idsKey) setMethodsNotice(true);
    previousIds.current = idsKey;
  }, [idsKey]);

  const methods: readonly CollectionMethod[] = useMemo(() => view?.methods ?? [], [view]);
  const parsed = useMemo(() => parseInputs(methods, raw ?? {}), [methods, raw]);
  const dirty = view ? isDirty(view, parsed) : false;

  useEffect(() => {
    if (!onStatus) return;
    onStatus({ enabled: view !== null, saved: view?.declaration != null, dirty: view !== null && dirty });
  }, [onStatus, view, dirty]);

  // 404 (البوابة مغلقة) أو لا صلاحية قراءة: لا قسم، والشاشة كما كانت.
  if (view === null) {
    if (state.status === 'loading') return <SectionCard title={t('collection.title')} id="collection-h"><LoadingBlock rows={2} /></SectionCard>;
    if (state.status === 'error' && state.error.kind !== 'not_found' && state.error.kind !== 'forbidden') {
      return (
        <SectionCard title={t('collection.title')} id="collection-h">
          <InlineNote tone="warning">{t('collection.loadFailed')}</InlineNote>
          <div className="mt-2"><SecondaryButton onClick={reload}>{t('retry')}</SecondaryButton></div>
        </SectionCard>
      );
    }
    return null;
  }
  if (view.state === 'frozen') return <CollectionReadOnly view={view} />;

  const preview = previewDifference(view, parsed.total);
  const recon = view.reconciliation;

  const submit = async () => {
    if (sending.current || !parsed.lines || busy) return;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    setSavedNote(null);
    try {
      const lines = parsed.lines;
      const key = intents.keyFor('collection', intentPayload(shiftId, view.revision, lines));
      // قبل الإرسال: الطلب الجاري قد يلتزم والصفحة تُغلق — النية غير مؤكدة (ومحفوظة) حتى تُحسم.
      const priorUncertain = intents.isUncertain('collection');
      intents.markUncertain('collection');
      const result = await opsWriteCollection(shiftId, { idempotency_key: key, base_revision: view.revision, lines }, { branchId: station.branch_id });
      if (result.kind === 'ok' && savedMatches(result.view, lines)) {
        intents.clear('collection');
        setOverride({ view: result.view, base: state.status === 'success' ? state.data : null });
        setSavedNote(result.unchanged ? 'unchanged' : 'saved');
        setMethodsNotice(false);
        reload();
        return;
      }
      if (result.kind === 'rejected' && ['collection_stale_revision', 'collection_methods_changed', 'collection_method_not_allowed', 'shift_not_open'].includes(result.code)) reload();
      if (shouldClearIntentKey(result as WriteResult, priorUncertain)) intents.clear('collection');
      setFailure(result.kind === 'ok' ? { kind: 'unverified' } : result);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <SectionCard title={t('collection.title')} id="collection-h">
      <div className="space-y-5" data-collection="">
        <p className="text-sm leading-6 text-muted">{t('collection.subtitle')}</p>
        <SalesBlock view={view} />

        <div data-collection-entry="">
          <h3 className="text-sm font-semibold text-text">{t('collection.entry.title')}</h3>
          <p className="mt-0.5 text-xs leading-5 text-muted">{t('collection.entry.hint')}</p>
          {methodsNotice ? <div className="mt-2" role="status" data-methods-updated=""><InlineNote tone="warning">{t('collection.entry.methodsUpdated')}</InlineNote></div> : null}
          {view.methods_changed && !methodsNotice ? <div className="mt-2" data-methods-changed=""><InlineNote tone="warning">{t('collection.entry.methodsChangedSaved')}</InlineNote></div> : null}
          {methods.length === 0 ? (
            <div className="mt-2" data-no-methods=""><InlineNote tone="warning">{t('collection.entry.noMethods')}</InlineNote></div>
          ) : (
            <div className="mt-3 space-y-3">
              {methods.map((method) => {
                const issue = parsed.issues[method.id];
                return (
                  <NumberField
                    key={method.id}
                    label={`${methodName(method, locale)} · ${method.settlement_type === 'cash' ? t('collection.entry.type.cash') : t('collection.entry.type.bank')}`}
                    value={raw?.[method.id] ?? ''}
                    onChange={(value) => { setRaw((current) => ({ ...(current ?? {}), [method.id]: value })); setFailure(null); setSavedNote(null); }}
                    suffix={SAUDI_RIYAL_SYMBOL}
                    error={issue === 'invalid' ? t('collection.entry.invalid') : null}
                    disabled={busy}
                    testId={`collection-amount-${method.id}`}
                  />
                );
              })}
            </div>
          )}
          <dl className="mt-3 divide-y divide-border text-sm">
            <div className="flex items-baseline justify-between gap-3 py-2.5"><dt className="font-medium text-text">{t('collection.entry.total')}</dt><dd className="num text-base font-bold text-text" data-collection-total="">{parsed.total === null ? '—' : formatMinorRiyal(parsed.total)}</dd></div>
          </dl>
          {parsed.total === null && methods.length > 0 ? <p className="mt-1 text-xs text-muted">{t('collection.entry.required')}</p> : null}
        </div>

        <div data-collection-recon="">
          <h3 className="text-sm font-semibold text-text">{t('collection.recon.title')}</h3>
          <div className="mt-1 text-sm">
            {!recon.visible ? (
              <span className="text-muted">{t('collection.recon.hidden')}</span>
            ) : preview.final && preview.differenceMinor !== null ? (
              <div>
                <DirectionBadge difference={preview.differenceMinor} />
                <p className="mt-1 text-xs text-muted">{dirty ? t('collection.recon.previewUnsaved') : t('collection.recon.saved')}</p>
              </div>
            ) : parsed.total === null ? (
              <span className="text-muted">{t('collection.recon.needInputs')}</span>
            ) : (
              <span className="text-warning" data-recon-not-final="">{t('collection.recon.notFinal')}</span>
            )}
          </div>
        </div>

        <DrawerBlock view={view} countedMinor={countedMinor} cashDeclaredMinor={parsed.cashTotal} />

        <WriteNotice result={failure} onCheck={reload} />
        {savedNote ? (
          <p role="status" data-collection-saved={savedNote} className="flex items-center gap-2 text-sm font-medium text-positive"><CircleCheck aria-hidden="true" className="h-4 w-4" strokeWidth={2} />{savedNote === 'saved' ? t('collection.saved', { revision: String(view.revision) }) : t('collection.unchanged')}</p>
        ) : null}
        {dirty && !savedNote && view.declaration !== null ? <p className="flex items-start gap-2 text-sm text-warning" data-collection-dirty=""><CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} />{t('collection.dirty')}</p> : null}
        <SecondaryButton disabled={!parsed.lines || busy || methods.length === 0 || !dirty} onClick={() => void submit()} data-save-collection="">{busy ? t('collection.saving') : t('collection.save')}</SecondaryButton>
        <Disclaimers view={view} />
      </div>
    </SectionCard>
  );
}

/** مُحمِّل القراءة فقط: يُعرض عند نجاح القراءة وحده؛ البوابة مغلقة (404)/لا صلاحية/فشل ⇒ لا شيء (الشاشة كما كانت). */
export function CollectionDetailSection({ station, shiftId }: { station: Station; shiftId: string }) {
  const { state, retained } = useShiftCollection(station, shiftId);
  const view = state.status === 'success' ? state.data : retained;
  return view ? <CollectionReadOnly view={view} /> : null;
}
