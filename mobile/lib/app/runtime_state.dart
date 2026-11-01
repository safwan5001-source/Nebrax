import 'package:flutter/foundation.dart';

/// The runtime's top-level screens. Distinct from an [AppSchema]'s own
/// internal `pages` map (Home and Cart each parse a single-page schema of
/// their own) — this enum is which of those *screens* is currently shown.
/// [page] (S06a) is the generic screen that renders any other page the live
/// Experience declares, identified by [RuntimeState.selectedPageId].
enum RuntimePage { home, product, cart, page }

class _Visit {
  final RuntimePage page;
  final String? productId;
  final String? pageId;
  const _Visit(this.page, this.productId, this.pageId);
}

/// App-level ephemeral UI state (MR-06): which screen is showing, which
/// product is selected (a navigation parameter, never business data), and
/// two bump counters screens listen to so they know when to re-fetch —
/// [cartVersion] after any cart-mutating action, [refreshVersion] after an
/// explicit `refresh` action. None of this is server-authoritative — every
/// screen still re-fetches from [CommerceClient] itself; this class holds
/// no product/cart data of its own.
///
/// S06a adds a visit history ([canGoBack]/[goBack]) so back works across
/// custom pages, and the set of pages the live Experience declares
/// ([declarePages]) — a `navigate` to anything outside it stays a no-op (the
/// same fail-safe posture as before).
class RuntimeState extends ChangeNotifier {
  RuntimePage _page = RuntimePage.home;
  String? _selectedProductId;
  String? _selectedPageId;
  int _cartVersion = 0;
  int _refreshVersion = 0;
  final List<_Visit> _history = [];
  Set<String> _declaredPageIds = const {};
  bool _started = false;

  /// تنقّل صريح حدث (رابط عميق/إشعار/إجراء) — الوجهة الأولية لا تطغى عليه (`startAt`).
  bool _explicitNavigation = false;

  RuntimePage get page => _page;
  String? get selectedProductId => _selectedProductId;
  String? get selectedPageId => _selectedPageId;
  int get cartVersion => _cartVersion;
  int get refreshVersion => _refreshVersion;
  bool get canGoBack => _history.isNotEmpty;

  /// Page ids the live Experience declares (`home`/`cart` included — they
  /// keep their dedicated screens). Replaces the previous set; if the current
  /// custom page is no longer declared the runtime returns home.
  void declarePages(Iterable<String> pageIds) {
    _declaredPageIds = Set.unmodifiable(pageIds.toSet());
    if (_page == RuntimePage.page && !_declaredPageIds.contains(_selectedPageId)) {
      _history.clear();
      _page = RuntimePage.home;
      _selectedPageId = null;
      notifyListeners();
    }
  }

  void _pushCurrent() => _history.add(_Visit(_page, _selectedProductId, _selectedPageId));

  void goHome() {
    _explicitNavigation = true;
    _history.clear();
    _page = RuntimePage.home;
    _selectedProductId = null;
    _selectedPageId = null;
    notifyListeners();
  }

  void goToProduct(String productId) {
    _explicitNavigation = true;
    _pushCurrent();
    _page = RuntimePage.product;
    _selectedProductId = productId;
    notifyListeners();
  }

  void goToCart() {
    _explicitNavigation = true;
    _pushCurrent();
    _page = RuntimePage.cart;
    notifyListeners();
  }

  /// Opens a declared custom page; returns whether it did. `home`/`cart` are
  /// never custom pages (they have dedicated screens and `navigate` already
  /// maps them), and an undeclared id is ignored.
  bool goToPage(String pageId) {
    if (pageId == 'home' || pageId == 'cart' || !_declaredPageIds.contains(pageId)) return false;
    _explicitNavigation = true;
    _pushCurrent();
    _page = RuntimePage.page;
    _selectedPageId = pageId;
    notifyListeners();
    return true;
  }

  /// One-time landing on the Experience's `navigation.initialPageId` (PAG-02):
  /// only for a declared custom page or `cart`, only once per session, and
  /// without a history entry (the initial page is the root, not a detour).
  void startAt(String? pageId) {
    // رابط عميق/إشعار بارد يُرسَل قبل اكتمال الإقلاع: وجهته الصريحة تتقدّم على الصفحة الأولية.
    if (_started || _explicitNavigation || pageId == null || pageId == 'home') return;
    if (pageId == 'cart') {
      _started = true;
      _page = RuntimePage.cart;
      notifyListeners();
      return;
    }
    if (!_declaredPageIds.contains(pageId)) return;
    _started = true;
    _page = RuntimePage.page;
    _selectedPageId = pageId;
    notifyListeners();
  }

  void goBack() {
    if (_history.isEmpty) return;
    _explicitNavigation = true;
    final previous = _history.removeLast();
    _page = previous.page;
    _selectedProductId = previous.productId;
    _selectedPageId = previous.pageId;
    notifyListeners();
  }

  /// الجذر النشط للتبويبات: `home`/`cart` أو معرّف الصفحة المخصّصة؛ شاشة المنتج تتبع الجذر الذي جاءت منه
  /// (أقرب زيارة سابقة ليست منتجاً)، وإلا `home`.
  String get activeRootPageId {
    String? keyOf(RuntimePage page, String? pageId) => switch (page) {
      RuntimePage.home => 'home',
      RuntimePage.cart => 'cart',
      RuntimePage.page => pageId,
      RuntimePage.product => null,
    };
    final own = keyOf(_page, _selectedPageId);
    if (own != null) return own;
    for (final visit in _history.reversed) {
      final key = keyOf(visit.page, visit.pageId);
      if (key != null) return key;
    }
    return 'home';
  }

  /// تبديل جذر من تبويب سفلي: يمسح السجل ويفتح الوجهة (`home`/`cart`/صفحة معلنة)؛ يعيد هل فعل.
  bool selectRoot(String pageId) {
    if (pageId == 'home') {
      goHome();
      return true;
    }
    if (pageId == 'cart') {
      _explicitNavigation = true;
      _history.clear();
      _page = RuntimePage.cart;
      _selectedProductId = null;
      _selectedPageId = null;
      notifyListeners();
      return true;
    }
    if (!_declaredPageIds.contains(pageId)) return false;
    _explicitNavigation = true;
    _history.clear();
    _page = RuntimePage.page;
    _selectedProductId = null;
    _selectedPageId = pageId;
    notifyListeners();
    return true;
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
