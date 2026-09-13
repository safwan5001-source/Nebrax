'use client';

import { useId } from 'react';
import { RotateCw, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { ProductPublicationStore } from '@/modules/products/publication';

type PublicationStatus = 'loading' | 'ready' | 'empty' | 'error';

export function ProductPublicationFields({
  status,
  stores,
  selectedIds,
  disabled = false,
  onChange,
  onRetry,
  labels,
}: {
  status: PublicationStatus;
  stores: ProductPublicationStore[];
  selectedIds: string[];
  disabled?: boolean;
  onChange: (storefrontIds: string[]) => void;
  onRetry: () => void;
  labels: {
    title: string;
    availableOnline: string;
    hint: string;
    loading: string;
    empty: string;
    loadFailed: string;
    retry: string;
  };
}) {
  const fieldId = useId();
  const toggle = (storefrontId: string, checked: boolean) => {
    onChange(checked
      ? Array.from(new Set([...selectedIds, storefrontId]))
      : selectedIds.filter((id) => id !== storefrontId));
  };

  return (
    <section className="space-y-3 rounded-md border border-border p-3" aria-labelledby={`${fieldId}-title`}>
      <div className="flex items-start gap-2">
        <Store className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.7} aria-hidden />
        <div>
          <h3 id={`${fieldId}-title`} className="text-sm font-medium text-text">{labels.title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">{labels.hint}</p>
        </div>
      </div>

      {status === 'loading' && (
        <div role="status" aria-label={labels.loading}>
          <Skeleton className="h-14 w-full" />
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-negative/10 px-3 py-2">
          <p role="alert" className="text-xs text-negative">{labels.loadFailed}</p>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RotateCw className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden />
            {labels.retry}
          </Button>
        </div>
      )}

      {status === 'empty' && <p className="rounded-md bg-background px-3 py-2 text-sm text-muted">{labels.empty}</p>}

      {status === 'ready' && (
        <div className="divide-y divide-border rounded-md border border-border">
          {stores.map((storefront) => {
            const inputId = `${fieldId}-${storefront.id}`;
            return (
              <label key={storefront.id} htmlFor={inputId} className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm text-text">
                <input
                  id={inputId}
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={selectedIds.includes(storefront.id)}
                  disabled={disabled}
                  onChange={(event) => toggle(storefront.id, event.target.checked)}
                />
                <span className="min-w-0 flex-1 truncate">{storefront.name}</span>
                <span className="text-xs text-muted">{labels.availableOnline}</span>
              </label>
            );
          })}
        </div>
      )}
    </section>
  );
}
