'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarDays, Check, ChevronDown, MapPin, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import type { Branch } from '@/lib/branch';
import type { ComparisonMode } from './financial-comparison';

export interface ReportFilterState {
  from: string;
  to: string;
  /** فروع مختارة — فارغة = كل الفروع (مجمّع). */
  branchIds: string[];
}

export const EMPTY_FILTERS: ReportFilterState = { from: '', to: '', branchIds: [] };

/** يحوّل حالة المرشّحات إلى سلسلة استعلام (`branch_id[]` لكل فرع). */
export function filtersToQuery(f: ReportFilterState): string {
  const p = new URLSearchParams();
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  f.branchIds.forEach((id) => p.append('branch_id[]', id));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/**
 * شريط مرشّحات التقارير: مدى تاريخي + منتقي فروع متعدّد الاختيار.
 * بلا اختيار فروع = **كل الفروع مجمّعة** (السلوك الافتراضي والمحاسبي الصحيح).
 */
export function ReportFilters({
  value,
  onChange,
  onClear,
  showDateRange = true,
  showBranches = true,
  comparison,
  compactMobile = false,
  compactDesktop = false,
}: {
  value: ReportFilterState;
  onChange: (next: ReportFilterState) => void;
  /** يسمح لتقرير متخصص بمسح مرشحاته الإضافية مع المرشحات المشتركة. */
  onClear?: () => void;
  /** تقارير اللقطة الحالية لا تدّعي أنها قابلة للرجوع إلى فترة تاريخية. */
  showDateRange?: boolean;
  /** تقارير القيمة العالمية لا تتظاهر بأن لها فلتر فرع مستقل. */
  showBranches?: boolean;
  /** يظهر فقط للتقارير التي تدعم شاشة مقارنة مستقلة. */
  comparison?: { value: ComparisonMode; onChange: (mode: ComparisonMode) => void; previousPeriodDisabled?: boolean; previousYearDisabled?: boolean };
  /**
   * وضع اختياري للوحة التحكم وحدها: يستبدل صفّ الـ chips على الجوال بزرّ
   * «الفلاتر» مضغوط بعدّاد، يفتح ورقةً واحدة تجمع كل المرشّحات مع تطبيق/إعادة
   * تعيين صريحين. لا يمسّ شاشات التقارير الـ٢١ الأخرى — تبقى على صفّ الـ chips
   * الحالي الذي يطبّق فوراً بلا زرّ تطبيق منفصل.
   */
  compactMobile?: boolean;
  /**
   * وضع اختياري للوحة التحكم وحدها (تابلت/ديسكتوب): يزيل بطاقة الإطار المحيطة
   * (حدّ + خلفية + حشوة) ويُخفي التسميات المرئية فوق الحقول (تبقى مُتاحة
   * لقارئ الشاشة عبر `aria-label`)، فيندمج الشريط بصرياً مع `AwjGlobalSearch`
   * في صفّ toolbar واحد كثيف بدل بطاقتين منفصلتين. لا يمسّ شاشات التقارير
   * الأخرى — تبقى ببطاقتها وتسمياتها كما هي تماماً.
   */
  compactDesktop?: boolean;
}) {
  const t = useTranslations('reports');
  const tb = useTranslations('branches');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [open, setOpen] = useState(false);
  const [dateSheet, setDateSheet] = useState(false);
  const [filterSheet, setFilterSheet] = useState(false);
  const [draft, setDraft] = useState<ReportFilterState>(value);
  const [draftComparison, setDraftComparison] = useState<ComparisonMode>(comparison?.value ?? 'none');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ data: Branch[] }>('/branches').then((r) => setBranches(r.data)).catch(() => {});
  }, []);

  // إغلاق المنتقي بالنقر خارجه أو بمفتاح Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = (id: string) => {
    const next = value.branchIds.includes(id)
      ? value.branchIds.filter((x) => x !== id)
      : [...value.branchIds, id];
    onChange({ ...value, branchIds: next });
  };

  const label = useMemo(() => {
    if (value.branchIds.length === 0) return t('all_branches');
    if (value.branchIds.length === 1) return branches.find((b) => b.id === value.branchIds[0])?.name ?? '—';
    return t('branches_selected', { n: value.branchIds.length });
  }, [value.branchIds, branches, t]);

  const clear = () => {
    if (comparison) comparison.onChange('none');
    if (onClear) onClear();
    else onChange(EMPTY_FILTERS);
  };
  const dateSet = showDateRange && (!!value.from || !!value.to);
  const comparisonActive = comparison?.value !== 'none';
  const dirty = dateSet || comparisonActive || (showBranches && value.branchIds.length > 0);
  /** عدد مجموعات المرشّحات الفعّالة — لعدّاد زرّ «الفلاتر ②» على الجوال المضغوط. */
  const activeCount =
    (dateSet ? 1 : 0) + (comparisonActive ? 1 : 0) + (showBranches && value.branchIds.length > 0 ? 1 : 0);

  /**
   * نصّ chip التاريخ. **لا يُترك فارغاً**: الحالة الافتراضية تُسمّى «كل الفترات»
   * لا تُترك بياضاً — الفراغ يُقرأ عطلاً لا اختياراً.
   *
   * ولم أغيّر الافتراض نفسه إلى «هذا الشهر»: ذلك يبدّل **كل رقم** على اللوحة
   * وفي كل تقرير لمن يفتحها بعد الترقية، وهو قرار مالك منتج لا تحسين عرض.
   */
  const dateLabel = useMemo(() => {
    if (!dateSet) return t('all_periods');

    // «اليوم» بدل «٢٠٢٦-٠٨-١٣ ← ٢٠٢٦-٠٨-١٣»: تكرار التاريخ نفسه مرّتين يشغل
    // العرض ولا يضيف معنى، والاسم يُقرأ بلمحة.
    const today = new Date().toISOString().slice(0, 10);
    if (value.from === today && value.to === today) return t('today');

    return [value.from || '…', value.to || '…'].join(' ← ');
  }, [dateSet, value.from, value.to, t]);

  const chip = (active: boolean) =>
    cn(
      'flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] transition-colors',
      active
        ? 'border-primary/40 bg-primary-soft font-medium text-primary'
        : 'border-border bg-surface text-text'
    );

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════════
          الجوال: صفّ chips واحد قابل للتمرير — الوضع الافتراضي
          ═══════════════════════════════════════════════════════════════
          ثلاثة حقول كاملة العرض كانت تدفع أول بيانٍ حقيقي أسفل الطيّة —
          فيُمرّر المستخدم ليرى ما جاء من أجله. الصفّ الواحد يردّه إلى مكانه. */}
      {!compactMobile && (
        <div className="no-print -mx-1 flex w-full gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] sm:hidden [&::-webkit-scrollbar]:hidden">
          {showDateRange && (
            <button type="button" onClick={() => setDateSheet(true)} className={chip(dateSet)}>
              <CalendarDays className="h-4 w-4 shrink-0" strokeWidth={1.8} />
              <span className={cn(dateSet && 'num')}>{dateLabel}</span>
            </button>
          )}

          {comparison && (
            <select
              aria-label={t('comparison')}
              value={comparison.value}
              onChange={(event) => comparison.onChange(event.target.value as ComparisonMode)}
              className={`${chip(comparison.value !== 'none')} max-w-44 appearance-none`}
            >
              <option value="none">{t('comparison_none')}</option>
              <option value="previous-period" disabled={comparison.previousPeriodDisabled}>{t('comparison_previous_period')}</option>
              <option value="previous-year" disabled={comparison.previousYearDisabled}>{t('comparison_previous_year')}</option>
            </select>
          )}

          {showBranches && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-haspopup="listbox"
              aria-expanded={open}
              className={chip(value.branchIds.length > 0)}
            >
              <MapPin className="h-4 w-4 shrink-0" strokeWidth={1.8} />
              <span>{label}</span>
            </button>
          )}

          {dirty && (
            <button type="button" onClick={clear} className={chip(false)}>
              <X className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
              {t('clear_filters')}
            </button>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          الجوال: الوضع المضغوط (اللوحة) — زرّ واحد + عدّاد + ورقة مرشّحات
          ═══════════════════════════════════════════════════════════════
          يستبدل صفّ الـchips الثلاث بزرّ «الفلاتر ②» واحد يفتح ورقة تجمع
          كل المرشّحات مع تطبيق/إعادة تعيين صريحين — لا تطبيق فوري لكل نقرة. */}
      {compactMobile && (
        <div className="no-print flex w-full items-center gap-2 sm:hidden">
          <button
            type="button"
            onClick={() => {
              setDraft(value);
              setDraftComparison(comparison?.value ?? 'none');
              setFilterSheet(true);
            }}
            className={cn(
              'flex h-10 shrink-0 items-center gap-2 rounded-[10px] border px-4 text-[13px] font-medium transition-colors',
              activeCount > 0
                ? 'border-primary/40 bg-primary-soft text-primary'
                : 'border-border bg-surface text-text'
            )}
          >
            <SlidersHorizontal className="h-4 w-4" strokeWidth={1.8} />
            <span>{t('filters')}</span>
            {activeCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-white">
                {activeCount}
              </span>
            )}
          </button>

          {dirty && (
            <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {dateSet && (
                <span className="num flex h-7 shrink-0 items-center whitespace-nowrap rounded-full border border-border bg-surface px-2.5 text-[12px] text-muted">
                  {dateLabel}
                </span>
              )}
              {showBranches && value.branchIds.length > 0 && (
                <span className="flex h-7 shrink-0 items-center whitespace-nowrap rounded-full border border-border bg-surface px-2.5 text-[12px] text-muted">
                  {label}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ورقة المرشّحات المجمّعة للوضع المضغوط. */}
      {compactMobile && (
        <Dialog open={filterSheet} onClose={() => setFilterSheet(false)} title={t('filters_title')}>
          <div className="space-y-4">
            {showDateRange && (
              <div className="space-y-1.5">
                <Label>{t('date_range')}</Label>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="rf-sheet-from">{t('from')}</Label>
                    <Input
                      id="rf-sheet-from"
                      type="date"
                      dir="ltr"
                      className="w-full text-start [unicode-bidi:isolate]"
                      value={draft.from}
                      onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rf-sheet-to">{t('to')}</Label>
                    <Input
                      id="rf-sheet-to"
                      type="date"
                      dir="ltr"
                      className="w-full text-start [unicode-bidi:isolate]"
                      value={draft.to}
                      onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            )}

            {comparison && (
              <div className="space-y-1.5">
                <Label htmlFor="rf-sheet-comparison">{t('comparison')}</Label>
                <select
                  id="rf-sheet-comparison"
                  value={draftComparison}
                  onChange={(e) => setDraftComparison(e.target.value as ComparisonMode)}
                  className="h-10 w-full rounded border border-border bg-surface px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <option value="none">{t('comparison_none')}</option>
                  <option value="previous-period" disabled={comparison.previousPeriodDisabled}>{t('comparison_previous_period')}</option>
                  <option value="previous-year" disabled={comparison.previousYearDisabled}>{t('comparison_previous_year')}</option>
                </select>
              </div>
            )}

            {showBranches && (
              <div className="space-y-1.5">
                <Label>{tb('title')}</Label>
                <div role="listbox" aria-multiselectable className="max-h-52 overflow-y-auto rounded border border-border">
                  <button
                    type="button"
                    role="option"
                    aria-selected={draft.branchIds.length === 0}
                    onClick={() => setDraft((d) => ({ ...d, branchIds: [] }))}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-text hover:bg-primary-soft hover:text-primary"
                  >
                    <Check className={cn('h-4 w-4 shrink-0', draft.branchIds.length === 0 ? 'opacity-100' : 'opacity-0')} strokeWidth={2} />
                    <span className="truncate">{t('all_branches')}</span>
                  </button>
                  {branches.map((b) => {
                    const on = draft.branchIds.includes(b.id);
                    return (
                      <button
                        key={b.id}
                        type="button"
                        role="option"
                        aria-selected={on}
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            branchIds: on ? d.branchIds.filter((x) => x !== b.id) : [...d.branchIds, b.id],
                          }))
                        }
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-text hover:bg-primary-soft hover:text-primary"
                      >
                        <Check className={cn('h-4 w-4 shrink-0', on ? 'opacity-100' : 'opacity-0')} strokeWidth={2} />
                        <span className="truncate">{b.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                onClick={() => {
                  clear();
                  setDraft(EMPTY_FILTERS);
                  setDraftComparison('none');
                  setFilterSheet(false);
                }}
              >
                {t('reset_all')}
              </Button>
              <Button
                onClick={() => {
                  onChange(draft);
                  if (comparison) comparison.onChange(draftComparison);
                  setFilterSheet(false);
                }}
              >
                {t('apply')}
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* نافذة اختيار المدى — على الجوال وحده؛ الديسكتوب يعرض الحقلين مباشرةً. */}
      {showDateRange && !compactMobile && <Dialog open={dateSheet} onClose={() => setDateSheet(false)} title={t('date_range')}>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="rf-from-m">{t('from')}</Label>
            <Input id="rf-from-m" type="date" dir="ltr" className="w-full text-start [unicode-bidi:isolate]"
              value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rf-to-m">{t('to')}</Label>
            <Input id="rf-to-m" type="date" dir="ltr" className="w-full text-start [unicode-bidi:isolate]"
              value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            {dateSet && (
              <Button variant="outline" onClick={() => onChange({ ...value, from: '', to: '' })}>
                {t('clear_filters')}
              </Button>
            )}
            <Button onClick={() => setDateSheet(false)}>{t('apply')}</Button>
          </div>
        </div>
      </Dialog>}

    <div
      className={cn(
        'no-print hidden flex-wrap sm:flex',
        compactDesktop ? 'items-center gap-2' : 'items-end gap-3 rounded border border-border bg-surface p-3'
      )}
    >
      {showDateRange && <>
        <div className={compactDesktop ? undefined : 'space-y-1.5'}>
          <Label htmlFor="rf-from" className={cn(compactDesktop && 'sr-only')}>{t('from')}</Label>
          <Input id="rf-from" type="date" dir="ltr"
            className={cn('text-start [unicode-bidi:isolate]', compactDesktop ? 'h-10 w-36' : 'w-40')}
            value={value.from}
            onChange={(e) => onChange({ ...value, from: e.target.value })} />
        </div>
        <div className={compactDesktop ? undefined : 'space-y-1.5'}>
          <Label htmlFor="rf-to" className={cn(compactDesktop && 'sr-only')}>{t('to')}</Label>
          <Input id="rf-to" type="date" dir="ltr"
            className={cn('text-start [unicode-bidi:isolate]', compactDesktop ? 'h-10 w-36' : 'w-40')}
            value={value.to}
            onChange={(e) => onChange({ ...value, to: e.target.value })} />
        </div>
      </>}

      {comparison && <div className={compactDesktop ? undefined : 'space-y-1.5'}>
        <Label htmlFor="rf-comparison" className={cn(compactDesktop && 'sr-only')}>{t('comparison')}</Label>
        <select
          id="rf-comparison"
          value={comparison.value}
          onChange={(event) => comparison.onChange(event.target.value as ComparisonMode)}
          className={cn(
            'rounded border border-border bg-surface px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            compactDesktop ? 'h-10 w-44' : 'h-9 w-48'
          )}
        >
          <option value="none">{t('comparison_none')}</option>
          <option value="previous-period" disabled={comparison.previousPeriodDisabled}>{t('comparison_previous_period')}</option>
          <option value="previous-year">{t('comparison_previous_year')}</option>
        </select>
      </div>}

      {/* منتقي فروع متعدّد الاختيار */}
      {showBranches && <div className={compactDesktop ? undefined : 'space-y-1.5'}>
        <Label htmlFor="rf-branches" className={cn(compactDesktop && 'sr-only')}>{tb('title')}</Label>
        <div ref={rootRef} className="relative">
          <button
            id="rf-branches"
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={open}
            className={cn(
              'flex items-center justify-between gap-2 rounded border border-border bg-surface px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              compactDesktop ? 'h-10 w-52' : 'h-9 w-56'
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <MapPin className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} />
              <span className="truncate">{label}</span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" strokeWidth={1.8} />
          </button>

          {open && (
            <div role="listbox" aria-multiselectable className="absolute z-50 mt-1 max-h-64 w-56 overflow-y-auto rounded border border-border bg-surface p-1 shadow-md">
              <button
                type="button"
                onClick={() => onChange({ ...value, branchIds: [] })}
                className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-sm text-text hover:bg-primary-soft hover:text-primary"
              >
                <Check className={cn('h-4 w-4 shrink-0', value.branchIds.length === 0 ? 'opacity-100' : 'opacity-0')} strokeWidth={2} />
                <span className="truncate">{t('all_branches')}</span>
              </button>
              {branches.map((b) => {
                const on = value.branchIds.includes(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => toggle(b.id)}
                    className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-sm text-text hover:bg-primary-soft hover:text-primary"
                  >
                    <Check className={cn('h-4 w-4 shrink-0', on ? 'opacity-100' : 'opacity-0')} strokeWidth={2} />
                    <span className="truncate">{b.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>}

      {dirty && (
        <Button variant="ghost" size="sm" onClick={clear}>
          <X className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('clear_filters')}
        </Button>
      )}
    </div>
    </>
  );
}
