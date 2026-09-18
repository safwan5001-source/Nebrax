'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ColumnDef } from '@tanstack/react-table';
import { CheckSquare, Plus, Square, Trash2, X, Pipette } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/data-table';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';

type VisualType = 'none' | 'color';
type OptionValue = {
  id: string;
  value: string;
  value_en: string | null;
  is_active: boolean;
  visual_type?: VisualType;
  color_value?: string | null;
};

type VisualDraft = { visual_type: VisualType; color_value: string };
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

function visualPayload(draft: VisualDraft) {
  return {
    visual_type: draft.visual_type,
    color_value: draft.visual_type === 'color' ? draft.color_value.trim().toUpperCase() : null,
  };
}

/**
 * VAR-CORE-1 — قسم «الخيارات والمتغيّرات» ضمن ملف المنتج.
 *
 * يستعمل `DataTable` المشترك (نفسه المستعمَل في `/products`) لا جدولاً
 * يدوياً: فيرث الاستجابة للجوال (`mobileRecord`) والبحث والتحديد الجماعي
 * مجاناً وباتساقٍ مع بقية الشاشات، بدل اختراع نمط جوالٍ موازٍ لهذه الشاشة
 * وحدها. لا يعرض حقول مخزون/تسعير/وسائط وهمية — الأعمدة والتفاصيل هنا
 * مقصورة على ما تملك سلطته الفعلية اليوم (التركيبة، SKU، الحالة).
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
  const [selectedCombos, setSelectedCombos] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [newOptionName, setNewOptionName] = useState('');
  const [newValueByOption, setNewValueByOption] = useState<Record<string, string>>({});
  const [newVisualByOption, setNewVisualByOption] = useState<Record<string, VisualDraft>>({});
  const [editingValue, setEditingValue] = useState<{ optionId: string; value: OptionValue } | null>(null);
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedVariantIds, setSelectedVariantIds] = useState<string[]>([]);
  const [detailVariant, setDetailVariant] = useState<Variant | null>(null);
  const valueInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

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
      const preselected = matrixRes.combinations.filter((c) => !c.exists).map((c) => c.combination_key);
      setSelectedCombos(preselected);
    } catch (err) {
      showError(err instanceof ApiError ? err.message : t('action_failed'));
    } finally {
      setLoading(false);
    }
  }, [isManaged, productId, showError, t]);

  useEffect(() => { void load(); }, [load]);

  const newCombinations = useMemo(
    () => (matrix ? matrix.combinations.filter((c) => !c.exists) : []),
    [matrix]
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

  /**
   * إدخالٌ متتابع فعّال: كتابة قيمة ← Enter ← تُنشأ الرقاقة ← التركيز يبقى
   * جاهزاً للقيمة التالية فوراً بلا لمس الفأرة. التحقّق من التكرار المطبَّع
   * يبقى على الخادم وحده — النجاح المتفائل هنا تجربة استخدامٍ لا سلطة حسم.
   */
  function visualDraft(optionId: string): VisualDraft {
    return newVisualByOption[optionId] ?? { visual_type: 'none', color_value: '' };
  }

  function setVisualDraft(optionId: string, patch: Partial<VisualDraft>) {
    setNewVisualByOption((prev) => ({ ...prev, [optionId]: { ...visualDraft(optionId), ...patch } }));
  }

  function visualPayload(draft: VisualDraft) {
    return {
      visual_type: draft.visual_type,
      color_value: draft.visual_type === 'color' ? draft.color_value.trim().toUpperCase() : null,
    };
  }

  async function addValue(optionId: string) {
    const value = (newValueByOption[optionId] ?? '').trim();
    if (!value) return;
    const draft = visualDraft(optionId);
    try {
      await api(`/products/${productId}/options/${optionId}/values`, { method: 'POST', body: { value, ...visualPayload(draft) } });
      setNewValueByOption((prev) => ({ ...prev, [optionId]: '' }));
      setNewVisualByOption((prev) => ({ ...prev, [optionId]: { visual_type: 'none', color_value: '' } }));
      await load();
    } catch (err) {
      showError(err instanceof ApiError ? err.message : t('action_failed'));
    } finally {
      // `load()` يعيد جلب الخيارات فيُعاد رسم نفس الحقل (نفس `key`)، لكن
      // التركيز الصريح هنا ضمانٌ لا افتراض — خصوصاً بعد فشلٍ يُبقي القيمة.
      // بلا `requestAnimationFrame`: عنصر الإدخال نفسه لا يُعاد تركيبه (نفس
      // المفتاح)، فالتركيز الفوري يعمل بلا انتظار إطار عرضٍ إضافي.
      valueInputRefs.current[optionId]?.focus();
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
    const combos = newCombinations
      .filter((c) => selectedCombos.includes(c.combination_key))
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
      if (detailVariant?.id === variant.id) setDetailVariant(null);
      await load();
    } catch (err) {
      showError(err instanceof ApiError ? err.message : t('action_failed'));
    }
  }

  /**
   * إجراءٌ جماعي آمن فقط: تفعيل/تعطيل — بلا نقطة نهاية جماعية جديدة في
   * الخادم، بل استدعاءات مسارٍ موجودٍ واحدة تلو الأخرى، مع تقرير صريح عند
   * فشل جزئي بدل ادّعاء نجاحٍ كامل.
   */
  async function bulkSetActive(active: boolean) {
    const targets = variants.filter((v) => selectedVariantIds.includes(v.id) && v.is_active !== active);
    if (targets.length === 0) return;

    let failed = 0;
    for (const variant of targets) {
      try {
        await api(`/products/${productId}/variants/${variant.id}`, { method: 'PUT', body: { is_active: active } });
      } catch {
        failed += 1;
      }
    }

    await load();
    setSelectedVariantIds([]);
    if (failed > 0) {
      showError(t('variants_bulk_partial_failure', { failed, total: targets.length }));
    } else {
      success(t('variants_bulk_success', { count: targets.length }));
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

  const combinationColumns: ColumnDef<Combination, unknown>[] = [
    {
      id: 'combination',
      accessorFn: (c) => c.option_values.map((v) => v.value).join(' / '),
      header: t('variants_column_combination'),
    },
    {
      id: 'status',
      header: t('variants_column_status'),
      cell: () => <Badge tone="neutral">{t('variants_status_new')}</Badge>,
    },
  ];

  const variantColumns: ColumnDef<Variant, unknown>[] = [
    {
      id: 'combination',
      accessorKey: 'display_name',
      header: t('variants_column_combination'),
      cell: ({ row }) => (
        <button
          type="button"
          className="text-start text-primary hover:underline"
          onClick={() => setDetailVariant(row.original)}
        >
          {row.original.display_name}
        </button>
      ),
    },
    {
      id: 'sku',
      accessorKey: 'sku',
      header: t('sku'),
      cell: ({ row }) => <span className="num" dir="ltr">{row.original.sku}</span>,
    },
    {
      id: 'status',
      header: t('variants_column_status'),
      cell: ({ row }) => (
        <Badge tone={row.original.is_active ? 'positive' : 'muted'}>
          {row.original.is_active ? t('active') : t('inactive')}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: t('actions'),
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => void toggleVariantActive(row.original)}>
            {row.original.is_active ? t('deactivate') : t('activate')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => void deleteVariant(row.original)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

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
                  <span key={value.id} className="inline-flex min-h-9 items-center gap-1.5 rounded border border-border bg-surface px-2.5 py-1 text-xs text-text">
                    {value.visual_type === 'color' && value.color_value ? <Swatch color={value.color_value} /> : null}
                    <button type="button" aria-label={t('variants_visual_edit', { name: value.value })} className="text-start hover:underline" onClick={() => setEditingValue({ optionId: option.id, value })}>
                      <span>{value.value}</span>
                    </button>
                    <button type="button" aria-label={t('remove')} className="flex h-5 w-5 items-center justify-center rounded hover:bg-primary-soft" onClick={() => void removeValue(option.id, value.id)}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <Input ref={(el) => { valueInputRefs.current[option.id] = el; }} className="h-9 w-32 text-xs" placeholder={t('variants_add_value_placeholder')} value={newValueByOption[option.id] ?? ''} onChange={(e) => setNewValueByOption((prev) => ({ ...prev, [option.id]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addValue(option.id); } }} />
                <Select aria-label={t('variants_visual_type_label')} className="h-9 w-32 text-xs" value={visualDraft(option.id).visual_type} onChange={(e) => setVisualDraft(option.id, { visual_type: e.target.value as VisualType })}>
                  <option value="none">{t('variants_visual_none')}</option>
                  <option value="color">{t('variants_visual_color')}</option>
                </Select>
                {visualDraft(option.id).visual_type === 'color' ? <ColorEditor draft={visualDraft(option.id)} onChange={(patch) => setVisualDraft(option.id, patch)} t={t} /> : null}
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
            <p className="rounded bg-primary-soft/40 px-3 py-2 text-sm">
              {t('variants_possible_combinations', { count: matrix.total_possible })}
            </p>
          )}
        </CardContent>
      </Card>

      {newCombinations.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
            <CardTitle>{t('variants_review_title')}</CardTitle>
            <span className="text-xs text-muted">
              {t('variants_selected_of_new', { selected: selectedCombos.length, total: newCombinations.length })}
            </span>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            <DataTable
              columns={combinationColumns}
              data={newCombinations}
              showToolbar={false}
              emptyLabel={t('variants_empty')}
              selection={{
                selectedIds: selectedCombos,
                onChange: setSelectedCombos,
                getRowId: (c) => c.combination_key,
              }}
              mobileRecord={(c) => ({
                title: c.option_values.map((v) => v.value).join(' / '),
                status: <Badge tone="neutral">{t('variants_status_new')}</Badge>,
              })}
            />
            {/* شريطٌ ثابتٌ سفلياً على الجوال يحترم منطقة الأمان — لا يختفي
                إجراء الإنشاء الرئيسي خلف حافة الشاشة أو لوحة المفاتيح. */}
            <div className="sticky bottom-0 -mx-4 -mb-4 flex items-center justify-end gap-2 border-t border-border bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:static sm:m-0 sm:border-0 sm:p-0">
              <Button type="button" size="sm" onClick={() => void createSelectedVariants()} disabled={selectedCombos.length === 0}>
                {t('variants_create_selected', { count: selectedCombos.length })}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle>{t('variants_table_title', { count: variants.length })}</CardTitle>
          {variants.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => { setMultiSelect((v) => !v); setSelectedVariantIds([]); }}
            >
              {multiSelect ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
              {t('variants_multi_select')}
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          {multiSelect && selectedVariantIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-surface px-3 py-2 text-sm">
              <span className="num text-text">{t('selected_count', { count: selectedVariantIds.length })}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedVariantIds([])}>{t('clear_selection')}</Button>
              <div className="ms-auto flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void bulkSetActive(true)}>{t('activate')}</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void bulkSetActive(false)}>{t('deactivate')}</Button>
              </div>
            </div>
          )}
          <DataTable
            columns={variantColumns}
            data={variants}
            loading={loading}
            showToolbar
            searchPlaceholder={t('variants_search_placeholder')}
            emptyLabel={t('variants_empty')}
            selection={multiSelect ? {
              selectedIds: selectedVariantIds,
              onChange: setSelectedVariantIds,
              getRowId: (v) => v.id,
            } : undefined}
            mobileRecord={(variant) => ({
              title: (
                <button type="button" className="text-start text-primary hover:underline" onClick={() => setDetailVariant(variant)}>
                  {variant.display_name}
                </button>
              ),
              meta: <span dir="ltr">{variant.sku}</span>,
              status: (
                <Badge tone={variant.is_active ? 'positive' : 'muted'}>
                  {variant.is_active ? t('active') : t('inactive')}
                </Badge>
              ),
            })}
          />
        </CardContent>
      </Card>

      <OptionValueVisualSheet
        productId={productId}
        editing={editingValue}
        onClose={() => setEditingValue(null)}
        onSaved={() => { setEditingValue(null); void load(); }}
      />
      <VariantDetailSheet
        productId={productId}
        variant={detailVariant}
        onClose={() => setDetailVariant(null)}
        onSaved={() => { void load(); }}
        onDeleted={() => { setDetailVariant(null); void load(); }}
      />
    </div>
  );
}

/**
 * تفاصيل متغيّرٍ واحد — نفس مكوّن `Sheet` المشترك (لوحةٌ جانبية على سطح
 * المكتب، وملء الشاشة تلقائياً على الجوال بحكم عرضه المتجاوب القائم) بدل
 * اختراع محرّرَين منفصلين لسطح المكتب والجوال.
 */
function VariantDetailSheet({ productId, variant, onClose, onSaved, onDeleted }: {
  productId: string;
  variant: Variant | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const t = useTranslations('products');
  const { success, error: showError } = useToast();
  const [sku, setSku] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (variant) {
      setSku(variant.sku);
      setIsActive(variant.is_active);
    }
  }, [variant]);

  async function save() {
    if (!variant) return;
    setSaving(true);
    try {
      await api(`/products/${productId}/variants/${variant.id}`, {
        method: 'PUT',
        body: { sku, is_active: isActive },
      });
      success(t('variants_saved'));
      onSaved();
      onClose();
    } catch (err) {
      showError(err instanceof ApiError ? err.message : t('action_failed'));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!variant || !window.confirm(t('variants_delete_confirm', { name: variant.display_name }))) return;
    try {
      await api(`/products/${productId}/variants/${variant.id}`, { method: 'DELETE' });
      success(t('variants_deleted'));
      onDeleted();
    } catch (err) {
      showError(err instanceof ApiError ? err.message : t('action_failed'));
    }
  }

  return (
    <Sheet open={variant != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      {variant && (
        <SheetContent closeLabel={t('close')}>
          <header className="shrink-0 border-b border-border px-5 pb-4 pe-14 pt-4">
            <p className="text-xs font-medium text-muted">{t('variants_detail_title')}</p>
            <SheetTitle className="mt-1 text-lg font-semibold text-text">{variant.display_name}</SheetTitle>
          </header>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
            <div>
              <p className="text-xs font-medium text-muted">{t('variants_column_combination')}</p>
              <dl className="mt-2 space-y-1">
                {variant.option_values.map((v) => (
                  <div key={v.value_id} className="flex items-center justify-between text-sm">
                    <dt className="text-muted">{v.option_name}</dt>
                    <dd className="text-text">{v.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted" htmlFor="variant-detail-sku">{t('sku')}</label>
              <Input id="variant-detail-sku" dir="ltr" value={sku} onChange={(e) => setSku(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted" htmlFor="variant-detail-status">{t('variants_column_status')}</label>
              <Select id="variant-detail-status" value={isActive ? '1' : '0'} onChange={(e) => setIsActive(e.target.value === '1')}>
                <option value="1">{t('active')}</option>
                <option value="0">{t('inactive')}</option>
              </Select>
            </div>
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-5 py-4">
            <Button type="button" variant="ghost" size="sm" onClick={() => void remove()}>
              <Trash2 className="h-3.5 w-3.5" />{t('delete')}
            </Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>{t('cancel')}</Button>
              <Button type="button" size="sm" onClick={() => void save()} disabled={saving}>{t('save')}</Button>
            </div>
          </footer>
        </SheetContent>
      )}
    </Sheet>
  );
}


function Swatch({ color }: { color: string }) {
  return <span aria-hidden="true" className="inline-block h-4 w-4 shrink-0 rounded-full border border-border" style={{ backgroundColor: color }} />;
}

function ColorEditor({ draft, onChange, t }: { draft: VisualDraft; onChange: (patch: Partial<VisualDraft>) => void; t: (key: string) => string }) {
  const pickerValue = /^#[0-9A-Fa-f]{6}$/.test(draft.color_value) ? draft.color_value : '#000000';
  return <div className="flex items-center gap-2">
    <label className="sr-only" htmlFor="new-option-color">{t('variants_color_picker')}</label>
    <input id="new-option-color" aria-label={t('variants_color_picker')} type="color" value={pickerValue} onChange={(e) => onChange({ color_value: e.target.value.toUpperCase() })} className="h-9 w-10 cursor-pointer rounded border border-border bg-surface p-1" />
    <Input aria-label={t('variants_hex_label')} dir="ltr" className="h-9 w-28 font-mono text-xs" placeholder="#RRGGBB" value={draft.color_value} onChange={(e) => onChange({ color_value: e.target.value })} />
    {/^#[0-9A-Fa-f]{6}$/.test(draft.color_value) ? <Swatch color={draft.color_value} /> : null}
  </div>;
}

function OptionValueVisualSheet({ productId, editing, onClose, onSaved }: { productId: string; editing: { optionId: string; value: OptionValue } | null; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('products');
  const { success, error: showError } = useToast();
  const [draft, setDraft] = useState<VisualDraft>({ visual_type: 'none', color_value: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (editing) setDraft({ visual_type: editing.value.visual_type === 'color' ? 'color' : 'none', color_value: editing.value.color_value ?? '' });
  }, [editing]);
  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      await api(`/products/${productId}/options/${editing.optionId}/values/${editing.value.id}`, { method: 'PUT', body: visualPayload(draft) });
      success(t('variants_visual_saved'));
      onSaved();
    } catch (err) { showError(err instanceof ApiError ? err.message : t('action_failed')); }
    finally { setSaving(false); }
  }
  return <Sheet open={editing !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
    {editing ? <SheetContent closeLabel={t('close')}>
      <header className="shrink-0 border-b border-border px-5 pb-4 pe-14 pt-4"><p className="text-xs font-medium text-muted">{t('variants_visual_title')}</p><SheetTitle className="mt-1 text-lg font-semibold text-text">{editing.value.value}</SheetTitle></header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <div className="space-y-1.5"><label className="text-xs font-medium text-muted" htmlFor="edit-visual-type">{t('variants_visual_type_label')}</label><Select id="edit-visual-type" value={draft.visual_type} onChange={(e) => setDraft((prev) => ({ ...prev, visual_type: e.target.value as VisualType }))}><option value="none">{t('variants_visual_none')}</option><option value="color">{t('variants_visual_color')}</option></Select></div>
        {draft.visual_type === 'color' ? <ColorEditor draft={draft} onChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))} t={t} /> : <p className="text-xs text-muted">{t('variants_visual_none_hint')}</p>}
      </div>
      <footer className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-4"><Button type="button" variant="outline" size="sm" onClick={onClose}>{t('cancel')}</Button><Button type="button" size="sm" onClick={() => void save()} disabled={saving}>{t('save')}</Button></footer>
    </SheetContent> : null}
  </Sheet>;
}
