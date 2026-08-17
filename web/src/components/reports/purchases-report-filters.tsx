'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { EMPTY_FILTERS, ReportFilters, type ReportFilterState } from '@/components/reports/report-filters';
import type { PurchaseReportView } from '@/components/reports/purchases-reports-workspace';

interface Partner { id: string; name: string; phone?: string | null; vat_number?: string | null }
interface Product { id: string; name: string; sku?: string | null; barcode?: string | null; is_active: boolean }
interface Creator { id: string; name: string; hint?: string | null }

export interface PurchaseReportFilterState extends ReportFilterState {
  interval: 'day' | 'week' | 'month' | 'year';
  supplierId: string;
  productId: string;
  creatorId: string;
  paymentStatus: '' | 'paid' | 'partial' | 'unpaid';
  receivedStatus: '' | 'pending' | 'partial' | 'received';
  paymentMethod: '' | 'cash' | 'bank';
}

export const EMPTY_PURCHASE_REPORT_FILTERS: PurchaseReportFilterState = {
  ...EMPTY_FILTERS,
  interval: 'month',
  supplierId: '',
  productId: '',
  creatorId: '',
  paymentStatus: '',
  receivedStatus: '',
  paymentMethod: '',
};

export function PurchaseReportFilters({
  view,
  value,
  onChange,
}: {
  view: PurchaseReportView;
  value: PurchaseReportFilterState;
  onChange: (next: PurchaseReportFilterState) => void;
}) {
  const t = useTranslations('reports.purchases');
  const [expanded, setExpanded] = useState(false);
  const [suppliers, setSuppliers] = useState<Partner[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [creators, setCreators] = useState<Creator[]>([]);

  useEffect(() => {
    api<{ data: Partner[] }>('/partners?type=supplier').then((r) => setSuppliers(r.data)).catch(() => {});
    api<{ data: Product[] }>('/products').then((r) => setProducts(r.data.filter((p) => p.is_active))).catch(() => {});
    api<{ data: Creator[] }>('/reports/purchases/creators').then((r) => setCreators(r.data)).catch(() => {});
  }, []);

  const supplierOptions = useMemo<ComboOption[]>(() => suppliers.map((p) => ({
    value: p.id,
    label: p.name,
    sub: p.vat_number ?? undefined,
    hint: p.phone ?? undefined,
  })), [suppliers]);
  const productOptions = useMemo<ComboOption[]>(() => products.map((p) => ({
    value: p.id,
    label: p.name,
    sub: [p.sku, p.barcode].filter(Boolean).join(' · ') || undefined,
  })), [products]);
  const creatorOptions = useMemo<ComboOption[]>(() => creators.map((creator) => ({
    value: creator.id,
    label: creator.name,
    hint: creator.hint ?? undefined,
  })), [creators]);

  const isPaymentReport = view === 'payments';
  const hasInterval = view === 'period' || view === 'payments';
  const hasProduct = !isPaymentReport;
  const dirty = value.supplierId !== '' || value.productId !== '' || value.creatorId !== ''
    || value.paymentStatus !== '' || value.receivedStatus !== '' || value.paymentMethod !== '' || value.interval !== 'month';
  const scopeDirty = !!value.from || !!value.to || value.branchIds.length > 0;

  function patch(next: Partial<PurchaseReportFilterState>) {
    onChange({ ...value, ...next });
  }

  return (
    <div className="space-y-3">
      <ReportFilters
        value={value}
        onChange={(base) => onChange({ ...value, ...base })}
        onClear={() => onChange(EMPTY_PURCHASE_REPORT_FILTERS)}
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
                <p className="mt-0.5 text-xs leading-5 text-muted">{t(isPaymentReport ? 'paymentsScopeHint' : 'purchasesScopeHint')}</p>
              </div>
              {(dirty || scopeDirty) && <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_PURCHASE_REPORT_FILTERS)}>{t('resetAll')}</Button>}
            </div>

            <div className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-3')}>
              {hasInterval && (
                <div className="space-y-1.5">
                  <Label htmlFor="purchase-interval">{t('interval')}</Label>
                  <Select id="purchase-interval" value={value.interval} onChange={(e) => patch({ interval: e.target.value as PurchaseReportFilterState['interval'] })}>
                    <option value="day">{t('intervals.day')}</option>
                    <option value="week">{t('intervals.week')}</option>
                    <option value="month">{t('intervals.month')}</option>
                    <option value="year">{t('intervals.year')}</option>
                  </Select>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="purchase-supplier">{t('supplier')}</Label>
                <Combobox
                  id="purchase-supplier"
                  value={value.supplierId}
                  onChange={(supplierId) => patch({ supplierId })}
                  options={supplierOptions}
                  placeholder={t('allSuppliers')}
                  clearLabel={t('allSuppliers')}
                  searchPlaceholder={t('searchSupplier')}
                  emptyText={t('noSuppliers')}
                  aria-label={t('supplier')}
                />
              </div>

              {!isPaymentReport && (
                <div className="space-y-1.5">
                  <Label htmlFor="purchase-creator">{t('creator')}</Label>
                  <Combobox
                    id="purchase-creator"
                    value={value.creatorId}
                    onChange={(creatorId) => patch({ creatorId })}
                    options={creatorOptions}
                    placeholder={t('allCreators')}
                    clearLabel={t('allCreators')}
                    searchPlaceholder={t('searchCreator')}
                    emptyText={t('noCreators')}
                    aria-label={t('creator')}
                  />
                </div>
              )}

              {hasProduct && (
                <div className="space-y-1.5">
                  <Label htmlFor="purchase-product">{t('product')}</Label>
                  <Combobox
                    id="purchase-product"
                    value={value.productId}
                    onChange={(productId) => patch({ productId })}
                    options={productOptions}
                    placeholder={t('allProducts')}
                    clearLabel={t('allProducts')}
                    searchPlaceholder={t('searchProduct')}
                    emptyText={t('noProducts')}
                    aria-label={t('product')}
                  />
                  {view !== 'product' && value.productId && <p className="text-[11px] leading-4 text-muted">{t('productInvoiceScope')}</p>}
                </div>
              )}

              {isPaymentReport ? (
                <div className="space-y-1.5">
                  <Label htmlFor="purchase-payment-method">{t('paymentMethod')}</Label>
                  <Select id="purchase-payment-method" value={value.paymentMethod} onChange={(e) => patch({ paymentMethod: e.target.value as PurchaseReportFilterState['paymentMethod'] })}>
                    <option value="">{t('allPaymentMethods')}</option>
                    <option value="cash">{t('paymentMethods.cash')}</option>
                    <option value="bank">{t('paymentMethods.bank')}</option>
                  </Select>
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="purchase-payment-status">{t('paymentStatus')}</Label>
                    <Select id="purchase-payment-status" value={value.paymentStatus} onChange={(e) => patch({ paymentStatus: e.target.value as PurchaseReportFilterState['paymentStatus'] })}>
                      <option value="">{t('allPaymentStatuses')}</option>
                      <option value="paid">{t('paymentStatuses.paid')}</option>
                      <option value="partial">{t('paymentStatuses.partial')}</option>
                      <option value="unpaid">{t('paymentStatuses.unpaid')}</option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="purchase-received-status">{t('receivedStatus')}</Label>
                    <Select id="purchase-received-status" value={value.receivedStatus} onChange={(e) => patch({ receivedStatus: e.target.value as PurchaseReportFilterState['receivedStatus'] })}>
                      <option value="">{t('allReceivedStatuses')}</option>
                      <option value="pending">{t('receivedStatuses.pending')}</option>
                      <option value="partial">{t('receivedStatuses.partial')}</option>
                      <option value="received">{t('receivedStatuses.received')}</option>
                    </Select>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
