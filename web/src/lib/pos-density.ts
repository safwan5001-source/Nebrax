/** تفضيل عرض الكاشير فقط. لا يغيّر `show_product_images` الآتي من الخادم. */
export const POS_DENSITY_STORAGE_KEY = 'awj-pos-density-v3';

export type PosDensityMode = 'compact' | 'standard' | 'visual';

export function parsePosDensity(value: string | null | undefined): PosDensityMode {
  if (value === 'compact' || value === 'standard' || value === 'visual') return value;
  return 'standard';
}

/** Compact لا يعرض صورة. Standard/Visual يعرضان الصورة فقط إن سمح إعداد الخادم. */
export function posTileShowsImage(density: PosDensityMode, serverShowImages: boolean): boolean {
  if (density === 'compact') return false;
  return serverShowImages;
}
