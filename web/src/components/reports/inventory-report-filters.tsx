'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { EMPTY_FILTERS, ReportFilters, type ReportFilterState } from '@/components/reports/report-filters';
import type { InventoryReportView } from '@/components/reports/inventory-reports-workspace';

interface ProductOption { id: string; name: string; sku?: string | null; track_inventory: boolean }
interface WarehouseOption { id: string; name: string; code?: string | null }

export interface InventoryReportFilterState extends ReportFilterState {
  productId: string;
  warehouseId: string;
  movementType: '' | 'in' | 'out';
  operationType: '' | 'receipt' | 'issue' | 'transfer';
  hideZero: boolean;
}

export const EMPTY_INVENTORY_REPORT_FILTERS: InventoryReportFilterState = {
  ...EMPTY_FILTERS,
  productId: '',
  warehouseId: '',
  movementType: '',
  operationType: '',
  hideZero: false,
};

export function InventoryReportFilters({
  view,
  value,
  onChange,
}: {
  view: InventoryReportView;
  value: InventoryReportFilterState;
  onChange: (next: InventoryReportFilterState) => void;
}) {
  const t = useTranslations('reports.inventory');
  const [expanded, setExpanded] = useState(false);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const historical = view === 'movements' || view === 'operations' || view === 'stocktakes';
  const snapshot = !historical;

  useEffect(() => {
    Promise.all([
      api<{ data: ProductOption[] }>('/products'),
      api<{ data: WarehouseOption[] }>('/warehouses'),
    ]).then(([productResponse, warehouseResponse]) => {
      setProducts(productResponse.data.filter((product) => product.track_inventory));
      setWarehouses(warehouseResponse.data);
    }).catch(() => {});
  }, []);

  const productOptions = useMemo<ComboOption[]>(() => products.map((product) => ({
    value: product.id,
    label: product.name,
    sub: product.sku ?? undefined,
  })), [products]);
  const warehouseOptions = useMemo<ComboOption[]>(() => warehouses.map((warehouse) => ({
    value: warehouse.id,
    label: warehouse.name,
    sub: warehouse.code ?? undefined,
  })), [warehouses]);

  const dirty = value.productId !== '' || value.warehouseId !== '' || value.movementType !== ''
    || value.operationType !== '' || value.hideZero;
  const scopeDirty = (historical && (!!value.from || !!value.to)) || value.branchIds.length > 0;

  function patch(next: Partial<InventoryReportFilterState>) {
    onChange({ ...value, ...next });
  }

  return (
    <div className="space-y-3">
      <ReportFilters
        value={value}
        onChange={(base) => onChange({ ...value, ...base })}
        onClear={() => onChange(EMPTY_INVENTORY_REPORT_FILTERS)}
        showDateRange={historical}
        showBranches={view !== 'value'}
      />

      <div className="no-print flex flex-wrap items-center gap-2">
        <Button
          variant={expanded || dirty ? 'primary' : 'outline'}
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          <SlidersHorizontal className="h-4 w-4" strokeWidth={1.7} />
          {t('advancedFilters')}
          {expanded ? <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.8} /> : <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />}
        </Button>
        {(dirty || scopeDirty) && !expanded && <span className="text-xs text-muted">{t('filtersActive')}</span>}
      </div>

      {expanded && (
        <Card className="no-print border-primary/20">
          <CardContent className="p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-text">{t('advancedFilters')}</h2>
                <p className="mt-0.5 text-xs leading-5 text-muted">{t(snapshot ? 'snapshotScopeHint' : 'historyScopeHint')}</p>
              </div>
              {(dirty || scopeDirty) && <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_INVENTORY_REPORT_FILTERS)}>{t('resetAll')}</Button>}
            </div>

            <div className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-3')}>
              <div className="space-y-1.5">
                <Label htmlFor="inventory-product-filter">{t('product')}</Label>
                <Combobox
                  id="inventory-product-filter"
                  value={value.productId}
                  onChange={(productId) => patch({ productId })}
                  options={productOptions}
                  placeholder={t('allProducts')}
                  clearLabel={t('allProducts')}
                  searchPlaceholder={t('searchProduct')}
                  emptyText={t('noProducts')}
                  aria-label={t('product')}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="inventory-warehouse-filter">{t('warehouse')}</Label>
                <Combobox
                  id="inventory-warehouse-filter"
                  value={value.warehouseId}
                  onChange={(warehouseId) => patch({ warehouseId })}
                  options={warehouseOptions}
                  placeholder={t('allWarehouses')}
                  clearLabel={t('allWarehouses')}
                  searchPlaceholder={t('searchWarehouse')}
                  emptyText={t('noWarehouses')}
                  aria-label={t('warehouse')}
                />
              </div>

              {view === 'movements' && (
                <div className="space-y-1.5">
                  <Label htmlFor="inventory-movement-type">{t('movementType')}</Label>
                  <Select id="inventory-movement-type" value={value.movementType} onChange={(event) => patch({ movementType: event.target.value as InventoryReportFilterState['movementType'] })}>
                    <option value="">{t('allMovementTypes')}</option>
                    <option value="in">{t('movementTypes.in')}</option>
                    <option value="out">{t('movementTypes.out')}</option>
                  </Select>
                </div>
              )}

              {view === 'operations' && (
                <div className="space-y-1.5">
                  <Label htmlFor="inventory-operation-type">{t('operationType')}</Label>
                  <Select id="inventory-operation-type" value={value.operationType} onChange={(event) => patch({ operationType: event.target.value as InventoryReportFilterState['operationType'] })}>
                    <option value="">{t('allOperationTypes')}</option>
                    <option value="receipt">{t('operationTypes.receipt')}</option>
                    <option value="issue">{t('operationTypes.issue')}</option>
                    <option value="transfer">{t('operationTypes.transfer')}</option>
                  </Select>
                </div>
              )}

              {snapshot && (
                <div className="flex items-center justify-between gap-3 rounded border border-border bg-background px-3 py-2.5">
                  <Label htmlFor="inventory-hide-zero" className="cursor-pointer text-sm">{t('hideZero')}</Label>
                  <Switch id="inventory-hide-zero" checked={value.hideZero} onCheckedChange={(hideZero) => patch({ hideZero })} aria-label={t('hideZero')} />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
