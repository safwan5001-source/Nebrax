import { generateComponentId, type AppSchemaComponent } from '@/lib/app-builder';

/**
 * كتالوج أقسام الوضع السهل V2 — مصدر الأقسام التي يمكن إضافتها بنقرة، ومصفوفة الدعم الصادقة (مواصفة V2 §5).
 *
 * كل قسم **جاهز/جاهز بقيود** يُنتج شجرة AppSchema من مكوّنات السجل الحالي فقط (لا محرك موازٍ ولا مفتاح مخطط جديد):
 * `Section → …`. الأقسام **المقترحة** تُعرض معطّلة مع سبب صريح (لا مكوّن/شاشة/API لها في Runtime) ولا تُضاف أبداً —
 * الصدق قبل الاكتمال. `Section` هو حاوية القسم الذي يراه التاجر كوحدة واحدة.
 */

export type EasySectionStatus = 'ready' | 'limited' | 'proposed';
export type EasyCategory = 'content' | 'products' | 'navigation' | 'cart';

export interface EasyCatalogEntry {
  key: string;
  category: EasyCategory;
  status: EasySectionStatus;
  /** مفتاح ترجمة السبب للمقيَّد/المقترح. */
  reasonKey?: string;
  /** صفحات Runtime التي يوفّر لها بيانات هذا القسم (`home`/`cart`)؛ غائب = أي صفحة. المورد لا يُحلّ خارجها فيظهر فارغاً. */
  pages?: string[];
  /** يبني شجرة القسم بمعرّفات جديدة؛ غائب للمقترح. */
  build?: () => AppSchemaComponent;
}

const section = (children: AppSchemaComponent[], title?: string): AppSchemaComponent => ({
  type: 'Section',
  id: generateComponentId('Section'),
  ...(title !== undefined ? { props: { title } } : {}),
  children,
});

export const EASY_CATALOG: EasyCatalogEntry[] = [
  {
    key: 'text', category: 'content', status: 'ready',
    build: () => section([{ type: 'Text', id: generateComponentId('Text'), props: { text: '', style: 'body' } }]),
  },
  {
    key: 'button', category: 'navigation', status: 'ready',
    build: () => section([{ type: 'Button', id: generateComponentId('Button'), props: { label: 'زر', style: 'primary' } }]),
  },
  {
    key: 'productList', category: 'products', status: 'ready', pages: ['home'],
    // مطابق لبنية `default-experience.ts` (ProductList + قالب ProductCard اختياري بمراجع $item.* وإجراء openProduct).
    build: () => section([{
      type: 'ProductList',
      id: generateComponentId('ProductList'),
      binding: { resource: 'commerce.products' },
      children: [{
        type: 'ProductCard',
        id: generateComponentId('ProductCard'),
        optional: true,
        props: { title: '$item.display_name', amountMinor: '$item.price.amount_minor', imageUrl: '$item.thumbnail_url' },
        action: { type: 'openProduct', params: { productId: '$item.id' } },
      }],
    }]),
  },
  {
    key: 'cartList', category: 'cart', status: 'ready', pages: ['cart'],
    build: () => section([{
      type: 'CartList',
      id: generateComponentId('CartList'),
      binding: { resource: 'commerce.cart', collect: 'items' },
      children: [{
        type: 'Section',
        id: generateComponentId('Section'),
        optional: true,
        props: { title: '$item.product_name' },
        children: [
          { type: 'Text', id: generateComponentId('Text'), optional: true, props: { text: '$item.variant_descriptor', style: 'caption' } },
          { type: 'Price', id: generateComponentId('Price'), optional: true, props: { amountMinor: '$item.line_total.amount_minor' } },
          {
            type: 'Quantity', id: generateComponentId('Quantity'), optional: true,
            props: { value: '$item.quantity', min: 1, max: 99 },
            action: { type: 'updateCartQuantity', params: { cartItemId: '$item.id', quantity: '$item.quantity' } },
          },
          {
            type: 'Button', id: generateComponentId('Button'), optional: true,
            props: { label: 'إزالة', style: 'secondary' },
            action: { type: 'removeCartItem', params: { cartItemId: '$item.id' } },
          },
        ],
      }],
    }]),
  },
  {
    key: 'cartSummary', category: 'cart', status: 'ready', pages: ['cart'],
    build: () => section([{ type: 'CartSummary', id: generateComponentId('CartSummary'), props: { itemCount: 0, subtotalAmountMinor: 0 } }]),
  },
  {
    key: 'image', category: 'content', status: 'limited', reasonKey: 'easy.reasons.image',
    build: () => section([{ type: 'Image', id: generateComponentId('Image'), props: { url: '' } }]),
  },
  {
    key: 'banner', category: 'content', status: 'limited', reasonKey: 'easy.reasons.banner',
    build: () => section([
      { type: 'Image', id: generateComponentId('Image'), props: { url: '' } },
      { type: 'Text', id: generateComponentId('Text'), props: { text: '', style: 'title' } },
      { type: 'Button', id: generateComponentId('Button'), props: { label: 'تسوّق الآن', style: 'primary' } },
    ]),
  },
  { key: 'slider', category: 'content', status: 'proposed', reasonKey: 'easy.reasons.noComponent' },
  { key: 'productGrid', category: 'products', status: 'proposed', reasonKey: 'easy.reasons.noComponent' },
  { key: 'categories', category: 'products', status: 'proposed', reasonKey: 'easy.reasons.noScreen' },
  { key: 'video', category: 'content', status: 'proposed', reasonKey: 'easy.reasons.noComponent' },
  { key: 'testimonials', category: 'content', status: 'proposed', reasonKey: 'easy.reasons.noComponent' },
  { key: 'myOrders', category: 'cart', status: 'proposed', reasonKey: 'easy.reasons.noScreen' },
  { key: 'account', category: 'cart', status: 'proposed', reasonKey: 'easy.reasons.noScreen' },
];

/** كل قسم قابل للإضافة بنقرة (جاهز/جاهز بقيود). */
export function isAddable(entry: EasyCatalogEntry): boolean {
  return entry.status !== 'proposed' && typeof entry.build === 'function';
}

/** هل يصلح القسم للصفحة `pageId`؟ (أقسام الموارد مرتبطة بشاشة Runtime التي تحلّ مواردها.) */
export function isAddableOnPage(entry: EasyCatalogEntry, pageId: string | null): boolean {
  return isAddable(entry) && (!entry.pages || (pageId !== null && entry.pages.includes(pageId)));
}

/** وصف مختصر مشتق للقسم في القائمة (عرض فقط — لا يُكتب في المخطط). */
export function sectionSummary(node: AppSchemaComponent): { primaryType: string; title: string | null } {
  const inner = node.type === 'Section' && node.children && node.children.length > 0 ? node.children[0] : node;
  const sectionTitle = typeof node.props?.title === 'string' && node.props.title ? node.props.title : null;
  const text = ['text', 'label', 'title'].map((k) => inner.props?.[k]).find((v): v is string => typeof v === 'string' && v.length > 0) ?? null;
  return { primaryType: inner.type, title: sectionTitle ?? text };
}
