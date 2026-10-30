import { ApiError } from '@/lib/api';
import type { AppSchema } from '@/lib/app-builder';

/**
 * AD-01 / S01b — منطق حفظ المسودة بلا واجهة: قراءة تعارض الخادم (409 `draft_conflict`) وتصنيف أسباب فشل الحفظ،
 * ونسخة محلية احتياطية للتعديلات غير المحفوظة. العقد المشترك: `contracts/app-builder/draft-save-conflict.v1.json`.
 */

export interface DraftConflictInfo {
  currentRevision: number;
  baseRevision: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** يقرأ جسم 409 `draft_conflict` من الخادم؛ `null` لأي خطأ آخر (فلا يُعامَل 409 عام كتعارض مسودة). */
export function parseDraftConflict(err: unknown): DraftConflictInfo | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const body = err.body;
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.reason !== 'draft_conflict') return null;
  if (typeof b.current_revision !== 'number' || typeof b.base_revision !== 'number') return null;
  return {
    currentRevision: b.current_revision,
    baseRevision: b.base_revision,
    updatedBy: typeof b.updated_by === 'string' ? b.updated_by : null,
    updatedAt: typeof b.updated_at === 'string' ? b.updated_at : null,
  };
}

export type SaveFailureKind = 'conflict' | 'forbidden' | 'validation' | 'network' | 'other';

/** `network` = لم يصل الطلب/الرد إلى الخادم أصلاً (ليس ApiError) — التعديلات سليمة محلياً ويمكن إعادة المحاولة. */
export function classifySaveError(err: unknown): SaveFailureKind {
  if (parseDraftConflict(err)) return 'conflict';
  if (err instanceof ApiError) {
    if (err.status === 403) return 'forbidden';
    if (err.status === 422) return 'validation';
    return 'other';
  }
  return 'network';
}

// ── نسخة محلية احتياطية ────────────────────────────────────────────────────

const BACKUP_PREFIX = 'awj.appBuilder.draftBackup.v1';

export interface DraftBackup {
  v: 1;
  appId: string;
  userId: string;
  schema: AppSchema;
  /** الـrevision الذي بُنيت عليه التعديلات — يبقى أساس الحفظ التفاؤلي عند الاستعادة، فيُكتشف أي تعارض لاحق. */
  baseRevision: number;
  savedAt: string;
}

function backupKey(userId: string, appId: string): string {
  return `${BACKUP_PREFIX}.${userId}.${appId}`;
}

/** المفتاح يضمّ هوية المستخدم كي لا يظهر عمل مستخدم لآخر على المتصفح نفسه. */
export function writeDraftBackup(userId: string, appId: string, schema: AppSchema, baseRevision: number): boolean {
  try {
    const payload: DraftBackup = { v: 1, appId, userId, schema, baseRevision, savedAt: new Date().toISOString() };
    window.localStorage.setItem(backupKey(userId, appId), JSON.stringify(payload));
    return true;
  } catch {
    return false; // امتلاء التخزين أو حجبه: لا نكسر المحرر
  }
}

export function readDraftBackup(userId: string, appId: string): DraftBackup | null {
  try {
    const raw = window.localStorage.getItem(backupKey(userId, appId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DraftBackup> | null;
    if (!parsed || parsed.v !== 1 || parsed.appId !== appId || parsed.userId !== userId) return null;
    if (!parsed.schema || typeof parsed.schema !== 'object' || typeof parsed.baseRevision !== 'number') return null;
    return parsed as DraftBackup;
  } catch {
    return null;
  }
}

export function clearDraftBackup(userId: string, appId: string): void {
  try {
    window.localStorage.removeItem(backupKey(userId, appId));
  } catch {
    // لا شيء
  }
}

/**
 * يمسح النسخة المحلية بعد حفظٍ ناجح **فقط** إن كانت تخصّ ما حُفظ (أو لا يوجد شيء): تبويبٌ آخر للمستخدم نفسه على
 * التطبيق نفسه يشارك المفتاح، وقد تحمل نسخته تعديلات لم تُحفظ فلا يجوز محوها.
 */
export function clearDraftBackupIfSaved(userId: string, appId: string, savedSchema: AppSchema): void {
  const stored = readDraftBackup(userId, appId);
  if (stored && !schemasEqual(stored.schema, savedSchema)) return;
  clearDraftBackup(userId, appId);
}

export function schemasEqual(a: AppSchema, b: AppSchema): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
