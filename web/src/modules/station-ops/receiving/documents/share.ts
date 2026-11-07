/**
 * FUEL-B5.1 — تسليم الملفات المولَّدة للمستخدم على الجوال: عرض/طباعة PDF، تنزيل، ومشاركة (ورقة المشاركة الأصلية في iOS مع رجوع للتنزيل).
 * لا شبكة API هنا. `fetch` الوحيد لقراءة رابط `blob:` محلي أنشأه المتصفح نفسه (مشاركة Excel المجلوب بمصادقة).
 */

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** يفتح PDF في تبويب جديد ليُطبع/يُحفظ من عارض المتصفح (طباعة iOS عبر ورقة المشاركة ← طباعة). يعيد false إن حُجبت النافذة المنبثقة. */
export function openForPrint(blob: Blob): boolean {
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, '_blank', 'noopener');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return opened !== null;
}

export async function shareBlob(blob: Blob, fileName: string, mime: string, title: string): Promise<ShareOutcome> {
  const file = new File([blob], fileName, { type: mime });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof navigator.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'; // المستخدم أغلق الورقة: ليس خطأ ولا تنزيلاً
      throw error;
    }
  }
  downloadBlob(blob, fileName);
  return 'downloaded';
}

/** blob من رابط `blob:` محلي فقط (يرفض أي مصدر آخر). */
export async function blobFromObjectUrl(url: string): Promise<Blob> {
  if (!url.startsWith('blob:')) throw new Error('only local blob URLs are readable here');
  const response = await fetch(url);
  const blob = await response.blob();
  URL.revokeObjectURL(url);
  return blob;
}
