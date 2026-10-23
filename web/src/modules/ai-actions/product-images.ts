// AI-ACTIONS-06 — عقد صور المنتجات في الاستيراد عبر مساعد أَوْج.
// الخادم هو المرجع الوحيد: ما جُهِّز وما سيُطبَّق وما نجح يُقرأ منه ولا يُحسب هنا.
import type { Lang } from './product-execution';

export type PreviewImageStatus = 'ready' | 'skipped' | 'unavailable' | 'error';
export type RowImagesStatus = 'none' | 'ready' | 'needs_decision' | 'unavailable' | 'error' | 'skipped';
/** حالة الصورة في نتيجة التنفيذ: ما لم يكن «ready» في المعاينة يحمل حالته الأصلية ولا يُحسب نجاحاً. */
export type ImageResultStatus = 'pending' | 'success' | 'failed' | 'skipped' | 'unavailable' | 'error';

export interface StagedImage {
  id: string;
  sha256: string;
  mime_type: string;
  size: number;
  width: number;
  height: number;
}

export interface PreviewImageItem {
  key: string;
  role: 'primary' | 'additional';
  position: number;
  source: { kind: 'archive' | 'url'; label: string };
  status: PreviewImageStatus;
  code: string | null;
  message: string | null;
  image: StagedImage | null;
}

export interface PreviewImages {
  count: number;
  ready: number;
  will_apply: boolean;
  status: RowImagesStatus;
  mode: 'new_product' | 'append_existing';
  existing: { count: number; update_approved: boolean | null };
  items: PreviewImageItem[];
}

export interface PreviewImagesSummary {
  archive: { total: number; matched: number; unmatched: { id: string; label: string }[] };
}

export interface ExecutionImage {
  key: string;
  role: 'primary' | 'additional';
  position: number;
  source: { kind: 'archive' | 'url'; label: string };
  image_id: string | null;
  status: ImageResultStatus;
  error_code: string | null;
  error_message: string | null;
  retryable: boolean;
  attempts: number;
  product_media_id: string | null;
}

export interface ExecutionImagesSummary {
  total: number;
  pending: number;
  success: number;
  failed: number;
  skipped: number;
  waiting_for_product: number;
}

export interface StagedArchive {
  archive: { id: string; label: string; sha256: string; mime_type: string; size: number; width: number; height: number }[];
  remote: number;
}

export const thumbnailPath = (actionId: string, imageId: string): string => `/ai-actions/${actionId}/images/${imageId}/thumbnail`;

export const IMAGE_TONE: Record<ImageResultStatus, 'positive' | 'negative' | 'muted' | 'warning'> = {
  success: 'positive',
  failed: 'negative',
  error: 'negative',
  skipped: 'muted',
  unavailable: 'warning',
  pending: 'warning',
};

const TEXT = {
  ar: {
    cardTitle: 'صور المنتجات',
    cardHint: 'ارفع ملف ZIP تسمّى صوره برمز الصنف أو الباركود: «SKU.jpg» للغلاف و«SKU__2.jpg» للإضافية. تُفحص الصور وتُخزَّن بشكل خاص ولا تُرفق بأي منتج قبل الموافقة والتنفيذ.',
    choose: 'اختر ملف ZIP للصور',
    uploading: 'جارٍ فحص الصور…',
    staged: (n: number) => `جُهِّزت ${n} صورة للمعاينة`,
    stagedNone: 'لم تُرفع صور بعد',
    remoteStaged: (n: number) => `${n} صورة من روابط خارجية جُهِّزت في معاينات سابقة`,
    saveFirst: 'احفظ تعديلاتك أولاً ثم ارفع الصور.',
    locked: 'لا يمكن إضافة صور بعد بدء التنفيذ.',
    uploadFailed: 'تعذّر رفع الصور.',
    resetNote: 'رفع صور جديدة يُبطل أي معاينة أو موافقة سابقة.',
    thumbAlt: (label: string) => `صورة ${label}`,
    roles: { primary: 'رئيسية', additional: 'إضافية' },
    sources: { archive: 'من الأرشيف', url: 'من رابط' },
    previewStatus: { ready: 'ستُرفق', skipped: 'لن تُرفق', unavailable: 'غير متاحة', error: 'مرفوضة' } as Record<PreviewImageStatus, string>,
    resultStatus: { pending: 'قيد الانتظار', success: 'أُرفقت', failed: 'فشلت', skipped: 'لم تُرفق', unavailable: 'غير متاحة', error: 'مرفوضة' } as Record<ImageResultStatus, string>,
    rowStatus: {
      none: 'بلا صور', ready: 'جاهزة', needs_decision: 'تحتاج قراراً', unavailable: 'غير متاحة', error: 'بها أخطاء', skipped: 'لن تُرفق',
    } as Record<RowImagesStatus, string>,
    count: (n: number) => (n === 1 ? 'صورة واحدة' : `${n} صور`),
    appendOnly: 'تُضاف إلى صور المنتج الحالية فقط — لا استبدال ولا حذف.',
    unmatched: (n: number) => `${n} صورة في الأرشيف لم تطابق أي صف`,
    decision: 'إضافة صور هذا الصف إلى المنتج الموجود (إلحاق فقط، لا استبدال)',
    retryableImage: 'قابلة لإعادة المحاولة',
    imageResults: 'الصور',
    openMedia: 'تُعرض ضمن صور المنتج',
  },
  en: {
    cardTitle: 'Product images',
    cardHint: 'Upload a ZIP whose images are named after the SKU or barcode: “SKU.jpg” for the cover, “SKU__2.jpg” for extras. Images are checked and stored privately; nothing is attached to a product before approval and execution.',
    choose: 'Choose an images ZIP',
    uploading: 'Checking images…',
    staged: (n: number) => `${n} image(s) prepared for the preview`,
    stagedNone: 'No images uploaded yet',
    remoteStaged: (n: number) => `${n} image(s) from external links prepared by earlier previews`,
    saveFirst: 'Save your edits first, then upload images.',
    locked: 'Images cannot be added once execution has started.',
    uploadFailed: 'Could not upload the images.',
    resetNote: 'Uploading new images voids any earlier preview or approval.',
    thumbAlt: (label: string) => `Image ${label}`,
    roles: { primary: 'Cover', additional: 'Extra' },
    sources: { archive: 'From archive', url: 'From link' },
    previewStatus: { ready: 'Will attach', skipped: 'Will not attach', unavailable: 'Unavailable', error: 'Rejected' } as Record<PreviewImageStatus, string>,
    resultStatus: { pending: 'Pending', success: 'Attached', failed: 'Failed', skipped: 'Not attached', unavailable: 'Unavailable', error: 'Rejected' } as Record<ImageResultStatus, string>,
    rowStatus: {
      none: 'No images', ready: 'Ready', needs_decision: 'Needs a decision', unavailable: 'Unavailable', error: 'Has errors', skipped: 'Will not attach',
    } as Record<RowImagesStatus, string>,
    count: (n: number) => (n === 1 ? '1 image' : `${n} images`),
    appendOnly: 'Added to the product’s current images only — nothing is replaced or deleted.',
    unmatched: (n: number) => `${n} archive image(s) matched no row`,
    decision: 'Add this row’s images to the existing product (append only, no replacement)',
    retryableImage: 'Retryable',
    imageResults: 'Images',
    openMedia: 'Shown in the product’s images',
  },
};

export function imageText(lang: Lang) {
  return TEXT[lang];
}

/** صور المعاينة التي سيُرفَق ما بعدها فعلاً، لعرض موجز الصف. */
export function readyCount(images: PreviewImages | null | undefined): number {
  return images?.ready ?? 0;
}

/** هل في الصف صورة بحاجة إلى قرار صريح لمنتج موجود؟ */
export function needsMediaDecision(images: PreviewImages | null | undefined): boolean {
  return images?.status === 'needs_decision';
}
