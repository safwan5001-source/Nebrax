'use client';

import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Tag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useHorizontalOverflow } from '@/components/platform/use-horizontal-overflow';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ApiError } from '@/lib/api';
import { formatMinorRiyal, formatRiyal, isValidRiyal, riyalToMinor } from '@/lib/money';
import { isPlatformAuthenticated } from '@/lib/platform-auth';
import { platformApi } from '@/lib/platform-api';
import { classifyPriceVersions, isDuplicateVersion, nextScheduled, previewOutcome, todayIsoDate, type PriceClassification, type PriceStatus } from './price-status';
import { useToday } from './use-today';

const PLANS = ['free', 'basic', 'pro', 'enterprise'] as const;

interface PriceVersion {
  id: string;
  plan: string;
  currency: string;
  monthly_amount: string;
  monthly_amount_minor: number;
  effective_on: string | null;
  created_at: string | null;
}

type T = (key: string, values?: Record<string, string | number>) => string;

/** التواريخ والمبالغ تُعزل اتجاهياً: في صفحة RTL يقلب محرك الاتجاه تسلسل 2026-03-26 إلى 26-03-2026. */
function Ltr({ children }: { children: React.ReactNode }) {
  return <bdi dir="ltr">{children}</bdi>;
}

const STATUS_KEY: Record<PriceStatus, string> = {
  current: 'statusCurrent',
  scheduled: 'statusScheduled',
  superseded: 'statusSuperseded',
  unknown: 'statusUnknown',
};
const STATUS_TONE: Record<PriceStatus, 'positive' | 'warning' | 'muted'> = {
  current: 'positive',
  scheduled: 'warning',
  superseded: 'muted',
  unknown: 'muted',
};

function sortPrices(list: PriceVersion[]): PriceVersion[] {
  return [...list].sort((a, b) => a.plan.localeCompare(b.plan) || (b.effective_on ?? '').localeCompare(a.effective_on ?? ''));
}

export default function PlatformPricesPage() {
  const t = useTranslations('platformPrices') as T;
  const router = useRouter();
  const [prices, setPrices] = useState<PriceVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // true بعد أول جلب ناجح للكتالوج كاملاً. قبل ذلك لا يصحّ اشتقاق حالة نسخة من قائمة ناقصة.
  const [catalogueLoaded, setCatalogueLoaded] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<PriceVersion | null>(null);
  const [saving, setSaving] = useState(false);
  const [plan, setPlan] = useState('basic');
  const [monthlyPrice, setMonthlyPrice] = useState('');
  const [effectiveOn, setEffectiveOn] = useState(() => todayIsoDate());

  // رقم آخر طلب جلب: نتيجة طلب أقدم تُهمل كلياً فلا تمحو نسخة حُفظت بعد انطلاقه ولا تُظهر قائمة سابقة لها.
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await platformApi<{ data: PriceVersion[] }>('/platform/prices');
      if (seq !== loadSeq.current) return;
      setPrices(response.data);
      setCatalogueLoaded(true);
    } catch (reason) {
      if (seq !== loadSeq.current) return;
      setLoadError(reason instanceof ApiError ? reason.message : t('loadFailed'));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!isPlatformAuthenticated()) {
      router.replace('/platform/login');
      return;
    }
    load();
  }, [load, router]);

  const today = useToday();
  // H1-N1: the history table is the scroller; it needs a keyboard stop only while it really scrolls (large text, narrow widths).
  const [historyScrollRef, historyScrolls] = useHorizontalOverflow<HTMLDivElement>();
  const classification = useMemo(() => classifyPriceVersions(prices, today), [prices, today]);

  // نص المعاينة يُشتق من كتالوج طازج لا من مقارنة التاريخ باليوم وحده: نسخة بأثر رجعي خلف نسخة أحدث سارية «سابقة».
  // الكتالوج «طازج» حين يكتمل جلبه الأول ولا يجري جلب (بعد حفظ مثلاً) ولا يوجد خطأ جلب؛ وإلا فالقائمة المحلية قد
  // تسبق النسخة المحفوظة للتو، فلا يُجزم بشيء لتاريخ ماضٍ. التاريخ المستقبلي «مجدول» في كل الأحوال.
  const catalogueFresh = catalogueLoaded && !loading && !loadError;
  // الملخص والسجل يُعرضان من كتالوج طازج فقط: أثناء الجلب اللاحق للحفظ تظهر الهياكل بدل قائمة تسبق النسخة المحفوظة.
  const previewKey = !effectiveOn
    ? 'previewEffective'
    : !catalogueFresh
      ? effectiveOn > today ? 'previewScheduled' : 'previewUnverified'
      : ({ scheduled: 'previewScheduled', effective: 'previewEffective', superseded: 'previewSuperseded', duplicate: 'previewDuplicate' } as const)[
            previewOutcome(prices, { plan, currency: 'SAR', effective_on: effectiveOn }, today)
          ];

  // نسخة مكررة معروفة: بالمفتاح نفسه (الخطة، العملة، تاريخ النفاذ) في كتالوج مكتمل وحديث. هذا فحص للواجهة يمنع طلباً
  // محكوماً بالرفض؛ قيد التفرد في قاعدة البيانات يبقى المرجع (مدير آخر قد يضيف النسخة بعد جلب هذه التبويبة). وإن لم
  // يكتمل الكتالوج أو تعذّر تحديثه فلا نتيجة تحقق هنا، ويُترك القرار للخادم.
  const knownDuplicate = catalogueFresh && effectiveOn !== '' && isDuplicateVersion(prices, { plan, currency: 'SAR', effective_on: effectiveOn });

  const typedMinor = monthlyPrice.trim() === '' ? null : riyalToMinor(monthlyPrice);
  const amountValid = typedMinor !== null && isValidRiyal(monthlyPrice) && typedMinor >= 0;
  const amountInvalid = monthlyPrice.trim() !== '' && !amountValid;

  async function save(): Promise<void> {
    const amount = riyalToMinor(monthlyPrice);
    if (!isValidRiyal(monthlyPrice) || amount < 0) {
      setSaveError(t('invalidAmount'));
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaved(null);
    try {
      const response = await platformApi<{ data: PriceVersion }>('/platform/prices', {
        method: 'POST',
        body: { plan, currency: 'SAR', monthly_amount: amount, effective_on: effectiveOn },
      });
      setMonthlyPrice('');
      setSaved(response.data);
      // كل حفظ ناجح يعيد جلب الكتالوج كاملاً: مدير آخر قد يكون أضاف نسخاً بعد جلب هذه التبويبة، فلا تُشتق حالة
      // النسخة من قائمة محلية قديمة. لا تُدمج النسخة المُرجَعة محلياً؛ تظهر بالجلب فقط، فلا تُصنَّف حالتها إلا من قائمة تحتويها.
      void load();
    } catch (reason) {
      setSaveError(reason instanceof ApiError ? reason.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const planCodes = useMemo(() => {
    const extra = prices.map((price) => price.plan).filter((code) => !(PLANS as readonly string[]).includes(code));
    return [...PLANS, ...Array.from(new Set(extra))];
  }, [prices]);

  // حالة النسخة المحفوظة تُشتق من التصنيف نفسه المستخدم في السجل بعد إدراجها: نسخة بأثر رجعي خلف نسخة أحدث
  // سارية تظهر «سابقة» هنا أيضاً لا «سارية».
  const savedState = saved && catalogueLoaded ? classification.get(saved.id)?.status : undefined;
  const savedStatus =
    savedState === 'scheduled' ? 'savedScheduled' : savedState === 'current' ? 'savedEffective' : savedState === 'superseded' ? 'savedSuperseded' : null;

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex items-start gap-3">
        <Tag className="mt-0.5 h-6 w-6 shrink-0 text-primary" strokeWidth={1.7} aria-hidden="true" />
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
        </div>
      </header>

      <section aria-labelledby="prices-summary">
        <h2 id="prices-summary" className="mb-3 text-sm font-semibold text-text">{t('summaryTitle')}</h2>
        {loadError ? null : !catalogueFresh ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="prices-skeleton">
            {PLANS.map((code) => <Skeleton key={code} className="h-28" />)}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {planCodes.map((code) => (
                <PlanSummary key={code} plan={code} versions={prices.filter((price) => price.plan === code)} classification={classification} today={today} t={t} />
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted">{t('summaryNote')}</p>
          </>
        )}
      </section>

      <section aria-labelledby="prices-new">
        <Card>
          <CardHeader><CardTitle id="prices-new">{t('newPrice')}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-relaxed text-muted">{t('effectNote')}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-start">
              <div className="space-y-1.5">
                <label htmlFor="price-plan" className="block text-sm font-medium text-text">{t('plan')}</label>
                <Select id="price-plan" className="h-11" value={plan} onChange={(event) => setPlan(event.target.value)}>
                  {PLANS.map((item) => <option key={item} value={item}>{item}</option>)}
                </Select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="price-amount" className="block text-sm font-medium text-text">{t('monthlyPrice')}</label>
                <Input
                  id="price-amount"
                  className="h-11"
                  inputMode="decimal"
                  dir="ltr"
                  value={monthlyPrice}
                  onChange={(event) => setMonthlyPrice(event.target.value)}
                  aria-invalid={amountInvalid || undefined}
                  aria-describedby="price-amount-hint"
                />
                <p id="price-amount-hint" className={`text-xs ${amountInvalid ? 'text-negative' : 'text-muted'}`}>
                  {amountInvalid ? t('invalidAmount') : t('amountHint')}
                </p>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="price-effective" className="block text-sm font-medium text-text">{t('effectiveOn')}</label>
                <Input
                  id="price-effective"
                  className="h-11"
                  type="date"
                  dir="ltr"
                  value={effectiveOn}
                  onChange={(event) => setEffectiveOn(event.target.value)}
                  aria-invalid={knownDuplicate || undefined}
                  aria-describedby={knownDuplicate ? 'price-duplicate' : undefined}
                />
              </div>
              <div className="lg:pt-[1.625rem]">
                <Button className="h-11 w-full" onClick={save} disabled={saving || !monthlyPrice || !effectiveOn || knownDuplicate} aria-describedby={knownDuplicate ? 'price-duplicate' : undefined}>
                  {saving ? t('saving') : t('save')}
                </Button>
              </div>
            </div>

            {knownDuplicate && <p id="price-duplicate" className="text-sm text-negative">{t('duplicateBlocked')}</p>}
            {!catalogueFresh && effectiveOn !== '' && <p role="note" className="text-xs text-muted">{t('duplicateUnverified')}</p>}

            {amountValid && effectiveOn && (
              <div className="rounded border border-border bg-background p-3 text-sm" data-testid="price-preview">
                <p className="font-medium text-text">{t('previewTitle')}</p>
                <p className="mt-1 text-text">
                  <Ltr>{plan}</Ltr> · <Ltr>{formatMinorRiyal(typedMinor)}</Ltr> {t('monthlyWord')} · {t('effectiveWord')} <Ltr>{effectiveOn}</Ltr>
                </p>
                {!knownDuplicate && <p className="mt-1 text-xs text-muted">{t(previewKey)}</p>}
                <p className="num mt-1 text-xs text-muted" dir="ltr">{t('previewStored', { minor: typedMinor ?? 0 })}</p>
              </div>
            )}

            {saveError && <p className="text-sm text-negative" role="alert">{saveError}</p>}
            {saved && (
              <div className="rounded border border-positive/20 bg-positive/10 px-3 py-2 text-sm text-positive" role="status">
                <p>{t('saved')}</p>
                <p className="mt-1 text-xs">
                  <Ltr>{saved.plan}</Ltr> · <Ltr>{formatRiyal(saved.monthly_amount)}</Ltr> {t('monthlyWord')} · {t('effectiveWord')} <Ltr>{saved.effective_on ?? '—'}</Ltr> ·{' '}
                  {savedStatus === 'savedScheduled' ? <>{t('savedScheduled')} <Ltr>{saved.effective_on ?? '—'}</Ltr></> : savedStatus ? t(savedStatus) : null}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="prices-history">
        <Card>
          <CardHeader><CardTitle id="prices-history">{t('history')}</CardTitle></CardHeader>
          <CardContent>
            {loadError ? (
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-negative" role="alert">{loadError}</p>
                <Button variant="outline" className="h-11" onClick={load}>{t('retry')}</Button>
              </div>
            ) : !catalogueFresh ? (
              <Skeleton className="h-52 w-full" />
            ) : prices.length === 0 ? (
              <p className="text-sm text-muted">{t('empty')}</p>
            ) : (
              <div aria-busy={loading}>
                <div
                  ref={historyScrollRef}
                  {...(historyScrolls ? { role: 'region', tabIndex: 0, 'aria-label': t('historyScrollRegion') } : {})}
                  className="hidden overflow-x-auto rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:block"
                >
                  {/* This div is the single scroller; the Table wrapper must not scroll on its own (an inner scroller would hide the overflow from it). */}
                  <Table wrapperProps={{ className: 'overflow-x-visible' }}>
                    <THead>
                      <TR>
                        <TH>{t('plan')}</TH>
                        <TH>{t('statusColumn')}</TH>
                        <TH className="text-end">{t('price')}</TH>
                        <TH>{t('currency')}</TH>
                        <TH>{t('effectiveOn')}</TH>
                        <TH>{t('addedOn')}</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {prices.map((price) => (
                        <TR key={price.id}>
                          <TD className="font-medium">{price.plan}</TD>
                          <TD><StatusBadge info={classification.get(price.id)} t={t} /></TD>
                          <TD className="num text-end">{formatRiyal(price.monthly_amount)}</TD>
                          <TD className="num">{price.currency}</TD>
                          <TD className="num text-muted" dir="ltr">{price.effective_on ?? '—'}</TD>
                          <TD className="num text-muted" dir="ltr">{price.created_at?.slice(0, 10) ?? '—'}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
                <div className="space-y-3 md:hidden">
                  {prices.map((price) => (
                    <div key={price.id} className="rounded border border-border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-text">{price.plan}</p>
                        <p className="num text-text">{formatRiyal(price.monthly_amount)}</p>
                      </div>
                      <div className="mt-2"><StatusBadge info={classification.get(price.id)} t={t} /></div>
                      <p className="num mt-2 text-xs text-muted">
                        {price.currency} · <span dir="ltr">{price.effective_on ?? '—'}</span>
                        {price.created_at ? <> · {t('addedOn')} <span dir="ltr">{price.created_at.slice(0, 10)}</span></> : null}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs text-muted">{t('historyNote')}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function StatusBadge({ info, t }: { info: PriceClassification | undefined; t: T }) {
  const status = info?.status ?? 'unknown';
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Badge wrap tone={STATUS_TONE[status]}>{t(STATUS_KEY[status])}</Badge>
      {info?.tied && <span className="text-xs text-muted">{t('tiedDate')}</span>}
    </span>
  );
}

function PlanSummary({
  plan,
  versions,
  classification,
  today,
  t,
}: {
  plan: string;
  versions: PriceVersion[];
  classification: Map<string, PriceClassification>;
  today: string;
  t: T;
}) {
  const current = versions.filter((price) => classification.get(price.id)?.status === 'current');
  const upcoming = nextScheduled(versions, today);
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm font-medium text-muted">{plan}</p>
        {versions.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t('noPrice')}</p>
        ) : current.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t('noCurrentPrice')}</p>
        ) : (
          <>
            {/* عند تساوي تاريخ النفاذ لا تختار الواجهة نسخة واحدة: تعرضها كلها وتقول ذلك. */}
            {current.map((price) => (
              <p key={price.id} className="num mt-2 whitespace-nowrap text-xl font-semibold text-text"><Ltr>{formatRiyal(price.monthly_amount)}</Ltr></p>
            ))}
            <p className="num mt-1 text-xs text-muted">{t('sinceDate')} <Ltr>{current[0]?.effective_on ?? '—'}</Ltr></p>
            {current.length > 1 && <p className="mt-1 text-xs text-muted">{t('tiedDate')}</p>}
          </>
        )}
        {upcoming && (
          <div className="mt-3 border-t border-border pt-3">
            <Badge wrap tone="warning">{t('nextScheduled')}</Badge>
            <p className="num mt-1.5 text-sm text-text"><Ltr>{formatRiyal(upcoming.monthly_amount)}</Ltr></p>
            <p className="num text-xs text-muted">{t('startsOn')} <Ltr>{upcoming.effective_on ?? '—'}</Ltr></p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
