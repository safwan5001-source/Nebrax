/**
 * عقد تصدير أرصدة المخزون كما يفهمه الخادم — دالّةٌ واحدة تبني سلسلة
 * الاستعلام من حالة الشاشة، فلا تنحرف معاملات التصدير عن مرشّحات القائمة.
 *
 * «النتائج الحالية» تعني كل المطابق للمرشّحات لا الصفحة المرئية، فلا تُرسل
 * `page`/`per_page` أبداً. المرشّحات تُقرأ من نفس حالة `DataExplorer` التي
 * تفلتر بها الشاشة، فما يُصدَّر هو ما يُعرض حرفياً.
 */

export type InventoryExportScope = 'filtered' | 'all';
export type InventoryExportFormat = 'xlsx' | 'csv';

/** مفاتيح مرشّحات الشاشة التي يفهمها الخادم — أيّ مفتاح آخر يُتجاهَل. */
const EXPORT_FILTER_KEYS = [
  'unit',
  'qty_min',
  'qty_max',
  'avg_cost_min',
  'avg_cost_max',
  'stock_value_min',
  'stock_value_max',
] as const;

export interface InventoryExportState {
  search: string;
  sort?: string;
  /** مفتاح المرشّح → قيمته النصّية (من حالة `DataExplorer`). */
  filters: Record<string, string>;
}

export interface InventoryExportOptions {
  scope: InventoryExportScope;
  format: InventoryExportFormat;
  includeZero: boolean;
  locale: string;
}

/**
 * يبني سلسلة استعلام مسار التصدير.
 *
 * في نطاق «الكل» تُسقط كل المرشّحات والبحث والفرز — يصدّر الكتالوج كاملاً.
 * وفي «المفلتر» تُمرَّر مرشّحات الشاشة نفسها. `include_zero` يُرسَل صراحةً
 * دائماً كي لا يلتبس غيابه بالافتراض.
 */
export function inventoryExportQuery(
  state: InventoryExportState,
  options: InventoryExportOptions
): string {
  const params = new URLSearchParams();
  params.set('scope', options.scope);
  params.set('format', options.format);
  params.set('include_zero', options.includeZero ? '1' : '0');
  params.set('locale', options.locale.startsWith('en') ? 'en' : 'ar');

  if (options.scope === 'filtered') {
    if (state.search.trim()) params.set('search', state.search.trim());
    if (state.sort) params.set('sort', state.sort);
    for (const key of EXPORT_FILTER_KEYS) {
      const value = state.filters[key];
      if (value !== undefined && String(value).trim() !== '') {
        params.set(key, String(value).trim());
      }
    }
  }

  return params.toString();
}
