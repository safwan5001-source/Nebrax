import type { HelpLocale } from '../content';

export type LocalizedText = Record<HelpLocale, string>;

/** الفئة المستهدفة بالدليل. تُشتق افتراضات العرض من الصلاحيات الفعلية، لا من اسم دور. */
export type FuelAudience = 'operator' | 'supervisor' | 'manager';

/** أين تُنفَّذ المهمة فعلاً: تطبيق «محطات أَوْج»، أو وحدة محطات الوقود في ERP، أو كلاهما. */
export type FuelSurface = 'app' | 'erp' | 'both';

export type FuelHelpCategoryKey =
  | 'appBasics'
  | 'stationSetup'
  | 'staffAccess'
  | 'shifts'
  | 'salesCollection'
  | 'receivingStock'
  | 'monitoring';

export type FuelHelpArticleSlug =
  | 'fuel-app-quickstart'
  | 'fuel-station-settings'
  | 'fuel-products-prices'
  | 'fuel-tanks-pumps-nozzles'
  | 'fuel-staff-access'
  | 'fuel-pin-login'
  | 'fuel-shift-lifecycle'
  | 'fuel-open-shift'
  | 'fuel-meter-readings'
  | 'fuel-sales-liters'
  | 'fuel-sales-invoicing'
  | 'fuel-handover-shift'
  | 'fuel-collection-reconciliation'
  | 'fuel-review-approve-shift'
  | 'fuel-receiving'
  | 'fuel-receiving-costs'
  | 'fuel-tank-readings'
  | 'fuel-opening-balance'
  | 'fuel-reports-monitoring'
  | 'fuel-troubleshooting';

/** شاشة مرتبطة بالدليل. `appHref` داخل تطبيق المحطات؛ `erpHref` داخل وحدة المحطات في ERP. أيّهما قد يغيب. */
export interface FuelHelpScreen {
  label: LocalizedText;
  appHref?: `/${string}`;
  erpHref?: `/${string}`;
}

export interface FuelHelpProcedure {
  title: LocalizedText;
  /** كل خطوة جملة واحدة قابلة للتنفيذ؛ تُعرض مرقَّمة وفي الوضع التفاعلي خطوةً خطوة. */
  steps: LocalizedText[];
}

export interface FuelHelpField {
  name: LocalizedText;
  description: LocalizedText;
}

export interface FuelHelpProblem {
  problem: LocalizedText;
  fix: LocalizedText;
}

export interface FuelHelpArticle {
  slug: FuelHelpArticleSlug;
  category: FuelHelpCategoryKey;
  title: LocalizedText;
  summary: LocalizedText;
  /** مرادفات البحث (كلمات متباعدة بمسافات). */
  keywords: LocalizedText;
  minutes: number;
  audiences: readonly FuelAudience[];
  surface: FuelSurface;
  /** وصف الوظيفة: ما هذه الشاشة/المهمة ولماذا. */
  overview: LocalizedText;
  /** مفاتيح الصلاحيات الدقيقة المطلوبة (تُترجم من `FUEL_PERMISSION_LABELS`). */
  permissions: readonly string[];
  /** سطر يشرح كيف تجتمع الصلاحيات (كلها معاً أو أيٌّ منها) حين يلزم. */
  permissionsNote?: LocalizedText;
  procedures: readonly FuelHelpProcedure[];
  fields?: readonly FuelHelpField[];
  problems?: readonly FuelHelpProblem[];
  notes?: readonly LocalizedText[];
  /** وظائف غير متاحة اليوم موثَّقة صراحةً بدل اختراع شرح لها. */
  unavailable?: readonly LocalizedText[];
  screens?: readonly FuelHelpScreen[];
  related?: readonly FuelHelpArticleSlug[];
}

export interface FuelHelpCategory {
  key: FuelHelpCategoryKey;
  title: LocalizedText;
  description: LocalizedText;
}
