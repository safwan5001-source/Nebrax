import '../schema/schema.dart';
import 'app_action.dart';

/// Handles each allowlisted action once it has been decoded and validated.
///
/// Sensitive/server-authoritative actions (`addToCart`, `updateCartQuantity`,
/// `removeCartItem`) do not call any Commerce API from this task — that is
/// MOBILE-RUNTIME-4/5's job. A concrete [ActionHandler] implementation here
/// is proved with an injectable/fake handler (see `NoopActionHandler` below
/// and `test/actions/recording_action_handler.dart`), matching the
/// horizon's own task-4-comes-after-task-3 dependency ordering — this
/// registry proves *dispatch*, not *effect*.
abstract class ActionHandler {
  Future<void> onNavigate(NavigateAction action);
  Future<void> onOpenProduct(OpenProductAction action);
  Future<void> onAddToCart(AddToCartAction action);
  Future<void> onUpdateCartQuantity(UpdateCartQuantityAction action);
  Future<void> onRemoveCartItem(RemoveCartItemAction action);
  Future<void> onRefresh(RefreshAction action);
}

/// The temporary default handler until MOBILE-RUNTIME-4/5 wires a real one.
/// Deliberately inert (never throws, never silently pretends to succeed at
/// a business effect) — a tap dispatches a correctly-typed action and
/// nothing observable happens yet, which is the honest state of the app at
/// this point in the horizon.
class NoopActionHandler implements ActionHandler {
  const NoopActionHandler();

  @override
  Future<void> onNavigate(NavigateAction action) async {}
  @override
  Future<void> onOpenProduct(OpenProductAction action) async {}
  @override
  Future<void> onAddToCart(AddToCartAction action) async {}
  @override
  Future<void> onUpdateCartQuantity(UpdateCartQuantityAction action) async {}
  @override
  Future<void> onRemoveCartItem(RemoveCartItemAction action) async {}
  @override
  Future<void> onRefresh(RefreshAction action) async {}
}

/// Decodes and dispatches a schema [ActionRef] to a typed [ActionHandler]
/// method. This is the one function any tappable widget in the Component
/// Registry calls — never a raw callback, never a direct API/business call
/// from a widget.
class AppActionDispatcher {
  final ActionHandler handler;

  const AppActionDispatcher(this.handler);

  Future<void> dispatch(ActionRef ref) async {
    final action = decodeAction(ref);
    if (action == null) return; // fail-safe no-op — see decodeAction's own doc comment.
    switch (action) {
      case NavigateAction a:
        await handler.onNavigate(a);
      case OpenProductAction a:
        await handler.onOpenProduct(a);
      case AddToCartAction a:
        await handler.onAddToCart(a);
      case UpdateCartQuantityAction a:
        await handler.onUpdateCartQuantity(a);
      case RemoveCartItemAction a:
        await handler.onRemoveCartItem(a);
      case RefreshAction a:
        await handler.onRefresh(a);
    }
  }
}
