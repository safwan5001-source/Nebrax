import type { AccountStatementDocument } from '../types';

export interface SourceStatementRow {
  date: string;
  number: string;
  description: string | null;
  debit: string;
  credit: string;
  balance: string;
}

export interface SourcePartnerStatement {
  partner: { id: string; name: string; type: string };
  opening_balance: string;
  rows: readonly SourceStatementRow[];
  closing_balance: string;
}

export interface SourceStatementCompany {
  name: string;
  vat_number?: string | null;
  cr_number?: string | null;
  logo?: string | null;
  currency?: string | null;
}

export interface SourceStatementFilters {
  from: string;
  to: string;
  branchIds: readonly string[];
}

/**
 * عقد كشف حساب من نتيجة تقرير الطرف. حقول مرجع القيد/المصدر ومجاميع الفترة تبقى
 * فارغة إلى أن يوفرها API صراحة؛ لا تبني الواجهة قيماً تبدو تدقيقية وهي ليست كذلك.
 */
export function buildAccountStatementDocument(input: {
  statement: SourcePartnerStatement;
  company: SourceStatementCompany | null;
  filters: SourceStatementFilters;
  generatedAt: string;
}): AccountStatementDocument {
  const { statement, company, filters, generatedAt } = input;
  const currency = 'SAR' as const;

  return {
    family: 'account_statement',
    organization: {
      name: company?.name ?? '—',
      vatNumber: company?.vat_number ?? null,
      crNumber: company?.cr_number ?? null,
      tagline: null,
      logoText: null,
      logoUrl: company?.logo ?? null,
      logoHeight: null,
    },
    subject: {
      id: statement.partner.id,
      name: statement.partner.name,
      type: statement.partner.type,
      vatNumber: null,
      city: null,
    },
    scope: {
      from: filters.from || null,
      to: filters.to || null,
      branchIds: [...filters.branchIds],
      currency,
    },
    openingBalance: statement.opening_balance,
    periodDebit: null,
    periodCredit: null,
    closingBalance: statement.closing_balance,
    entries: statement.rows.map((row) => ({
      date: row.date,
      journalEntryId: null,
      journalNumber: row.number,
      sourceType: null,
      sourceId: null,
      sourceNumber: null,
      description: row.description,
      debit: row.debit,
      credit: row.credit,
      balance: row.balance,
    })),
    generatedAt,
  };
}
