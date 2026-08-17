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
import type { CustomerReportView } from '@/components/reports/customers-reports-workspace';

interface Partner { id: string; name: string; type: 'customer' | 'supplier' | 'both'; phone?: string | null; vat_number?: string | null }

export interface CustomerReportFilterState extends ReportFilterState {
  interval: 'day' | 'week' | 'month' | 'year';
  customerId: string;
  paymentStatus: '' | 'paid' | 'partial' | 'unpaid';
  paymentMethod: '' | 'cash' | 'bank';
  appointmentStatus: '' | 'scheduled' | 'done' | 'cancelled';
}

export const EMPTY_CUSTOMER_REPORT_FILTERS: CustomerReportFilterState = {
  ...EMPTY_FILTERS,
  interval: 'month',
  customerId: '',
  paymentStatus: '',
  paymentMethod: '',
  appointmentStatus: '',
};

export function CustomerReportFilters({
  view,
  value,
  onChange,
}: {
  view: CustomerReportView;
  value: CustomerReportFilterState;
  onChange: (next: CustomerReportFilterState) => void;
}) {
  const t = useTranslations('reports.customers');
  const [expanded, setExpanded] = useState(false);
  const [customers, setCustomers] = useState<Partner[]>([]);

  useEffect(() => {
    api<{ data: Partner[] }>('/partners')
      .then((response) => setCustomers(response.data.filter((partner) => partner.type === 'customer' || partner.type === 'both')))
      .catch(() => {});
  }, []);

  const customerOptions = useMemo<ComboOption[]>(() => customers.map((customer) => ({
    value: customer.id,
    label: customer.name,
    sub: customer.vat_number ?? undefined,
    hint: customer.phone ?? undefined,
  })), [customers]);

  const isPaymentReport = view === 'payments';
  const isAppointmentReport = view === 'appointments';
  const dirty = value.customerId !== '' || value.paymentStatus !== '' || value.paymentMethod !== ''
    || value.appointmentStatus !== '' || value.interval !== 'month';
  const scopeDirty = !!value.from || !!value.to || value.branchIds.length > 0;

  function patch(next: Partial<CustomerReportFilterState>) {
    onChange({ ...value, ...next });
  }

  const hint = isPaymentReport ? 'paymentsScopeHint' : isAppointmentReport ? 'appointmentsScopeHint' : 'salesScopeHint';

  return (
    <div className="space-y-3">
      <ReportFilters
        value={value}
        onChange={(base) => onChange({ ...value, ...base })}
        onClear={() => onChange(EMPTY_CUSTOMER_REPORT_FILTERS)}
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
                <p className="mt-0.5 text-xs leading-5 text-muted">{t(hint)}</p>
              </div>
              {(dirty || scopeDirty) && <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_CUSTOMER_REPORT_FILTERS)}>{t('resetAll')}</Button>}
            </div>

            <div className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-3')}>
              {isPaymentReport && (
                <div className="space-y-1.5">
                  <Label htmlFor="customer-interval">{t('interval')}</Label>
                  <Select id="customer-interval" value={value.interval} onChange={(event) => patch({ interval: event.target.value as CustomerReportFilterState['interval'] })}>
                    <option value="day">{t('intervals.day')}</option>
                    <option value="week">{t('intervals.week')}</option>
                    <option value="month">{t('intervals.month')}</option>
                    <option value="year">{t('intervals.year')}</option>
                  </Select>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="customer-filter">{t('customer')}</Label>
                <Combobox
                  id="customer-filter"
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

              {isPaymentReport && (
                <div className="space-y-1.5">
                  <Label htmlFor="customer-payment-method">{t('paymentMethod')}</Label>
                  <Select id="customer-payment-method" value={value.paymentMethod} onChange={(event) => patch({ paymentMethod: event.target.value as CustomerReportFilterState['paymentMethod'] })}>
                    <option value="">{t('allPaymentMethods')}</option>
                    <option value="cash">{t('paymentMethods.cash')}</option>
                    <option value="bank">{t('paymentMethods.bank')}</option>
                  </Select>
                </div>
              )}

              {!isPaymentReport && !isAppointmentReport && (
                <div className="space-y-1.5">
                  <Label htmlFor="customer-payment-status">{t('paymentStatus')}</Label>
                  <Select id="customer-payment-status" value={value.paymentStatus} onChange={(event) => patch({ paymentStatus: event.target.value as CustomerReportFilterState['paymentStatus'] })}>
                    <option value="">{t('allPaymentStatuses')}</option>
                    <option value="paid">{t('paymentStatuses.paid')}</option>
                    <option value="partial">{t('paymentStatuses.partial')}</option>
                    <option value="unpaid">{t('paymentStatuses.unpaid')}</option>
                  </Select>
                </div>
              )}

              {isAppointmentReport && (
                <div className="space-y-1.5">
                  <Label htmlFor="customer-appointment-status">{t('appointmentStatus')}</Label>
                  <Select id="customer-appointment-status" value={value.appointmentStatus} onChange={(event) => patch({ appointmentStatus: event.target.value as CustomerReportFilterState['appointmentStatus'] })}>
                    <option value="">{t('allAppointmentStatuses')}</option>
                    <option value="scheduled">{t('appointmentStatuses.scheduled')}</option>
                    <option value="done">{t('appointmentStatuses.done')}</option>
                    <option value="cancelled">{t('appointmentStatuses.cancelled')}</option>
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
