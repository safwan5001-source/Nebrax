/**
 * AWJ Fuel Icons V2 — سجلّ الأصول الرسمية العشرين (مكتبة مشتركة، لا تعتمد على نظام تصميم أي تطبيق).
 *
 * الأصول في `public/fuel-icons/v2` منقولة حرفياً من حزمة «Reference-Locked» المعتمدة؛ لا إعادة رسم ولا تلوين.
 * التسميات العربية/الإنجليزية هنا منفصلة عن الرسم (كما في `icons.json` الأصلي). لا منطق أعمال.
 */

export const FUEL_ICON_IDS = [
  'gasoline-91',
  'gasoline-95',
  'diesel',
  'fuel-product',
  'fuel-derivatives',
  'pump-91',
  'pump-95',
  'pump-diesel',
  'fuel-pump',
  'nozzle-91',
  'nozzle-95',
  'nozzle-diesel',
  'tank-91',
  'tank-95',
  'tank-diesel',
  'fuel-station',
  'storage-tanks',
  'control-valve',
  'fuel-meter',
  'fuel-transport',
] as const;

export type FuelIconId = (typeof FUEL_ICON_IDS)[number];
export type FuelIconLocale = 'ar' | 'en';
export type FuelIconKind = 'product' | 'pump' | 'nozzle' | 'tank' | 'facility' | 'equipment';

export interface FuelIconDef {
  id: FuelIconId;
  kind: FuelIconKind;
  ar: string;
  en: string;
}

export const FUEL_ICONS: Record<FuelIconId, FuelIconDef> = {
  'gasoline-91': { id: 'gasoline-91', kind: 'product', ar: 'بنزين 91', en: 'Gasoline 91' },
  'gasoline-95': { id: 'gasoline-95', kind: 'product', ar: 'بنزين 95', en: 'Gasoline 95' },
  diesel: { id: 'diesel', kind: 'product', ar: 'ديزل', en: 'Diesel' },
  'fuel-product': { id: 'fuel-product', kind: 'product', ar: 'منتج وقود', en: 'Fuel product' },
  'fuel-derivatives': { id: 'fuel-derivatives', kind: 'product', ar: 'مشتقات وقود', en: 'Fuel derivatives' },
  'pump-91': { id: 'pump-91', kind: 'pump', ar: 'مضخة بنزين 91', en: 'Gasoline 91 pump' },
  'pump-95': { id: 'pump-95', kind: 'pump', ar: 'مضخة بنزين 95', en: 'Gasoline 95 pump' },
  'pump-diesel': { id: 'pump-diesel', kind: 'pump', ar: 'مضخة ديزل', en: 'Diesel pump' },
  'fuel-pump': { id: 'fuel-pump', kind: 'pump', ar: 'مضخة', en: 'Fuel pump' },
  'nozzle-91': { id: 'nozzle-91', kind: 'nozzle', ar: 'فوهة بنزين 91', en: 'Gasoline 91 nozzle' },
  'nozzle-95': { id: 'nozzle-95', kind: 'nozzle', ar: 'فوهة بنزين 95', en: 'Gasoline 95 nozzle' },
  'nozzle-diesel': { id: 'nozzle-diesel', kind: 'nozzle', ar: 'فوهة ديزل', en: 'Diesel nozzle' },
  'tank-91': { id: 'tank-91', kind: 'tank', ar: 'خزان بنزين 91', en: 'Gasoline 91 tank' },
  'tank-95': { id: 'tank-95', kind: 'tank', ar: 'خزان بنزين 95', en: 'Gasoline 95 tank' },
  'tank-diesel': { id: 'tank-diesel', kind: 'tank', ar: 'خزان ديزل', en: 'Diesel tank' },
  'fuel-station': { id: 'fuel-station', kind: 'facility', ar: 'محطة وقود', en: 'Fuel station' },
  'storage-tanks': { id: 'storage-tanks', kind: 'facility', ar: 'خزانات التخزين', en: 'Storage tanks' },
  'control-valve': { id: 'control-valve', kind: 'equipment', ar: 'صمام تحكم', en: 'Control valve' },
  'fuel-meter': { id: 'fuel-meter', kind: 'equipment', ar: 'عدّاد وقود', en: 'Fuel meter' },
  'fuel-transport': { id: 'fuel-transport', kind: 'equipment', ar: 'نقل الوقود', en: 'Fuel transport' },
};

export const FUEL_ICON_BASE_PATH = '/fuel-icons/v2';

/** مقاس الأصل المعتمد (عرض×ارتفاع) — نسبة 5:4 ثابتة لكل الأيقونات. */
export const FUEL_ICON_NATIVE = { width: 320, height: 256 } as const;
export const FUEL_ICON_SMALL = { width: 128, height: 102 } as const;

export function isFuelIconId(value: string): value is FuelIconId {
  return Object.prototype.hasOwnProperty.call(FUEL_ICONS, value);
}

export function fuelIconLabel(id: FuelIconId, locale: string): string {
  return locale.toLowerCase().startsWith('ar') ? FUEL_ICONS[id].ar : FUEL_ICONS[id].en;
}

export function fuelIconSources(id: FuelIconId): { full: string; small: string } {
  return { full: `${FUEL_ICON_BASE_PATH}/png/${id}.png`, small: `${FUEL_ICON_BASE_PATH}/sm/${id}.png` };
}
