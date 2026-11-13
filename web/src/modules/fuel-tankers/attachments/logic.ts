/**
 * TANKER-PR5 — منطق نقي لمرفقات سند التعبئة على الجوال (قبل الرفع وبعده). **الخادم هو الحَكَم** (المحتوى الفعلي، النوع، الحجم، العدد، التكرار، الصلاحية، السياسة):
 * فحص المتصفح يوفّر رحلة شبكة ويشرح السبب فقط، ولا يُعتمد عليه أمنياً. لا شبكة ولا حالة هنا.
 */
export type AttachmentStatus = 'active' | 'removed' | 'replaced';
export type AttachmentKind = 'image' | 'pdf';

export interface FillAttachment {
  id: string;
  fuel_tanker_fill_id: string;
  fill_number: string | null;
  voucher_number: string | null;
  original_name: string;
  mime_type: string;
  kind: AttachmentKind;
  size: number;
  status: AttachmentStatus;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string | null;
  replaces_attachment_id: string | null;
  replaced_by_attachment_id: string | null;
  removed_by_name: string | null;
  removed_at: string | null;
  removal_reason: string | null;
}

export interface AttachmentPolicy {
  required: boolean;
  /** المرحلة المُعلَنة للإلزام (`never` = اختيارية). إرشادي فقط: لا إنفاذ بعد. */
  required_stage: 'never' | 'before_shift_approval' | 'before_settlement';
  mime_types: string[];
  max_bytes: number;
  max_count: number;
  max_per_request: number;
  after_close: 'allow' | 'deny';
  removal: 'open_shift_only' | 'always' | 'never';
}

/** حالة المرفقات من الخادم: السياسة الفعّالة وما يُسمح الآن ولماذا (لا استنتاج في المتصفح). */
export interface AttachmentState {
  policy: AttachmentPolicy;
  active_count: number;
  status: 'present' | 'missing' | 'none';
  can_add: boolean;
  add_blocked_reason: string | null;
  can_remove: boolean;
  remove_blocked_reason: string | null;
  can_view_history: boolean;
}

/** الافتراضات المعتمدة (تطابق `Settings::DEFAULTS`)؛ تُستعمل فقط ريثما تصل الحالة من الخادم ولا تُمنح بها صلاحية. */
export const SAFE_POLICY: AttachmentPolicy = {
  required: false, required_stage: 'never', mime_types: ['image/jpeg', 'image/png', 'application/pdf'], max_bytes: 10 * 1024 * 1024, max_count: 10, max_per_request: 5, after_close: 'allow', removal: 'open_shift_only',
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export function toAttachment(row: unknown): FillAttachment | null {
  if (!isObject(row) || typeof row.id !== 'string' || typeof row.original_name !== 'string') return null;
  const status: AttachmentStatus = row.status === 'removed' || row.status === 'replaced' ? row.status : 'active';
  const mime = str(row.mime_type) ?? 'application/octet-stream';
  return {
    id: row.id,
    fuel_tanker_fill_id: str(row.fuel_tanker_fill_id) ?? '',
    fill_number: str(row.fill_number),
    voucher_number: str(row.voucher_number),
    original_name: row.original_name,
    mime_type: mime,
    kind: row.kind === 'pdf' || mime === 'application/pdf' ? 'pdf' : 'image',
    size: typeof row.size === 'number' && row.size >= 0 ? row.size : 0,
    status,
    uploaded_by: str(row.uploaded_by),
    uploaded_by_name: str(row.uploaded_by_name),
    uploaded_at: str(row.uploaded_at),
    replaces_attachment_id: str(row.replaces_attachment_id),
    replaced_by_attachment_id: str(row.replaced_by_attachment_id),
    removed_by_name: str(row.removed_by_name),
    removed_at: str(row.removed_at),
    removal_reason: str(row.removal_reason),
  };
}

export function toState(meta: unknown): AttachmentState {
  const m = isObject(meta) ? meta : {};
  const p = isObject(m.policy) ? m.policy : {};
  const int = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback);
  const mimes = Array.isArray(p.mime_types) ? p.mime_types.filter((x): x is string => typeof x === 'string') : SAFE_POLICY.mime_types;
  const status = m.status === 'present' || m.status === 'missing' ? m.status : 'none';
  return {
    policy: {
      required: p.required === true,
      required_stage: p.required_stage === 'before_shift_approval' || p.required_stage === 'before_settlement' ? p.required_stage : 'never',
      mime_types: mimes.length > 0 ? mimes : SAFE_POLICY.mime_types,
      max_bytes: int(p.max_bytes, SAFE_POLICY.max_bytes),
      max_count: int(p.max_count, SAFE_POLICY.max_count),
      max_per_request: int(p.max_per_request, SAFE_POLICY.max_per_request),
      after_close: p.after_close === 'deny' ? 'deny' : 'allow',
      removal: p.removal === 'always' || p.removal === 'never' ? p.removal : 'open_shift_only',
    },
    active_count: typeof m.active_count === 'number' && m.active_count >= 0 ? m.active_count : 0,
    status,
    can_add: m.can_add === true,
    add_blocked_reason: str(m.add_blocked_reason),
    can_remove: m.can_remove === true,
    remove_blocked_reason: str(m.remove_blocked_reason),
    can_view_history: m.can_view_history === true,
  };
}

/** قيمة `accept` لمنتقي الملفات من أنواع السياسة. الصور تُحصر في JPEG/PNG كي يحوّل iOS صور HEIC إلى JPEG عند الاختيار. */
export const acceptAttr = (policy: AttachmentPolicy): string => policy.mime_types.join(',');
export const imageAcceptAttr = (policy: AttachmentPolicy): string => policy.mime_types.filter((mime) => mime.startsWith('image/')).join(',');

const EXTENSIONS: Record<string, string[]> = { 'application/pdf': ['pdf'], 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'] };

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** النوع المعلن للملف أو المستنتج من امتداده عندما يكون النوع فارغاً (بعض متصفحات الجوال). `null` = غير معروف. */
export function declaredMime(file: Pick<File, 'name' | 'type'>): string | null {
  const type = file.type.toLowerCase();
  if (type in EXTENSIONS) return type;
  if (type === '' || type === 'application/octet-stream') {
    const ext = extensionOf(file.name);
    return Object.entries(EXTENSIONS).find(([, exts]) => exts.includes(ext))?.[0] ?? null;
  }
  return type;
}

export type FileRejection = 'type' | 'size' | 'empty' | 'limit';
export interface FileCheck { accepted: File[]; rejected: Array<{ name: string; reason: FileRejection }> }

/** @param active عدد المرفقات النشطة الحالية، @param queued ما اختير للرفع ولم يُرفع بعد. */
export function checkFiles(picked: readonly File[], policy: AttachmentPolicy, active: number, queued = 0): FileCheck {
  const accepted: File[] = [];
  const rejected: FileCheck['rejected'] = [];
  for (const file of picked) {
    const mime = declaredMime(file);
    if (mime === null || !policy.mime_types.includes(mime)) rejected.push({ name: file.name, reason: 'type' });
    else if (file.size <= 0) rejected.push({ name: file.name, reason: 'empty' });
    else if (file.size > policy.max_bytes) rejected.push({ name: file.name, reason: 'size' });
    else if (active + queued + accepted.length >= policy.max_count) rejected.push({ name: file.name, reason: 'limit' });
    else accepted.push(file);
  }
  return { accepted, rejected };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const megabytes = (bytes: number): number => Math.round((bytes / (1024 * 1024)) * 10) / 10;

/**
 * رموز رفض الخادم (`reason`) ⇒ مفاتيح الرسائل. الرمز غير المعروف يعود `null` فتعرض الواجهة رسالة الخادم أو العامة (لا اختلاق).
 * التفاصيل الآمنة (`details`) تحمل الحدود فقط (بلا مسارات ولا PII).
 */
const REASONS = new Set([
  'attachment_invalid', 'attachment_type_not_allowed', 'attachment_too_large', 'attachment_limit_reached', 'attachment_add_blocked', 'attachment_removal_blocked',
  'attachment_not_active', 'attachment_same_content', 'attachment_duplicate', 'attachment_storage_failed', 'attachment_conflict', 'forbidden', 'not_found',
]);
export const reasonKey = (reason: unknown): string | null => (typeof reason === 'string' && REASONS.has(reason) ? reason : null);

/** سبب منع الإضافة/الإزالة من الحالة (`fill_voided`/`shift_closed`/`limit_reached`/`removal_disabled`) ⇒ مفتاح رسالة؛ غير المعروف `null`. */
export const BLOCK_REASONS = ['fill_voided', 'shift_closed', 'limit_reached', 'removal_disabled'] as const;
export const blockKey = (reason: string | null): (typeof BLOCK_REASONS)[number] | null => (reason !== null && (BLOCK_REASONS as readonly string[]).includes(reason) ? (reason as (typeof BLOCK_REASONS)[number]) : null);
