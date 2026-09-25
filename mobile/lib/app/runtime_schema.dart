import 'package:flutter/foundation.dart';

import '../schema/schema.dart';

/// This runtime's own bundled App Schema documents (horizon MR-04 —
/// "Home from App Schema" in the vertical slice, §5; binding wiring —
/// `APP-BUILDER-17` slice 3b). Home and Cart each declare a single page with
/// a static structural shell plus one real `binding`-driven list:
/// `ProductList` binds directly to `commerce.products` (collection is the
/// resource result itself — no `collect` needed, since the list endpoint's
/// own `data` is already the array), and `CartList` binds to `commerce.cart`
/// with `binding.collect: "items"` (a nested list field on a single fetched
/// object). Each declares exactly one authored child — its item template,
/// resolved and repeated by `app/binding_resolution.dart`'s
/// `resolveNodeBindings`, never by this file. Everything else (tagline,
/// go-cart/go-home labels, the Cart summary) stays the pre-existing static-
/// shell + `experience_hydration.dart`'s `hydrateNode` pattern — neither is
/// expressible as a per-item `$item.*` reference (locale-picked text,
/// aggregate counts), so neither is forced into the binding mechanism.
///
/// Product is deliberately **not** a bundled schema page — see
/// `product_screen.dart`'s own doc comment for why a single-instance,
/// per-product screen is built directly through the Component Registry
/// instead; this stays true after slice 3b, which explicitly keeps
/// `ProductScreen`/route context out of scope.
const String kHomeSchemaJson = '''
{
  "schemaVersion": "1.0.0",
  "minRuntimeVersion": "1.0.0",
  "navigation": {"initialPageId": "home"},
  "theme": {"tokens": {"colorPrimary": "#0F6A5A"}},
  "pages": {
    "home": {
      "type": "Page",
      "id": "home-root",
      "children": [
        {
          "type": "Section",
          "id": "home-hero",
          "props": {"title": "أَوْج"},
          "children": [
            {"type": "Text", "id": "home-tagline", "props": {"text": "تسوّق منتجاتك المفضّلة"}}
          ]
        },
        {
          "type": "NavigationTarget",
          "id": "home-go-cart",
          "props": {"label": "عرض السلة"},
          "action": {"type": "navigate", "params": {"pageId": "cart"}}
        },
        {
          "type": "ProductList",
          "id": "slot.home.products",
          "binding": {"resource": "commerce.products"},
          "children": [
            {
              "type": "ProductCard",
              "id": "home-product-card-template",
              "optional": true,
              "props": {
                "title": "\$item.display_name",
                "amountMinor": "\$item.price.amount_minor",
                "imageUrl": "\$item.thumbnail_url"
              },
              "action": {"type": "openProduct", "params": {"productId": "\$item.id"}}
            }
          ]
        }
      ]
    }
  }
}
''';

const String kCartSchemaJson = '''
{
  "schemaVersion": "1.0.0",
  "minRuntimeVersion": "1.0.0",
  "navigation": {"initialPageId": "cart"},
  "pages": {
    "cart": {
      "type": "Page",
      "id": "cart-root",
      "children": [
        {
          "type": "NavigationTarget",
          "id": "cart-go-home",
          "props": {"label": "متابعة التسوق"},
          "action": {"type": "navigate", "params": {"pageId": "home"}}
        },
        {
          "type": "CartList",
          "id": "slot.cart.items",
          "binding": {"resource": "commerce.cart", "collect": "items"},
          "children": [
            {
              "type": "Section",
              "id": "cart-line-template",
              "optional": true,
              "props": {"title": "\$item.product_name"},
              "children": [
                {
                  "type": "Text",
                  "id": "cart-line-template-variant",
                  "optional": true,
                  "props": {"text": "\$item.variant_descriptor", "style": "caption"}
                },
                {
                  "type": "Price",
                  "id": "cart-line-template-price",
                  "optional": true,
                  "props": {"amountMinor": "\$item.line_total.amount_minor"}
                },
                {
                  "type": "Quantity",
                  "id": "cart-line-template-qty",
                  "optional": true,
                  "props": {"value": "\$item.quantity", "min": 1, "max": 99},
                  "action": {
                    "type": "updateCartQuantity",
                    "params": {"cartItemId": "\$item.id", "quantity": "\$item.quantity"}
                  }
                },
                {
                  "type": "Button",
                  "id": "cart-line-template-remove",
                  "optional": true,
                  "props": {"label": "إزالة", "style": "secondary"},
                  "action": {"type": "removeCartItem", "params": {"cartItemId": "\$item.id"}}
                }
              ]
            }
          ]
        },
        {"type": "CartSummary", "id": "slot.cart.summary", "props": {"itemCount": 0, "subtotalAmountMinor": 0}}
      ]
    }
  }
}
''';

/// Parses [json] and resolves it against [manifest] in one step. Thrown
/// [SchemaFormatException]s are **not** caught here — a bundled schema
/// failing to parse is this runtime's own bug, not a runtime/network
/// failure a screen should show a "try again" state for; it should surface
/// during development/testing, not be silently swallowed in production.
CompatibilityResult resolveRuntimeSchema(
  String json,
  CapabilityManifest manifest, {
  CompatibilityResolver resolver = const CompatibilityResolver(),
}) {
  final schema = AppSchema.parse(json);
  return resolver.resolve(schema, manifest);
}

/// This build's own [RuntimePlatform] — Android/iOS only (MR-02); any other
/// [TargetPlatform] (a test host, a desktop/web build outside this
/// workspace's scope) reports as [RuntimePlatform.android], the more
/// conservative of the two capability manifests today (both list identical
/// capabilities — MOBILE-RUNTIME-2's `RuntimeCapabilities` has no iOS/
/// Android divergence yet).
///
/// `dart:io.Platform` is avoided so this stays usable from `flutter test`
/// (which runs on whatever host the test process happens to be on, not a
/// real device) — [defaultTargetPlatform] is Flutter's own
/// framework-provided platform signal.
RuntimePlatform currentRuntimePlatform() {
  return defaultTargetPlatform == TargetPlatform.iOS
      ? RuntimePlatform.ios
      : RuntimePlatform.android;
}
