'use client';
import { formatDate, formatDateTime } from '@/lib/formatting';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatRiyal, isNegative } from '@/lib/money';
import type { Company } from '@/lib/company';

export interface PartnerStatementRow {
  date: string;
  number: string;
  description: string | null;
  debit: string;
  credit: string;
  balance: string;
}

export interface PartnerStatementData {
  partner: { id: string; name: string; type: string };
  opening_balance: string;
  rows: PartnerStatementRow[];
  closing_balance: string;
}

export interface StatementFilters {
  from: string;
  to: string;
  branchIds: string[];
}

function displayBalance(value: string, creditBalance: boolean): string {
  if (!creditBalance) return value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.abs(numeric).toFixed(2) : value;
}

function humanDate(value: string, locale: string): string {
  return formatDate(value, locale, { fallback: value || '—' });
}

/**
 * المستند الموحد لكشف الحساب: هو مصدر المعاينة والطباعة وملف PDF.
 * لا يحسب مبالغ مالية؛ يعرض فقط القيم التي يعيدها محرك التقارير.
 */
export function PartnerStatementDocument({
  statement,
  company,
  filters,
  translationNamespace = 'partnerStatement',
  creditBalance = false,
  closingBalanceLabel,
}: {
  statement: PartnerStatementData;
  company: Company | null;
  filters: StatementFilters;
  /** يفصل نصوص المورد عن العميل مع الاحتفاظ بقالب المستند المالي نفسه. */
  translationNamespace?: 'partnerStatement' | 'supplierStatement';
  /** للمورّد طبيعة دائنة؛ تعرض الأرصدة بقيم موجبة مع بقاء عمودي المدين/الدائن مصدر الحقيقة. */
  creditBalance?: boolean;
  closingBalanceLabel?: string;
}) {
  const t = useTranslations(translationNamespace);
  const locale = useLocale();

  const period = useMemo(() => {
    if (!filters.from && !filters.to) return t('all_periods');
    if (filters.from && filters.to && filters.from === filters.to) return humanDate(filters.from, locale);
    return `${humanDate(filters.from, locale)} — ${humanDate(filters.to, locale)}`;
  }, [filters.from, filters.to, locale, t]);

  const branchScope = filters.branchIds.length === 0
    ? t('all_branches')
    : t('branches_selected', { count: filters.branchIds.length });

  const generatedAt = formatDateTime(new Date(), locale);

  return (
    <article
      id="print-root"
      className="w-full bg-white text-slate-900 print:w-[794px]"
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      aria-label={t('document_aria_label', { party: statement.partner.name })}
    >
      <div className="border-b-4 border-primary px-4 pt-6 sm:px-6 sm:pt-8 md:px-10 md:pt-10 print:px-10 print:pt-10">
        <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:gap-8">
          <div className="min-w-0">
            {company?.logo ? (
              <img src={company.logo} alt={company.name} className="mb-3 h-12 w-auto object-contain" />
            ) : (
              <p className="text-lg font-bold tracking-tight text-slate-900">{company?.name ?? 'Nebrax'}</p>
            )}
            <p className="mt-1 text-xs text-slate-500">
              {[company?.vat_number && `${t('vat_number')}: ${company.vat_number}`, company?.cr_number && `${t('cr_number')}: ${company.cr_number}`]
                .filter(Boolean)
                .join('  •  ')}
            </p>
          </div>
          <div className="shrink-0 text-start sm:text-end">
            <h1 className="text-3xl font-bold tracking-tight text-slate-950">{t('title')}</h1>
            <p className="mt-2 text-sm text-slate-500">{t('generated_at')}: {generatedAt}</p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-x-12 gap-y-4 border-t border-slate-200 py-5 text-sm sm:mt-8 sm:grid-cols-2">
          <Meta label={t('party')} value={statement.partner.name} strong />
          <Meta label={t('party_type')} value={statement.partner.type === 'customer' ? t('customer_type') : t('supplier_type')} />
          <Meta label={t('period')} value={period} mono />
          <Meta label={t('branch_scope')} value={branchScope} />
        </div>
      </div>

      <div className="px-4 py-5 sm:px-6 sm:py-6 md:px-10 md:py-7 print:px-10 print:py-7">
        <div className="grid grid-cols-1 gap-px overflow-hidden border border-slate-200 bg-slate-200 sm:grid-cols-2">
          <BalanceCell label={t('opening_balance')} value={displayBalance(statement.opening_balance, creditBalance)} subtle />
          <BalanceCell label={closingBalanceLabel ?? t('closing_balance')} value={displayBalance(statement.closing_balance, creditBalance)} negative={!creditBalance && isNegative(statement.closing_balance)} />
        </div>

        <div className="mt-5 overflow-x-auto border border-slate-200 sm:mt-7">
          <table className="min-w-[660px] w-full border-collapse text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
              <tr className="border-b border-slate-200">
                <th className="px-3 py-3 text-start">{t('date')}</th>
                <th className="px-3 py-3 text-start">{t('entry_number')}</th>
                <th className="px-3 py-3 text-start">{t('description')}</th>
                <th className="px-3 py-3 text-end">{t('debit')}</th>
                <th className="px-3 py-3 text-end">{t('credit')}</th>
                <th className="px-3 py-3 text-end">{t('balance')}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-600">
                <td className="px-3 py-3" />
                <td className="px-3 py-3" />
                <td className="px-3 py-3 font-medium">{t('opening_balance')}</td>
                <td className="px-3 py-3" />
                <td className="px-3 py-3" />
                <td className="num px-3 py-3 text-end font-semibold">{formatRiyal(displayBalance(statement.opening_balance, creditBalance))}</td>
              </tr>
              {statement.rows.map((row, index) => (
                <tr key={`${row.number}-${index}`} className="border-b border-slate-100 last:border-b-0">
                  <td className="num whitespace-nowrap px-3 py-3 text-slate-500">{row.date}</td>
                  <td className="num whitespace-nowrap px-3 py-3 font-medium text-slate-800">{row.number}</td>
                  <td className="max-w-[210px] px-3 py-3 text-slate-700">{row.description ?? '—'}</td>
                  <td className="num whitespace-nowrap px-3 py-3 text-end">{row.debit !== '0.00' ? formatRiyal(row.debit) : '—'}</td>
                  <td className="num whitespace-nowrap px-3 py-3 text-end">{row.credit !== '0.00' ? formatRiyal(row.credit) : '—'}</td>
                  <td className={`num whitespace-nowrap px-3 py-3 text-end font-semibold ${!creditBalance && isNegative(row.balance) ? 'text-rose-700' : 'text-slate-900'}`}>
                    {formatRiyal(displayBalance(row.balance, creditBalance))}
                  </td>
                </tr>
              ))}
              {statement.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-12 text-center text-sm text-slate-500">{t('empty')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <footer className="border-t border-slate-200 px-4 py-4 text-xs text-slate-500 sm:px-6 sm:py-5 md:px-10 print:px-10">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <span>{t('footer_note')}</span>
          <span className="shrink-0">{t('currency')}: {company?.currency ?? 'SAR'}</span>
        </div>
      </footer>
    </article>
  );
}

function Meta({ label, value, mono, strong }: { label: string; value: string; mono?: boolean; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`${mono ? 'num' : ''} mt-1 truncate text-sm ${strong ? 'font-semibold text-slate-950' : 'font-medium text-slate-800'}`}>{value}</p>
    </div>
  );
}

function BalanceCell({ label, value, negative, subtle }: { label: string; value: string; negative?: boolean; subtle?: boolean }) {
  return (
    <div className="bg-white px-5 py-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`num mt-1 text-2xl font-bold ${negative ? 'text-rose-700' : subtle ? 'text-slate-700' : 'text-slate-950'}`}>{formatRiyal(value)}</p>
    </div>
  );
}
