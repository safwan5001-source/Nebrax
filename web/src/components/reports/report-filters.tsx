'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronDown, MapPin, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

  return (
    <div className="no-print flex flex-wrap items-end gap-3 rounded border border-border bg-surface p-3">
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
  );
}
