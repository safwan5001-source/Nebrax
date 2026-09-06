'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronDown, FileText, Loader2, Package, Search, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/permissions';
import { currentUser } from '@/lib/auth';
import { formatRiyal } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * ═══════════════════════════════════════════════════════════════
 *  AWJ Global Search — أساس واجهة البحث المتقدم (Foundation فقط)
 * ═══════════════════════════════════════════════════════════════
 *  ليس محرّك بحثٍ موحّداً على الخادم — لا يوجد نقطة `/search` مجمّعة في
 *  المشروع اليوم، وإضافتها معمارية جديدة خارج نطاق هذه المهمة. هذا المكوّن
 *  يستهلك أربع نقاط REST **موجودة وآمنة فعلاً** بمعامل `search` نفسه المتّبع
 *  فيها (فواتير، مشتريات، منتجات، قيود يومية)، فيبقى العزل والصلاحيات على
 *  حالهما تماماً — كل استعلام يمرّ بـ`SetTenant` والـ RBAC القائم في الخادم.
 *
 *  فئات أُخرى (العملاء/الموردون، الحسابات، المدفوعات، عروض الأسعار...) لا
 *  تملك معامل بحث خادمي اليوم، فلا تُعرض هنا حتى لا يكون البحث خادعاً
 *  (قائمة كاملة تُصفّى في الواجهة توحي بخصوصية لا تحمل ضمان عزل جديد).
 */

type SearchCategory = 'all' | 'invoices' | 'purchases' | 'products' | 'journal_entries';

interface ResultItem {
  id: string;
  primary: string;
  secondary?: string;
  meta?: string;
  amount?: string;
  href: string;
}

interface CategoryConfig {
  key: Exclude<SearchCategory, 'all'>;
  permission: string;
  endpoint: string;
  mapItem: (row: Record<string, unknown>) => ResultItem;
}

const CATEGORIES: CategoryConfig[] = [
  {
    key: 'invoices',
    permission: 'invoices.view',
    endpoint: '/invoices',
    mapItem: (row) => ({
      id: String(row.id),
      primary: String(row.number ?? ''),
      secondary: (row.partner as { name?: string } | null)?.name ?? undefined,
      meta: typeof row.invoice_date === 'string' ? row.invoice_date : undefined,
      amount: typeof row.total === 'string' ? formatRiyal(row.total) : undefined,
      href: `/invoices/${row.id}`,
    }),
  },
  {
    key: 'purchases',
    permission: 'purchases.view',
    endpoint: '/purchases',
    mapItem: (row) => ({
      id: String(row.id),
      primary: String(row.number ?? ''),
      secondary: (row.partner as { name?: string } | null)?.name ?? undefined,
      meta: typeof row.purchase_date === 'string' ? row.purchase_date : undefined,
      amount: typeof row.total === 'string' ? formatRiyal(row.total) : undefined,
      href: `/purchases/${row.id}`,
    }),
  },
  {
    key: 'products',
    permission: 'products.view',
    endpoint: '/products',
    mapItem: (row) => ({
      id: String(row.id),
      primary: String(row.name ?? ''),
      secondary: [row.sku, row.barcode].filter(Boolean).join(' · ') || undefined,
      href: `/products/${row.id}`,
    }),
  },
  {
    key: 'journal_entries',
    permission: 'accounts.view',
    endpoint: '/journal-entries',
    mapItem: (row) => ({
      id: String(row.id),
      primary: String(row.number ?? ''),
      secondary: typeof row.description === 'string' ? row.description : undefined,
      meta: typeof row.entry_date === 'string' ? row.entry_date : undefined,
      amount: typeof row.total === 'string' ? formatRiyal(row.total) : undefined,
      href: `/journal-entries/${row.id}`,
    }),
  },
];

const PER_PAGE_ALL = 4;
const PER_PAGE_SINGLE = 8;

export function AwjGlobalSearch({ className }: { className?: string }) {
  const t = useTranslations('awjSearch');
  const router = useRouter();
  const user = currentUser();

  const allowedCategories = useMemo(
    () => CATEGORIES.filter((c) => hasPermission(user?.permissions, user?.role, c.permission)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [type, setType] = useState<SearchCategory>('all');
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Record<string, ResultItem[]>>({});
  const [activeIndex, setActiveIndex] = useState(-1);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // اختصار سطح المكتب Ctrl+K / Cmd+K — يركّز حقل البحث فقط طالما اللوحة معروضة.
  // لا لوحة أوامر عامة ولا اعتراض على مستوى التطبيق: لا تعارض مع أي اختصار
  // آخر (لا يوجد Cmd+K مسجّل في المشروع اليوم — انظر تقرير التنفيذ).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, []);

  // بحث مؤجَّل (debounce) — لا نداء لكل ضغطة مفتاح.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults({});
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(() => {
      const categories = type === 'all' ? allowedCategories : allowedCategories.filter((c) => c.key === type);
      const perPage = type === 'all' ? PER_PAGE_ALL : PER_PAGE_SINGLE;

      Promise.allSettled(
        categories.map((c) =>
          api<{ data: Record<string, unknown>[] }>(
            `${c.endpoint}?search=${encodeURIComponent(q)}&per_page=${perPage}`
          ).then((r) => ({ key: c.key, items: r.data.map(c.mapItem) }))
        )
      ).then((settled) => {
        const next: Record<string, ResultItem[]> = {};
        settled.forEach((s, i) => {
          if (s.status === 'fulfilled') {
            next[s.value.key] = s.value.items;
          } else if (!(s.reason instanceof ApiError && s.reason.status === 403)) {
            // خطأ غير متوقّع بفئة واحدة لا يُسقط بقية النتائج — يُترك فارغاً بصمت.
            next[categories[i].key] = [];
          }
        });
        setResults(next);
        setLoading(false);
        setActiveIndex(-1);
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [query, type, allowedCategories]);

  const placeholder = t(`placeholder_${type}` as 'placeholder_all');

  const flatResults = useMemo(
    () => Object.values(results).flat(),
    [results]
  );

  function navigateTo(item: ResultItem) {
    setOpen(false);
    setQuery('');
    router.push(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || flatResults.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      navigateTo(flatResults[activeIndex]);
    }
  }

  const showPanel = open && query.trim().length > 0;

  return (
    <div ref={rootRef} className={cn('relative w-full', className)}>
      <div className="flex h-10 items-stretch overflow-hidden rounded-[10px] border border-border bg-surface focus-within:ring-2 focus-within:ring-primary/40">
        <div className="relative flex flex-1 items-center gap-2 px-3">
          <Search className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label={placeholder}
            className="h-full w-full min-w-0 bg-transparent text-sm text-text placeholder:text-muted focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={t('clear')}
              className="shrink-0 rounded p-0.5 text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          )}
          {!query && (
            <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted sm:inline-block">
              {t('shortcut_hint')}
            </kbd>
          )}
        </div>

        <div className="relative shrink-0 border-s border-border">
          <button
            type="button"
            onClick={() => setTypeMenuOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={typeMenuOpen}
            aria-label={t('type_selector_label')}
            className="flex h-full items-center gap-1 px-3 text-[13px] font-medium text-text hover:bg-primary-soft hover:text-primary"
          >
            <span className="max-w-24 truncate sm:max-w-none">{t(`type_${type}` as 'type_all')}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          </button>

          {typeMenuOpen && (
            <div
              role="listbox"
              className="absolute end-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-[10px] border border-border bg-surface p-1 shadow-md"
            >
              {(['all', ...allowedCategories.map((c) => c.key)] as SearchCategory[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  role="option"
                  aria-selected={type === c}
                  onClick={() => {
                    setType(c);
                    setTypeMenuOpen(false);
                    inputRef.current?.focus();
                  }}
                  className={cn(
                    'flex w-full items-center rounded-md px-2.5 py-2 text-start text-sm',
                    type === c ? 'bg-primary-soft text-primary' : 'text-text hover:bg-background'
                  )}
                >
                  {t(`type_${c}` as 'type_all')}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {showPanel && (
        <div className="absolute end-0 start-0 top-full z-50 mt-1.5 max-h-96 overflow-y-auto rounded-[10px] border border-border bg-surface p-1.5 shadow-lg">
          {query.trim().length < 2 ? (
            <p className="p-3 text-center text-[13px] text-muted">{t('min_chars')}</p>
          ) : loading ? (
            <div className="flex items-center justify-center gap-2 p-4 text-[13px] text-muted">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
              {t('loading')}
            </div>
          ) : flatResults.length === 0 ? (
            <p className="p-3 text-center text-[13px] text-muted">{t('no_results')}</p>
          ) : (
            allowedCategories
              .filter((c) => results[c.key]?.length)
              .map((c) => (
                <ResultSection
                  key={c.key}
                  title={t(`section_${c.key}` as 'section_invoices')}
                  items={results[c.key] ?? []}
                  allItems={flatResults}
                  activeIndex={activeIndex}
                  icon={c.key === 'products' ? Package : FileText}
                  onSelect={navigateTo}
                />
              ))
          )}
        </div>
      )}
    </div>
  );
}

function ResultSection({
  title,
  items,
  allItems,
  activeIndex,
  icon: Icon,
  onSelect,
}: {
  title: string;
  items: ResultItem[];
  allItems: ResultItem[];
  activeIndex: number;
  icon: typeof FileText;
  onSelect: (item: ResultItem) => void;
}) {
  return (
    <div className="py-1">
      <p className="px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-muted">{title}</p>
      {items.map((item) => {
        const globalIndex = allItems.indexOf(item);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start',
              globalIndex === activeIndex ? 'bg-primary-soft' : 'hover:bg-background'
            )}
          >
            <Icon className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-text">
                {item.primary}
                {item.secondary && <span className="font-normal text-muted"> — {item.secondary}</span>}
              </span>
              {item.meta && <span className="num block truncate text-xs text-muted">{item.meta}</span>}
            </span>
            {item.amount && <span className="num shrink-0 text-sm font-semibold text-text">{item.amount}</span>}
          </button>
        );
      })}
    </div>
  );
}
