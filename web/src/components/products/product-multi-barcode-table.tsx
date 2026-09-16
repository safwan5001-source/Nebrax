'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { riyalToMinor } from '@/lib/money';

interface UnitOption {
  name: string;
  factor: number;
}

interface VariantOption {
  id: string;
  descriptor: string;
}

interface BarcodeRow {
  id: string;
  code: string;
  unit_name: string | null;
  default_quantity: number;
  label: string | null;
  product_variant_id: string | null;
  variant_descriptor: string | null;
}

interface UnitPriceRow {
  id: string;
  product_variant_id: string | null;
  unit_name: string;
  price: string;
}

/**
 * سطرٌ معلَّقٌ — قبل وجود `product_id` — لهويّة باركود×وحدة×سعر. الشكل نفسه
 * الذي كانت `/products/new` تجمعه محلياً قبل PR-PROD-UX-2؛ لا سلطة منفصلة:
 * يُدمَج حرفياً ضمن `barcodes[]`/`unit_prices[]` في نفس طلب `POST /products`
 * الذرّي (`ProductWorkspace`), الذي يبقى المصدر الوحيد لبنائه.
 */
export interface PendingBarcodeRow {
  code: string;
  unit_name: string | null;
  default_quantity: number;
  label: string | null;
  /** نصٌّ بالريال — فارغٌ يعني «بلا سعرٍ صريح لهذه الوحدة بعد». */
  price: string;
}

/**
 * VAR-PRICE-UX-1 (GAP-02/GAP-03) + PR-PROD-UX-2 — جدول «باركود متعدد»: الوحدة
 * × المعامل × الباركود × الكمية × سعر البيع × الإجراءات، وفق
 * docs/plans/products-inventory/AWJ_MULTIPLE_BARCODE_UOM_SELLING_PRICE_UX_CONTRACT.md.
 *
 * **السعر ليس ملكاً للسطر.** كل صفٍّ يعرض سعر الهويّة (المنتج أو المتغيّر
 * المحدَّد) × الوحدة نفسها — لا عموداً على الباركود. تعديل السعر في أي صفٍّ
 * يكتب إلى `ProductPricingService` عبر `PUT products/{id}/unit-prices`
 * فيظهر فوراً في كل الصفوف الأخرى المطابقة لنفس الهويّة×الوحدة (لا نسخة
 * محلية للسعر — يُعاد جلب القائمة القانونية بعد كل حفظ).
 *
 * لا معامل×سعرٍ محسوبٍ هنا إطلاقاً — كل سعرٍ صريحٌ مستقل، والمعامل عمودٌ
 * معلوماتيٌّ بحت.
 *
 * **وضعان بمكوّنٍ واحد، لا تطبيقين (PR-PROD-UX-2):** حين لا يوجد `productId`
 * بعد (منتجٌ لم يُحفَظ أول مرّة)، الجدول محليٌّ بحت — لا نداء شبكة، والصفوف
 * تُدار عبر `pendingRows`/`onPendingRowsChange` التي يملكها المستدعي
 * (`ProductWorkspace`) ليدمجها ذرّياً في `POST /products` الأول. حين يوجد
 * `productId`، يعمل الجدول بسلطته الحقيقية القائمة (`/barcodes`,
 * `/unit-prices`) دون أي تغيير. الانتقال بين الحالتين تلقائيٌّ ببساطة: بمجرد
 * ظهور `productId` (بعد الحفظ الأول)، يُعاد الجلب من الخادم فعلياً — لا إعادة
 * إرسالٍ للصفوف المُنشأة ذرّياً بالفعل ضمن نفس المعاملة.
 */
export function ProductMultiBarcodeTable({
  productId,
  baseUnitName,
  alternateUnits,
  isVariantManaged,
  variants,
  pendingRows,
  onPendingRowsChange,
}: {
  productId?: string;
  baseUnitName: string;
  alternateUnits: UnitOption[];
  isVariantManaged: boolean;
  variants: VariantOption[];
  /** وضع الإنشاء فقط — الصفوف المُعلَّقة يملكها المستدعي (`ProductWorkspace`). */
  pendingRows?: PendingBarcodeRow[];
  onPendingRowsChange?: (rows: PendingBarcodeRow[]) => void;
}) {
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const { success, error: toastError } = useToast();
  const isCreateMode = !productId;

  const [expanded, setExpanded] = useState(false);
  const autoExpandedRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [liveBarcodes, setLiveBarcodes] = useState<BarcodeRow[]>([]);
  const [livePrices, setLivePrices] = useState<UnitPriceRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [newUnit, setNewUnit] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newQty, setNewQty] = useState('1');
  const [newPrice, setNewPrice] = useState('');
  const [newVariantId, setNewVariantId] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingPriceKey, setSavingPriceKey] = useState<string | null>(null);

  const pending = pendingRows ?? [];

  // في وضع الإنشاء، الصفوف والأسعار مُشتقّةٌ محلياً من `pendingRows` — لا نداء
  // شبكة، ولا هويّة متغيّرٍ (لا متغيّرات قبل أول حفظ أصلاً). بمجرد وجود
  // `productId` تصبح `liveBarcodes`/`livePrices` (المُحمَّلتان فعلياً من
  // الخادم) هما المصدر الوحيد — هذا هو الانتقال الكامل، بلا كودٍ خاصٍّ إضافي.
  const barcodes: BarcodeRow[] = isCreateMode
    ? pending.map((row, index) => ({
        id: `pending-${index}`,
        code: row.code,
        unit_name: row.unit_name,
        default_quantity: row.default_quantity,
        label: row.label,
        product_variant_id: null,
        variant_descriptor: null,
      }))
    : liveBarcodes;
  const prices: UnitPriceRow[] = isCreateMode
    ? pending
        .filter((row) => row.price.trim() !== '')
        .map((row, index) => ({ id: `pending-price-${index}`, product_variant_id: null, unit_name: row.unit_name ?? baseUnitName, price: row.price }))
    : livePrices;
  const showVariantColumn = isVariantManaged && !isCreateMode;

  const unitOptions = useMemo(
    () => [{ name: baseUnitName, factor: 1 }, ...alternateUnits],
    [baseUnitName, alternateUnits],
  );

  const factorFor = useCallback(
    (unitName: string | null) => unitOptions.find((u) => u.name === (unitName ?? baseUnitName))?.factor ?? 1,
    [unitOptions, baseUnitName],
  );

  /** «باكيت — 6 حبات» بدل «pack ×6» الخام — بلا تعديل نموذج الوحدة نفسه. */
  const unitLabel = useCallback(
    (unitName: string | null) => {
      const name = unitName ?? baseUnitName;
      const factor = factorFor(unitName);

      return factor <= 1 ? name : t('unit_with_base_count', { unit: name, count: factor, base: baseUnitName });
    },
    [baseUnitName, factorFor, t],
  );

  const priceKey = useCallback((unitName: string, variantId: string | null) => `${unitName}|${variantId ?? ''}`, []);

  const priceFor = useCallback(
    (unitName: string | null, variantId: string | null) => {
      const storedUnit = unitName ?? baseUnitName;
      const row = prices.find((p) => p.unit_name === storedUnit && (p.product_variant_id ?? null) === variantId);

      return row?.price ?? '';
    },
    [prices, baseUnitName],
  );

  const load = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    setError(null);
    try {
      const [barcodeResult, priceResult] = await Promise.all([
        api<{ data: BarcodeRow[] }>(`/products/${productId}/barcodes`),
        api<{ data: UnitPriceRow[] }>(`/products/${productId}/unit-prices`),
      ]);
      setLiveBarcodes(barcodeResult.data);
      setLivePrices(priceResult.data);
      if (!autoExpandedRef.current && barcodeResult.data.length > 0) {
        autoExpandedRef.current = true;
        setExpanded(true);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('load_profile_failed'));
    } finally {
      setLoading(false);
    }
  }, [productId, t]);

  useEffect(() => {
    if (productId) void load();
  }, [load, productId]);

  useEffect(() => {
    if (isCreateMode && !autoExpandedRef.current && pending.length > 0) {
      autoExpandedRef.current = true;
      setExpanded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreateMode, pending.length]);

  async function savePrice(unitName: string | null, variantId: string | null, riyalValue: string) {
    const storedUnit = unitName ?? baseUnitName;
    const key = priceKey(storedUnit, variantId);
    if (riyalValue.trim() === '') return;
    const minor = riyalToMinor(riyalValue);
    if (!Number.isFinite(minor) || minor < 0) {
      toastError(t('unit_price_invalid'));
      return;
    }
    if (isCreateMode) {
      // نفس الهويّة×الوحدة تشارك سعراً واحداً — تحديثه هنا يُحدِّث كل الصفوف
      // المُعلَّقة لهذه الوحدة معاً، لا صفّاً واحداً، فيطابق سلوك السلطة
      // القانونية الحقيقية (`ProductPricingService::setPrice`) بصرياً حتى قبل
      // أن توجد فعلياً.
      onPendingRowsChange?.(pending.map((row) => ((row.unit_name ?? baseUnitName) === storedUnit ? { ...row, price: riyalValue } : row)));
      return;
    }
    setSavingPriceKey(key);
    setError(null);
    try {
      await api(`/products/${productId}/unit-prices`, {
        method: 'PUT',
        body: { unit_name: unitName, product_variant_id: variantId, price: minor },
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSavingPriceKey(null);
    }
  }

  function resetNewRowFields() {
    setNewUnit('');
    setNewCode('');
    setNewQty('1');
    setNewPrice('');
    setNewVariantId('');
    setNewLabel('');
  }

  async function addRow() {
    if (!newCode.trim() || saving) return;
    const qty = newQty.trim() === '' ? 1 : Number(newQty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000000) {
      setError(t('barcode_quantity_invalid'));
      return;
    }
    const priceInput = newPrice.trim();
    if (isCreateMode) {
      // وضع الإنشاء يرفض سعراً غير صالح فوراً (لا حفظ ذرّي مؤجَّلٍ لخطأٍ
      // كامنٍ) — يطابق سلوك مُنتقي الباركود المُعلَّق القديم على `/products/new`
      // حرفياً قبل هذا التوحيد.
      if (priceInput !== '' && !Number.isFinite(riyalToMinor(priceInput))) {
        setError(t('unit_price_invalid'));
        return;
      }
      setError(null);
      onPendingRowsChange?.([
        ...pending,
        { code: newCode.trim(), unit_name: newUnit || null, default_quantity: qty, label: newLabel.trim() || null, price: priceInput },
      ]);
      resetNewRowFields();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api(`/products/${productId}/barcodes`, {
        method: 'POST',
        body: {
          code: newCode.trim(),
          unit_name: newUnit || null,
          default_quantity: qty,
          label: newLabel.trim() || null,
          product_variant_id: isVariantManaged && newVariantId ? newVariantId : null,
        },
      });
      if (priceInput !== '') {
        const minor = riyalToMinor(priceInput);
        if (Number.isFinite(minor) && minor >= 0) {
          await api(`/products/${productId}/unit-prices`, {
            method: 'PUT',
            body: {
              unit_name: newUnit || null,
              product_variant_id: isVariantManaged && newVariantId ? newVariantId : null,
              price: minor,
            },
          });
        }
      }
      resetNewRowFields();
      await load();
      success(t('barcode_added'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function deleteRow(row: BarcodeRow) {
    if (isCreateMode) {
      const index = Number(row.id.replace('pending-', ''));
      onPendingRowsChange?.(pending.filter((_, i) => i !== index));
      return;
    }
    if (!window.confirm(t('barcode_delete_confirm', { code: row.code }))) return;
    setError(null);
    try {
      await api(`/products/${productId}/barcodes/${row.id}`, { method: 'DELETE' });
      await load();
      success(t('barcode_deleted'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    }
  }

  function variantLabel(variantId: string | null, descriptor: string | null): string {
    if (variantId === null) return t('multi_barcode_no_variant');

    return descriptor ?? variantId;
  }

  const priceInputId = (row: BarcodeRow) => `mb-price-${row.id}`;

  return (
    <section className="space-y-3 rounded-md border border-border p-3" aria-labelledby="multi-barcode-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="multi-barcode-title" className="text-sm font-medium text-text">{t('alternate_barcodes')}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">{t('multi_barcode_hint')}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setExpanded((v) => !v)}>
          {expanded ? t('multi_barcode_collapse') : t('multi_barcode_expand')}
        </Button>
      </div>

      {expanded && (
        <div className="space-y-3">
          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <>
              {/* سطح المكتب: جدولٌ كثيف — البطل هنا. */}
              <div className="hidden overflow-x-auto rounded-md border border-border md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-background text-xs text-muted">
                      <th className="px-2 py-2 text-start font-medium">{t('multi_barcode_col_unit')}</th>
                      <th className="px-2 py-2 text-start font-medium">{t('multi_barcode_col_factor')}</th>
                      <th className="px-2 py-2 text-start font-medium">{t('multi_barcode_col_barcode')}</th>
                      <th className="px-2 py-2 text-start font-medium">{t('multi_barcode_col_quantity')}</th>
                      <th className="px-2 py-2 text-start font-medium">{t('multi_barcode_col_price')}</th>
                      {showVariantColumn && <th className="px-2 py-2 text-start font-medium">{t('multi_barcode_col_variant')}</th>}
                      <th className="px-2 py-2 text-start font-medium">{t('multi_barcode_col_actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {barcodes.map((row) => {
                      const key = priceKey(row.unit_name ?? baseUnitName, row.product_variant_id);

                      return (
                        <tr key={row.id}>
                          <td className="px-2 py-1.5">{unitLabel(row.unit_name)}</td>
                          <td className="num px-2 py-1.5 text-muted">×{factorFor(row.unit_name)}</td>
                          <td className="num px-2 py-1.5" dir="ltr">{row.code}</td>
                          <td className="num px-2 py-1.5">{row.default_quantity}</td>
                          <td className="px-2 py-1.5">
                            <Label htmlFor={priceInputId(row)} className="sr-only">{t('multi_barcode_col_price')}</Label>
                            <Input
                              key={priceFor(row.unit_name, row.product_variant_id)}
                              id={priceInputId(row)}
                              className="num w-24 text-end"
                              defaultValue={priceFor(row.unit_name, row.product_variant_id)}
                              disabled={savingPriceKey === key}
                              onBlur={(e) => void savePrice(row.unit_name, row.product_variant_id, e.target.value)}
                            />
                          </td>
                          {showVariantColumn && (
                            <td className="px-2 py-1.5 text-xs text-muted">{variantLabel(row.product_variant_id, row.variant_descriptor)}</td>
                          )}
                          <td className="px-2 py-1.5">
                            <Button type="button" variant="ghost" size="icon" aria-label={`${t('delete')}: ${row.code}`} onClick={() => void deleteRow(row)}>
                              <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="bg-background/60">
                      <td className="px-2 py-1.5">
                        <Select aria-label={t('unit')} value={newUnit} onChange={(e) => setNewUnit(e.target.value)}>
                          <option value="">{baseUnitName}</option>
                          {alternateUnits.map((u) => <option key={u.name} value={u.name}>{unitLabel(u.name)}</option>)}
                        </Select>
                      </td>
                      <td className="num px-2 py-1.5 text-muted">×{factorFor(newUnit || null)}</td>
                      <td className="px-2 py-1.5">
                        <Input aria-label={t('barcode_code')} dir="ltr" className="num" value={newCode} onChange={(e) => setNewCode(e.target.value)} disabled={saving} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input aria-label={t('barcode_default_quantity')} type="number" min={1} max={1000000} className="num w-20 text-end" value={newQty} onChange={(e) => setNewQty(e.target.value)} disabled={saving} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input aria-label={t('multi_barcode_col_price')} className="num w-24 text-end" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} disabled={saving} placeholder="0.00" />
                      </td>
                      {showVariantColumn && (
                        <td className="px-2 py-1.5">
                          <Select aria-label={t('multi_barcode_col_variant')} value={newVariantId} onChange={(e) => setNewVariantId(e.target.value)} disabled={saving}>
                            <option value="">{t('multi_barcode_no_variant')}</option>
                            {variants.map((v) => <option key={v.id} value={v.id}>{v.descriptor}</option>)}
                          </Select>
                        </td>
                      )}
                      <td className="px-2 py-1.5">
                        <Button type="button" variant="outline" size="sm" disabled={!newCode.trim() || saving} onClick={() => void addRow()}>
                          <Plus className="h-4 w-4" strokeWidth={1.7} />{t('add_barcode')}
                        </Button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* الجوّال: صفوفٌ متراصّة بعناصر تحكّمٍ كاملة العرض بدل جدولٍ مضغوط. */}
              <div className="space-y-2 md:hidden">
                {barcodes.map((row) => {
                  const key = priceKey(row.unit_name ?? baseUnitName, row.product_variant_id);

                  return (
                    <div key={row.id} className="space-y-2 rounded-md border border-border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-text">{unitLabel(row.unit_name)}</p>
                          <p className="num text-xs text-muted" dir="ltr">{row.code}</p>
                        </div>
                        <Button type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label={`${t('delete')}: ${row.code}`} onClick={() => void deleteRow(row)}>
                          <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs text-muted">
                        <span>{t('multi_barcode_col_factor')}: ×{factorFor(row.unit_name)}</span>
                        <span>{t('multi_barcode_col_quantity')}: {row.default_quantity}</span>
                        {showVariantColumn && <span className="col-span-2">{t('multi_barcode_col_variant')}: {variantLabel(row.product_variant_id, row.variant_descriptor)}</span>}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`${priceInputId(row)}-m`}>{t('multi_barcode_col_price')}</Label>
                        <Input
                          key={priceFor(row.unit_name, row.product_variant_id)}
                          id={`${priceInputId(row)}-m`}
                          className="num h-11 w-full text-end"
                          defaultValue={priceFor(row.unit_name, row.product_variant_id)}
                          disabled={savingPriceKey === key}
                          onBlur={(e) => void savePrice(row.unit_name, row.product_variant_id, e.target.value)}
                        />
                      </div>
                    </div>
                  );
                })}

                <div className="space-y-2 rounded-md border border-dashed border-border p-3">
                  <p className="text-sm font-medium text-text">{t('add_barcode')}</p>
                  <div className="space-y-1.5">
                    <Label htmlFor="mb-new-unit-m">{t('unit')}</Label>
                    <Select id="mb-new-unit-m" className="h-11 w-full" value={newUnit} onChange={(e) => setNewUnit(e.target.value)}>
                      <option value="">{baseUnitName}</option>
                      {alternateUnits.map((u) => <option key={u.name} value={u.name}>{unitLabel(u.name)}</option>)}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mb-new-code-m">{t('barcode_code')}</Label>
                    <Input id="mb-new-code-m" dir="ltr" className="num h-11 w-full" value={newCode} onChange={(e) => setNewCode(e.target.value)} disabled={saving} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="mb-new-qty-m">{t('barcode_default_quantity')}</Label>
                      <Input id="mb-new-qty-m" type="number" min={1} max={1000000} className="num h-11 w-full text-end" value={newQty} onChange={(e) => setNewQty(e.target.value)} disabled={saving} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="mb-new-price-m">{t('multi_barcode_col_price')}</Label>
                      <Input id="mb-new-price-m" className="num h-11 w-full text-end" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} disabled={saving} placeholder="0.00" />
                    </div>
                  </div>
                  {showVariantColumn && (
                    <div className="space-y-1.5">
                      <Label htmlFor="mb-new-variant-m">{t('multi_barcode_col_variant')}</Label>
                      <Select id="mb-new-variant-m" className="h-11 w-full" value={newVariantId} onChange={(e) => setNewVariantId(e.target.value)} disabled={saving}>
                        <option value="">{t('multi_barcode_no_variant')}</option>
                        {variants.map((v) => <option key={v.id} value={v.id}>{v.descriptor}</option>)}
                      </Select>
                    </div>
                  )}
                  <Button type="button" className="h-11 w-full" disabled={!newCode.trim() || saving} onClick={() => void addRow()}>
                    <Plus className="h-4 w-4" strokeWidth={1.7} />{t('add_barcode')}
                  </Button>
                </div>
              </div>

              {barcodes.length === 0 && (
                <p className="rounded-md bg-background px-3 py-2 text-sm text-muted">{t('no_alternate_barcodes')}</p>
              )}
            </>
          )}
          {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
        </div>
      )}
    </section>
  );
}
