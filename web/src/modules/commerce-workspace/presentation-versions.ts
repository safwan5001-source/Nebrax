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
};

export type PresentationVersionDetail = PresentationVersionSummary & {
  config: StorefrontPresentationConfig;
};

type Failure<TReason extends string> =
  | { ok: false; reason: TReason; message: string }
  | { ok: false; reason: 'forbidden' | 'failed'; message: string };

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
    return { ok: false, reason: classifyPublishFailure(error), message: errorMessage(error, 'publish_failed') };
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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
