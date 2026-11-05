import type { FuelIconId } from './registry';

/**
 * اشتقاق أيقونة من بيانات أَوْج الفعلية (عرض فقط). لا كتالوج ثابت: التعرّف يعتمد على رمز/اسم المنتج الحقيقيين
 * فقط ولا يخمّن؛ أي منتج غير مطابق تماماً لدرجة 91/95/ديزل يرجع إلى أيقونة عامة محايدة (ولا يُنشأ منتج ولا يُفترض وجوده).
 * الأرقام الهندية/الفارسية تُطبَّع إلى 0–9 قبل المطابقة.
 */

export type FuelAssetRole = 'product' | 'pump' | 'nozzle' | 'tank';
export type FuelGrade = '91' | '95' | 'diesel';

const ARABIC_INDIC = /[٠-٩]/g;
const PERSIAN = /[۰-۹]/g;

function normalize(value: string): string {
  return value
    .replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(PERSIAN, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toLowerCase();
}

/** رتبة الوقود إن كانت واحدة بلا لبس؛ وإلا `null` (متعددة الرتب أو غير معروفة). */
export function detectFuelGrade(...parts: Array<string | null | undefined>): FuelGrade | null {
  const text = normalize(parts.filter(Boolean).join(' '));
  if (!text) return null;
  const found = new Set<FuelGrade>();
  if (/(^|[^0-9])91([^0-9]|$)/.test(text)) found.add('91');
  if (/(^|[^0-9])95([^0-9]|$)/.test(text)) found.add('95');
  if (/diesel|ديزل|سولار/.test(text)) found.add('diesel');
  return found.size === 1 ? [...found][0] : null;
}

const BY_ROLE: Record<FuelAssetRole, Record<FuelGrade, FuelIconId> & { fallback: FuelIconId }> = {
  product: { '91': 'gasoline-91', '95': 'gasoline-95', diesel: 'diesel', fallback: 'fuel-product' },
  pump: { '91': 'pump-91', '95': 'pump-95', diesel: 'pump-diesel', fallback: 'fuel-pump' },
  nozzle: { '91': 'nozzle-91', '95': 'nozzle-95', diesel: 'nozzle-diesel', fallback: 'fuel-product' },
  tank: { '91': 'tank-91', '95': 'tank-95', diesel: 'tank-diesel', fallback: 'storage-tanks' },
};

export function resolveFuelIcon(role: FuelAssetRole, product?: { code?: string | null; name?: string | null } | null): FuelIconId {
  const grade = product ? detectFuelGrade(product.code, product.name) : null;
  const map = BY_ROLE[role];
  return grade ? map[grade] : map.fallback;
}

/** A pump gets a grade-specific pictogram only when every connected nozzle resolves to the same known grade. */
export function resolvePumpIcon(products: ReadonlyArray<{ code?: string | null; name?: string | null } | null>): FuelIconId {
  if (products.length === 0) return 'fuel-pump';
  const grades = products.map((product) => product ? detectFuelGrade(product.code, product.name) : null);
  if (grades.some((grade) => !grade) || new Set(grades).size !== 1) return 'fuel-pump';
  return BY_ROLE.pump[grades[0] as FuelGrade];
}
