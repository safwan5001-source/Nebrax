import '../schema/schema.dart';

/// A typed, validated instance of one of the horizon's MR-05 allowlisted
/// actions. This is the *only* shape an action can take at dispatch time —
/// there is no "generic"/catch-all variant, so a switch over this sealed
/// class is exhaustive and the Dart analyzer enforces that every action
/// type is handled.
sealed class AppAction {
  const AppAction();
}

class NavigateAction extends AppAction {
  final String pageId;
  const NavigateAction(this.pageId);
}

class OpenProductAction extends AppAction {
  final String productId;
  const OpenProductAction(this.productId);
}

class AddToCartAction extends AppAction {
  final String productId;
  final String? variantId;
  final int quantity;
  const AddToCartAction({required this.productId, this.variantId, this.quantity = 1});
}

class UpdateCartQuantityAction extends AppAction {
  final String cartItemId;
  final int quantity;
  const UpdateCartQuantityAction({required this.cartItemId, required this.quantity});
}

class RemoveCartItemAction extends AppAction {
  final String cartItemId;
  const RemoveCartItemAction(this.cartItemId);
}

class RefreshAction extends AppAction {
  const RefreshAction();
}

/// Decodes a schema [ActionRef] into a typed [AppAction], or `null` when the
/// action cannot be safely dispatched.
///
/// This is deliberately defense-in-depth: [CompatibilityResolver] (MOBILE-
/// RUNTIME-2) already excludes a schema node whose *action type* is
/// unsupported before this code ever runs, but it has no opinion on whether
/// that action's `params` are well-formed for the type — a schema could
/// declare `{"type": "addToCart", "params": {}}` with no `productId`, which
/// is a resolvable, "supported" action reference that is nonetheless
/// nonsensical to dispatch. Returning `null` here — never throwing — means a
/// malformed-but-technically-supported action safely does nothing instead of
/// crashing a widget's `onTap`.
///
/// This function is also the single place that decides which action `type`
/// strings exist at all; `component_registry_test.dart` asserts its
/// recognized set matches `RuntimeCapabilities.actions` exactly, so the two
/// allowlists (compatibility-check identifiers vs. actually-dispatchable
/// actions) cannot silently drift apart.
AppAction? decodeAction(ActionRef ref) {
  switch (ref.type) {
    case 'navigate':
      final pageId = ref.params['pageId'];
      if (pageId is! String || pageId.isEmpty) return null;
      return NavigateAction(pageId);

    case 'openProduct':
      final productId = ref.params['productId'];
      if (productId is! String || productId.isEmpty) return null;
      return OpenProductAction(productId);

    case 'addToCart':
      final productId = ref.params['productId'];
      if (productId is! String || productId.isEmpty) return null;
      final variantIdRaw = ref.params['variantId'];
      if (variantIdRaw != null && variantIdRaw is! String) return null;
      final quantityRaw = ref.params['quantity'];
      final int quantity;
      if (quantityRaw == null) {
        quantity = 1;
      } else if (quantityRaw is int && quantityRaw > 0) {
        quantity = quantityRaw;
      } else {
        return null;
      }
      return AddToCartAction(
        productId: productId,
        variantId: variantIdRaw as String?,
        quantity: quantity,
      );

    case 'updateCartQuantity':
      final cartItemId = ref.params['cartItemId'];
      final quantityRaw = ref.params['quantity'];
      if (cartItemId is! String || cartItemId.isEmpty) return null;
      if (quantityRaw is! int || quantityRaw < 0) return null;
      return UpdateCartQuantityAction(cartItemId: cartItemId, quantity: quantityRaw);

    case 'removeCartItem':
      final cartItemId = ref.params['cartItemId'];
      if (cartItemId is! String || cartItemId.isEmpty) return null;
      return RemoveCartItemAction(cartItemId);

    case 'refresh':
      return const RefreshAction();

    default:
      return null;
  }
}
