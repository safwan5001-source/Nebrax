import 'package:flutter/foundation.dart';

/// The runtime's top-level screens. Distinct from an [AppSchema]'s own
/// internal `pages` map (Home and Cart each parse a single-page schema of
/// their own) — this enum is which of those *screens* is currently shown.
enum RuntimePage { home, product, cart }

/// App-level ephemeral UI state (MR-06): which screen is showing, which
/// product is selected (a navigation parameter, never business data), and
/// two bump counters screens listen to so they know when to re-fetch —
/// [cartVersion] after any cart-mutating action, [refreshVersion] after an
/// explicit `refresh` action. None of this is server-authoritative — every
/// screen still re-fetches from [CommerceClient] itself; this class holds
/// no product/cart data of its own.
class RuntimeState extends ChangeNotifier {
  RuntimePage _page = RuntimePage.home;
  String? _selectedProductId;
  int _cartVersion = 0;
  int _refreshVersion = 0;

  RuntimePage get page => _page;
  String? get selectedProductId => _selectedProductId;
  int get cartVersion => _cartVersion;
  int get refreshVersion => _refreshVersion;

  void goHome() {
    _page = RuntimePage.home;
    _selectedProductId = null;
    notifyListeners();
  }

  void goToProduct(String productId) {
    _page = RuntimePage.product;
    _selectedProductId = productId;
    notifyListeners();
  }

  void goToCart() {
    _page = RuntimePage.cart;
    notifyListeners();
  }

  void markCartChanged() {
    _cartVersion++;
    notifyListeners();
  }

  void markRefreshRequested() {
    _refreshVersion++;
    notifyListeners();
  }
}
