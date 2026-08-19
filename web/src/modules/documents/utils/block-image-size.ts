import type { DocBlockAlignment, DocBlockImageOpacity, DocBlockImageSize } from '../types';

export type ImageBlockKey = 'stamp' | 'signature';

type PdfGStateCapable = {
  GState?: (parameters: { opacity: number }) => unknown;
  setGState?: (gState: unknown) => void;
};

const IMAGE_SIZE_MULTIPLIER: Record<DocBlockImageSize, number> = {
  sm: 0.75,
  md: 1,
  lg: 1.25,
};

const PREVIEW_IMAGE_CLASSES: Record<ImageBlockKey, Record<DocBlockImageSize, string>> = {
  stamp: {
    sm: 'h-16 w-auto max-w-full object-contain',
    md: 'h-24 w-auto max-w-full object-contain',
    lg: 'h-32 w-auto max-w-full object-contain',
  },
  signature: {
    sm: 'h-10 w-auto max-w-full object-contain',
    md: 'h-14 w-auto max-w-full object-contain',
    lg: 'h-20 w-auto max-w-full object-contain',
  },
};

const IMAGE_OPACITY_VALUES: Record<DocBlockImageOpacity, number> = {
  solid: 1,
  soft: 0.75,
  faint: 0.5,
};

const HISTORICAL_IMAGE_OPACITY: Record<ImageBlockKey, number> = {
  stamp: 0.9,
  signature: 1,
};

const PREVIEW_IMAGE_OPACITY_CLASSES: Record<DocBlockImageOpacity, string> = {
  solid: 'opacity-100',
  soft: 'opacity-75',
  faint: 'opacity-50',
};

/**
 * يحافظ غياب الخاصية على قياس المراجعات القديمة (`md`).
 * لا يقبل العارض إلا كتلة صورة معتمدة من عقد القالب.
 */
export function getDocumentImagePreviewClass(block: ImageBlockKey, size?: DocBlockImageSize): string {
  return PREVIEW_IMAGE_CLASSES[block][size ?? 'md'];
}

/** يعيد صنف معاينة ثابتاً مع استعادة شفافية كل كتلة التاريخية عند غياب الخاصية. */
export function getDocumentImagePreviewOpacityClass(block: ImageBlockKey, opacity?: DocBlockImageOpacity): string {
  if (opacity) return PREVIEW_IMAGE_OPACITY_CLASSES[opacity];
  return block === 'stamp' ? 'opacity-90' : 'opacity-100';
}

/** يعيد شفافية PDF المقابلة، مع صون مظهر الختم والتوقيع قبل إضافة الخاصية. */
export function getDocumentImagePdfOpacity(block: ImageBlockKey, opacity?: DocBlockImageOpacity): number {
  return opacity ? IMAGE_OPACITY_VALUES[opacity] : HISTORICAL_IMAGE_OPACITY[block];
}

/**
 * يحصر شفافية صورة واحدة في عملية الرسم التابعة لها. تدعم jsPDF تمرير حالة جديدة
 * إلى `setGState` مباشرةً؛ وعند عدم توافرها يبقى الرسم سليماً بلا شفافية بدلاً من
 * إيقاف تنزيل المستند. تعاد الحالة الكاملة دائماً حتى لو فشل الرسم.
 */
export function withDocumentImagePdfOpacity(
  pdf: PdfGStateCapable,
  opacity: number,
  draw: () => void,
): void {
  if (opacity >= 1 || !pdf.GState || !pdf.setGState) {
    draw();
    return;
  }

  pdf.setGState(pdf.GState({ opacity }));
  try {
    draw();
  } finally {
    pdf.setGState(pdf.GState({ opacity: 1 }));
  }
}

/** يوسّع أو يصغّر أبعاد PDF نسبةً إلى القياس الأصلي لذلك المولد. */
export function getDocumentImagePdfSize(
  size: DocBlockImageSize | undefined,
  baseWidth: number,
  baseHeight: number,
): { width: number; height: number } {
  const multiplier = IMAGE_SIZE_MULTIPLIER[size ?? 'md'];
  return { width: baseWidth * multiplier, height: baseHeight * multiplier };
}

/** يحول المحاذاة المنطقية للكتلة إلى إحداثي PDF متوافق مع مستند RTL. */
export function getDocumentImagePdfX(
  alignment: DocBlockAlignment | undefined,
  pageWidth: number,
  left: number,
  right: number,
  imageWidth: number,
): number {
  switch (alignment ?? 'start') {
    case 'center': return pageWidth / 2 - imageWidth / 2;
    case 'end': return left;
    default: return right - imageWidth;
  }
}
