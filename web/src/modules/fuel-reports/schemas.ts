import { z } from 'zod';

/**
 * HORIZON-REPORTS — مخطط حمولة محرك تقارير الوقود (مصدر الشكل: `FuelReportEngine::run` و`FuelReportCatalog`).
 * أي استجابة تخالف العقد تُرفض كاملةً. PHP يرمّز المصفوفة الفارغة `[]` بدل `{}` (مرشحات/صفوف بلا أعمدة) فيُطبَّع هنا ولا يُرفض.
 * اللترات `mL` صحيحة والنقود هللات صحيحة؛ التحويل للعرض وحده في `format.ts`.
 */

const label = z.object({ ar: z.string(), en: z.string() });
export type Label = z.infer<typeof label>;

export const COLUMN_TYPES = ['text', 'int', 'liters', 'money', 'bp', 'date', 'datetime', 'status'] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export const columnSchema = z.object({
  key: z.string().min(1),
  type: z.enum(COLUMN_TYPES),
  label,
  total: z.string().optional(),
  values: z.record(z.string(), label).optional(),
});
export type ReportColumn = z.infer<typeof columnSchema>;

const emptyArrayToObject = (value: unknown) => (Array.isArray(value) && value.length === 0 ? {} : value);

export const tableSchema = z.object({
  key: z.string().min(1),
  title: label,
  columns: z.array(columnSchema),
  rows: z.array(z.preprocess(emptyArrayToObject, z.record(z.string(), z.unknown()))),
  totals: z.preprocess(emptyArrayToObject, z.record(z.string(), z.number().nullable())).nullable(),
});
export type ReportTable = z.infer<typeof tableSchema>;

export const summaryItemSchema = z.object({
  key: z.string().min(1),
  label,
  type: z.enum([...COLUMN_TYPES, 'text']),
  value: z.union([z.number(), z.string(), z.null()]),
});
export type SummaryItem = z.infer<typeof summaryItemSchema>;

export const definitionSchema = z.object({
  key: z.string().min(1),
  family: z.string().min(1),
  title: label,
  description: label,
  filters: z.array(z.string()),
  source: z.string(),
  orientation: z.enum(['portrait', 'landscape']),
  thermal: z.boolean(),
});
export type ReportDefinition = z.infer<typeof definitionSchema>;

export const catalogSchema = z.object({
  data: z.object({ families: z.record(z.string(), label), reports: z.array(definitionSchema) }),
});
export type Catalog = z.infer<typeof catalogSchema>['data'];

export const payloadSchema = z.object({
  data: z.object({
    report: definitionSchema,
    generated_at: z.string(),
    timezone: z.string(),
    timezones: z.array(z.string()),
    tenant: z.object({ name: z.string().nullable() }),
    stations: z.array(z.object({ id: z.string(), name: z.string(), code: z.string().nullable().optional() })),
    period: z.object({ from: z.string(), to: z.string() }).nullable(),
    filters: z.preprocess(emptyArrayToObject, z.record(z.string(), z.unknown())),
    summary: z.array(summaryItemSchema),
    tables: z.array(tableSchema),
    data_quality: z.object({ complete: z.boolean(), gaps: z.array(z.string()), notes: z.array(label) }),
    truncated: z.boolean(),
    source: z.object({ kind: z.string() }),
  }),
});
export type ReportPayload = z.infer<typeof payloadSchema>['data'];
