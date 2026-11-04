/**
 * منطق نقيّ لمعالج استيراد كشف الطرف (IMP-PS-A4a): التحقق من المطابقة والإعداد، بناء الخيارات المجمَّدة، وحسم مخرجات المعاينة/التنفيذ (التكرار `already_imported` / `replayed`).
 * لا شبكة ولا React هنا؛ كل قاعدة تعكس رفض الخادم (`assertMapping` / `options`) كي لا يُكتشف الخطأ بعد رحلة، **والخادم يبقى الحَكَم**.
 */
import type { ApplyOptions } from '@/modules/import-jobs/client';
import type { PreviewOptions } from '../client';
import {
  periodIssue,
  type AmountDirection,
  type ApplyResult,
  type ColumnMapping,
  type FieldDefinition,
  type InspectColumn,
  type PartnerRole,
  type PeriodIssue,
  type PreviewResult,
} from '../contract';

export const WIZARD_STEPS = ['file', 'setup', 'mapping', 'preview', 'confirm', 'result'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export function stepIndex(step: WizardStep): number {
  return WIZARD_STEPS.indexOf(step);
}

/** مطابقة أولية من اقتراحات الخادم (`suggested_field`)؛ حقل مقترح لعمودين يُمنح لأول عمود فقط (لا ربط مزدوج). */
export function suggestedMapping(columns: InspectColumn[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const taken = new Set<string>();
  for (const column of columns) {
    const field = column.suggested_field;
    if (field && !taken.has(field)) {
      mapping[column.index] = field;
      taken.add(field);
    } else {
      mapping[column.index] = null;
    }
  }
  return mapping;
}

export interface MappingGaps {
  duplicate: boolean;
  missingDate: boolean;
  /** لا `amount` ولا زوج `debit`+`credit` */
  amountMissing: boolean;
  /** `amount` مع `debit`/`credit` معاً */
  amountConflict: boolean;
  /** `amount` وحده بلا اتجاه صريح */
  directionRequired: boolean;
  /** اتجاه محدَّد لكن الملف بعمودَي مدين/دائن */
  directionUnexpected: boolean;
}

export function mappingGaps(mapping: ColumnMapping, direction: AmountDirection | null): MappingGaps {
  const chosen = Object.values(mapping).filter((key): key is string => Boolean(key));
  const has = (key: string) => chosen.includes(key);
  const hasAmount = has('amount');
  const hasDebit = has('debit');
  const hasCredit = has('credit');

  return {
    duplicate: new Set(chosen).size !== chosen.length,
    missingDate: !has('line_date'),
    amountMissing: !hasAmount && !(hasDebit && hasCredit),
    amountConflict: hasAmount && (hasDebit || hasCredit),
    directionRequired: hasAmount && !hasDebit && !hasCredit && direction === null,
    directionUnexpected: !hasAmount && direction !== null,
  };
}

export function mappingReady(mapping: ColumnMapping, direction: AmountDirection | null): boolean {
  const gaps = mappingGaps(mapping, direction);
  return !Object.values(gaps).some(Boolean);
}

/** هل يستعمل الملف عمود مبلغ واحداً (فيظهر اختيار الاتجاه)؟ */
export function usesSingleAmount(mapping: ColumnMapping): boolean {
  return Object.values(mapping).includes('amount');
}

/** الحقول الإلزامية غير المربوطة (للرسائل). مع المبلغ/المدين/الدائن تُفصَّل في `MappingGaps`. */
export function missingRequiredFields(mapping: ColumnMapping, fields: FieldDefinition[]): FieldDefinition[] {
  const chosen = new Set(Object.values(mapping).filter(Boolean));
  return fields.filter((field) => field.required && !chosen.has(field.key));
}

export interface SetupInput {
  partnerId: string;
  role: PartnerRole | '';
  periodFrom: string;
  periodTo: string;
  /** `''` = المؤسسة كلها */
  branchId: string;
  dateToleranceDays: number | null;
  amountToleranceMinor: number | null;
  /** مقيَّد بفروع ⇒ يجب اختيار فرع (لا «المؤسسة كلها») */
  branchRequired: boolean;
}

export interface SetupIssues {
  partner: boolean;
  role: boolean;
  period: PeriodIssue | null;
  branch: boolean;
  dateTolerance: boolean;
  amountTolerance: boolean;
}

export function setupIssues(input: SetupInput, maxDateTolerance: number): SetupIssues {
  return {
    partner: input.partnerId === '',
    role: input.role === '',
    period: periodIssue(input.periodFrom, input.periodTo),
    branch: input.branchRequired && input.branchId === '',
    dateTolerance: input.dateToleranceDays === null || input.dateToleranceDays < 0 || input.dateToleranceDays > maxDateTolerance || !Number.isInteger(input.dateToleranceDays),
    amountTolerance: input.amountToleranceMinor === null,
  };
}

export function setupReady(input: SetupInput, maxDateTolerance: number): boolean {
  const issues = setupIssues(input, maxDateTolerance);
  return !issues.partner && !issues.role && issues.period === null && !issues.branch && !issues.dateTolerance && !issues.amountTolerance;
}

/** يحوّل الإعداد المتحقَّق منه إلى خيارات المعاينة. يرمي عند نقص — لا يُستدعى قبل `setupReady`. */
export function previewOptionsFrom(input: SetupInput, mapping: ColumnMapping, direction: AmountDirection | null): PreviewOptions {
  if (input.role === '' || input.dateToleranceDays === null || input.amountToleranceMinor === null) {
    throw new Error('setup incomplete');
  }
  return {
    partnerId: input.partnerId,
    role: input.role,
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    branchId: input.branchId || null,
    dateToleranceDays: input.dateToleranceDays,
    amountToleranceMinor: input.amountToleranceMinor,
    amountDirection: usesSingleAmount(mapping) ? direction : null,
    mapping,
  };
}

/** الخيارات التي تُرسَل عند إنشاء التشغيلة المربوطة: **مطابقة حرفياً** لخيارات المعاينة كي تتطابق البصمة (الخادم يعيد التحويل القانوني). */
export function applyOptionsFrom(options: PreviewOptions): ApplyOptions {
  return {
    partner_id: options.partnerId,
    role: options.role,
    period_from: options.periodFrom,
    period_to: options.periodTo,
    date_tolerance_days: options.dateToleranceDays,
    amount_tolerance_minor: options.amountToleranceMinor,
    ...(options.branchId ? { branch_id: options.branchId } : {}),
    ...(options.amountDirection ? { amount_direction: options.amountDirection } : {}),
    ...(options.mapping && Object.keys(options.mapping).length > 0 ? { mapping: options.mapping } : {}),
  };
}

export type PreviewVerdict = 'blocked_errors' | 'blocked_empty' | 'already_imported' | 'ready';

/** حكم المعاينة: الأخطاء تمنع، والملف المستورد سابقاً لا يُعاد استيراده (يُوجَّه إلى المقارنة القائمة)، ثم الجاهزية. */
export function previewVerdict(preview: PreviewResult): PreviewVerdict {
  if (preview.error_rows > 0) return 'blocked_errors';
  if (preview.total_rows === 0) return 'blocked_empty';
  if (preview.already_imported) return 'already_imported';
  return 'ready';
}

export function canConfirmImport(preview: PreviewResult | null, acknowledged: boolean): boolean {
  return preview !== null && previewVerdict(preview) === 'ready' && acknowledged;
}

export type ResultOutcome =
  | { kind: 'created'; reconciliationId: string | null; lines: number | null }
  | { kind: 'replayed'; reconciliationId: string | null; lines: number | null };

/** نتيجة تشغيلة مكتملة: `replayed` ⇒ استُورد الملف نفسه سابقاً (لا جديد). المعرّف قد يغيب فيُعطَّل زر الفتح بدل رابط مكسور. */
export function resultOutcome(applyResult: Record<string, unknown> | null | undefined): ResultOutcome {
  const result = (applyResult ?? {}) as ApplyResult;
  const id = typeof result.reconciliation_id === 'string' && result.reconciliation_id !== '' ? result.reconciliation_id : null;
  const lines = typeof result.lines === 'number' ? result.lines : null;
  return result.replayed === true ? { kind: 'replayed', reconciliationId: id, lines } : { kind: 'created', reconciliationId: id, lines };
}

/** رابط المقارنة: صفحة المساحة (A4b) غير مبنية بعد، فالرابط لقائمة الكشوف مع تمييز المقارنة بـ`highlight`، لا مسار مكسور. */
export function reconciliationHref(id: string | null): string {
  return id ? `/partner-statements?highlight=${encodeURIComponent(id)}` : '/partner-statements';
}

export interface BranchChoice {
  id: string;
  /** `null` = الاسم غير متاح (لا `branches.view`) فيُعرض رمز قصير. */
  name: string | null;
}

/**
 * خيارات الفرع في المعالج. المقيَّد: فروع نطاقه فقط (من `/me`)، بأسماء من `/branches` إن قُرئت وإلا بلا اسم. غير المقيَّد: ما قرأه `/branches`.
 * **للعرض فقط** — الخادم يعيد فحص نطاق الفرع عند المعاينة والتنفيذ.
 */
export function branchChoices(input: { restricted: boolean; scopeIds: readonly string[]; fetched: readonly { id: string; name: string }[]; failed: boolean }): BranchChoice[] {
  const byId = new Map(input.fetched.map((branch) => [branch.id, branch.name]));
  if (!input.restricted) return input.fetched.map((branch) => ({ id: branch.id, name: branch.name }));
  if (input.fetched.length === 0 && !input.failed) return [];
  return input.scopeIds.filter((id) => input.failed || byId.has(id)).map((id) => ({ id, name: byId.get(id) ?? null }));
}
