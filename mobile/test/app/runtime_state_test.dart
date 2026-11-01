import 'package:awj_mobile_runtime/app/runtime_state.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('starts on home with no selected product', () {
    final state = RuntimeState();
    expect(state.page, RuntimePage.home);
    expect(state.selectedProductId, isNull);
  });

  test(
    'goToProduct switches to product and records the id; goHome clears it',
    () {
      final state = RuntimeState();
      var notifications = 0;
      state.addListener(() => notifications++);

      state.goToProduct('p1');
      expect(state.page, RuntimePage.product);
      expect(state.selectedProductId, 'p1');
      expect(notifications, 1);

      state.goHome();
      expect(state.page, RuntimePage.home);
      expect(state.selectedProductId, isNull);
      expect(notifications, 2);
    },
  );

  test('goToCart switches to cart', () {
    final state = RuntimeState();
    state.goToCart();
    expect(state.page, RuntimePage.cart);
  });

  test('markCartChanged and markRefreshRequested bump independent counters and notify', () {
    final state = RuntimeState();
    var notifications = 0;
    state.addListener(() => notifications++);

    state.markCartChanged();
    expect(state.cartVersion, 1);
    expect(state.refreshVersion, 0);

    state.markRefreshRequested();
    expect(state.cartVersion, 1);
    expect(state.refreshVersion, 1);

    expect(notifications, 2);
  });

  group('declared custom pages and history (S06a)', () {
    test('goToPage only navigates to a declared page and reports whether it did', () {
      final state = RuntimeState();
      expect(state.goToPage('about'), isFalse); // لم تُعلَن
      expect(state.page, RuntimePage.home);

      state.declarePages(['home', 'cart', 'about']);
      expect(state.goToPage('about'), isTrue);
      expect(state.page, RuntimePage.page);
      expect(state.selectedPageId, 'about');
    });

    test('home and cart are never custom pages (they keep their dedicated screens)', () {
      final state = RuntimeState()..declarePages(['home', 'cart', 'about']);
      expect(state.goToPage('home'), isFalse);
      expect(state.goToPage('cart'), isFalse);
      expect(state.page, RuntimePage.home);
    });

    test('back returns through the visited screens in order and stops at home', () {
      final state = RuntimeState()..declarePages(['about']);
      expect(state.canGoBack, isFalse);

      state.goToPage('about');
      state.goToProduct('p1');
      state.goToCart();
      expect(state.canGoBack, isTrue);

      state.goBack();
      expect(state.page, RuntimePage.product);
      expect(state.selectedProductId, 'p1');
      state.goBack();
      expect(state.page, RuntimePage.page);
      expect(state.selectedPageId, 'about');
      state.goBack();
      expect(state.page, RuntimePage.home);
      expect(state.canGoBack, isFalse);
      state.goBack(); // لا شيء يحدث
      expect(state.page, RuntimePage.home);
    });

    test('goHome is the root: it clears the history', () {
      final state = RuntimeState()..declarePages(['about']);
      state.goToPage('about');
      state.goToCart();
      state.goHome();
      expect(state.canGoBack, isFalse);
    });

    test('re-declaring pages that no longer include the current page falls back home', () {
      final state = RuntimeState()..declarePages(['about']);
      state.goToPage('about');
      state.declarePages(['home']);
      expect(state.page, RuntimePage.home);
    });

    test('startAt lands on a declared initial page once, without a history entry', () {
      final state = RuntimeState()..declarePages(['about']);
      state.startAt('about');
      expect(state.page, RuntimePage.page);
      expect(state.canGoBack, isFalse);
      state.goHome();
      state.startAt('about'); // مرة واحدة فقط في الجلسة
      expect(state.page, RuntimePage.home);
    });

    test('startAt yields to an explicit navigation that already happened (cold-start deep link / notification)', () {
      for (final navigate in <void Function(RuntimeState)>[
        (s) => s.goToProduct('p1'),
        (s) => s.goToCart(),
        (s) => s.goHome(),
      ]) {
        final state = RuntimeState()..declarePages(['about']);
        navigate(state);
        final page = state.page;
        final product = state.selectedProductId;
        state.startAt('about');
        expect(state.page, page, reason: 'startAt must not override the explicit destination');
        expect(state.selectedProductId, product);
      }
      final deep = RuntimeState()..declarePages(['about']);
      deep.declarePages(['about']);
      expect(deep.goToPage('about'), isTrue);
      deep.startAt('cart');
      expect(deep.page, RuntimePage.page);
    });

    test('startAt ignores undeclared, home and null', () {
      final state = RuntimeState()..declarePages(['about']);
      state.startAt('nope');
      state.startAt('home');
      state.startAt(null);
      expect(state.page, RuntimePage.home);
    });
  });
}
