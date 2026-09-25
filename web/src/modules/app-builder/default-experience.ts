/**
 * LIVE-PREVIEW-6 (`AWJ_APP_BUILDER_LIVE_RUNTIME_PREVIEW_V1.md`) — the **Default AWJ
 * Experience**: the real runtime's own bundled, compile-time Home + Cart schema
 * (`mobile/lib/app/runtime_schema.dart`'s `kHomeSchemaJson`/`kCartSchemaJson`), rendered
 * by `UseDefaultExperience` (`mobile/lib/startup/last_known_good.dart`) whenever a tenant
 * has never published an App Builder experience. Before this task there was **no backend
 * representation of it at all** — LIVE-PREVIEW-1 §7 confirmed a repo-wide search found zero
 * references outside `mobile/lib`. This module is a static, read-only, **client-side-only**
 * mirror — not a new backend route, not a new API surface, not a new schema field. It exists
 * purely so the Builder can show a merchant what a customer sees before that merchant's first
 * publish, matching this task's own charter ("Preview must never imply that a draft is an
 * actual production/mobile release" — including the reverse: a merchant should be able to see
 * what *is* live today, which for an unpublished tenant is exactly this).
 *
 * **Byte-identical by contract, checked by `default-experience.test.ts`**: that test reads
 * `mobile/lib/app/runtime_schema.dart` as plain text (no Flutter/Dart toolchain needed — the
 * schema is a compile-time string literal), extracts the two triple-quoted JSON blocks, and
 * deep-equals them against `DEFAULT_APP_EXPERIENCE.pages.home`/`.pages.cart` below. If the
 * bundled runtime schema ever changes, that test fails until this file is updated to match —
 * the same "shared conformance, not independently-maintained duplicates" discipline
 * `runtime-contract.ts` (LIVE-PREVIEW-2) already established for a different pair of ports.
 *
 * Combining both bundled pages under one `AppSchema`-shaped document (with a single
 * `navigation.initialPageId: 'home'`) is this module's own choice, not the mobile source's —
 * the real runtime treats `kHomeSchemaJson`/`kCartSchemaJson` as two independently-parsed
 * documents (Home is the initial route; Cart is reached only via the `navigate` action), never
 * a single two-page schema. Combining them here only lets the Builder's existing
 * multi-page navigation UI show both without inventing a second rendering path — it changes
 * nothing about what either page itself contains.
 */

import type { AppSchema } from '@/lib/app-builder';

export const DEFAULT_APP_EXPERIENCE: AppSchema = {
  schemaVersion: '1.0.0',
  minRuntimeVersion: '1.0.0',
  navigation: { initialPageId: 'home' },
  theme: { tokens: { colorPrimary: '#0F6A5A' } },
  pages: {
    home: {
      type: 'Page',
      id: 'home-root',
      children: [
        {
          type: 'Section',
          id: 'home-hero',
          props: { title: 'أَوْج' },
          children: [{ type: 'Text', id: 'home-tagline', props: { text: 'تسوّق منتجاتك المفضّلة' } }],
        },
        {
          type: 'NavigationTarget',
          id: 'home-go-cart',
          props: { label: 'عرض السلة' },
          action: { type: 'navigate', params: { pageId: 'cart' } },
        },
        {
          type: 'ProductList',
          id: 'slot.home.products',
          binding: { resource: 'commerce.products' },
          children: [
            {
              type: 'ProductCard',
              id: 'home-product-card-template',
              optional: true,
              props: {
                title: '$item.display_name',
                amountMinor: '$item.price.amount_minor',
                imageUrl: '$item.thumbnail_url',
              },
              action: { type: 'openProduct', params: { productId: '$item.id' } },
            },
          ],
        },
      ],
    },
    cart: {
      type: 'Page',
      id: 'cart-root',
      children: [
        {
          type: 'NavigationTarget',
          id: 'cart-go-home',
          props: { label: 'متابعة التسوق' },
          action: { type: 'navigate', params: { pageId: 'home' } },
        },
        {
          type: 'CartList',
          id: 'slot.cart.items',
          binding: { resource: 'commerce.cart', collect: 'items' },
          children: [
            {
              type: 'Section',
              id: 'cart-line-template',
              optional: true,
              props: { title: '$item.product_name' },
              children: [
                {
                  type: 'Text',
                  id: 'cart-line-template-variant',
                  optional: true,
                  props: { text: '$item.variant_descriptor', style: 'caption' },
                },
                {
                  type: 'Price',
                  id: 'cart-line-template-price',
                  optional: true,
                  props: { amountMinor: '$item.line_total.amount_minor' },
                },
                {
                  type: 'Quantity',
                  id: 'cart-line-template-qty',
                  optional: true,
                  props: { value: '$item.quantity', min: 1, max: 99 },
                  action: { type: 'updateCartQuantity', params: { cartItemId: '$item.id', quantity: '$item.quantity' } },
                },
                {
                  type: 'Button',
                  id: 'cart-line-template-remove',
                  optional: true,
                  props: { label: 'إزالة', style: 'secondary' },
                  action: { type: 'removeCartItem', params: { cartItemId: '$item.id' } },
                },
              ],
            },
          ],
        },
        { type: 'CartSummary', id: 'slot.cart.summary', props: { itemCount: 0, subtotalAmountMinor: 0 } },
      ],
    },
  },
};
