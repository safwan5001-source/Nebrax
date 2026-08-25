'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatRiyal } from '@/lib/money';
import { cn } from '@/lib/utils';

export type AllocationKind = 'none' | 'single' | 'multiple';
export type AllocationInputMode = 'percent' | 'amount';
export interface LineAllocation { costCenterId: string; value: string }

export interface InvoiceLine {
  key: string;
  productId: string | null;
  description: string;
  qty: string;
  price: string;
  tax: string;
  disc: string;
  unit: string;
  allocationKind: AllocationKind;
  allocationInputMode: AllocationInputMode;
  allocations: LineAllocation[];
  minimumPriceOverrideReason: string;
}

export interface LineCostCenter { id: string; code: string; name: string }
export interface LineUnit { name: string; factor: number }

/**
 * ثلاث حالات للسطر لا اثنتان:
 *
 * - **الجوال** (< md): بطاقةٌ بعمود واحد، لكل حقلٍ تسميتُه — ثمانية حقول في
 *   عمودين على شاشة ٣٩٠px تجعل كلاً منها أضيق من رقمه.
 * - **التابلت** (md … lg): عمودان. ليس جوالاً مكبَّراً ولا صفّاً كثيفاً: ٧٦٨px
 *   لا تسع ثمانية أعمدة، لكنها تسع اثنين بلا ضيق.
 * - **الديسكتوب** (lg+): صفّ ERP واحد كثيف بمسارات صريحة، ورأس الأعمدة يغني عن
 *   التسميات فتُخفى إلى `sr-only`.
 */
export const LINE_GRID =
  'lg:grid-cols-[minmax(6.5rem,2.2fr)_minmax(5.5rem,1.6fr)_minmax(4.5rem,1.1fr)_minmax(8.5rem,1.3fr)_3.75rem_3.5rem_minmax(4.5rem,1fr)_2.25rem]';

/** تسميةٌ ظاهرة على الجوال والتابلت، ومخفيّةٌ للقارئ الآلي على الديسكتوب. */
function LineField({
  label, htmlFor, className, children,
}: { label: string; htmlFor: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('min-w-0', className)}>
      <Label htmlFor={htmlFor} className="mb-0.5 block text-[11px] font-medium text-muted lg:sr-only lg:mb-0">
        {label}
      </Label>
      {children}
    </div>
  );
}

export interface InvoiceLineRowProps {
  line: InvoiceLine;
  productOptions: ComboOption[];
  units: LineUnit[];
  centers: LineCostCenter[];
  /** صافي السطر بالهللات بعد خصمه — أساس تخصيص المبالغ. */
  net: number;
  /** ضريبة السطر بالهللات. */
  lineTax: number;
  /** الحد الأدنى المسجَّل للمنتج (ريالات كنصّ) — أو `null` إن لم يكن له حدّ. */
  minSalePrice: string | null;
  /** هل السعر الحالي تحت الحدّ الأدنى فعلاً؟ */
  belowMinimum: boolean;
  allocationTotal: number | null;
  allocationIssue: string | null;
  canRemove: boolean;
  onPatch: (patch: Partial<InvoiceLine>) => void;
  onPickProduct: (productId: string) => void;
  onChangeUnit: (unit: string) => void;
  onNewProduct: () => void;
  onRemove: () => void;
  onAllocationKind: (kind: AllocationKind) => void;
  onAllocationInputMode: (mode: AllocationInputMode) => void;
  onAllocationPatch: (index: number, patch: Partial<LineAllocation>) => void;
  onAllocationAdd: () => void;
  onAllocationRemove: (index: number) => void;
}

export function InvoiceLineRow({
  line, productOptions, units, centers, net, lineTax,
  minSalePrice, belowMinimum, allocationTotal, allocationIssue, canRemove,
  onPatch, onPickProduct, onChangeUnit, onNewProduct, onRemove,
  onAllocationKind, onAllocationInputMode, onAllocationPatch, onAllocationAdd, onAllocationRemove,
}: InvoiceLineRowProps) {
  const t = useTranslations('invoiceForm');
  const [expanded, setExpanded] = React.useState(false);

  const hasAllocation = line.allocationKind !== 'none';
  // الإفصاح يُفتَح قسراً على ما لا يجوز أن يمرّ دون رؤية: سعرٌ تحت الحدّ، أو
  // خطأ تخصيص، أو تخصيصٌ قائم يحمل أرقاماً يراجعها المحاسب.
  const forceOpen = belowMinimum || Boolean(allocationIssue) || hasAllocation;
  const open = expanded || forceOpen;

  const basisPointsToPercent = (value: number) => {
    const whole = Math.floor(value / 100);
    const fraction = String(value % 100).padStart(2, '0');
    return fraction === '00' ? String(whole) : `${whole}.${fraction}`;
  };
  const remaining = allocationTotal === null
    ? null
    : line.allocationInputMode === 'percent' ? 10000 - allocationTotal : net - allocationTotal;

  const advancedId = `line-advanced-${line.key}`;

  return (
    <div
      className={cn(
        'rounded-lg border border-border p-2 lg:rounded-none lg:border-0 lg:p-0',
        // الفواصل ٦px على الجوال، والصفّ الكثيف من `lg` وحدها.
        'space-y-1.5 lg:space-y-0'
      )}
    >
      <div className={cn('grid grid-cols-1 gap-x-2 gap-y-1.5 md:grid-cols-2 lg:items-center lg:gap-2 lg:gap-y-0', LINE_GRID)}>
        <LineField label={t('item')} htmlFor={`${line.key}-product`}>
          <Combobox
            id={`${line.key}-product`}
            value={line.productId ?? ''}
            onChange={onPickProduct}
            options={productOptions}
            placeholder={t('manual')}
            searchPlaceholder={t('search_product')}
            emptyText={t('no_product_found')}
            clearLabel={t('manual')}
            footerLabel={t('new_product')}
            onFooterClick={onNewProduct}
            aria-label={t('item')}
          />
        </LineField>

        <LineField label={t('description')} htmlFor={`${line.key}-description`}>
          <Input
            id={`${line.key}-description`}
            placeholder={t('description')}
            value={line.description}
            onChange={(e) => onPatch({ description: e.target.value, productId: null })}
          />
        </LineField>

        <LineField label={t('price')} htmlFor={`${line.key}-price`}>
          <Input
            id={`${line.key}-price`} className="num text-end" inputMode="decimal" dir="ltr" placeholder="0.00"
            value={line.price} onChange={(e) => onPatch({ price: e.target.value })}
            aria-invalid={belowMinimum || undefined}
          />
        </LineField>

        {/* الوحدة تحت الكمية على الجوال فلا تضغط خانتها، وبجانبها من `lg`. */}
        <LineField label={t('qty')} htmlFor={`${line.key}-qty`}>
          <div className="space-y-1.5 lg:flex lg:items-center lg:gap-1 lg:space-y-0">
            <Input
              id={`${line.key}-qty`} className="num text-end lg:flex-1" type="number" min={1} dir="ltr"
              value={line.qty} onChange={(e) => onPatch({ qty: e.target.value })}
            />
            {units.length >= 2 && (
              <Select
                className="lg:w-20 lg:shrink-0" value={line.unit} aria-label={t('unit')}
                onChange={(e) => onChangeUnit(e.target.value)}
              >
                {units.map((u) => (
                  <option key={u.name} value={u.factor === 1 ? '' : u.name}>{u.name}</option>
                ))}
              </Select>
            )}
          </div>
        </LineField>

        <LineField label={t('line_discount_short')} htmlFor={`${line.key}-discount`}>
          <Input
            id={`${line.key}-discount`} className="num text-end" inputMode="decimal" dir="ltr" placeholder="0"
            value={line.disc} onChange={(e) => onPatch({ disc: e.target.value })}
          />
        </LineField>

        <LineField label={t('tax')} htmlFor={`${line.key}-tax`}>
          <Input
            id={`${line.key}-tax`} className="num text-end" type="number" min={0} max={100} dir="ltr"
            value={line.tax} onChange={(e) => onPatch({ tax: e.target.value })}
          />
        </LineField>

        {/* الإجمالي والحذف صفٌّ واحد مضغوط دون `lg`؛ و`lg:contents` يذيب الغلاف
            فيعود كلٌّ خليّةً في الصفّ الكثيف. */}
        <div className="col-span-full flex items-center justify-between gap-2 border-t border-border pt-1.5 md:col-span-2 lg:contents lg:border-0 lg:pt-0">
          <div className="lg:text-end">
            <span className="text-[11px] font-medium text-muted lg:hidden">{t('total_with_vat')}</span>{' '}
            <span className="num text-sm font-semibold text-text lg:font-normal">{formatRiyal((net + lineTax) / 100)}</span>
          </div>
          <Button
            type="button" variant="ghost" size="icon" className="shrink-0 lg:ms-auto"
            aria-label={t('remove_line')} disabled={!canRemove} onClick={onRemove}
          >
            <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
          </Button>
        </div>
      </div>

      {/* ═══ إعدادات السطر المتقدّمة ═══
          مطويّة افتراضياً: لوحةُ تخصيصٍ مفتوحة تحت كل سطر تضاعف ارتفاعه ثلاث مرات
          وتدفع بقيّة البنود خارج الشاشة، بينما لا يستعملها أكثر التدفّقات. */}
      {(centers.length > 0 || minSalePrice) && (
        <div className="pt-1.5 lg:pt-2">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={open}
            aria-controls={advancedId}
            disabled={forceOpen}
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-[11px] font-medium',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              belowMinimum || allocationIssue ? 'text-negative' : 'text-muted hover:text-primary',
              forceOpen && 'cursor-default'
            )}
          >
            <span className="flex items-center gap-1.5">
              {belowMinimum || allocationIssue ? (
                <TriangleAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
              ) : null}
              {t('line_advanced')}
              {hasAllocation ? <span className="num text-primary">· {line.allocations.length}</span> : null}
            </span>
            {!forceOpen && (
              <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')} strokeWidth={2} aria-hidden />
            )}
          </button>

          {open && (
            <div id={advancedId} className="mt-1.5 space-y-3 rounded-md border border-border bg-surface/60 p-3">
              {minSalePrice && (
                <div className="space-y-1.5">
                  {belowMinimum && (
                    <p role="alert" className="rounded border border-warning/30 bg-warning/10 px-2.5 py-2 text-xs leading-relaxed text-warning">
                      {t('minimum_price_below', { amount: formatRiyal(Number(minSalePrice)) })}
                    </p>
                  )}
                  <Label htmlFor={`minimum-price-reason-${line.key}`}>{t('minimum_price_override_reason')}</Label>
                  <Input
                    id={`minimum-price-reason-${line.key}`}
                    value={line.minimumPriceOverrideReason}
                    maxLength={500}
                    onChange={(e) => onPatch({ minimumPriceOverrideReason: e.target.value })}
                    placeholder={t('minimum_price_override_reason_placeholder')}
                  />
                  <p className="text-xs leading-relaxed text-muted">
                    {t('minimum_price_override_reason_hint', { amount: formatRiyal(Number(minSalePrice)) })}
                  </p>
                </div>
              )}

              {centers.length > 0 && (
                <div className="space-y-3 border-t border-border pt-3 first:border-0 first:pt-0">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor={`line-center-kind-${line.key}`}>{t('line_cost_center')}</Label>
                      <Select
                        id={`line-center-kind-${line.key}`}
                        value={line.allocationKind}
                        onChange={(e) => onAllocationKind(e.target.value as AllocationKind)}
                      >
                        <option value="none">{t('line_cost_center_none')}</option>
                        <option value="single">{t('line_cost_center_single')}</option>
                        <option value="multiple">{t('line_cost_center_multiple')}</option>
                      </Select>
                    </div>
                    {hasAllocation && (
                      <div className="space-y-1.5">
                        <Label htmlFor={`line-center-mode-${line.key}`}>{t('allocation_mode')}</Label>
                        <Select
                          id={`line-center-mode-${line.key}`}
                          value={line.allocationInputMode}
                          onChange={(e) => onAllocationInputMode(e.target.value as AllocationInputMode)}
                        >
                          <option value="percent">{t('allocation_percent')}</option>
                          <option value="amount">{t('allocation_amount')}</option>
                        </Select>
                      </div>
                    )}
                  </div>

                  {hasAllocation && (
                    <div className="space-y-2">
                      {line.allocations.map((allocation, index) => (
                        <div key={`${line.key}-allocation-${index}`} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,180px)_auto]">
                          <div className="space-y-1.5">
                            <Label htmlFor={`line-center-${line.key}-${index}`}>{t('allocation_center')}</Label>
                            <Select
                              id={`line-center-${line.key}-${index}`}
                              value={allocation.costCenterId}
                              onChange={(e) => onAllocationPatch(index, { costCenterId: e.target.value })}
                            >
                              <option value="">{t('no_center')}</option>
                              {centers.map((center) => (
                                <option
                                  key={center.id}
                                  value={center.id}
                                  disabled={center.id !== allocation.costCenterId && line.allocations.some((item) => item.costCenterId === center.id)}
                                >
                                  {center.code} — {center.name}
                                </option>
                              ))}
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`line-center-value-${line.key}-${index}`}>
                              {line.allocationInputMode === 'percent' ? t('allocation_value_percent') : t('allocation_value_amount')}
                            </Label>
                            <Input
                              id={`line-center-value-${line.key}-${index}`}
                              className="num text-end" inputMode="decimal" dir="ltr" placeholder="0"
                              value={allocation.value}
                              onChange={(e) => onAllocationPatch(index, { value: e.target.value })}
                            />
                          </div>
                          <Button
                            type="button" variant="ghost" size="icon" className="mb-0.5"
                            aria-label={t('allocation_remove')} onClick={() => onAllocationRemove(index)}
                          >
                            <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
                          </Button>
                        </div>
                      ))}

                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
                        <Button type="button" variant="outline" size="sm" onClick={onAllocationAdd}>
                          <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />{t('allocation_add')}
                        </Button>
                        <div className="text-end text-xs" aria-live="polite">
                          <p className="text-muted">
                            {t('allocation_total')}: <span className="num text-text">
                              {allocationTotal === null
                                ? '—'
                                : line.allocationInputMode === 'percent'
                                  ? `${basisPointsToPercent(allocationTotal)}%`
                                  : formatRiyal(allocationTotal / 100)}
                            </span> {t('allocation_of_line')}
                          </p>
                          {remaining !== null && (
                            <p className={cn('num', remaining === 0 ? 'text-positive' : 'text-negative')}>
                              {remaining === 0
                                ? t('allocation_complete')
                                : `${t('allocation_remaining')}: ${line.allocationInputMode === 'percent' ? `${basisPointsToPercent(Math.abs(remaining))}%` : formatRiyal(Math.abs(remaining) / 100)}`}
                            </p>
                          )}
                        </div>
                      </div>
                      <p className="text-[11px] leading-relaxed text-muted">{t('allocation_hint')}</p>
                      {allocationIssue && <p className="text-xs text-negative" role="alert">{allocationIssue}</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
