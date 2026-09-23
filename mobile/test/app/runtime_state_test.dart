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
}
