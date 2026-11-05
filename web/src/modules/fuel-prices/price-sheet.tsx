'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/formatting';
import { formatMinorRiyal, minorToRiyal } from '@/lib/money';
import { createPrice, PricesError } from './client';
import type { CreateResult, EffectiveRow, PriceScope, SuggestionRow } from './contract';
import { buildPayload, currentInScope, newIdempotencyKey, parsePriceInput, parseScheduled, rejectionKey, type StartMode } from './price-form';
import { describeRow, describeSuggestion, needsSupersede } from './row-view';

export interface PriceSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'manual' | 'suggestion';
  scope: PriceScope;
  scopeLabel: string;
  timeZone: string | null;
  productName: string;
  fuelProductId: string;
  row: EffectiveRow | undefined;
  suggestion: SuggestionRow | undefined;
  /** يُستدعى بعد حفظ ناجح، أو عند حالة قد تكون قديمة (رفض/انقطاع) ليُعاد جلب اللوحة من الخادم. */
  onChanged: (result: CreateResult | null) => void;
}

type Step = 'form' | 'review';

const field = 'block min-h-12 w-full rounded-xl border border-border bg-surface px-4 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

export function PriceSheet(props: PriceSheetProps) {
  const { open, onOpenChange, mode, scope, scopeLabel, timeZone, productName, fuelProductId, row, suggestion, onChanged } = props;
  const t = useTranslations('fuelPrices');
  const locale = useLocale();
  const { success } = useToast();

  const view = describeRow(row);
  const sug = describeSuggestion(suggestion);
  const sugAvail = mode === 'suggestion' && sug.kind === 'available' ? sug : null;
  const fromSuggestion = sugAvail !== null;
  const taxMode = sugAvail ? sugAvail.taxMode : view.kind === 'known' || view.kind === 'not_configured' ? view.taxMode : null;
  const current = currentInScope(row, scope);

  const [step, setStep] = useState<Step>('form');
  const [priceText, setPriceText] = useState('');
  const [start, setStart] = useState<StartMode>({ kind: 'now' });
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const [ackReplace, setAckReplace] = useState(false);
  const [ackUnit, setAckUnit] = useState(false);
  const [ackTax, setAckTax] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ key: string; detail?: string } | null>(null);
  const savingRef = useRef(false);
  const keyRef = useRef<string>('');

  // فتح الورقة = محاولة منطقية جديدة: حالة نظيفة ومفتاح تكرار جديد.
  useEffect(() => {
    if (!open) return;
    setStep('form');
    setPriceText(sugAvail ? minorToRiyal(sugAvail.minor) : '');
    setStart({ kind: 'now' });
    setNote('');
    setTouched(false);
    setAckReplace(false);
    setAckUnit(false);
    setAckTax(false);
    setSaving(false);
    setError(null);
    savingRef.current = false;
    keyRef.current = newIdempotencyKey();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const touch = () => { keyRef.current = newIdempotencyKey(); setError(null); };

  const parsed = parsePriceInput(priceText);
  const nowMs = Date.now();
  const scheduled = start.kind === 'scheduled' ? parseScheduled(start.localValue, nowMs) : null;
  const startMs = scheduled?.ok ? Date.parse(scheduled.iso) : nowMs;
  const supersede = needsSupersede(current, startMs);
  const priceError = !parsed.ok && (touched || priceText !== '') ? parsed.error : null;
  const scheduleError = scheduled && !scheduled.ok ? scheduled.error : null;
  const formValid = parsed.ok && scheduleError === null && taxMode !== null && (!sugAvail || parsed.minor === sugAvail.minor);
  const reviewReady = formValid && (!supersede || ackReplace) && (!fromSuggestion || (ackUnit && ackTax));

  const startLabel = useMemo(
    () => (start.kind === 'now' ? t('sheet.startNowValue') : scheduled?.ok ? formatDateTime(scheduled.iso, locale, { timeZone: timeZone ?? undefined }) : '—'),
    [start, scheduled, t, locale, timeZone],
  );

  async function save() {
    if (savingRef.current || !parsed.ok || taxMode === null) return; // قفل ضغطتين
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await createPrice(
        buildPayload({
          scope,
          fuelProductId,
          minor: parsed.minor,
          start,
          scheduledIso: scheduled?.ok ? scheduled.iso : undefined,
          note,
          supersede,
          suggestion: sugAvail ? { tax_mode: sugAvail.taxMode } : null,
          idempotencyKey: keyRef.current,
        }),
      );
      success(t(result.meta.replayed ? 'sheet.savedReplay' : 'sheet.saved'));
      onChanged(result);
      onOpenChange(false);
    } catch (caught) {
      const err = caught instanceof PricesError ? caught : new PricesError('offline');
      if (err.kind === 'rejected') {
        setError({ key: rejectionKey(err.reason) });
        onChanged(null); // رفض بسبب حالة قديمة غالباً (تعارض/اقتراح تغيّر): أعد قراءة الخادم
      } else if (err.kind === 'forbidden') setError({ key: 'forbidden' });
      else if (err.kind === 'timeout' || err.kind === 'offline') {
        // لا نعرف إن حُفظ: المفتاح يبقى نفسه فتكرار الضغط آمن، ونعيد قراءة الخادم لنرى الحقيقة.
        setError({ key: err.kind === 'timeout' ? 'timeout' : 'offline' });
        onChanged(null);
      } else setError({ key: 'generic' });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const taxText = taxMode === 'tax_inclusive' ? t('card.taxInclusive') : taxMode === 'tax_exclusive' ? t('card.taxExclusive') : t('card.taxUnset');

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <SheetContent closeLabel={t('close')} className="pb-[env(safe-area-inset-bottom)]">
        <div className="border-b border-border px-5 pb-4 pt-5 pe-14">
          <SheetTitle className="text-lg font-semibold text-text">{t(fromSuggestion ? 'sheet.titleSuggestion' : 'sheet.title', { product: productName })}</SheetTitle>
          <SheetDescription className="mt-1 text-sm text-muted">{scopeLabel}</SheetDescription>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {step === 'form' ? (
            <>
              {view.kind === 'known' ? (
                <div className="rounded-xl bg-primary-soft px-4 py-3 text-sm">
                  <p className="text-muted">{t('sheet.currentPrice')}</p>
                  <p className="mt-0.5 text-base font-semibold text-text">
                    <span className="num">{formatMinorRiyal(view.minor)}</span> <span className="text-xs font-normal text-muted">{t('card.perLiter')}</span>
                    <span className="ms-2 text-xs font-normal text-muted">{view.scope === 'station' ? t('card.sourceStation') : t('card.sourceTenant')}</span>
                  </p>
                </div>
              ) : null}

              {taxMode === null ? (
                <p role="alert" className="flex items-start gap-2 rounded-xl border border-warning/40 bg-[color:var(--fo-warning-tint,transparent)] px-4 py-3 text-sm text-warning">
                  <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
                  {t('sheet.taxUnsetBlock')}
                </p>
              ) : null}

              <div>
                <label htmlFor="fp-price" className="mb-1.5 block text-sm font-medium text-text">{t('sheet.priceLabel')}</label>
                <div className="relative" dir="ltr">
                  <input
                    id="fp-price"
                    inputMode="decimal"
                    autoComplete="off"
                    dir="ltr"
                    lang="en"
                    placeholder="0.00"
                    className={`${field} num pr-28 text-left text-2xl font-semibold`}
                    value={priceText}
                    readOnly={fromSuggestion}
                    aria-invalid={priceError !== null}
                    aria-describedby="fp-price-hint"
                    onChange={(event) => { setPriceText(event.target.value); setTouched(true); touch(); }}
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-muted" dir={locale === 'ar' ? 'rtl' : 'ltr'}>{t('sheet.priceUnit')}</span>
                </div>
                <p id="fp-price-hint" className={`mt-1.5 text-xs ${priceError ? 'text-negative' : 'text-muted'}`}>
                  {priceError ? t(`sheet.priceError.${priceError}`) : fromSuggestion ? t('sheet.priceFromCard') : t('sheet.priceHint')}
                </p>
              </div>

              <div className="rounded-xl border border-border px-4 py-3 text-sm">
                <p className="font-medium text-text">{t('sheet.taxTitle')}: <span className="font-semibold">{taxText}</span></p>
                <p className="mt-1 text-xs leading-5 text-muted">{t('sheet.taxExplain')}</p>
              </div>

              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-text">{t('sheet.startLabel')}</legend>
                <div className="grid grid-cols-2 gap-2" role="radiogroup">
                  {(['now', 'scheduled'] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      role="radio"
                      aria-checked={start.kind === kind}
                      onClick={() => { setStart(kind === 'now' ? { kind: 'now' } : { kind: 'scheduled', localValue: start.kind === 'scheduled' ? start.localValue : '' }); touch(); }}
                      className={`min-h-12 rounded-xl border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${start.kind === kind ? 'border-primary bg-primary-soft text-primary' : 'border-border text-text'}`}
                    >
                      {kind === 'now' ? t('sheet.startNow') : t('sheet.startScheduled')}
                    </button>
                  ))}
                </div>
                {start.kind === 'scheduled' ? (
                  <div className="mt-2">
                    <input
                      type="datetime-local"
                      dir="ltr"
                      lang="en"
                      aria-label={t('sheet.scheduledAt')}
                      className={`${field} num`}
                      value={start.localValue}
                      onChange={(event) => { setStart({ kind: 'scheduled', localValue: event.target.value }); touch(); }}
                    />
                    {scheduleError ? <p className="mt-1.5 text-xs text-negative">{t(`sheet.scheduleError.${scheduleError}`)}</p> : null}
                  </div>
                ) : (
                  <p className="mt-1.5 text-xs text-muted">{t('sheet.startNowHint')}</p>
                )}
              </fieldset>

              <div>
                <label htmlFor="fp-note" className="mb-1.5 block text-sm font-medium text-text">{t('sheet.noteLabel')}</label>
                <textarea id="fp-note" rows={2} maxLength={500} className={`${field} py-3`} placeholder={t('sheet.notePlaceholder')} value={note} onChange={(event) => { setNote(event.target.value); touch(); }} />
              </div>
            </>
          ) : (
            <>
              <h3 className="text-sm font-semibold text-text">{t('sheet.reviewTitle')}</h3>
              <dl className="divide-y divide-border rounded-xl border border-border text-sm">
                {[
                  [t('sheet.rvProduct'), <bdi key="p">{productName}</bdi>],
                  [t('sheet.rvScope'), scopeLabel],
                  [t('sheet.rvPrice'), parsed.ok ? <span key="v"><span className="num" dir="ltr">{formatMinorRiyal(parsed.minor)}</span> {t('card.perLiter')}</span> : '—'],
                  [t('sheet.rvTax'), taxText],
                  [t('sheet.rvStart'), start.kind === 'now' ? startLabel : <span key="s" className="num" dir="ltr">{startLabel}</span>],
                  ...(fromSuggestion ? [[t('sheet.rvSource'), t('sheet.rvSourceCard')]] : []),
                ].map(([label, value]) => (
                  <div key={String(label)} className="flex items-start justify-between gap-4 px-4 py-3">
                    <dt className="shrink-0 text-muted">{label}</dt>
                    <dd className="text-end font-medium text-text">{value}</dd>
                  </div>
                ))}
              </dl>

              {supersede && current ? (
                <div className="rounded-xl border border-warning/40 px-4 py-3 text-sm">
                  <p className="font-medium text-text">{t('sheet.replaceTitle')}</p>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    {t('sheet.replaceBody', { price: formatMinorRiyal(current.price_per_liter_minor), when: startLabel })}
                  </p>
                  <label className="mt-3 flex min-h-11 items-start gap-3 text-sm text-text">
                    <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={ackReplace} onChange={(event) => setAckReplace(event.target.checked)} />
                    <span>{t('sheet.replaceAck')}</span>
                  </label>
                </div>
              ) : view.kind === 'known' && view.scope === 'tenant' && scope.kind === 'station' ? (
                <p className="rounded-xl bg-primary-soft px-4 py-3 text-xs leading-5 text-muted">{t('sheet.overrideNote', { price: formatMinorRiyal(view.minor) })}</p>
              ) : null}

              {fromSuggestion ? (
                <div className="space-y-1 rounded-xl border border-border px-4 py-2">
                  <label className="flex min-h-11 items-start gap-3 py-1.5 text-sm text-text">
                    <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={ackUnit} onChange={(event) => setAckUnit(event.target.checked)} />
                    <span>{t('sheet.ackUnit')}</span>
                  </label>
                  <label className="flex min-h-11 items-start gap-3 py-1.5 text-sm text-text">
                    <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={ackTax} onChange={(event) => setAckTax(event.target.checked)} />
                    <span>{t('sheet.ackTax', { tax: taxText })}</span>
                  </label>
                </div>
              ) : null}
              <p className="text-xs leading-5 text-muted">{t('sheet.noRetroNote')}</p>
            </>
          )}

          {error ? (
            <p role="alert" className="flex items-start gap-2 rounded-xl border border-negative/40 px-4 py-3 text-sm text-negative">
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
              <span>{t(`errors.${error.key}`)}</span>
            </p>
          ) : null}
        </div>

        <div className="flex gap-3 border-t border-border bg-surface px-5 py-4">
          {step === 'review' ? (
            <button type="button" disabled={saving} onClick={() => { setStep('form'); setError(null); }} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border px-5 text-base font-medium text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">
              <ArrowLeft aria-hidden="true" className="h-4 w-4 rtl:rotate-180" strokeWidth={1.8} />
              {t('sheet.back')}
            </button>
          ) : null}
          {step === 'form' ? (
            <button type="button" disabled={!formValid} data-primary-action onClick={() => setStep('review')} className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl bg-primary px-5 text-base font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-40">
              {t('sheet.continue')}
            </button>
          ) : (
            <button type="button" disabled={!reviewReady || saving} aria-busy={saving} data-primary-action onClick={() => void save()} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-base font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-40">
              {saving ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <CheckCircle2 aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />}
              {saving ? t('sheet.saving') : t(fromSuggestion ? 'sheet.confirmSuggestion' : 'sheet.confirm')}
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
