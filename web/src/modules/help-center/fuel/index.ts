import { helpLocale, normalizeHelpSearch, type HelpLocale } from '../content';
import { FUEL_SETUP_ARTICLES } from './articles-setup';
import { FUEL_SHIFT_ARTICLES } from './articles-shifts';
import { FUEL_STOCK_ARTICLES } from './articles-stock';
import type { FuelAudience, FuelHelpArticle, FuelHelpArticleSlug, FuelHelpCategory, FuelHelpCategoryKey, FuelSurface } from './types';

export { helpLocale };
export type { FuelAudience, FuelHelpArticle, FuelHelpCategoryKey, FuelSurface, HelpLocale };
export * from './types';
export { FUEL_PERMISSION_LABELS, permissionLabel } from './permission-labels';

/**
 * مركز مساعدة محطات الوقود: مصدر محتوى واحد يخدم تطبيق «محطات أَوْج» ووحدة المحطات في ERP.
 * لا يرتبط بمستأجر: المحتوى ثابت وثنائي اللغة، وما يتغير هو ما يعرضه كل سطح من روابط شاشاته.
 */
export const FUEL_HELP_CATEGORIES: readonly FuelHelpCategory[] = [
  { key: 'appBasics', title: { ar: 'البدء في التطبيق', en: 'App basics' }, description: { ar: 'التنقل والمحطة واللغة وتبديل الموظف.', en: 'Navigation, station, language, and switching employee.' } },
  { key: 'stationSetup', title: { ar: 'إعداد المحطة', en: 'Station setup' }, description: { ar: 'الإعدادات والخزانات والمضخات والفوهات والأسعار.', en: 'Settings, tanks, pumps, nozzles, and prices.' } },
  { key: 'staffAccess', title: { ar: 'الموظفون والدخول', en: 'Staff and sign-in' }, description: { ar: 'الصلاحيات ورمز PIN.', en: 'Permissions and PIN codes.' } },
  { key: 'shifts', title: { ar: 'الورديات', en: 'Shifts' }, description: { ar: 'الفتح والقراءات والتسليم والاعتماد.', en: 'Opening, readings, handover, and approval.' } },
  { key: 'salesCollection', title: { ar: 'المبيعات والتحصيل', en: 'Sales and collection' }, description: { ar: 'اللترات والمبيعات والتحصيل ومطابقة الفروق.', en: 'Litres, sales, collection, and variance reconciliation.' } },
  { key: 'receivingStock', title: { ar: 'الاستلام والمخزون', en: 'Receiving and stock' }, description: { ar: 'استلام الوقود والخزانات والرصيد الافتتاحي.', en: 'Fuel receiving, tanks, and opening balance.' } },
  { key: 'monitoring', title: { ar: 'الرقابة وحل المشكلات', en: 'Oversight and troubleshooting' }, description: { ar: 'التقارير والتنبيهات والأخطاء الشائعة.', en: 'Reports, alerts, and common errors.' } },
];

const ALL_ARTICLES: readonly FuelHelpArticle[] = [...FUEL_SETUP_ARTICLES, ...FUEL_SHIFT_ARTICLES, ...FUEL_STOCK_ARTICLES];

/** ترتيب العرض: يبدأ بالتطبيق ثم الإعداد ثم الدورة التشغيلية ثم الرقابة. */
const ORDER: readonly FuelHelpArticleSlug[] = [
  'fuel-app-quickstart', 'fuel-pin-login', 'fuel-staff-access',
  'fuel-station-settings', 'fuel-tanks-pumps-nozzles', 'fuel-products-prices',
  'fuel-shift-lifecycle', 'fuel-open-shift', 'fuel-meter-readings', 'fuel-handover-shift', 'fuel-review-approve-shift',
  'fuel-sales-liters', 'fuel-collection-reconciliation', 'fuel-sales-invoicing',
  'fuel-receiving', 'fuel-receiving-costs', 'fuel-tank-readings', 'fuel-opening-balance',
  'fuel-reports-monitoring', 'fuel-troubleshooting',
];

export const FUEL_HELP_ARTICLES: readonly FuelHelpArticle[] = ORDER.map((slug) => ALL_ARTICLES.find((article) => article.slug === slug)!);

export function getFuelHelpArticle(slug: string): FuelHelpArticle | undefined {
  return FUEL_HELP_ARTICLES.find((article) => article.slug === slug);
}

export function getFuelHelpCategory(key: FuelHelpCategoryKey): FuelHelpCategory {
  return FUEL_HELP_CATEGORIES.find((category) => category.key === key)!;
}

/** تسمية الفئة المستهدفة. */
export const FUEL_AUDIENCE_LABELS: Record<FuelAudience, Record<HelpLocale, string>> = {
  operator: { ar: 'البائع', en: 'Attendant' },
  supervisor: { ar: 'المشرف', en: 'Supervisor' },
  manager: { ar: 'المسؤول', en: 'Manager' },
};

export const FUEL_SURFACE_LABELS: Record<FuelSurface, Record<HelpLocale, string>> = {
  app: { ar: 'في تطبيق المحطات', en: 'In the Stations app' },
  erp: { ar: 'في وحدة المحطات (ERP)', en: 'In the Stations module (ERP)' },
  both: { ar: 'في التطبيق والوحدة', en: 'In the app and the module' },
};

export interface FuelHelpFilter {
  query?: string;
  category?: FuelHelpCategoryKey;
  audience?: FuelAudience;
}

function articleFields(article: FuelHelpArticle, locale: HelpLocale) {
  const procedures = article.procedures.flatMap((p) => [p.title[locale], ...p.steps.map((s) => s[locale])]);
  const fields = (article.fields ?? []).flatMap((f) => [f.name[locale], f.description[locale]]);
  const problems = (article.problems ?? []).flatMap((p) => [p.problem[locale], p.fix[locale]]);
  const notes = [...(article.notes ?? []), ...(article.unavailable ?? [])].map((n) => n[locale]);
  return {
    title: normalizeHelpSearch(article.title[locale]),
    keywords: normalizeHelpSearch(article.keywords[locale]),
    summary: normalizeHelpSearch(article.summary[locale]),
    structure: normalizeHelpSearch([...(article.procedures.map((p) => p.title[locale])), ...(article.fields ?? []).map((f) => f.name[locale])].join(' ')),
    body: normalizeHelpSearch([article.overview[locale], ...procedures, ...fields, ...problems, ...notes, ...article.permissions].join(' ')),
  };
}

/** بحث حتمي بلا fuzzy: كل كلمة من الاستعلام يجب أن تظهر في حقل ما، والترتيب بوزن الحقل ثم ترتيب المحتوى. */
export function searchFuelHelp(filter: FuelHelpFilter, locale: HelpLocale): FuelHelpArticle[] {
  const pool = FUEL_HELP_ARTICLES.filter((article) => (!filter.category || article.category === filter.category) && (!filter.audience || article.audiences.includes(filter.audience)));
  const normalized = normalizeHelpSearch(filter.query ?? '');
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 0) return [...pool];

  return pool
    .map((article, index) => {
      const f = articleFields(article, locale);
      const all = [f.title, f.keywords, f.summary, f.structure, f.body];
      if (!tokens.every((token) => all.some((field) => field.includes(token)))) return undefined;
      let score = 0;
      if (f.title.includes(normalized)) score += 700;
      if (f.keywords.includes(normalized)) score += 450;
      if (f.summary.includes(normalized)) score += 250;
      if (f.structure.includes(normalized)) score += 180;
      if (f.body.includes(normalized)) score += 100;
      for (const token of tokens) {
        if (f.title.includes(token)) score += 60;
        if (f.keywords.includes(token)) score += 40;
        if (f.summary.includes(token)) score += 20;
        if (f.structure.includes(token)) score += 12;
        if (f.body.includes(token)) score += 5;
      }
      return { article, index, score };
    })
    .filter((match): match is { article: FuelHelpArticle; index: number; score: number } => match !== undefined)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((match) => match.article);
}
