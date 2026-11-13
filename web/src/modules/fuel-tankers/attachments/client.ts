import { api, downloadFile, fetchPrivateFileUrl } from '@/lib/api';
import { toAttachment, toState, type AttachmentState, type FillAttachment } from './logic';

/**
 * TANKER-PR5 — **نقطة الشبكة الوحيدة** لمرفقات سند التعبئة (يحرسه `attachments-boundary.test.ts`): مسارات `fuel-stations/tanker-fills/{id}/attachments*` وحدها.
 * لا `tenant_id` ولا مسار تخزين ولا رابط عام: الملف يُجلب بترويسة المصادقة عبر Laravel ويُعرض كرابط محلي (`blob:`). دليل فقط — لا مخزون ولا قيد ولا فاتورة.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** معرّفات المسار UUID فقط — لا يُركَّب أي نص حر في عنوان الطلب. */
export function assertId(id: string): string {
  if (!UUID.test(id)) throw new Error('invalid_id');
  return id;
}

const base = (fillId: string) => `/fuel-stations/tanker-fills/${assertId(fillId)}/attachments`;

export interface AttachmentList { rows: FillAttachment[]; state: AttachmentState }

function listOf(payload: unknown): AttachmentList {
  const body = (typeof payload === 'object' && payload !== null ? payload : {}) as { data?: unknown; meta?: unknown };
  const rows = (Array.isArray(body.data) ? body.data : []).map(toAttachment).filter((row): row is FillAttachment => row !== null);
  return { rows, state: toState(body.meta) };
}

function oneOf(payload: unknown): { row: FillAttachment; state: AttachmentState } {
  const body = (typeof payload === 'object' && payload !== null ? payload : {}) as { data?: unknown; meta?: unknown };
  const row = toAttachment(body.data);
  if (row === null) throw new Error('malformed_response');
  return { row, state: toState(body.meta) };
}

/** @param history يضيف المُزال/المُستبدَل (لمن يملك صلاحية الإزالة فقط؛ غيره يتجاهله الخادم). */
export async function listAttachments(fillId: string, history = false): Promise<AttachmentList> {
  return listOf(await api<unknown>(`${base(fillId)}${history ? '?history=1' : ''}`));
}

/** رفع ملف واحد (كل ملف بطلبه: إعادة المحاولة مستقلة، والخادم idempotent بالمحتوى فلا نسخة ثانية). */
export async function uploadAttachment(fillId: string, file: File): Promise<AttachmentList> {
  const form = new FormData();
  form.append('attachments[]', file);
  return listOf(await api<unknown>(base(fillId), { method: 'POST', body: form }));
}

export async function replaceAttachment(fillId: string, attachmentId: string, file: File): Promise<{ row: FillAttachment; state: AttachmentState }> {
  const form = new FormData();
  form.append('attachment', file);
  return oneOf(await api<unknown>(`${base(fillId)}/${assertId(attachmentId)}/replace`, { method: 'POST', body: form }));
}

export async function removeAttachment(fillId: string, attachmentId: string, reason: string): Promise<{ row: FillAttachment; state: AttachmentState }> {
  return oneOf(await api<unknown>(`${base(fillId)}/${assertId(attachmentId)}`, { method: 'DELETE', body: { reason: reason.trim() } }));
}

/** رابط معاينة محلي (`blob:`) — المستدعي مسؤول عن `URL.revokeObjectURL`. */
export function previewUrl(fillId: string, attachmentId: string, mime: string): Promise<string> {
  return fetchPrivateFileUrl(`${base(fillId)}/${assertId(attachmentId)}/download`, mime);
}

export function downloadAttachment(fillId: string, attachmentId: string, fallbackName: string): Promise<'downloaded' | 'demo-unavailable'> {
  return downloadFile(`${base(fillId)}/${assertId(attachmentId)}/download`, fallbackName);
}
