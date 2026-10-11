// قراءة عقد GET /api/reports/delivery-channel وعرضه كما هو.
// لا إعادة حساب لضريبة أو صافٍ، ولا طرح لإشعارات الدائن، ولا ضم لطلبات Hub.
import { formulaSafeCsv } from '@/lib/csv-formula';

const MONEY = /^-?\d+\.\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface DeliveryChannelFilters {
  from: string;
  to: string;
  branchIds: string[];
  profileId: string;
}

export interface DeliveryChannelPlatformRow {
  delivery_platform_profile_id: string;
  platform_key: string;
  gross_sales: string;
  discounts: string;
  shipping: string;
  adjustment: string;
  net_sales: string;
  vat: string;
  total: string;
  invoice_count: number;
  platform_collected_total: string;
  merchant_collected_total: string;
  unclassified_total: string;
  returns_count: number;
  returns_subtotal: string;
  returns_vat: string;
  returns_total: string;
  net_after_pos_returns: string;
}

export interface DeliveryChannelInvoiceRow {
  id: string;
  number: string;
  invoice_date: string;
  branch_id: string | null;
  branch_name: string | null;
  delivery_platform_profile_id: string;
  platform_key: string;
  display_name: string | null;
  display_name_en: string | null;
  collection_mode: string;
  external_order_reference: string | null;
  gross_sales: string;
  discounts: string;
  shipping: string;
  adjustment: string;
  net_sales: string;
  vat: string;
  total: string;
  pos_session_id: string | null;
}

export interface DeliveryChannelReturnRow {
  id: string;
  number: string;
  return_date: string;
  source_invoice_id: string;
  source_invoice_number: string;
  delivery_platform_profile_id: string;
  platform_key: string;
  subtotal: string;
  vat: string;
  total: string;
}

export interface DeliveryChannelCreditRow {
  id: string;
  number: string;
  note_date: string;
  source_invoice_id: string;
  source_invoice_number: string;
  delivery_platform_profile_id: string;
  platform_key: string;
  total: string;
}

export interface DeliveryChannelReport {
  scope: {
    from: string | null;
    to: string | null;
    branch_ids: string[] | null;
    delivery_platform_profile_id: string | null;
    source: 'posted_pos_delivery_invoices';
  };
  summary: {
    gross_sales: string;
    discounts: string;
    shipping: string;
    adjustment: string;
    net_sales: string;
    vat: string;
    total: string;
    invoice_count: number;
    returns_count: number;
    returns_subtotal: string;
    returns_vat: string;
    returns_total: string;
    net_after_pos_returns: string;
  };
  collection: {
    platform_collected_total: string;
    merchant_collected_total: string;
    unclassified_total: string;
  };
  credit_notes: {
    count: number;
    total: string;
    by_platform: Array<{ delivery_platform_profile_id: string; platform_key: string; count: number; total: string }>;
    rows: DeliveryChannelCreditRow[];
  };
  exceptions: {
    context_branch_mismatch: number;
    credit_note_partner_mismatch: number;
  };
  platforms: DeliveryChannelPlatformRow[];
  invoices: DeliveryChannelInvoiceRow[];
  returns: DeliveryChannelReturnRow[];
}

export interface ShownMetric {
  id:
    | 'gross_sales'
    | 'discounts'
    | 'net_sales'
    | 'vat'
    | 'total'
    | 'invoice_count'
    | 'returns_count'
    | 'returns_subtotal'
    | 'returns_vat'
    | 'returns_total'
    | 'net_after_pos_returns';
  kind: 'money' | 'count';
  value: string | number;
}

export interface PlatformFilterOption {
  id: string;
  platformKey: string;
}

export interface DeliveryChannelCsvLabels {
  columns: Record<(typeof CSV_COLUMNS)[number], string>;
  sections: {
    summary: string;
    creditNotes: string;
    creditNotesNotSubtracted: string;
    collection: string;
    exceptions: string;
    platform: string;
    invoice: string;
    returnDocument: string;
    creditNote: string;
  };
  names: {
    grossSales: string;
    discounts: string;
    shipping: string;
    adjustment: string;
    netSales: string;
    vat: string;
    total: string;
    invoiceCount: string;
    returnsCount: string;
    returnsSubtotal: string;
    returnsVat: string;
    returnsTotal: string;
    netAfterReturns: string;
    creditNoteCount: string;
    creditNoteTotal: string;
    platformCollected: string;
    merchantCollected: string;
    unclassified: string;
    contextMismatch: string;
    partnerMismatch: string;
  };
}

export const CSV_COLUMNS = [
  'section',
  'name',
  'count',
  'amount',
  'profile_id',
  'platform_key',
  'number',
  'date',
  'branch_name',
  'display_name',
  'display_name_en',
  'collection_mode',
  'external_order_reference',
  'source_invoice_number',
  'subtotal',
  'gross_sales',
  'discounts',
  'shipping',
  'adjustment',
  'net_sales',
  'vat',
  'total',
  'returns_total',
  'net_after_pos_returns',
  'pos_session_id',
] as const;

type CsvColumn = (typeof CSV_COLUMNS)[number];
type CsvCell = string | number | null;

export function deliveryChannelPath(filters: DeliveryChannelFilters): string {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  filters.branchIds.forEach((id) => params.append('branch_id[]', id));
  if (filters.profileId) params.set('delivery_platform_profile_id', filters.profileId);
  const query = params.toString();
  return query ? `/reports/delivery-channel?${query}` : '/reports/delivery-channel';
}

/** المقاييس المعروضة تُنسخ من الملخص. لا تُشتق من البنود ولا من إشعارات الدائن. */
export function shownFinancialMetrics(report: DeliveryChannelReport): ShownMetric[] {
  const summary = report.summary;
  return [
    { id: 'gross_sales', kind: 'money', value: summary.gross_sales },
    { id: 'discounts', kind: 'money', value: summary.discounts },
    { id: 'net_sales', kind: 'money', value: summary.net_sales },
    { id: 'vat', kind: 'money', value: summary.vat },
    { id: 'total', kind: 'money', value: summary.total },
    { id: 'invoice_count', kind: 'count', value: summary.invoice_count },
    { id: 'returns_count', kind: 'count', value: summary.returns_count },
    { id: 'returns_subtotal', kind: 'money', value: summary.returns_subtotal },
    { id: 'returns_vat', kind: 'money', value: summary.returns_vat },
    { id: 'returns_total', kind: 'money', value: summary.returns_total },
    { id: 'net_after_pos_returns', kind: 'money', value: summary.net_after_pos_returns },
  ];
}

export function shownCreditNotes(report: DeliveryChannelReport): { count: number; total: string } {
  return { count: report.credit_notes.count, total: report.credit_notes.total };
}

export function comparisonRows(report: DeliveryChannelReport): Array<{
  id: string;
  platformKey: string;
  invoiceCount: number;
  total: string;
  returnsTotal: string;
  netAfter: string;
}> {
  return report.platforms.map((row) => ({
    id: row.delivery_platform_profile_id,
    platformKey: row.platform_key,
    invoiceCount: row.invoice_count,
    total: row.total,
    returnsTotal: row.returns_total,
    netAfter: row.net_after_pos_returns,
  }));
}

export function platformFilterOptions(report: DeliveryChannelReport): PlatformFilterOption[] {
  const keys = new Map<string, string>();
  for (const row of report.platforms) keys.set(row.delivery_platform_profile_id, row.platform_key);
  for (const row of report.credit_notes.by_platform) {
    if (!keys.has(row.delivery_platform_profile_id)) keys.set(row.delivery_platform_profile_id, row.platform_key);
  }
  return [...keys.entries()]
    .map(([id, platformKey]) => ({ id, platformKey }))
    .sort((a, b) => a.platformKey.localeCompare(b.platformKey) || a.id.localeCompare(b.id));
}

export function pinnedPlatformLabel(
  row: { display_name: string | null; display_name_en: string | null },
  locale: string,
): string {
  const arabic = locale.toLowerCase().startsWith('ar');
  const primary = arabic ? row.display_name : row.display_name_en;
  const fallback = arabic ? row.display_name_en : row.display_name;
  return primary || fallback || '';
}

export function readDeliveryChannelReport(payload: unknown): DeliveryChannelReport | null {
  if (!isRecord(payload)) return null;
  const scope = readScope(payload.scope);
  const summary = readSummary(payload.summary);
  const collection = readCollection(payload.collection);
  const creditNotes = readCreditNotes(payload.credit_notes);
  const exceptions = readExceptions(payload.exceptions);
  const platforms = readPlatforms(payload.platforms);
  const invoices = readInvoices(payload.invoices);
  const returns = readReturns(payload.returns);
  if (!scope || !summary || !collection || !creditNotes || !exceptions || !platforms || !invoices || !returns) return null;
  return { scope, summary, collection, credit_notes: creditNotes, exceptions, platforms, invoices, returns };
}

export function buildDeliveryChannelCsv(report: DeliveryChannelReport, labels: DeliveryChannelCsvLabels): string {
  const rows: CsvCell[][] = [
    metricRow(labels.sections.summary, labels.names.grossSales, null, report.summary.gross_sales),
    metricRow(labels.sections.summary, labels.names.discounts, null, report.summary.discounts),
    metricRow(labels.sections.summary, labels.names.shipping, null, report.summary.shipping),
    metricRow(labels.sections.summary, labels.names.adjustment, null, report.summary.adjustment),
    metricRow(labels.sections.summary, labels.names.netSales, null, report.summary.net_sales),
    metricRow(labels.sections.summary, labels.names.vat, null, report.summary.vat),
    metricRow(labels.sections.summary, labels.names.total, null, report.summary.total),
    metricRow(labels.sections.summary, labels.names.invoiceCount, report.summary.invoice_count, null),
    metricRow(labels.sections.summary, labels.names.returnsCount, report.summary.returns_count, null),
    metricRow(labels.sections.summary, labels.names.returnsSubtotal, null, report.summary.returns_subtotal),
    metricRow(labels.sections.summary, labels.names.returnsVat, null, report.summary.returns_vat),
    metricRow(labels.sections.summary, labels.names.returnsTotal, null, report.summary.returns_total),
    metricRow(labels.sections.summary, labels.names.netAfterReturns, null, report.summary.net_after_pos_returns),
    metricRow(labels.sections.creditNotes, labels.sections.creditNotesNotSubtracted, report.credit_notes.count, report.credit_notes.total),
    metricRow(labels.sections.collection, labels.names.platformCollected, null, report.collection.platform_collected_total),
    metricRow(labels.sections.collection, labels.names.merchantCollected, null, report.collection.merchant_collected_total),
    metricRow(labels.sections.collection, labels.names.unclassified, null, report.collection.unclassified_total),
    metricRow(labels.sections.exceptions, labels.names.contextMismatch, report.exceptions.context_branch_mismatch, null),
    metricRow(labels.sections.exceptions, labels.names.partnerMismatch, report.exceptions.credit_note_partner_mismatch, null),
  ];

  for (const platform of report.platforms) {
    rows.push(line({
      section: labels.sections.platform,
      count: platform.invoice_count,
      profile_id: platform.delivery_platform_profile_id,
      platform_key: platform.platform_key,
      gross_sales: platform.gross_sales,
      discounts: platform.discounts,
      shipping: platform.shipping,
      adjustment: platform.adjustment,
      net_sales: platform.net_sales,
      vat: platform.vat,
      total: platform.total,
      returns_total: platform.returns_total,
      net_after_pos_returns: platform.net_after_pos_returns,
    }));
  }

  for (const invoice of report.invoices) {
    rows.push(line({
      section: labels.sections.invoice,
      profile_id: invoice.delivery_platform_profile_id,
      platform_key: invoice.platform_key,
      number: invoice.number,
      date: invoice.invoice_date,
      branch_name: invoice.branch_name,
      display_name: invoice.display_name,
      display_name_en: invoice.display_name_en,
      collection_mode: invoice.collection_mode,
      external_order_reference: invoice.external_order_reference,
      gross_sales: invoice.gross_sales,
      discounts: invoice.discounts,
      shipping: invoice.shipping,
      adjustment: invoice.adjustment,
      net_sales: invoice.net_sales,
      vat: invoice.vat,
      total: invoice.total,
      pos_session_id: invoice.pos_session_id,
    }));
  }

  for (const row of report.returns) {
    rows.push(line({
      section: labels.sections.returnDocument,
      profile_id: row.delivery_platform_profile_id,
      platform_key: row.platform_key,
      number: row.number,
      date: row.return_date,
      source_invoice_number: row.source_invoice_number,
      subtotal: row.subtotal,
      vat: row.vat,
      total: row.total,
    }));
  }

  for (const row of report.credit_notes.rows) {
    rows.push(line({
      section: labels.sections.creditNote,
      profile_id: row.delivery_platform_profile_id,
      platform_key: row.platform_key,
      number: row.number,
      date: row.note_date,
      source_invoice_number: row.source_invoice_number,
      total: row.total,
    }));
  }

  return formulaSafeCsv(CSV_COLUMNS.map((column) => labels.columns[column]), rows);
}

function metricRow(section: string, name: string, count: number | null, amount: string | null): CsvCell[] {
  return line({ section, name, count, amount });
}

function line(values: Partial<Record<CsvColumn, CsvCell>>): CsvCell[] {
  return CSV_COLUMNS.map((column) => values[column] ?? '');
}

function readScope(value: unknown): DeliveryChannelReport['scope'] | null {
  if (!isRecord(value) || value.source !== 'posted_pos_delivery_invoices') return null;
  const from = nullableDay(value.from);
  const to = nullableDay(value.to);
  const profileId = nullableText(value.delivery_platform_profile_id);
  if (from === undefined || to === undefined || profileId === undefined) return null;
  if (value.branch_ids !== null && !isStringArray(value.branch_ids)) return null;
  return {
    from,
    to,
    branch_ids: value.branch_ids,
    delivery_platform_profile_id: profileId,
    source: 'posted_pos_delivery_invoices',
  };
}

function readSummary(value: unknown): DeliveryChannelReport['summary'] | null {
  if (!isRecord(value)) return null;
  const money = pickMoney(value, ['gross_sales', 'discounts', 'shipping', 'adjustment', 'net_sales', 'vat', 'total', 'returns_subtotal', 'returns_vat', 'returns_total', 'net_after_pos_returns']);
  const invoiceCount = count(value.invoice_count);
  const returnsCount = count(value.returns_count);
  if (!money || invoiceCount === null || returnsCount === null) return null;
  return { ...money, invoice_count: invoiceCount, returns_count: returnsCount };
}

function readCollection(value: unknown): DeliveryChannelReport['collection'] | null {
  if (!isRecord(value)) return null;
  return pickMoney(value, ['platform_collected_total', 'merchant_collected_total', 'unclassified_total']);
}

function readExceptions(value: unknown): DeliveryChannelReport['exceptions'] | null {
  if (!isRecord(value)) return null;
  const context = count(value.context_branch_mismatch);
  const partner = count(value.credit_note_partner_mismatch);
  if (context === null || partner === null) return null;
  return { context_branch_mismatch: context, credit_note_partner_mismatch: partner };
}

function readCreditNotes(value: unknown): DeliveryChannelReport['credit_notes'] | null {
  if (!isRecord(value) || !isMoney(value.total) || !Array.isArray(value.by_platform) || !Array.isArray(value.rows)) return null;
  const notes = count(value.count);
  if (notes === null) return null;
  const byPlatform = [];
  for (const row of value.by_platform) {
    if (!isRecord(row) || !isText(row.delivery_platform_profile_id) || !isText(row.platform_key) || !isMoney(row.total)) return null;
    const rowCount = count(row.count);
    if (rowCount === null) return null;
    byPlatform.push({
      delivery_platform_profile_id: row.delivery_platform_profile_id,
      platform_key: row.platform_key,
      count: rowCount,
      total: row.total,
    });
  }
  const rows = [];
  for (const row of value.rows) {
    const parsed = readCreditRow(row);
    if (!parsed) return null;
    rows.push(parsed);
  }
  return { count: notes, total: value.total, by_platform: byPlatform, rows };
}

function readPlatforms(value: unknown): DeliveryChannelPlatformRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows: DeliveryChannelPlatformRow[] = [];
  for (const row of value) {
    if (!isRecord(row) || !isText(row.delivery_platform_profile_id) || !isText(row.platform_key)) return null;
    const money = pickMoney(row, ['gross_sales', 'discounts', 'shipping', 'adjustment', 'net_sales', 'vat', 'total', 'platform_collected_total', 'merchant_collected_total', 'unclassified_total', 'returns_subtotal', 'returns_vat', 'returns_total', 'net_after_pos_returns']);
    const invoiceCount = count(row.invoice_count);
    const returnsCount = count(row.returns_count);
    if (!money || invoiceCount === null || returnsCount === null) return null;
    rows.push({
      delivery_platform_profile_id: row.delivery_platform_profile_id,
      platform_key: row.platform_key,
      invoice_count: invoiceCount,
      returns_count: returnsCount,
      ...money,
    });
  }
  return rows;
}

function readInvoices(value: unknown): DeliveryChannelInvoiceRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows: DeliveryChannelInvoiceRow[] = [];
  for (const row of value) {
    if (!isRecord(row) || !isText(row.id) || !isText(row.number) || !isDay(row.invoice_date)) return null;
    if (!isText(row.delivery_platform_profile_id) || !isText(row.platform_key) || !isText(row.collection_mode)) return null;
    const branchId = nullableText(row.branch_id);
    const branchName = nullableText(row.branch_name);
    const displayName = nullableText(row.display_name);
    const displayNameEn = nullableText(row.display_name_en);
    const reference = nullableText(row.external_order_reference);
    const sessionId = nullableText(row.pos_session_id);
    const money = pickMoney(row, ['gross_sales', 'discounts', 'shipping', 'adjustment', 'net_sales', 'vat', 'total']);
    if (!money || branchId === undefined || branchName === undefined || displayName === undefined || displayNameEn === undefined || reference === undefined || sessionId === undefined) return null;
    rows.push({
      id: row.id,
      number: row.number,
      invoice_date: row.invoice_date,
      branch_id: branchId,
      branch_name: branchName,
      delivery_platform_profile_id: row.delivery_platform_profile_id,
      platform_key: row.platform_key,
      display_name: displayName,
      display_name_en: displayNameEn,
      collection_mode: row.collection_mode,
      external_order_reference: reference,
      pos_session_id: sessionId,
      ...money,
    });
  }
  return rows;
}

function readReturns(value: unknown): DeliveryChannelReturnRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows: DeliveryChannelReturnRow[] = [];
  for (const row of value) {
    if (!isRecord(row) || !isText(row.id) || !isText(row.number) || !isDay(row.return_date)) return null;
    if (!isText(row.source_invoice_id) || !isText(row.source_invoice_number)) return null;
    if (!isText(row.delivery_platform_profile_id) || !isText(row.platform_key)) return null;
    if (!isMoney(row.subtotal) || !isMoney(row.vat) || !isMoney(row.total)) return null;
    rows.push({
      id: row.id,
      number: row.number,
      return_date: row.return_date,
      source_invoice_id: row.source_invoice_id,
      source_invoice_number: row.source_invoice_number,
      delivery_platform_profile_id: row.delivery_platform_profile_id,
      platform_key: row.platform_key,
      subtotal: row.subtotal,
      vat: row.vat,
      total: row.total,
    });
  }
  return rows;
}

function readCreditRow(value: unknown): DeliveryChannelCreditRow | null {
  if (!isRecord(value) || !isText(value.id) || !isText(value.number) || !isDay(value.note_date)) return null;
  if (!isText(value.source_invoice_id) || !isText(value.source_invoice_number)) return null;
  if (!isText(value.delivery_platform_profile_id) || !isText(value.platform_key) || !isMoney(value.total)) return null;
  return {
    id: value.id,
    number: value.number,
    note_date: value.note_date,
    source_invoice_id: value.source_invoice_id,
    source_invoice_number: value.source_invoice_number,
    delivery_platform_profile_id: value.delivery_platform_profile_id,
    platform_key: value.platform_key,
    total: value.total,
  };
}

function pickMoney<K extends string>(row: Record<string, unknown>, keys: readonly K[]): { [P in K]: string } | null {
  const out = {} as { [P in K]: string };
  for (const key of keys) {
    if (!isMoney(row[key])) return null;
    out[key] = row[key];
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMoney(value: unknown): value is string {
  return typeof value === 'string' && MONEY.test(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

function isDay(value: unknown): value is string {
  return typeof value === 'string' && DAY.test(value);
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function nullableText(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

function nullableDay(value: unknown): string | null | undefined {
  if (value === null) return null;
  return isDay(value) ? value : undefined;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
