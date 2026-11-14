import { api } from '@/lib/api';
import { assertId } from '../client';
import { notSent, classifyWriteError, type WriteOutcome } from './outcome';
import {
  queryEntries, readDetail, readPostingPreview, readReversalPreview, readWorkspace, readWriteSuccess,
  type FillDetail, type OperationPreview, type WorkspacePage, type WorkspaceQuery,
} from './logic';

/**
 * TANKER-PR6B-5 — **نقطة الشبكة الوحيدة** لمساحة عمل الدمج المخزني لسندات التعبئة (يحرسه `fills-boundary.test.ts`): قائمة بيضاء من ستة مسارات فقط —
 * قراءة القائمة، قراءة التفاصيل، معاينتا الترحيل والعكس (GET)، وكتابتان (POST) هما الترحيل والعكس. لا PUT/PATCH/DELETE، ولا `tenant_id`، ولا ساعة عميل،
 * ولا كمية أو تكلفة أو حساب في أي حمولة (الحمولة `reason` و`confirm_historical` فقط). الخادم يفرض البوابات والصلاحيات ونطاق المحطة والعزل.
 *
 * **لا إعادة إرسال تلقائية أبداً**: الكتابة تعيد نتيجة صادقة (`WriteOutcome`)، والنتيجة غير المؤكدة تُحسم بقراءة التفاصيل (`getFill`) لا بإعادة الكتابة.
 */
const BASE = '/fuel-stations/tanker-fills';
const WORKSPACE = `${BASE}/inventory-workspace`;

/** مهلة طلب الكتابة؛ بعدها تُعلَن النتيجة «غير مؤكدة» (قد تكون العملية تمّت) لا فشلاً. */
export const WRITE_TIMEOUT_MS = 30_000;

const fillPath = (id: string, suffix: string) => `${BASE}/${assertId(id)}/${suffix}`;

export async function listFills(query: WorkspaceQuery = {}): Promise<WorkspacePage> {
  const entries = queryEntries({ ...query, stationId: query.stationId ? assertId(query.stationId) : undefined });
  const qs = entries.length === 0 ? '' : `?${new URLSearchParams(entries).toString()}`;
  return readWorkspace(await api<unknown>(`${WORKSPACE}${qs}`));
}

export async function getFill(id: string): Promise<FillDetail> {
  return readDetail(await api<unknown>(fillPath(id, 'inventory')));
}

export async function previewPosting(id: string): Promise<OperationPreview> {
  return readPostingPreview(await api<unknown>(fillPath(id, 'inventory-posting/preview')));
}

export async function previewReversal(id: string): Promise<OperationPreview> {
  return readReversalPreview(await api<unknown>(fillPath(id, 'inventory-reversal/preview')));
}

export interface PostBody { reason?: string; confirm_historical?: true }
export interface ReverseBody { reason: string }

/** الإرسال المشترك للكتابتين: نتيجة صادقة، مهلة صريحة، بلا إعادة محاولة. */
async function submit(path: string, body: PostBody | ReverseBody): Promise<WriteOutcome> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return notSent('offline');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WRITE_TIMEOUT_MS);
  try {
    const raw = await api<unknown>(path, { method: 'POST', body, signal: controller.signal });
    try {
      const success = readWriteSuccess(raw);
      return { kind: 'ok', replayed: success.replayed, inventoryStatus: success.inventoryStatus };
    } catch {
      // نجاح HTTP بجسم غير مفهوم: لا نعلن النجاح ولا الفشل — تُعاد القراءة.
      return { kind: 'unknown', cause: 'unverified' };
    }
  } catch (error) {
    return classifyWriteError(error);
  } finally {
    clearTimeout(timer);
  }
}

/** ترحيل السند مخزنياً ومحاسبياً (`POST …/inventory-posting`). التنفيذ بطلب صريح من المستخدم وحده. */
export async function postInventory(id: string, body: PostBody): Promise<WriteOutcome> {
  let path: string;
  try { path = fillPath(id, 'inventory-posting'); } catch { return notSent('invalid_id'); }
  return submit(path, body);
}

/** عكس ترحيل السند (`POST …/inventory-reversal`) بسبب إلزامي. */
export async function reverseInventory(id: string, body: ReverseBody): Promise<WriteOutcome> {
  let path: string;
  try { path = fillPath(id, 'inventory-reversal'); } catch { return notSent('invalid_id'); }
  return submit(path, body);
}
