/**
 * CUST-H1-2 — عميل واجهة نسخ التصميم (`storefront_presentations/.../versions`).
 *
 * يغلّف الستّ نقاط التي أنشأها CUST-H1-1 (list/create/show/save/rename/delete)
 * بنفس اتفاقية `presentation.ts`: `{id}`/`{version}` محدِّدا صفّ فقط، لا
 * `tenant_id` في أي جسم طلب، والمستأجر من الجلسة عبر `SetTenant`.
 *
 * تصنيف 409: القراءة/الإنشاء تُصنَّف `unsupported_schema` (مخطط أمامي —
 * `ForwardSchemaVersionException`)؛ الحفظ/إعادة التسمية تُصنَّف `conflict`
 * (مراجعة قديمة أو نسخة منشورة غير قابلة للتعديل — كلاهما يعالَجان في
 * الواجهة بإعادة تحميل النسخة الحالية وعدم الكتابة فوق حالة الخادم)؛ الحذف
 * يُصنَّف `lifecycle_conflict` (منشورة/مجدولة/نسخة عمل متوافقة).
 */

import { api, hasApiStatus } from '@/lib/api';
import {
  normalizePresentationConfig,
  type StorefrontPresentationConfig,
} from '@/modules/store-experience-builder/presentation';
import { COMMERCE_STORE_ADMIN_LIST_PATH } from './stores';

export function commerceStorefrontPresentationVersionsPath(storefrontId: string): string {
  return `${COMMERCE_STORE_ADMIN_LIST_PATH}/${storefrontId}/presentation/versions`;
}

export function commerceStorefrontPresentationVersionPath(
  storefrontId: string,
  versionId: string,
): string {
  return `${commerceStorefrontPresentationVersionsPath(storefrontId)}/${versionId}`;
}

export function commerceStorefrontPresentationVersionPublishPath(
  storefrontId: string,
  versionId: string,
): string {
  return `${commerceStorefrontPresentationVersionPath(storefrontId, versionId)}/publish`;
}

export function commerceStorefrontPresentationVersionSchedulePath(
  storefrontId: string,
  versionId: string,
): string {
  return `${commerceStorefrontPresentationVersionPath(storefrontId, versionId)}/schedule`;
}

export type PresentationVersionState = 'draft' | 'scheduled' | 'published';

export type PresentationVersionSummary = {
  id: string;
  storefrontId: string;
  name: string;
  state: PresentationVersionState;
  schemaVersion: number;
  revision: number;
  scheduledFor: string | null;
  lastPublishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /**
   * CUST-H1-3 — حالة رأس النشر الحالية لهذا المتجر (`storefront_presentations.published_revision`)،
   * نفس القيمة على كل صفوف القائمة. المصدر الوحيد الذي يمكّن الواجهة من
   * إرسال `expected_published_revision` صحيحة مع طلب النشر الفوري — لا
   * حقل آخر يكشف هذه الحالة. `null` = لم يُنشَر هذا المتجر شيئاً بعد.
   */
  publishedRevision: number | null;
  /**
   * CUST-H1-4/5 — opaque Storefront-level schedule lifecycle token
   * (`schedule_epoch`-derived). Same value on every row of this Storefront's
   * list, present even in the no-schedule state. Required for every
   * schedule/reschedule/cancel request — never derived or guessed
   * client-side.
   */
  scheduleToken: string;
  /**
   * CUST-H1-5 — whether the Production runtime deployment gate
   * (`docs/plans/store/CUST-H1-ARCH-1-...md` §14) is verified active in the
   * *current* backend environment. A single environment-wide value mirrored
   * onto every row, exactly like `publishedRevision`/`scheduleToken` above.
   * `false` in Production today (no scheduler cron wired yet — CUST-H1-4
   * report) — the UI must gate Schedule/Reschedule with a clear explanation
   * rather than imply a live capability that isn't actually running.
   */
  schedulingRuntimeActive: boolean;
};

export type PresentationVersionDetail = PresentationVersionSummary & {
  config: StorefrontPresentationConfig;
};

/**
 * CUST-HV V3 — path ⇒ stable code of every publish-gate rejection
 * (`announcements.items[2].window.endsAt` ⇒ `window_end_not_after_start`), read
 * from a 422 `error_codes` map. Present only when the server sent one.
 */
export type PublishValidationIssues = Record<string, string>;

type Failure<TReason extends string> =
  | { ok: false; reason: TReason; message: string; issues?: PublishValidationIssues }
  | { ok: false; reason: 'forbidden' | 'failed'; message: string; issues?: PublishValidationIssues };

export type VersionListOutcome =
  | { ok: true; data: PresentationVersionSummary[] }
  | Failure<'not_found'>;

export type VersionReadOutcome =
  | { ok: true; data: PresentationVersionDetail }
  | Failure<'not_found' | 'unsupported_schema' | 'validation'>;

export type VersionWriteOutcome =
  | { ok: true; data: PresentationVersionDetail }
  | Failure<'not_found' | 'conflict' | 'validation' | 'unsupported_schema'>;

export type VersionDeleteOutcome =
  | { ok: true }
  | Failure<'not_found' | 'lifecycle_conflict'>;

/**
 * CUST-H1-3 — تصنيف فشل النشر أدقّ من فئة "conflict" العامة المستعملة
 * للحفظ/إعادة التسمية: كل هذه الحالات ترجع 409 من الخادم بنص عربي مختلف
 * (`StaleVersionRevisionException`/`StalePublicationHeadException`/
 * `VersionLifecycleConflictException`/`ForwardSchemaVersionException`) —
 * لا رمز خطأ منفصل في هذا المسار (خلافاً لمسار الأرصدة الافتتاحية)، فالتمييز
 * هنا نصّي عمداً على نص الرسالة العربية نفسه الذي يعرضه الخادم أصلاً، لا حقلاً
 * جديداً يُضاف الآن لعقدٍ ثابتٍ فعلاً.
 * - `stale`: مراجعة النسخة أو حالة رأس النشر لم تعودا كما راجعهما التاجر —
 *   العلاج نفسه للاثنين: تحديث الحالة الحالية قبل إعادة المحاولة يدوياً.
 * - `scheduled_conflict`: الهدف مجدولٌ حالياً — يجب إلغاء الجدولة أولاً.
 * - `unsupported_schema`: مخطط الهدف أحدث مما يدعمه الخادم الحالي.
 */
export type VersionPublishOutcome =
  | { ok: true; data: PresentationVersionDetail }
  | Failure<'not_found' | 'stale' | 'scheduled_conflict' | 'unsupported_schema' | 'validation'>;

/**
 * CUST-H1-5 — schedule/replace/reschedule failure classification, same
 * message-text convention as `classifyPublishFailure` (no dedicated `code`
 * field on this path either — see that function's own comment for why that
 * consistency was chosen over inventing one just for this endpoint):
 * - `stale_revision`: the target Version's `revision` no longer matches —
 *   someone edited/saved it since the dialog opened.
 * - `stale_token`: the Storefront's schedule lifecycle state changed since
 *   last reviewed (another session scheduled/replaced/canceled/rescheduled).
 * - `active_conflict`: the target became the Published version meanwhile —
 *   a Published Version can never be scheduled.
 */
export type VersionScheduleOutcome =
  | { ok: true; data: PresentationVersionDetail }
  | Failure<'not_found' | 'stale_revision' | 'stale_token' | 'active_conflict' | 'validation'>;

/**
 * CUST-H1-5 — cancel-schedule failure classification:
 * - `stale_token`: schedule lifecycle state changed since last reviewed.
 * - `not_scheduled`: the target is no longer the currently-scheduled
 *   Version (already published, replaced, or canceled elsewhere) — cancel
 *   never clears another Version's schedule.
 */
export type VersionCancelScheduleOutcome =
  | { ok: true; data: PresentationVersionDetail }
  | Failure<'not_found' | 'stale_token' | 'not_scheduled'>;

export async function listPresentationVersions(storefrontId: string): Promise<VersionListOutcome> {
  try {
    const payload = await api<unknown>(commerceStorefrontPresentationVersionsPath(storefrontId));
    const data = mapSummaryList(payload);
    if (data === null) return { ok: false, reason: 'failed', message: 'invalid_payload' };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, reason: classifyListFailure(error), message: errorMessage(error, 'list_failed') };
  }
}

export async function createPresentationVersion(
  storefrontId: string,
  name: string,
  sourceVersionId?: string | null,
): Promise<VersionWriteOutcome> {
  try {
    const body: Record<string, unknown> = { name };
    if (sourceVersionId) body.source_version_id = sourceVersionId;
    const payload = await api<unknown>(commerceStorefrontPresentationVersionsPath(storefrontId), {
      method: 'POST',
      body,
    });
    const data = mapDetail(payload);
    if (data === null) return { ok: false, reason: 'failed', message: 'invalid_payload' };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, reason: classifyCreateOrReadFailure(error), message: errorMessage(error, 'create_failed') };
  }
}

export async function showPresentationVersion(
  storefrontId: string,
  versionId: string,
): Promise<VersionReadOutcome> {
  try {
    const payload = await api<unknown>(commerceStorefrontPresentationVersionPath(storefrontId, versionId));
    const data = mapDetail(payload);
    if (data === null) return { ok: false, reason: 'failed', message: 'invalid_payload' };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, reason: classifyCreateOrReadFailure(error), message: errorMessage(error, 'load_failed') };
  }
}

export async function savePresentationVersion(
  storefrontId: string,
  versionId: string,
  config: StorefrontPresentationConfig,
  revision: number,
): Promise<VersionWriteOutcome> {
  try {
    const payload = await api<unknown>(commerceStorefrontPresentationVersionPath(storefrontId, versionId), {
      method: 'PUT',
      body: { config, revision },
    });
    const data = mapDetail(payload);
    if (data === null) return { ok: false, reason: 'failed', message: 'invalid_payload' };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, reason: classifyWriteFailure(error), message: errorMessage(error, 'save_failed') };
  }
}

export async function renamePresentationVersion(
  storefrontId: string,
  versionId: string,
  name: string,
  revision: number,
): Promise<VersionWriteOutcome> {
  try {
    const payload = await api<unknown>(commerceStorefrontPresentationVersionPath(storefrontId, versionId), {
      method: 'PATCH',
      body: { name, revision },
    });
    const data = mapDetail(payload);
    if (data === null) return { ok: false, reason: 'failed', message: 'invalid_payload' };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, reason: classifyWriteFailure(error), message: errorMessage(error, 'rename_failed') };
  }
}

/**
 * CUST-H1-3 — نشر فوري لنسخة محدَّدة تماماً. `expectedPublishedRevision`/
 * `expectedActiveVersionId` يجب أن يأتيا من آخر حالة رأس نشر وثّقتها الواجهة
 * فعلياً (آخر تحميل ناجح لقائمة النسخ) — لا قيمة مُخمَّنة أو مُفترَضة. لا
 * إعادة محاولة تلقائية هنا على أي فشل: التعارض دوماً قرارٌ يدوي صريح من
 * التاجر (راجع `VersionPublishOutcome`).
 */
export async function publishPresentationVersion(
  storefrontId: string,
  versionId: string,
  revision: number,
  expectedPublishedRevision: number | null,
  expectedActiveVersionId: string | null,
): Promise<VersionPublishOutcome> {
  try {
    const payload = await api<unknown>(commerceStorefrontPresentationVersionPublishPath(storefrontId, versionId), {
      method: 'POST',
      body: {
        revision,
        expected_published_revision: expectedPublishedRevision,
        expected_active_version_id: expectedActiveVersionId,
      },
    });
    const data = mapDetail(payload);
    if (data === null) return { ok: false, reason: 'failed', message: 'invalid_payload' };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, reason: classifyPublishFailure(error), message: errorMessage(error, 'publish_failed'), ...issuesOf(error) };
  }
}

/**
 * CUST-H1-5 — schedule a Draft Version, replace another Storefront's
 * currently-scheduled Version, or reschedule the same Version already
 * scheduled — the backend collapses all three into one transaction
 * (`StorefrontPresentationVersionService::scheduleForCurrentTenant`, see
 * CUST-H1-4's report for why: the request shape and lock/compare steps are
 * identical in every case). `scheduledForIso` must carry an explicit offset
 * (`Z` or `±HH:MM`) — never a bare local time. `expectedScheduleToken` must
 * come from the authoritative Storefront/Version state the merchant actually
 * reviewed (the current `scheduleToken` on any row of the last successful
 * list/detail load) — never inferred or fabricated.
 */
export async function schedulePresentationVersion(
  storefrontId: string,
  versionId: string,
  revision: number,
  scheduledForIso: string,
  expectedScheduleToken: string,
): Promise<VersionScheduleOutcome> {
  try {
    const payload = await api<unknown>(commerceStorefrontPresentationVersionSchedulePath(storefrontId, versionId), {
      method: 'PUT',
      body: {
        revision,
        scheduled_for: scheduledForIso,
        expected_schedule_token: expectedScheduleToken,
      },
    });
    const data = mapDetail(payload);
    if (data === null) return { ok: false, reason: 'failed', message: 'invalid_payload' };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, reason: classifyScheduleFailure(error), message: errorMessage(error, 'schedule_failed'), ...issuesOf(error) };
  }
}

/**
 * CUST-H1-5 — cancel a Version's schedule, returning it to Draft. Never a
 * generic delete: the Version row itself is untouched, only its schedule
 * state. `expectedScheduleToken` — same authority rule as
 * `schedulePresentationVersion` above.
 */
export async function cancelPresentationVersionSchedule(
  storefrontId: string,
  versionId: string,
  expectedScheduleToken: string,
): Promise<VersionCancelScheduleOutcome> {
  try {
    const payload = await api<unknown>(commerceStorefrontPresentationVersionSchedulePath(storefrontId, versionId), {
      method: 'DELETE',
      body: { expected_schedule_token: expectedScheduleToken },
    });
    const data = mapDetail(payload);
    if (data === null) return { ok: false, reason: 'failed', message: 'invalid_payload' };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, reason: classifyCancelScheduleFailure(error), message: errorMessage(error, 'cancel_schedule_failed') };
  }
}

export async function deletePresentationVersion(
  storefrontId: string,
  versionId: string,
): Promise<VersionDeleteOutcome> {
  try {
    await api<null>(commerceStorefrontPresentationVersionPath(storefrontId, versionId), {
      method: 'DELETE',
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: classifyDeleteFailure(error), message: errorMessage(error, 'delete_failed') };
  }
}

function mapSummaryList(payload: unknown): PresentationVersionSummary[] | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  const rows: PresentationVersionSummary[] = [];
  for (const row of data) {
    const summary = mapSummary(row);
    if (summary === null) return null;
    rows.push(summary);
  }
  return rows;
}

function mapDetail(payload: unknown): PresentationVersionDetail | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as { data?: unknown }).data;
  const summary = mapSummary(data);
  if (summary === null || !data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  if (!row.config || typeof row.config !== 'object' || Array.isArray(row.config)) return null;
  return { ...summary, config: normalizePresentationConfig(row.config) };
}

function mapSummary(row: unknown): PresentationVersionSummary | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;
  if (typeof record.id !== 'string' || record.id === '') return null;
  if (typeof record.storefront_id !== 'string' || record.storefront_id === '') return null;
  if (typeof record.name !== 'string') return null;
  if (record.state !== 'draft' && record.state !== 'scheduled' && record.state !== 'published') return null;
  const state = record.state;
  if (typeof record.revision !== 'number' || !Number.isFinite(record.revision)) return null;
  // فشل آمن كنظائره أعلاه (الحالة/المعرّف/المراجعة): `null` معناها الوحيد
  // المقبول "لم يُنشَر هذا المتجر شيئاً بعد" — أي نوع آخر غير رقم يُرفض الصفّ
  // كله بدل افتراض هذا المعنى بصمت (يُستعمل مباشرةً كـ`expected_published_revision`
  // في طلب النشر، فقيمة خاطئة صامتة هنا تُرسَل كسلطة نشرٍ فعلية).
  if (
    record.published_revision !== undefined
    && record.published_revision !== null
    && typeof record.published_revision !== 'number'
  ) {
    return null;
  }
  // نفس منطق `published_revision` أعلاه: `schedule_token` سلطة تُرسَل حرفياً
  // في طلبات الجدولة/الإلغاء اللاحقة (`expected_schedule_token`) — قيمة
  // مفقودة أو من نوع خاطئ تُرفض الصفّ كله بدل إرسال سلطة ملفَّقة لاحقاً.
  if (typeof record.schedule_token !== 'string' || record.schedule_token === '') return null;

  return {
    id: record.id,
    storefrontId: record.storefront_id,
    name: record.name,
    state,
    schemaVersion: typeof record.schema_version === 'number' ? record.schema_version : 1,
    revision: record.revision,
    scheduledFor: typeof record.scheduled_for === 'string' ? record.scheduled_for : null,
    lastPublishedAt: typeof record.last_published_at === 'string' ? record.last_published_at : null,
    createdAt: typeof record.created_at === 'string' ? record.created_at : null,
    updatedAt: typeof record.updated_at === 'string' ? record.updated_at : null,
    publishedRevision: typeof record.published_revision === 'number' ? record.published_revision : null,
    scheduleToken: record.schedule_token,
    // فشلٌ نحو الحالة الأكثر تقييداً لا رفض الصفّ: قيمةٌ مفقودة أو من نوع
    // خاطئ هنا تُسقِط قدرة الجدولة (`false`) بدل منحها ضمناً — خلافاً لـ`state`
    // حيث الافتراض الأكثر تساهلاً ("draft") هو ما يستوجب رفض الصفّ كله.
    schedulingRuntimeActive: record.scheduling_runtime_active === true,
  };
}

function classifyListFailure(error: unknown): 'not_found' | 'forbidden' | 'failed' {
  if (hasApiStatus(error, 403)) return 'forbidden';
  if (hasApiStatus(error, 404)) return 'not_found';
  return 'failed';
}

function classifyCreateOrReadFailure(
  error: unknown,
): 'not_found' | 'forbidden' | 'validation' | 'unsupported_schema' | 'failed' {
  if (hasApiStatus(error, 409)) return 'unsupported_schema';
  if (hasApiStatus(error, 403)) return 'forbidden';
  if (hasApiStatus(error, 404)) return 'not_found';
  if (hasApiStatus(error, 422)) return 'validation';
  return 'failed';
}

function classifyWriteFailure(
  error: unknown,
): 'not_found' | 'forbidden' | 'validation' | 'conflict' | 'failed' {
  if (hasApiStatus(error, 409)) return 'conflict';
  if (hasApiStatus(error, 403)) return 'forbidden';
  if (hasApiStatus(error, 404)) return 'not_found';
  if (hasApiStatus(error, 422)) return 'validation';
  return 'failed';
}

function classifyDeleteFailure(error: unknown): 'not_found' | 'forbidden' | 'lifecycle_conflict' | 'failed' {
  if (hasApiStatus(error, 409)) return 'lifecycle_conflict';
  if (hasApiStatus(error, 403)) return 'forbidden';
  if (hasApiStatus(error, 404)) return 'not_found';
  return 'failed';
}

/**
 * كل حالات 409 على مسار النشر ترجع من الخادم بنفس رمز الحالة (409) بنصوص
 * عربية مختلفة — لا رمز خطأ منفصل (`code`) في هذا المسار بعد. التمييز هنا
 * نصّي عمداً على نص رسالة الخادم نفسها (`StalePublicationHeadException`/
 * `VersionLifecycleConflictException`/`ForwardSchemaVersionException` —
 * كلٌّ بنصّ ثابت مغاير)؛ أي 409 آخر (مراجعة النسخة الهدف نفسها، مثلاً) يُصنَّف
 * `stale` — نفس معالجة "حدّث الحالة ثم أعد المحاولة يدوياً".
 */
function classifyPublishFailure(
  error: unknown,
): 'not_found' | 'forbidden' | 'validation' | 'stale' | 'scheduled_conflict' | 'unsupported_schema' | 'failed' {
  if (hasApiStatus(error, 409)) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('مخطط') || message.includes('أحدث مما يدعمه')) return 'unsupported_schema';
    if (message.includes('مجدولة')) return 'scheduled_conflict';
    return 'stale';
  }
  if (hasApiStatus(error, 403)) return 'forbidden';
  if (hasApiStatus(error, 404)) return 'not_found';
  if (hasApiStatus(error, 422)) return 'validation';
  return 'failed';
}

/**
 * CUST-H1-5 — same message-text classification convention as
 * `classifyPublishFailure` above, for the three 409 causes
 * `scheduleForCurrentTenant()` can raise (`StaleVersionRevisionException` /
 * `StaleScheduleTokenException` / `VersionLifecycleConflictException` when
 * the target is the active Published version) — each with its own fixed
 * Arabic text. `stale_revision` is the default 409 classification (matches
 * `StaleVersionRevisionException`'s text, the one case with no more specific
 * substring to match).
 */
function classifyScheduleFailure(
  error: unknown,
): 'not_found' | 'forbidden' | 'validation' | 'stale_revision' | 'stale_token' | 'active_conflict' | 'failed' {
  if (hasApiStatus(error, 409)) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('حالة الجدولة تغيّرت')) return 'stale_token';
    if (message.includes('لا يمكن جدولة')) return 'active_conflict';
    return 'stale_revision';
  }
  if (hasApiStatus(error, 403)) return 'forbidden';
  if (hasApiStatus(error, 404)) return 'not_found';
  if (hasApiStatus(error, 422)) return 'validation';
  return 'failed';
}

/**
 * CUST-H1-5 — `cancelScheduleForCurrentTenant()` raises only two 409 causes
 * (no `revision` in this request at all): `StaleScheduleTokenException` or
 * `VersionLifecycleConflictException` (target is no longer the scheduled
 * Version). `not_scheduled` is the default 409 classification.
 */
function classifyCancelScheduleFailure(
  error: unknown,
): 'not_found' | 'forbidden' | 'stale_token' | 'not_scheduled' | 'failed' {
  if (hasApiStatus(error, 409)) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('حالة الجدولة تغيّرت')) return 'stale_token';
    return 'not_scheduled';
  }
  if (hasApiStatus(error, 403)) return 'forbidden';
  if (hasApiStatus(error, 404)) return 'not_found';
  return 'failed';
}

function issuesOf(error: unknown): { issues?: PublishValidationIssues } {
  if (!hasApiStatus(error, 422)) return {};
  const body = (error as { body?: unknown }).body;
  const codes =
    typeof body === 'object' && body !== null ? (body as { error_codes?: unknown }).error_codes : undefined;
  if (typeof codes !== 'object' || codes === null || Array.isArray(codes)) return {};
  const issues: PublishValidationIssues = {};
  for (const [path, code] of Object.entries(codes)) {
    if (typeof code === 'string') issues[path] = code;
  }
  return Object.keys(issues).length > 0 ? { issues } : {};
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
