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
import type { SalesReportView } from '@/components/reports/sales-reports-workspace';

interface Partner { id: string; name: string; phone?: string | null; vat_number?: string | null }
interface Product { id: string; name: string; sku?: string | null; barcode?: string | null; is_active: boolean }
interface Employee { id: string; name: string }
interface Category { id: string; name: string; is_active: boolean }
interface Classification { id: string; name: string; is_active: boolean }

export interface SalesReportFilterState extends ReportFilterState {
  interval: 'day' | 'week' | 'month' | 'year';
  customerId: string;
  customerClassificationId: string;
  productId: string;
  productCategoryId: string;
  classificationId: string;
  salespersonId: string;
  paymentStatus: '' | 'paid' | 'partial' | 'unpaid';
  receiptMethod: '' | 'cash' | 'bank';
}

export const EMPTY_SALES_REPORT_FILTERS: SalesReportFilterState = {
  ...EMPTY_FILTERS,
  interval: 'month',
  customerId: '',
  customerClassificationId: '',
  productId: '',
  productCategoryId: '',
  classificationId: '',
  salespersonId: '',
  paymentStatus: '',
  receiptMethod: '',
};

export function SalesReportFilters({
  view,
  value,
  onChange,
}: {
  view: SalesReportView;
  value: SalesReportFilterState;
  onChange: (next: SalesReportFilterState) => void;
}) {
  const t = useTranslations('reports.sales');
  const [expanded, setExpanded] = useState(false);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [productCategories, setProductCategories] = useState<Category[]>([]);
  const [customerClassifications, setCustomerClassifications] = useState<Classification[]>([]);
  const [invoiceClassifications, setInvoiceClassifications] = useState<Classification[]>([]);

  useEffect(() => {
    api<{ data: Partner[] }>('/partners?type=customer').then((r) => setPartners(r.data)).catch(() => {});
    api<{ data: Product[] }>('/products').then((r) => setProducts(r.data.filter((p) => p.is_active))).catch(() => {});
    api<{ data: Employee[] }>('/employees').then((r) => setEmployees(r.data)).catch(() => {});
    api<{ data: Category[] }>('/product-categories').then((r) => setProductCategories(r.data.filter((c) => c.is_active))).catch(() => {});
    api<{ data: Classification[] }>('/classifications?scope=customer').then((r) => setCustomerClassifications(r.data.filter((c) => c.is_active))).catch(() => {});
    api<{ data: Classification[] }>('/classifications?scope=sales_invoice').then((r) => setInvoiceClassifications(r.data.filter((c) => c.is_active))).catch(() => {});
  }, []);

  const customerOptions = useMemo<ComboOption[]>(() => partners.map((p) => ({
    value: p.id,
    label: p.name,
    sub: p.vat_number ?? undefined,
    hint: p.phone ?? undefined,
  })), [partners]);
  const productOptions = useMemo<ComboOption[]>(() => products.map((p) => ({
    value: p.id,
    label: p.name,
    sub: [p.sku, p.barcode].filter(Boolean).join(' · ') || undefined,
  })), [products]);
  const salespersonOptions = useMemo<ComboOption[]>(() => employees.map((e) => ({ value: e.id, label: e.name })), [employees]);
  const productCategoryOptions = useMemo<ComboOption[]>(() => productCategories.map((c) => ({ value: c.id, label: c.name })), [productCategories]);
  const customerClassificationOptions = useMemo<ComboOption[]>(() => customerClassifications.map((c) => ({ value: c.id, label: c.name })), [customerClassifications]);
  const invoiceClassificationOptions = useMemo<ComboOption[]>(() => invoiceClassifications.map((c) => ({ value: c.id, label: c.name })), [invoiceClassifications]);

  const isReceiptReport = view === 'payments';
  const isProfitReport = view === 'profit';
  const hasInterval = view === 'period' || view === 'profit' || view === 'payments';
  const hasProduct = !isReceiptReport && !isProfitReport;
  const dirty = value.customerId !== '' || value.customerClassificationId !== '' || value.productId !== ''
    || value.productCategoryId !== '' || value.classificationId !== '' || value.salespersonId !== ''
    || value.paymentStatus !== '' || value.receiptMethod !== '' || value.interval !== 'month';
  const scopeDirty = !!value.from || !!value.to || value.branchIds.length > 0;

  function patch(patch: Partial<SalesReportFilterState>) {
    onChange({ ...value, ...patch });
  }

  return (
    <div className="space-y-3">
      <ReportFilters
        value={value}
        onChange={(base) => onChange({ ...value, ...base })}
        onClear={() => onChange(EMPTY_SALES_REPORT_FILTERS)}
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
        {(dirty || scopeDirty) && !expanded && (
          <span className="text-xs text-muted">{t('filtersActive')}</span>
        )}
      </div>

      {expanded && (
        <Card className="no-print border-primary/20">
          <CardContent className="p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-text">{t('advancedFilters')}</h2>
                <p className="mt-0.5 text-xs leading-5 text-muted">{t(isReceiptReport ? 'receiptsScopeHint' : isProfitReport ? 'profitScopeHint' : 'invoicesScopeHint')}</p>
              </div>
              {(dirty || scopeDirty) && (
                <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_SALES_REPORT_FILTERS)}>{t('resetAll')}</Button>
              )}
            </div>

            <div className={cn('grid gap-3', hasInterval ? 'sm:grid-cols-2 xl:grid-cols-3' : 'sm:grid-cols-2 xl:grid-cols-3')}>
              {hasInterval && (
                <div className="space-y-1.5">
                  <Label htmlFor="sales-interval">{t('interval')}</Label>
                  <Select id="sales-interval" value={value.interval} onChange={(e) => patch({ interval: e.target.value as SalesReportFilterState['interval'] })}>
                    <option value="day">{t('intervals.day')}</option>
                    <option value="week">{t('intervals.week')}</option>
                    <option value="month">{t('intervals.month')}</option>
                    <option value="year">{t('intervals.year')}</option>
                  </Select>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="sales-customer">{t('customer')}</Label>
                <Combobox
                  id="sales-customer"
                  value={value.customerId}
                  onChange={(customerId) => patch({ customerId })}
                  options={customerOptions}
                  placeholder={t('allCustomers')}
                  clearLabel={t('allCustomers')}
                  searchPlaceholder={t('searchCustomer')}
                  emptyText={t('noCustomers')}
                  aria-label={t('customer')}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sales-customer-classification">{t('customerClassification')}</Label>
                <Combobox
                  id="sales-customer-classification"
                  value={value.customerClassificationId}
                  onChange={(customerClassificationId) => patch({ customerClassificationId })}
                  options={customerClassificationOptions}
                  placeholder={t('allCustomerClassifications')}
                  clearLabel={t('allCustomerClassifications')}
                  searchPlaceholder={t('customerClassification')}
                  emptyText={t('allCustomerClassifications')}
                  aria-label={t('customerClassification')}
                />
              </div>

              {!isReceiptReport && (
                <div className="space-y-1.5">
                  <Label htmlFor="salesperson">{t('salesperson')}</Label>
                  <Combobox
                    id="salesperson"
                    value={value.salespersonId}
                    onChange={(salespersonId) => patch({ salespersonId })}
                    options={salespersonOptions}
                    placeholder={t('allSalespeople')}
                    clearLabel={t('allSalespeople')}
                    searchPlaceholder={t('searchSalesperson')}
                    emptyText={t('noSalespeople')}
                    aria-label={t('salesperson')}
                  />
                </div>
              )}

              {hasProduct && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="sales-product-category">{t('productCategory')}</Label>
                    <Combobox
                      id="sales-product-category"
                      value={value.productCategoryId}
                      onChange={(productCategoryId) => patch({ productCategoryId })}
                      options={productCategoryOptions}
                      placeholder={t('allProductCategories')}
                      clearLabel={t('allProductCategories')}
                      searchPlaceholder={t('productCategory')}
                      emptyText={t('allProductCategories')}
                      aria-label={t('productCategory')}
                    />
                  </div>
                  <div className="space-y-1.5">
                  <Label htmlFor="sales-product">{t('product')}</Label>
                  <Combobox
                    id="sales-product"
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
                </>
              )}

              {!isReceiptReport && (
                <div className="space-y-1.5">
                  <Label htmlFor="sales-invoice-classification">{t('invoiceClassification')}</Label>
                  <Combobox
                    id="sales-invoice-classification"
                    value={value.classificationId}
                    onChange={(classificationId) => patch({ classificationId })}
                    options={invoiceClassificationOptions}
                    placeholder={t('allInvoiceClassifications')}
                    clearLabel={t('allInvoiceClassifications')}
                    searchPlaceholder={t('invoiceClassification')}
                    emptyText={t('allInvoiceClassifications')}
                    aria-label={t('invoiceClassification')}
                  />
                </div>
              )}

              {isReceiptReport ? (
                <div className="space-y-1.5">
                  <Label htmlFor="receipt-method">{t('receiptMethod')}</Label>
                  <Select id="receipt-method" value={value.receiptMethod} onChange={(e) => patch({ receiptMethod: e.target.value as SalesReportFilterState['receiptMethod'] })}>
                    <option value="">{t('allReceiptMethods')}</option>
                    <option value="cash">{t('receiptMethods.cash')}</option>
                    <option value="bank">{t('receiptMethods.bank')}</option>
                  </Select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="payment-status">{t('paymentStatus')}</Label>
                  <Select id="payment-status" value={value.paymentStatus} onChange={(e) => patch({ paymentStatus: e.target.value as SalesReportFilterState['paymentStatus'] })}>
                    <option value="">{t('allPaymentStatuses')}</option>
                    <option value="paid">{t('paymentStatuses.paid')}</option>
                    <option value="partial">{t('paymentStatuses.partial')}</option>
                    <option value="unpaid">{t('paymentStatuses.unpaid')}</option>
                  </Select>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
