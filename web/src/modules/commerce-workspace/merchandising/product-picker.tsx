'use client';

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { loadProductPublicationList } from '@/modules/products/publication';
import type { T } from './common';

export type PickerProduct = { id: string; name: string; sku: string | null };

/**
 * منتقي منتجات بحثي (خادمي، مؤجَّل 300ms) فوق قائمة المنتجات الموثوقة نفسها
 * (`products/publication`): لا نسخة موازية لبيانات المنتج، ولا هوية مستأجر.
 */
export function ProductPicker({
  t,
  idPrefix,
  actionLabel,
  excludeIds = [],
  onPick,
}: {
  t: T;
  idPrefix: string;
  actionLabel: string;
  excludeIds?: string[];
  onPick: (product: PickerProduct) => void;
}) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<PickerProduct[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (search.trim() === '') {
      setResults(null);
      setFailed(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const page = await loadProductPublicationList({ search, perPage: 10 });
        if (!cancelled) {
          setResults(page.items.map((item) => ({ id: item.id, name: item.name, sku: item.sku })));
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);

  const visible = (results ?? []).filter((p) => !excludeIds.includes(p.id));

  return (
    <div className="space-y-2">
      <label htmlFor={`${idPrefix}-search`} className="sr-only">
        {t('merchProductSearch')}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <Input
          id={`${idPrefix}-search`}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('merchProductSearch')}
          className="h-10 ps-9"
        />
      </div>
      {failed ? <p role="alert" className="text-xs text-negative">{t('merchLoadFailed')}</p> : null}
      {results !== null && !failed ? (
        visible.length === 0 ? (
          <p className="text-xs text-muted">{t('merchNoResults')}</p>
        ) : (
          <ul className="divide-y divide-border rounded border border-border">
            {visible.map((product) => (
              <li key={product.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 truncate text-sm text-text">
                  {product.name}
                  {product.sku ? <span className="ms-2 text-xs text-muted" dir="ltr">{product.sku}</span> : null}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => onPick(product)}>
                  {actionLabel}
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
