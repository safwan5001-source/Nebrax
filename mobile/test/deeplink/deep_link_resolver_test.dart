import 'package:awj_mobile_runtime/deeplink/deep_link_resolver.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('resolveDeepLinkUri — valid links', () {
    test('the bare root resolves to navigate home', () {
      final action = resolveDeepLinkUri(Uri.parse('https://$kDeepLinkHost/'));
      expect(action?.type, 'navigate');
      expect(action?.params, {'pageId': 'home'});
    });

    test('no path at all resolves to navigate home', () {
      final action = resolveDeepLinkUri(Uri.parse('https://$kDeepLinkHost'));
      expect(action?.type, 'navigate');
      expect(action?.params, {'pageId': 'home'});
    });

    test('/home resolves to navigate home', () {
      final action = resolveDeepLinkUri(
        Uri.parse('https://$kDeepLinkHost/home'),
      );
      expect(action?.type, 'navigate');
      expect(action?.params, {'pageId': 'home'});
    });

    test('/cart resolves to navigate cart', () {
      final action = resolveDeepLinkUri(
        Uri.parse('https://$kDeepLinkHost/cart'),
      );
      expect(action?.type, 'navigate');
      expect(action?.params, {'pageId': 'cart'});
    });

    test('/product/<id> resolves to openProduct with that id', () {
      final action = resolveDeepLinkUri(
        Uri.parse('https://$kDeepLinkHost/product/p1'),
      );
      expect(action?.type, 'openProduct');
      expect(action?.params, {'productId': 'p1'});
    });

    test('a trailing slash does not change resolution', () {
      final home = resolveDeepLinkUri(
        Uri.parse('https://$kDeepLinkHost/home/'),
      );
      expect(home?.type, 'navigate');
      final product = resolveDeepLinkUri(
        Uri.parse('https://$kDeepLinkHost/product/p1/'),
      );
      expect(product?.type, 'openProduct');
      expect(product?.params, {'productId': 'p1'});
    });

    test('marketing/attribution query parameters are ignored, never read', () {
      final action = resolveDeepLinkUri(
        Uri.parse(
          'https://$kDeepLinkHost/product/p1?utm_source=email&token=leaked',
        ),
      );
      expect(action?.type, 'openProduct');
      expect(action?.params, {'productId': 'p1'});
    });
  });

  group('resolveDeepLinkUri — malformed/malicious negatives (fail-safe null, never throws)', () {
    test('http (not https) is rejected', () {
      expect(
        resolveDeepLinkUri(Uri.parse('http://$kDeepLinkHost/product/p1')),
        isNull,
      );
    });

    test('an unrecognized host is rejected', () {
      expect(
        resolveDeepLinkUri(Uri.parse('https://evil.example/product/p1')),
        isNull,
      );
    });

    test(
      'a host that merely contains the real host as a substring is rejected',
      () {
        expect(
          resolveDeepLinkUri(
            Uri.parse('https://$kDeepLinkHost.evil.example/product/p1'),
          ),
          isNull,
        );
      },
    );

    test('an unrecognized path is rejected', () {
      expect(
        resolveDeepLinkUri(Uri.parse('https://$kDeepLinkHost/checkout')),
        isNull,
      );
    });

    test('/product with no id is rejected', () {
      expect(
        resolveDeepLinkUri(Uri.parse('https://$kDeepLinkHost/product')),
        isNull,
      );
    });

    test('/product with an empty id segment is rejected', () {
      expect(
        resolveDeepLinkUri(Uri.parse('https://$kDeepLinkHost/product//')),
        isNull,
      );
    });

    test('/product with extra trailing segments is rejected, never takes the first id', () {
      expect(
        resolveDeepLinkUri(
          Uri.parse('https://$kDeepLinkHost/product/p1/extra'),
        ),
        isNull,
      );
    });

    test('an oversized productId segment is rejected', () {
      final oversized = 'p' * 500;
      expect(
        resolveDeepLinkUri(
          Uri.parse('https://$kDeepLinkHost/product/$oversized'),
        ),
        isNull,
      );
    });

    test('a scheme that is not http/https is rejected', () {
      expect(
        resolveDeepLinkUri(Uri.parse('javascript://$kDeepLinkHost/product/p1')),
        isNull,
      );
    });
  });

  group('resolveDeepLinkString — parse safety', () {
    test('an unparseable string returns null rather than throwing', () {
      expect(resolveDeepLinkString('not a url at all \u0000'), isNull);
    });

    test(
      'a well-formed matching string resolves the same as its parsed Uri',
      () {
        final action = resolveDeepLinkString(
          'https://$kDeepLinkHost/product/p1',
        );
        expect(action?.type, 'openProduct');
        expect(action?.params, {'productId': 'p1'});
      },
    );
  });

  group(
    'resolveDeepLinkUri — cannot produce a destructive/sensitive action',
    () {
      test(
        'no input can resolve to anything other than navigate/openProduct',
        () {
          // A structural guarantee, not just an empirical one — the function's
          // own source has no branch that constructs any other ActionRef type
          // (see its doc comment) — this sample of adversarial paths is a
          // regression net, not the only proof.
          const attempts = [
            '/addToCart',
            '/product/p1/addToCart',
            '/cart/addToCart',
            '/removeCartItem',
            '/updateCartQuantity',
          ];
          for (final path in attempts) {
            final action = resolveDeepLinkUri(
              Uri.parse('https://$kDeepLinkHost$path'),
            );
            expect(
              action == null ||
                  action.type == 'navigate' ||
                  action.type == 'openProduct',
              isTrue,
            );
          }
        },
      );
    },
  );
}
