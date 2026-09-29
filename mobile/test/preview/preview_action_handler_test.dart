import 'package:awj_mobile_runtime/actions/actions.dart';
import 'package:awj_mobile_runtime/preview/preview.dart';
import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:flutter_test/flutter_test.dart';

import '../schema/test_schemas.dart';

RenderableExperience _experience({bool withCartPage = true}) {
  final manifest = CapabilityManifest(
    platform: RuntimePlatform.android,
    runtimeVersion: SchemaVersion.parse('1.0.0'),
    minSupportedSchemaVersion: SchemaVersion.parse('1.0.0'),
    maxSupportedSchemaVersion: SchemaVersion.parse('1.0.0'),
    components: RuntimeCapabilities.components,
    actions: RuntimeCapabilities.actions,
    nativeCapabilities: RuntimeCapabilities.nativeCapabilities,
  );
  final pages = <String, Object?>{
    'home': componentNode(type: 'Page', id: 'home-root', children: const []),
    if (withCartPage) 'cart': componentNode(type: 'Page', id: 'cart-root', children: const []),
  };
  final json = encodeSchema({
    'schemaVersion': '1.0.0',
    'minRuntimeVersion': '1.0.0',
    'theme': {'tokens': <String, Object?>{}},
    'navigation': {'initialPageId': 'home'},
    'pages': pages,
  });
  final schema = AppSchema.parse(json);
  final result = const CompatibilityResolver().resolve(schema, manifest);
  return result as RenderableExperience;
}

void main() {
  group('PreviewActionHandler.onNavigate — the real shipped runtime allowlist, not a richer one', () {
    test('navigate to a declared, allowlisted page switches the page', () async {
      String? changedTo;
      final handler = PreviewActionHandler(
        experience: _experience(),
        onPageChange: (id) => changedTo = id,
        onNotice: (_) => fail('should not notice'),
        onRefreshRequested: () async {},
      );

      await handler.onNavigate(const NavigateAction('cart'));

      expect(changedTo, 'cart');
    });

    test('navigate to a pageId outside home/cart is unsupported even if it were declared', () async {
      PreviewActionNotice? notice;
      final handler = PreviewActionHandler(
        experience: _experience(),
        onPageChange: (_) => fail('should not change page'),
        onNotice: (n) => notice = n,
        onRefreshRequested: () async {},
      );

      await handler.onNavigate(const NavigateAction('checkout'));

      expect(notice, PreviewActionNotice.navigateUnsupported);
    });

    test('navigate to cart is unsupported when this snapshot never declared a cart page', () async {
      PreviewActionNotice? notice;
      final handler = PreviewActionHandler(
        experience: _experience(withCartPage: false),
        onPageChange: (_) => fail('should not change page'),
        onNotice: (n) => notice = n,
        onRefreshRequested: () async {},
      );

      await handler.onNavigate(const NavigateAction('cart'));

      expect(notice, PreviewActionNotice.navigateUnsupported);
    });
  });

  group('PreviewActionHandler — live-data actions are honestly unavailable, never faked', () {
    late List<PreviewActionNotice> notices;
    late PreviewActionHandler handler;

    setUp(() {
      notices = [];
      handler = PreviewActionHandler(
        experience: _experience(),
        onPageChange: (_) => fail('should not change page'),
        onNotice: notices.add,
        onRefreshRequested: () async {},
      );
    });

    test('openProduct requires live data', () async {
      await handler.onOpenProduct(const OpenProductAction('p1'));
      expect(notices, [PreviewActionNotice.requiresLiveData]);
    });

    test('addToCart requires live data', () async {
      await handler.onAddToCart(const AddToCartAction(productId: 'p1', quantity: 1));
      expect(notices, [PreviewActionNotice.requiresLiveData]);
    });

    test('updateCartQuantity requires live data', () async {
      await handler.onUpdateCartQuantity(const UpdateCartQuantityAction(cartItemId: 'c1', quantity: 2));
      expect(notices, [PreviewActionNotice.requiresLiveData]);
    });

    test('removeCartItem requires live data', () async {
      await handler.onRemoveCartItem(const RemoveCartItemAction('c1'));
      expect(notices, [PreviewActionNotice.requiresLiveData]);
    });
  });

  test('refresh re-triggers the fetch, never a fake success', () async {
    var refreshed = false;
    final handler = PreviewActionHandler(
      experience: _experience(),
      onPageChange: (_) => fail('should not change page'),
      onNotice: (_) => fail('should not notice'),
      onRefreshRequested: () async {
        refreshed = true;
      },
    );

    await handler.onRefresh(const RefreshAction());

    expect(refreshed, isTrue);
  });
}
