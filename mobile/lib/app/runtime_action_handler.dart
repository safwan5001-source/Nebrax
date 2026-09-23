import '../actions/actions.dart';
import '../commerce/commerce.dart';
import 'runtime_state.dart';

/// The real [ActionHandler] (replacing MOBILE-RUNTIME-3's temporary
/// `NoopActionHandler`): every allowlisted action now has an actual effect,
/// through [CommerceClient] and [RuntimeState] only — never a direct
/// network/state mutation from a widget.
///
/// Sensitive actions (`addToCart`/`updateCartQuantity`/`removeCartItem`)
/// call [CommerceClient] and report failure through [onError] rather than
/// throwing into the widget tree or silently swallowing it — a tap that
/// fails must be visibly different from one that succeeded (same principle
/// `_ActionTappable`'s inert-vs-active rendering already applies).
/// [RuntimeState.markCartChanged] fires only after a call the server
/// actually accepted, never optimistically before the response.
class RuntimeActionHandler implements ActionHandler {
  final CommerceClient client;
  final RuntimeState state;
  final void Function(String message) onError;

  RuntimeActionHandler({
    required this.client,
    required this.state,
    required this.onError,
  });

  @override
  Future<void> onNavigate(NavigateAction action) async {
    switch (action.pageId) {
      case 'home':
        state.goHome();
      case 'cart':
        state.goToCart();
      default:
        // An unrecognized pageId is a schema-authoring mistake, not a
        // runtime crash — fail safe by doing nothing (same posture as
        // `ExperienceView`'s unknown-pageId screen).
        break;
    }
  }

  @override
  Future<void> onOpenProduct(OpenProductAction action) async {
    state.goToProduct(action.productId);
  }

  @override
  Future<void> onAddToCart(AddToCartAction action) async {
    try {
      await client.addCartItem(
        productId: action.productId,
        productVariantId: action.variantId,
        quantity: action.quantity,
      );
      state.markCartChanged();
    } on CommerceApiException catch (e) {
      onError(e.message);
    } on CommerceProtocolException catch (e) {
      onError(e.message);
    }
  }

  @override
  Future<void> onUpdateCartQuantity(UpdateCartQuantityAction action) async {
    try {
      await client.updateCartItem(
        itemId: action.cartItemId,
        quantity: action.quantity,
      );
      state.markCartChanged();
    } on CommerceApiException catch (e) {
      onError(e.message);
    } on CommerceProtocolException catch (e) {
      onError(e.message);
    }
  }

  @override
  Future<void> onRemoveCartItem(RemoveCartItemAction action) async {
    try {
      await client.removeCartItem(itemId: action.cartItemId);
      state.markCartChanged();
    } on CommerceApiException catch (e) {
      onError(e.message);
    } on CommerceProtocolException catch (e) {
      onError(e.message);
    }
  }

  @override
  Future<void> onRefresh(RefreshAction action) async {
    state.markRefreshRequested();
  }
}
