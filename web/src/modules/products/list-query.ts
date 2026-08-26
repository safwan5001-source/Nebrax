import type { DataExplorerState } from '@/lib/data-explorer/types';

/**
 * عقد استعلام قائمة المنتجات — مصدر واحد للقائمة وللتصدير الخادميّ.
 *
 * يقابل `App\Support\ProductListFilters` في الخلفية حرفياً. الفصل بين
 * المرشّحات والتقسيم متعمَّد: التصدير المفلتر يعني **كل** النتائج، وتصديرٌ
 * يحمل رقم صفحة يعود بصفحة واحدة تحت اسم «كل النتائج».
 */

/** أعمدة يقبل الخادم الفرز بها — مطابقة لـ`ProductListFilters::SORTS`. */
export const PRODUCT_SORT_COLUMNS = ['sku', 'name', 'sale_price', 'purchase_price', 'quantity_on_hand'];

/** مرشّحات القائمة وفرزها، بلا `page` ولا `per_page`. */
export function productFilterQuery(state: DataExplorerState): string {
  const params = new URLSearchParams();
  if (state.search.trim()) params.set('search', state.search.trim());
  if (state.sort) params.set('sort', state.sort);

  for (const filter of state.filters) {
    if (Array.isArray(filter.value) || String(filter.value).trim() === '') continue;
    const value = String(filter.value);
    if (['category_id', 'type', 'is_active', 'stock_state'].includes(filter.key)) {
      params.set(filter.key, value);
      continue;
    }
    if (filter.key === 'sale_price' || filter.key === 'purchase_price') {
      const operator = ['gte', 'lte', 'eq'].includes(filter.operator) ? filter.operator : 'gte';
      params.set(`${filter.key}_${operator}`, value);
    }
  }

  return params.toString();
}

/** استعلام القائمة: المرشّحات نفسها مضافاً إليها التقسيم. */
export function productQuery(state: DataExplorerState): string {
  const params = new URLSearchParams(productFilterQuery(state));
  params.set('page', String(state.page ?? 1));
  params.set('per_page', String(state.perPage ?? 25));

  return params.toString();
}
