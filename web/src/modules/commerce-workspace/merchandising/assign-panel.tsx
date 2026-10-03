'use client';

import { useCallback, useEffect, useState } from 'react';
import { Tags } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { EmptyState, ErrorState, LoadingState } from '@/components/nebrax';
import { loadFacets, loadProductFacetValueIds, replaceProductFacetValueIds, type Facet } from './client';
import { writeFailureMessage, type T } from './common';
import { ProductPicker, type PickerProduct } from './product-picker';

/** تبويب «إسناد المنتجات»: منتج واحد ← قيم متعددة عبر أبعاد (ADR-14 §2.1). */
export function AssignPanel({ t, canManage }: { t: T; canManage: boolean }) {
  const { success } = useToast();
  const [facets, setFacets] = useState<Facet[] | null | 'error'>(null);
  const [product, setProduct] = useState<PickerProduct | null>(null);
  const [selected, setSelected] = useState<string[] | null | 'error'>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setFacets((await loadFacets()) ?? 'error');
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!product) return;
    let cancelled = false;
    setSelected(null);
    void loadProductFacetValueIds(product.id).then((ids) => {
      if (!cancelled) setSelected(ids ?? 'error');
    });
    return () => {
      cancelled = true;
    };
  }, [product]);

  if (facets === null) return <LoadingState variant="cards" rows={2} label={t('merchLoading')} />;
  if (facets === 'error') return <ErrorState message={t('merchLoadFailed')} onRetry={() => void loadAll()} />;
  if (facets.length === 0) return <EmptyState icon={Tags} title={t('merchAssignNoFacets')} />;

  const ids = Array.isArray(selected) ? selected : [];
  const toggle = (valueId: string) =>
    setSelected(ids.includes(valueId) ? ids.filter((id) => id !== valueId) : [...ids, valueId]);

  async function save() {
    if (!product || saving) return;
    setSaving(true);
    setError(null);
    const result = await replaceProductFacetValueIds(product.id, ids);
    setSaving(false);
    if (!result.ok) {
      setError(writeFailureMessage(result, t));
      return;
    }
    setSelected(result.data);
    await loadAll();
    success(t('merchAssignSaved'));
  }

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted">{t('merchAssignIntro')}</p>
      <ProductPicker t={t} idPrefix="merch-assign" actionLabel={t('merchEdit')} onPick={setProduct} />

      {product === null ? (
        <p className="text-sm text-muted">{t('merchAssignPick')}</p>
      ) : (
        <section aria-label={product.name} className="space-y-3 rounded border border-border bg-surface p-3">
          <h3 className="text-sm font-semibold text-text">{product.name}</h3>
          {selected === null ? <LoadingState variant="cards" rows={1} label={t('merchLoading')} surface="bare" /> : null}
          {selected === 'error' ? <ErrorState message={t('merchLoadFailed')} surface="bare" /> : null}
          {Array.isArray(selected) ? (
            <>
              {facets.map((facet) => {
                // قيمة مُسنَدة ثم عُطّلت تبقى ظاهرة (محتفَظ بها)؛ القيم المعطّلة غير المُسنَدة تُخفى.
                const values = facet.values.filter((v) => v.isActive || ids.includes(v.id));
                if (values.length === 0) return null;
                return (
                  <fieldset key={facet.id} className="space-y-1.5" disabled={!canManage || !facet.isActive && !values.some((v) => ids.includes(v.id))}>
                    <legend className="text-xs font-medium text-text">
                      {facet.name}
                      {!facet.isActive ? ` (${t('merchInactive')})` : ''}
                    </legend>
                    <div className="flex flex-wrap gap-2">
                      {values.map((value) => {
                        const checked = ids.includes(value.id);
                        return (
                          <label
                            key={value.id}
                            className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded border px-3 text-sm focus-within:ring-2 focus-within:ring-primary/40 ${
                              checked ? 'border-primary bg-primary/5 text-text' : 'border-border bg-surface text-text hover:border-primary/40'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="accent-primary"
                              checked={checked}
                              onChange={() => toggle(value.id)}
                            />
                            <span>{value.name}</span>
                            {!value.isActive ? <span className="text-xs text-muted">({t('merchInactive')})</span> : null}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}
              {error ? <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p> : null}
              {canManage ? (
                <div className="flex justify-end">
                  <Button type="button" onClick={() => void save()} disabled={saving}>
                    {t('merchAssignSave')}
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      )}
    </div>
  );
}
