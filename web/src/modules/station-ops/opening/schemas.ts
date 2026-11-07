import { z } from 'zod';

/**
 * PR-2 — عقود استجابة الرصيد الافتتاحي للوقود (`FuelOpeningBalanceResource` + `preview`). تحقق متسامح مع الحقول الإضافية (`passthrough`)
 * ومتشدد في ما تعتمد عليه الواجهة. **مفاتيح المال تغيب لمن لا يرى التكلفة** (`products.view_cost`) فهي اختيارية دائماً — الغياب ليس صفراً.
 */
const text = z.string();
const int = z.number().int();
const optInt = int.nullable().optional();
const liters = z.union([z.string(), z.number()]).transform(String);

export const openingLineSchema = z.object({
  id: text,
  tank_id: text,
  tank_name: z.string().nullable().optional(),
  fuel_product_id: text,
  quantity_milliliters: int,
  quantity_liters: liters.optional(),
  unit_cost_per_liter_minor: optInt,
  value_minor: optInt,
}).passthrough();

export const openingDocSchema = z.object({
  id: text,
  number: text,
  status: text,
  station_id: text,
  opening_date: text,
  notes: z.string().nullable().optional(),
  allow_zero_cost: z.boolean().optional(),
  total_milliliters: int,
  cost_recorded: z.boolean().nullable().optional(),
  total_value_minor: optInt,
  journal_entry_id: z.string().nullable().optional(),
  posted_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  lines: z.array(openingLineSchema).optional(),
}).passthrough();

export const blockerSchema = z.object({ code: text, message: z.string().optional(), tank_id: z.string().optional(), fuel_product_id: z.string().optional() }).passthrough();

const journalSide = z.object({
  account_id: text.optional(),
  code: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  role: z.string().optional(),
  setting: z.string().optional(),
  amount_minor: int,
}).passthrough();

export const previewSchema = z.object({
  ready: z.boolean(),
  posted: z.boolean().optional(),
  blockers: z.array(blockerSchema),
  warnings: z.array(blockerSchema),
  products: z.array(z.object({ fuel_product_id: text, name: z.string().nullable().optional(), total_milliliters: int, unit_cost_per_liter_minor: optInt, value_minor: optInt }).passthrough()),
  lines: z.array(z.object({ fuel_tank_id: text, tank_name: z.string().nullable().optional(), quantity_milliliters: int, unit_cost_per_liter_minor: optInt, value_minor: optInt }).passthrough()),
  journal: z.object({ debit: journalSide, credit: journalSide }).passthrough().nullable().optional(),
  total_milliliters: int,
  total_value_minor: optInt,
  not_checked: z.array(text).optional(),
}).passthrough();

export const accountSchema = z.object({ id: text, code: text, name: text, type: text, is_group: z.boolean(), is_active: z.boolean() }).passthrough();

const paged = <T extends z.ZodTypeAny>(item: T) => z.object({ data: z.array(item), meta: z.object({ current_page: z.number().int(), last_page: z.number().int() }).partial().nullable().optional() });

export const docResponse = z.object({ data: openingDocSchema, meta: z.object({ replayed: z.boolean().optional() }).passthrough().optional() });
export const docsResponse = paged(openingDocSchema);
export const previewResponse = z.object({ data: previewSchema });
export const accountsResponse = z.object({ data: z.array(accountSchema) });
export const settingsResponse = z.object({ data: z.object({ fuel_opening_balance_account_id: z.string().nullable().optional(), fuel_distinct_approver_required: z.boolean().nullable().optional() }).passthrough() });

export type OpeningLine = z.infer<typeof openingLineSchema>;
export type OpeningDoc = z.infer<typeof openingDocSchema>;
export type OpeningBlocker = z.infer<typeof blockerSchema>;
export type OpeningPreview = z.infer<typeof previewSchema>;
export type OpeningAccount = z.infer<typeof accountSchema>;
