'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatRiyal, isNegative } from '@/lib/money';
import type { Company } from '@/lib/company';
import {
  buildAccountStatementDocument,
  type SourcePartnerStatement,
  type SourceStatementFilters,
  type SourceStatementRow,
} from '@/modules/document-families/account-statement/from-partner-statement';

export type PartnerStatementRow = SourceStatementRow;
export type PartnerStatementData = SourcePartnerStatement;
export type StatementFilters = SourceStatementFilters;

function displayBalance(value: string, creditBalance: boolean): string {
  if (!creditBalance) return value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.abs(numeric).toFixed(2) : value;
}

function humanDate(value: string, locale: string): string {
  if (!value) return '—';
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.valueOf())
    ? value
    : new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
      }).format(parsed);
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

  const generatedAt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-GB', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date());
  const document = buildAccountStatementDocument({ statement, company, filters, generatedAt });

  return (
    <article
      id="print-root"
      className="w-full bg-white text-slate-900 print:w-[794px]"
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      aria-label={t('document_aria_label', { party: document.subject.name })}
    >
      <div className="border-b-4 border-primary px-4 pt-6 sm:px-6 sm:pt-8 md:px-10 md:pt-10 print:px-10 print:pt-10">
        <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:gap-8">
          <div className="min-w-0">
            {document.organization.logoUrl ? (
              <img src={document.organization.logoUrl} alt={document.organization.name} className="mb-3 h-12 w-auto object-contain" />
            ) : (
              <p className="text-lg font-bold tracking-tight text-slate-900">{document.organization.name}</p>
            )}
            <p className="mt-1 text-xs text-slate-500">
              {[document.organization.vatNumber && `${t('vat_number')}: ${document.organization.vatNumber}`, document.organization.crNumber && `${t('cr_number')}: ${document.organization.crNumber}`]
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
          <Meta label={t('party')} value={document.subject.name} strong />
          <Meta label={t('party_type')} value={document.subject.type === 'customer' ? t('customer_type') : t('supplier_type')} />
          <Meta label={t('period')} value={period} mono />
          <Meta label={t('branch_scope')} value={branchScope} />
        </div>
      </div>

      <div className="px-4 py-5 sm:px-6 sm:py-6 md:px-10 md:py-7 print:px-10 print:py-7">
        <div className="grid grid-cols-1 gap-px overflow-hidden border border-slate-200 bg-slate-200 sm:grid-cols-2">
          <BalanceCell label={t('opening_balance')} value={displayBalance(document.openingBalance, creditBalance)} subtle />
          <BalanceCell label={closingBalanceLabel ?? t('closing_balance')} value={displayBalance(document.closingBalance, creditBalance)} negative={!creditBalance && isNegative(document.closingBalance)} />
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
                <td className="num px-3 py-3 text-end font-semibold">{formatRiyal(displayBalance(document.openingBalance, creditBalance))}</td>
              </tr>
              {document.entries.map((row, index) => (
                <tr key={`${row.journalNumber}-${index}`} className="border-b border-slate-100 last:border-b-0">
                  <td className="num whitespace-nowrap px-3 py-3 text-slate-500">{row.date}</td>
                  <td className="num whitespace-nowrap px-3 py-3 font-medium text-slate-800">{row.journalNumber}</td>
                  <td className="max-w-[210px] px-3 py-3 text-slate-700">{row.description ?? '—'}</td>
                  <td className="num whitespace-nowrap px-3 py-3 text-end">{row.debit !== '0.00' ? formatRiyal(row.debit) : '—'}</td>
                  <td className="num whitespace-nowrap px-3 py-3 text-end">{row.credit !== '0.00' ? formatRiyal(row.credit) : '—'}</td>
                  <td className={`num whitespace-nowrap px-3 py-3 text-end font-semibold ${!creditBalance && isNegative(row.balance) ? 'text-rose-700' : 'text-slate-900'}`}>
                    {formatRiyal(displayBalance(row.balance, creditBalance))}
                  </td>
                </tr>
              ))}
              {document.entries.length === 0 && (
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
          <span className="shrink-0">{t('currency')}: {document.scope.currency}</span>
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
