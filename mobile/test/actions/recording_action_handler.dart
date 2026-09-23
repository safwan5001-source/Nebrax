import 'package:awj_mobile_runtime/actions/actions.dart';

/// Test double recording every dispatched action for assertion. Lives under
/// `test/` deliberately — production code uses `NoopActionHandler` until a
/// real handler exists (MOBILE-RUNTIME-4/5).
class RecordingActionHandler implements ActionHandler {
  final List<AppAction> received = [];

  @override
  Future<void> onNavigate(NavigateAction action) async => received.add(action);
  @override
  Future<void> onOpenProduct(OpenProductAction action) async => received.add(action);
  @override
  Future<void> onAddToCart(AddToCartAction action) async => received.add(action);
  @override
  Future<void> onUpdateCartQuantity(UpdateCartQuantityAction action) async => received.add(action);
  @override
  Future<void> onRemoveCartItem(RemoveCartItemAction action) async => received.add(action);
  @override
  Future<void> onRefresh(RefreshAction action) async => received.add(action);
}
