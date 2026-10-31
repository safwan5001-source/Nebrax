'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { EASY_CATALOG, isAddable, type EasyCatalogEntry, type EasyCategory } from './easy-catalog';

type Translate = (key: string, values?: Record<string, string | number>) => string;
const CATEGORIES: Array<EasyCategory | 'all'> = ['all', 'content', 'products', 'navigation', 'cart'];
const STATUS_TONE: Record<EasyCatalogEntry['status'], 'positive' | 'warning' | 'muted'> = { ready: 'positive', limited: 'warning', proposed: 'muted' };

/** كتالوج الأقسام: بحث + تصنيفات + شارة حالة صادقة؛ المقترح معطّل بسببه ولا يُضاف أبداً. */
export function EasyCatalogDialog({ open, onClose, onPick, t }: { open: boolean; onClose: () => void; onPick: (entry: EasyCatalogEntry) => void; t: Translate }) {
  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState<EasyCategory | 'all'>('all');

  React.useEffect(() => {
    if (open) { setQuery(''); setCategory('all'); }
  }, [open]);

  const normalized = query.trim().toLowerCase();
  const entries = EASY_CATALOG.filter((entry) => {
    if (category !== 'all' && entry.category !== category) return false;
    if (!normalized) return true;
    return t(`easy.catalog.${entry.key}.name`).toLowerCase().includes(normalized) || t(`easy.catalog.${entry.key}.desc`).toLowerCase().includes(normalized);
  });

  return (
    <Dialog open={open} onClose={onClose} title={t('easy.catalogTitle')} className="max-w-xl">
      <div className="space-y-3">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('easy.catalogSearch')} aria-label={t('easy.catalogSearch')} />
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('easy.catalogCategories')}>
          {CATEGORIES.map((c) => (
            <button
              key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)}
              className={cn('h-8 rounded px-2.5 text-xs font-medium', category === c ? 'bg-primary text-primary-foreground' : 'border border-border text-muted hover:bg-primary-soft hover:text-primary')}
            >
              {t(`easy.categories.${c}`)}
            </button>
          ))}
        </div>
        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">{t('easy.catalogNoResults')}</p>
        ) : (
          <ul className="max-h-[50vh] space-y-1.5 overflow-y-auto">
            {entries.map((entry) => {
              const addable = isAddable(entry);
              return (
                <li key={entry.key} className="flex items-start gap-3 rounded-md border border-border p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-text">{t(`easy.catalog.${entry.key}.name`)}</span>
                      <Badge tone={STATUS_TONE[entry.status]}>{t(`easy.status.${entry.status}`)}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">{t(`easy.catalog.${entry.key}.desc`)}</p>
                    {entry.reasonKey ? <p className="mt-0.5 text-[11px] text-muted">{t(entry.reasonKey)}</p> : null}
                  </div>
                  <Button type="button" size="sm" className="h-9 shrink-0" disabled={!addable} onClick={() => onPick(entry)}>
                    {addable ? t('easy.catalogAdd') : t('easy.status.unavailable')}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
