'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';

type OptionValue = { id: string; value: string; value_en: string | null; is_active: boolean };
type Option = { id: string; name: string; name_en: string | null; is_active: boolean; values: OptionValue[] };
type Variant = {
  id: string;
  sku: string;
  is_active: boolean;
  display_name: string;
  option_values: Array<{ option_id: string; option_name: string | null; value_id: string; value: string }>;
};
type Combination = {
  combination_key: string;
  option_values: Array<{ option_id: string; value_id: string; value: string }>;
  exists: boolean;
  variant_id: string | null;
};
type Matrix = { options: Option[]; total_possible: number; combinations: Combination[] };

/**
 * VAR-CORE-1 — قسم «الخيارات والمتغيّرات» ضمن ملف المنتج.
 *
 * لا يعرض حقول مخزون/تسعير/وسائط وهمية — الأعمدة هنا مقصورة على ما تملك
 * سلطته الفعلية اليوم (التركيبة، SKU، الحالة)، بحسب عقد VAR-CORE-1 الواجهي.
 */
export function ProductVariantsPanel({ productId, variantState, onProductChanged }: {
  productId: string;
  variantState: string;
  onProductChanged: () => void;
}) {
  const t = useTranslations('products');
  const { success, error: showError } = useToast();

  const [options, setOptions] = useState<Option[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [newOptionName, setNewOptionName] = useState('');
  const [newValueByOption, setNewValueByOption] = useState<Record<string, string>>({});

  const isManaged = variantState === 'variant_managed';

  const load = useCallback(async () => {
    if (!isManaged) return;
    setLoading(true);
    try {
      const [optionsRes, variantsRes, matrixRes] = await Promise.all([
        api<{ data: Option[] }>(`/products/${productId}/options`),
        api<{ data: Variant[] }>(`/products/${productId}/variants`),
        api<Matrix>(`/products/${productId}/variants/combinations`),
      ]);
      setOptions(optionsRes.data);
      setVariants(variantsRes.data);
      setMatrix(matrixRes);
      const preselected: Record<string, boolean> = {};
      matrixRes.combinations.forEach((c) => { if (!c.exists) preselected[c.combination_key] = true; });
      setSelected(preselected);
    } catch (err) {
      showError(err instanceof ApiError ? err.message : t('action_failed'));
    } finally {
      setLoading(false);
    }
  }, [isManaged, productId, showError, t]);

  useEffect(() => { void load(); }, [load]);

  const newCombinationsCount = useMemo(
    () => (matrix ? matrix.combinations.filter((c) => !c.exists).length : 0),
    [matrix]
  );
  const selectedCount = useMemo(
    () => Object.values(selected).filter(Boolean).length,
    [selected]
  );

  async function enable() {
    setEnabling(true);
    try {
      await api(`/products/${productId}/variants/enable`, { method: 'POST' });
      onProductChanged();
      success(t('variants_enabled'));
    } catch (err) {
      showError(err instanceof ApiError ? err.message : t('action_failed'));
    } finally {
      setEnabling(false);
    }
  }

  async function disable() {
    if (!window.confirm(t('variants_disable_confirm'))) return;
    try {
      await api(`/products/${productId}/variants/disable`, { method: 'POST' });
      onProductChanged();
      success(t('variants_disabled'));
    } catch (err) {
      showError(err instanceof ApiError ? err.message : t('action_failed'));
    }
  }

  async function addOption() {
    const name = newOptionName.trim();
    if (!name) return;
    try {
      await api(`/products/${productId}/options`, { method: 'POST', body: { name } });
      setNewOptionName('');
      await load();
    } catch (err) {
      showError(err instanceof ApiError ? err.message : t('action_failed'));
    }
  }

  async function removeOption(optionId: string) {
    if (!window.confirm(t('variants_remove_option_confirm'))) return;
    try {
      await api(`/products/${productId}/options/${optionId}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      showError(err instanceof ApiError ? err.message : t('action_failed'));
    }
  }

  async function addValue(optionId: string) {
    const value = (newValueByOption[optionId] ?? '').trim();
    if (!value) return;
    try {
      await api(`/products/${productId}/options/${optionId}/values`, { method: 'POST', body: { value } });
      setNewValueByOption((prev) => ({ ...prev, [optionId]: '' }));
      await load();
    } catch (err) {
      showError(err instanceof ApiError ? err.message : t('action_failed'));
    }
  }

  async function removeValue(optionId: string, valueId: string) {
    if (!window.confirm(t('variants_remove_value_confirm'))) return;
    try {
      await api(`/products/${productId}/options/${optionId}/values/${valueId}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      showError(err instanceof ApiError ? err.message : t('action_failed'));
    }
  }

  async function createSelectedVariants() {
    if (!matrix) return;
    const combos = matrix.combinations
      .filter((c) => !c.exists && selected[c.combination_key])
      .map((c) => c.option_values.map((v) => v.value_id));
    if (combos.length === 0) return;

    try {
      const result = await api<{ created: Variant[]; duplicates: string[]; failed: Array<{ message: string }> }>(
        `/products/${productId}/variants`,
        { method: 'POST', body: { combinations: combos } }
      );
      await load();
      if (result.failed.length > 0) {
        showError(result.failed[0]?.message ?? t('action_failed'));
      } else {
        success(t('variants_created', { count: result.created.length }));
      }
    } catch (err) {
      showError(err instanceof ApiError ? err.message : t('action_failed'));
    }
  }

  async function toggleVariantActive(variant: Variant) {
    try {
      await api(`/products/${productId}/variants/${variant.id}`, { method: 'PUT', body: { is_active: !variant.is_active } });
      await load();
    } catch (err) {
      showError(err instanceof ApiError ? err.message : t('action_failed'));
    }
  }

  async function deleteVariant(variant: Variant) {
    if (!window.confirm(t('variants_delete_confirm', { name: variant.display_name }))) return;
    try {
      await api(`/products/${productId}/variants/${variant.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      showError(err instanceof ApiError ? err.message : t('action_failed'));
    }
  }

  if (!isManaged) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 p-4">
          <div>
            <p className="text-sm font-medium text-text">{t('variants_entry_title')}</p>
            <p className="mt-1 text-xs text-muted">{t('variants_entry_hint')}</p>
          </div>
          <Button type="button" size="sm" onClick={() => void enable()} disabled={enabling}>
            <Plus className="h-4 w-4" />{t('variants_add_options')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle>{t('variants_options_title')}</CardTitle>
          <Button type="button" variant="ghost" size="sm" onClick={() => void disable()}>{t('variants_disable')}</Button>
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-0">
          {options.map((option) => (
            <div key={option.id} className="space-y-2 rounded border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-text">{option.name}</p>
                <Button type="button" variant="ghost" size="sm" onClick={() => void removeOption(option.id)}>
                  <Trash2 className="h-3.5 w-3.5" />{t('remove')}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {option.values.map((value) => (
                  <span key={value.id} className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-xs text-text">
                    {value.value}
                    <button type="button" aria-label={t('remove')} onClick={() => void removeValue(option.id, value.id)}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <Input
                  className="h-8 w-32 text-xs"
                  placeholder={t('variants_add_value_placeholder')}
                  value={newValueByOption[option.id] ?? ''}
                  onChange={(e) => setNewValueByOption((prev) => ({ ...prev, [option.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addValue(option.id); } }}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => void addValue(option.id)}>{t('add')}</Button>
              </div>
            </div>
          ))}

          <div className="flex items-center gap-2">
            <Input
              className="h-9 w-48"
              placeholder={t('variants_add_option_placeholder')}
              value={newOptionName}
              onChange={(e) => setNewOptionName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addOption(); } }}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => void addOption()}>
              <Plus className="h-4 w-4" />{t('variants_add_option')}
            </Button>
          </div>

          {matrix && matrix.total_possible > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-primary-soft/40 px-3 py-2 text-sm">
              <span>{t('variants_possible_combinations', { count: matrix.total_possible })}</span>
              {newCombinationsCount > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted">{t('variants_selected_of_new', { selected: selectedCount, total: newCombinationsCount })}</span>
                  <Button type="button" size="sm" onClick={() => void createSelectedVariants()} disabled={selectedCount === 0}>
                    {t('variants_create_selected', { count: selectedCount })}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {matrix && newCombinationsCount > 0 && (
        <Card>
          <CardHeader><CardTitle>{t('variants_review_title')}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH className="w-10" />
                  <TH>{t('variants_column_combination')}</TH>
                  <TH>{t('variants_column_status')}</TH>
                </TR>
              </THead>
              <TBody>
                {matrix.combinations.filter((c) => !c.exists).map((combo) => (
                  <TR key={combo.combination_key}>
                    <TD>
                      <input
                        type="checkbox"
                        checked={Boolean(selected[combo.combination_key])}
                        onChange={(e) => setSelected((prev) => ({ ...prev, [combo.combination_key]: e.target.checked }))}
                      />
                    </TD>
                    <TD>{combo.option_values.map((v) => v.value).join(' / ')}</TD>
                    <TD><Badge tone="neutral">{t('variants_status_new')}</Badge></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>{t('variants_table_title', { count: variants.length })}</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-4 text-sm text-muted">{t('loading')}</p>
          ) : variants.length === 0 ? (
            <p className="p-4 text-sm text-muted">{t('variants_empty')}</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{t('variants_column_combination')}</TH>
                  <TH>{t('sku')}</TH>
                  <TH>{t('variants_column_status')}</TH>
                  <TH>{t('actions')}</TH>
                </TR>
              </THead>
              <TBody>
                {variants.map((variant) => (
                  <TR key={variant.id}>
                    <TD className="font-medium text-text">{variant.display_name}</TD>
                    <TD className="num">{variant.sku}</TD>
                    <TD><Badge tone={variant.is_active ? 'positive' : 'muted'}>{variant.is_active ? t('active') : t('inactive')}</Badge></TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <Button type="button" variant="ghost" size="sm" onClick={() => void toggleVariantActive(variant)}>
                          {variant.is_active ? t('deactivate') : t('activate')}
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => void deleteVariant(variant)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
