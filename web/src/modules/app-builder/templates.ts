import { type AppSchema } from '@/lib/app-builder';

/**
 * APP-BUILDER-9 — مجموعة قوالب مُنسَّقة صغيرة (architecture doc §7: "V1 can begin
 * with a small curated template set"). كل قالب مخطط `AppSchema` صالح كامل، من
 * مكوّنات/إجراءات مبنية فعلاً فقط (`ComponentRegistry`/`ActionRegistry`) — بلا
 * محرّك تشغيل منفصل لكل قالب، وبلا ربط بيانات حقيقي (`DataResourceRegistry`
 * فارغ عمداً حتى اليوم): أرقام/نصوص القالب عناصر نائبة صريحة يحرّرها التاجر بعد
 * التطبيق، لا بيانات مستوردة. يُطبَّق عبر نفس `PUT /app-builder/apps/{id}/draft`
 * الموجود أصلاً — لا مسار/حقل خلفي جديد.
 */

export interface AppBuilderTemplate {
  id: string;
  nameKey: string;
  descriptionKey: string;
  schema: AppSchema;
}

export const APP_BUILDER_TEMPLATES: AppBuilderTemplate[] = [
  {
    id: 'blank',
    nameKey: 'blankName',
    descriptionKey: 'blankDescription',
    schema: {
      schemaVersion: '1.0.0',
      minRuntimeVersion: '1.0.0',
      navigation: { initialPageId: 'home' },
      theme: { tokens: {} },
      pages: {
        home: {
          type: 'Page',
          id: 'home-root',
          children: [
            {
              type: 'Section',
              id: 'sec-welcome',
              props: { title: 'Welcome' },
              children: [{ type: 'Text', id: 'txt-welcome', props: { text: 'Start building your app.', style: 'body' } }],
            },
          ],
        },
      },
    },
  },
  {
    id: 'catalog',
    nameKey: 'catalogName',
    descriptionKey: 'catalogDescription',
    schema: {
      schemaVersion: '1.0.0',
      minRuntimeVersion: '1.0.0',
      navigation: { initialPageId: 'home' },
      theme: { tokens: {} },
      pages: {
        home: {
          type: 'Page',
          id: 'home-root',
          children: [
            {
              type: 'Section',
              id: 'sec-featured',
              props: { title: 'Featured products' },
              children: [
                {
                  type: 'ProductList',
                  id: 'list-featured',
                  children: [
                    { type: 'ProductCard', id: 'pc-1', props: { title: 'Product 1', amountMinor: 9900 } },
                    { type: 'ProductCard', id: 'pc-2', props: { title: 'Product 2', amountMinor: 14900 } },
                  ],
                },
              ],
            },
            {
              type: 'Button',
              id: 'btn-cart',
              props: { label: 'View cart', style: 'secondary' },
              action: { type: 'navigate', params: { pageId: 'cart' } },
            },
          ],
        },
        cart: {
          type: 'Page',
          id: 'cart-root',
          children: [
            {
              type: 'CartList',
              id: 'cart-list',
              children: [{ type: 'CartSummary', id: 'cart-summary' }],
            },
          ],
        },
      },
    },
  },
];
