import type { DocBlockImageSize } from '../types';

export type ImageBlockKey = 'stamp' | 'signature';

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

/**
 * يحافظ غياب الخاصية على قياس المراجعات القديمة (`md`).
 * لا يقبل العارض إلا كتلة صورة معتمدة من عقد القالب.
 */
export function getDocumentImagePreviewClass(block: ImageBlockKey, size?: DocBlockImageSize): string {
  return PREVIEW_IMAGE_CLASSES[block][size ?? 'md'];
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
