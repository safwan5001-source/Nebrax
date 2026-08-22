import type { TabularReportCell, TabularReportDocument } from '../types';

export interface SourceTabularReportCompany {
  name: string;
  vat_number?: string | null;
  cr_number?: string | null;
}

export interface SourceTabularReportColumn {
  label: string;
  align?: 'start' | 'end';
}

function textCell(value: string): TabularReportCell {
  return { kind: 'text', value };
}

function columnsFromLegacy(columns: readonly SourceTabularReportColumn[]) {
  return columns.map((column, index) => ({
    id: `column_${index}`,
    labelKey: column.label,
    valueKind: 'text' as const,
    alignment: column.align ?? 'start',
  }));
}

function cellsFromLegacy(columns: readonly { id: string }[], row: readonly string[]): Readonly<Record<string, TabularReportCell>> {
  return Object.fromEntries(columns.map((column, index) => [column.id, textCell(row[index] ?? '')]));
}

/**
 * جسر إدخال لتقرير قديم يقدّم صفوف نصية. لا يستنتج نوع المال ولا يعيد جمع الأعمدة؛
 * المرحلة التالية تجعل محرك التقرير يرسل الخلايا المهيكلة مباشرةً.
 */
export function buildTabularReportDocument(input: {
  reportKey: string;
  title: string;
  asOf?: string | null;
  company: SourceTabularReportCompany | null;
  columns: readonly SourceTabularReportColumn[];
  rows: readonly (readonly string[])[];
  totalRow?: readonly string[] | null;
  generatedAt: string;
}): TabularReportDocument {
  const columns = columnsFromLegacy(input.columns);

  return {
    family: 'tabular_report',
    reportKey: input.reportKey,
    title: input.title,
    organization: {
      name: input.company?.name ?? '—',
      vatNumber: input.company?.vat_number ?? null,
      crNumber: input.company?.cr_number ?? null,
      tagline: null,
      logoText: null,
      logoUrl: null,
      logoHeight: null,
    },
    scope: { asOf: input.asOf ?? null },
    columns,
    groups: [{
      id: 'legacy_rows',
      label: '',
      context: {},
      rows: input.rows.map((row, index) => ({
        id: `legacy_row_${index}`,
        cells: cellsFromLegacy(columns, row),
      })),
      subtotal: null,
    }],
    grandTotal: input.totalRow ? cellsFromLegacy(columns, input.totalRow) : null,
    generatedAt: input.generatedAt,
  };
}
