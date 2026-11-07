/**
 * FUEL-B5.1 — منطق نقي لاختيار مرفقات سند المورد على الجوال (قبل الرفع). **الخادم هو الحَكَم** (المحتوى الفعلي، النوع، الحجم، التكرار، الصلاحية):
 * هذا الفحص يوفّر رحلة شبكة ويشرح السبب فقط، ولا يُعتمد عليه أمنياً.
 *
 * - الأنواع: PDF وJPG وPNG فقط (يطابق `FuelDeliveryAttachmentService`). كاميرا الآيفون تُسلّم JPEG عبر `accept="image/*"`.
 * - الحجم ≤ 10MB للملف، وحتى 5 ملفات في الطلب، و10 للاستلام الواحد.
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_PER_REQUEST = 5;
export const MAX_PER_DELIVERY = 10;
export const ACCEPT_ATTR = 'application/pdf,image/jpeg,image/png';
export const ACCEPT_IMAGE_ATTR = 'image/jpeg,image/png';

const ALLOWED: Record<string, string[]> = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
};

export type FileRejection = 'type' | 'size' | 'empty' | 'limit';

export interface FileCheck { accepted: File[]; rejected: Array<{ name: string; reason: FileRejection }> }

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** نوع الملف المسموح من الاسم/النوع المعلن (الفحص الفعلي في الخادم). `null` = غير مسموح. */
export function allowedMime(file: Pick<File, 'name' | 'type'>): string | null {
  const type = file.type.toLowerCase();
  if (type in ALLOWED) return type;
  if (type === '' || type === 'application/octet-stream') {
    const ext = extensionOf(file.name);
    return Object.entries(ALLOWED).find(([, exts]) => exts.includes(ext))?.[0] ?? null;
  }
  return null;
}

/** @param existing عدد المرفقات الموجودة/المختارة مسبقاً للاستلام نفسه. */
export function checkFiles(picked: readonly File[], existing: number): FileCheck {
  const accepted: File[] = [];
  const rejected: FileCheck['rejected'] = [];
  for (const file of picked) {
    if (allowedMime(file) === null) rejected.push({ name: file.name, reason: 'type' });
    else if (file.size <= 0) rejected.push({ name: file.name, reason: 'empty' });
    else if (file.size > MAX_FILE_BYTES) rejected.push({ name: file.name, reason: 'size' });
    else if (accepted.length >= MAX_PER_REQUEST || existing + accepted.length >= MAX_PER_DELIVERY) rejected.push({ name: file.name, reason: 'limit' });
    else accepted.push(file);
  }
  return { accepted, rejected };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isImageMime(mime: string | null | undefined): boolean {
  return mime === 'image/jpeg' || mime === 'image/png';
}

/**
 * ضغط صورة كبيرة قبل الرفع (صور الآيفون عالية الدقة قد تقارب الحدّ). أفضل جهد: أي فشل (لا canvas، لا ذاكرة) يعيد الملف الأصلي. لا يمسّ PDF ولا الصور الصغيرة.
 * الأبعاد القصوى 2400px والجودة 0.85 JPEG؛ يبقى الاسم مع امتداد jpg.
 */
export async function prepareImage(file: File, threshold = 3 * 1024 * 1024): Promise<File> {
  if (!isImageMime(allowedMime(file)) || file.size <= threshold || typeof document === 'undefined' || typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob || blob.size === 0 || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  }
}
