import { z } from 'zod';

/**
 * FUEL-B4 — مخططات استجابات إدارة الموظفين (مصدر الشكل: `FuelStaffAccessService::view()/templates()` و`AccessChangeAuditReader`).
 * أي استجابة تخالف الحقول المطلوبة تُرفض كاملةً (`invalid_shape`) بدل عرض صلاحيات مشتقة من بيانات غير مفهومة.
 */

const text = z.string();
const strings = z.array(z.string());

export const staffViewSchema = z.object({
  user: z.object({ id: text.min(1), name: text, email: z.string().nullable().optional(), is_active: z.boolean() }),
  role: text,
  /** `seller` | `supervisor` | `station_manager` | `custom` | `none` — يحدّده الخادم من الصلاحيات الفعلية. */
  template: text,
  fuel_permissions: strings,
  fuel_station_scope: z.string().nullable(),
  station_ids: strings,
  revision: text.min(1),
});

export const templateSchema = z.object({
  key: text.min(1),
  label_ar: text,
  label_en: text,
  permissions: strings,
  /** ما يستطيع هذا الفاعل تفويضه من القالب فعلاً (الباقي يرفضه الخادم). */
  assignable: z.boolean(),
});

export const templatesPayloadSchema = z.object({
  templates: z.array(templateSchema),
  catalog: strings,
  delegable: strings,
  reserved: strings,
});

export const candidateSchema = z.object({ id: text.min(1), name: text, email: z.string().nullable().optional(), is_active: z.boolean() });

const changeSchema = z.object({
  key: text,
  kind: z.enum(['list', 'scalar']),
  added: strings.optional(),
  removed: strings.optional(),
  count: z.number().int().optional(),
  from: z.union([z.string(), z.boolean(), z.null()]).optional(),
  to: z.union([z.string(), z.boolean(), z.null()]).optional(),
});

const partySchema = z.object({ id: text, name: z.string().nullable().optional() });

export const auditEventSchema = z.object({
  id: text.min(1),
  occurred_at: z.string().nullable(),
  action: text,
  subject_type: text,
  outcome: z.enum(['applied', 'denied']),
  actor: partySchema.nullable(),
  target: partySchema.extend({ kind: z.enum(['user', 'role']) }).nullable(),
  reason: z.string().nullable().optional(),
  denial_reason: z.string().nullable().optional(),
  changes: z.array(changeSchema),
});

export const auditPageSchema = z.object({
  data: z.array(auditEventSchema),
  meta: z.object({ current_page: z.number().int(), last_page: z.number().int(), per_page: z.number().int(), total: z.number().int() }),
});

export const staffListResponse = z.object({ data: z.array(staffViewSchema) });
export const staffOneResponse = z.object({ data: staffViewSchema });
export const templatesResponse = z.object({ data: templatesPayloadSchema });
export const candidatesResponse = z.object({ data: z.array(candidateSchema) });

export type StaffView = z.infer<typeof staffViewSchema>;
export type StaffTemplate = z.infer<typeof templateSchema>;
export type TemplatesPayload = z.infer<typeof templatesPayloadSchema>;
export type Candidate = z.infer<typeof candidateSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type AuditPage = z.infer<typeof auditPageSchema>;
