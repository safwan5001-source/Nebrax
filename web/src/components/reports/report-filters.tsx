'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarDays, Check, ChevronDown, MapPin, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import type { Branch } from '@/lib/branch';

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
}: {
  value: ReportFilterState;
  onChange: (next: ReportFilterState) => void;
}) {
  const t = useTranslations('reports');
  const tb = useTranslations('branches');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [open, setOpen] = useState(false);
  const [dateSheet, setDateSheet] = useState(false);
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

  const dirty = !!value.from || !!value.to || value.branchIds.length > 0;
  const dateSet = !!value.from || !!value.to;

  /**
   * نصّ chip التاريخ. **لا يُترك فارغاً**: الحالة الافتراضية تُسمّى «كل الفترات»
   * لا تُترك بياضاً — الفراغ يُقرأ عطلاً لا اختياراً.
   *
   * ولم أغيّر الافتراض نفسه إلى «هذا الشهر»: ذلك يبدّل **كل رقم** على اللوحة
   * وفي كل تقرير لمن يفتحها بعد الترقية، وهو قرار مالك منتج لا تحسين عرض.
   */
  const dateLabel = !dateSet
    ? t('all_periods')
    : [value.from || '…', value.to || '…'].join(' ← ');

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
          الجوال: صفّ chips واحد قابل للتمرير
          ═══════════════════════════════════════════════════════════════
          ثلاثة حقول كاملة العرض كانت تدفع أول بيانٍ حقيقي أسفل الطيّة —
          فيُمرّر المستخدم ليرى ما جاء من أجله. الصفّ الواحد يردّه إلى مكانه. */}
      <div className="no-print -mx-1 flex w-full gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] sm:hidden [&::-webkit-scrollbar]:hidden">
        <button type="button" onClick={() => setDateSheet(true)} className={chip(dateSet)}>
          <CalendarDays className="h-4 w-4 shrink-0" strokeWidth={1.8} />
          <span className={cn(dateSet && 'num')}>{dateLabel}</span>
        </button>

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

        {dirty && (
          <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className={chip(false)}>
            <X className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
            {t('clear_filters')}
          </button>
        )}
      </div>

      {/* نافذة اختيار المدى — على الجوال وحده؛ الديسكتوب يعرض الحقلين مباشرةً. */}
      <Dialog open={dateSheet} onClose={() => setDateSheet(false)} title={t('date_range')}>
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
      </Dialog>

    <div className="no-print hidden flex-wrap items-end gap-3 rounded border border-border bg-surface p-3 sm:flex">
      <div className="space-y-1.5">
        <Label htmlFor="rf-from">{t('from')}</Label>
        <Input id="rf-from" type="date" dir="ltr" className="w-40 text-start [unicode-bidi:isolate]" value={value.from}
          onChange={(e) => onChange({ ...value, from: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="rf-to">{t('to')}</Label>
        <Input id="rf-to" type="date" dir="ltr" className="w-40 text-start [unicode-bidi:isolate]" value={value.to}
          onChange={(e) => onChange({ ...value, to: e.target.value })} />
      </div>

      {/* منتقي فروع متعدّد الاختيار */}
      <div className="space-y-1.5">
        <Label htmlFor="rf-branches">{tb('title')}</Label>
        <div ref={rootRef} className="relative">
          <button
            id="rf-branches"
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={open}
            className="flex h-9 w-56 items-center justify-between gap-2 rounded border border-border bg-surface px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
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
      </div>

      {dirty && (
        <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
          <X className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('clear_filters')}
        </Button>
      )}
    </div>
    </>
  );
}
