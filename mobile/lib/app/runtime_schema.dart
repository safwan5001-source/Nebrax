import 'package:flutter/foundation.dart';

import '../schema/schema.dart';

/// This runtime's own bundled App Schema documents (horizon MR-04 —
/// "Home from App Schema" in the vertical slice, §5). Home and Cart each
/// declare a single page with a static structural shell plus one or more
/// empty "data slot" nodes (a fixed, well-known `id`, no declared children,
/// no schema templating mechanism — MR-04 forbids "remote expressions with
/// general code semantics", so there is no templating to add) that the
/// corresponding screen fills with live Commerce data via
/// `experience_hydration.dart`'s `hydrateNode`.
///
/// Product is deliberately **not** a bundled schema page — see
/// `product_screen.dart`'s own doc comment for why a single-instance,
/// per-product screen is built directly through the Component Registry
/// instead.
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
        {"type": "ProductList", "id": "slot.home.products", "children": []}
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
        {"type": "CartList", "id": "slot.cart.items", "children": []},
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
