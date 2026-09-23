import 'package:awj_mobile_runtime/commerce/commerce.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_transport.dart';

CommerceConfig _config() => CommerceConfig(
  baseUrl: Uri.parse('https://api.example.com/commerce/v1'),
  storeBearerToken: 'store-secret-key',
);

void main() {
  group('read tier (storefront/categories/products)', () {
    test(
      'getStorefront sends the store bearer token and no session headers',
      () async {
        final transport = FakeCommerceTransport.always(
          jsonResponse(200, {
            'data': {'name': 'أَوْج'},
            'meta': successMeta(),
          }),
        );
        final client = CommerceClient(
          config: _config(),
          sessionStore: InMemorySecureSessionStore(),
          transport: transport,
        );

        final storefront = await client.getStorefront();

        expect(storefront.name, 'أَوْج');
        final sent = transport.requests.single;
        expect(
          sent.uri.toString(),
          'https://api.example.com/commerce/v1/storefront',
        );
        expect(sent.headers['Authorization'], 'Bearer store-secret-key');
        expect(sent.headers.containsKey('X-Cart-Token'), isFalse);
        expect(sent.headers.containsKey('X-Customer-Token'), isFalse);
      },
    );

    test('listProducts encodes optional filters as query parameters, omitting absent ones', () async {
      final transport = FakeCommerceTransport.always(
        jsonResponse(200, {'data': [], 'meta': paginationMeta(total: 0)}),
      );
      final client = CommerceClient(
        config: _config(),
        sessionStore: InMemorySecureSessionStore(),
        transport: transport,
      );

      await client.listProducts(page: 2, search: 'قهوة');

      final sent = transport.requests.single;
      expect(sent.uri.queryParameters, {'page': '2', 'search': 'قهوة'});
    });

    test(
      'listProducts parses a page of products and its pagination meta',
      () async {
        final transport = FakeCommerceTransport.always(
          jsonResponse(200, {
            'data': [
              {
                'id': 'p1',
                'name': 'تمر',
                'name_en': 'Dates',
                'description': null,
                'sku': 'SKU-1',
                'category': null,
                'price': money(amountMinor: 5000),
                'in_stock': true,
                'thumbnail_url': null,
                'is_variant_managed': false,
                'created_at': null,
                'updated_at': null,
              },
            ],
            'meta': paginationMeta(total: 1, hasMore: false),
          }),
        );
        final client = CommerceClient(
          config: _config(),
          sessionStore: InMemorySecureSessionStore(),
          transport: transport,
        );

        final page = await client.listProducts();

        expect(page.items, hasLength(1));
        expect(page.items.single.name, 'تمر');
        expect(page.items.single.price.amountMinor, 5000);
        expect(page.pagination.total, 1);
      },
    );

    test(
      'getProduct discriminates a simple product from a variant-managed one',
      () async {
        final simpleTransport = FakeCommerceTransport.always(
          jsonResponse(200, {
            'data': {
              'id': 'p1',
              'name': 'تمر',
              'name_en': null,
              'description': null,
              'sku': null,
              'category': null,
              'price': money(),
              'in_stock': true,
              'thumbnail_url': null,
              'is_variant_managed': false,
              'created_at': null,
              'updated_at': null,
              'media': [],
            },
            'meta': successMeta(),
          }),
        );
        final simpleClient = CommerceClient(
          config: _config(),
          sessionStore: InMemorySecureSessionStore(),
          transport: simpleTransport,
        );
        final simple = await simpleClient.getProduct('p1');
        expect(simple, isA<CommerceSimpleProduct>());

        final variantTransport = FakeCommerceTransport.always(
          jsonResponse(200, {
            'data': {
              'id': 'p2',
              'name': 'تيشيرت',
              'name_en': null,
              'description': null,
              'sku': null,
              'category': null,
              'price': money(),
              'in_stock': true,
              'thumbnail_url': null,
              'is_variant_managed': true,
              'created_at': null,
              'updated_at': null,
              'media': [],
              'options': [
                {
                  'id': 'opt-1',
                  'name': 'المقاس',
                  'name_en': null,
                  'values': [
                    {'id': 'v1', 'value': 'صغير', 'value_en': null},
                  ],
                },
              ],
              'variants': [
                {
                  'id': 'var-1',
                  'sku': null,
                  'descriptor': 'صغير',
                  'option_value_ids': ['v1'],
                  'price': money(),
                  'in_stock': true,
                  'media': [],
                },
              ],
            },
            'meta': successMeta(),
          }),
        );
        final variantClient = CommerceClient(
          config: _config(),
          sessionStore: InMemorySecureSessionStore(),
          transport: variantTransport,
        );
        final variantManaged = await variantClient.getProduct(
          'p2',
        ) as CommerceVariantManagedProduct;
        expect(variantManaged.options, hasLength(1));
        expect(variantManaged.variants.single.descriptor, 'صغير');
      },
    );

    test('a validation_failed error response is thrown as CommerceApiException with the wire code', () async {
      final transport = FakeCommerceTransport.always(
        jsonResponse(
          422,
          errorEnvelope(
            'validation_failed',
            'search too long',
            requestId: 'req-42',
          ),
        ),
      );
      final client = CommerceClient(
        config: _config(),
        sessionStore: InMemorySecureSessionStore(),
        transport: transport,
      );

      await expectLater(
        client.listProducts(),
        throwsA(
          isA<CommerceApiException>()
              .having((e) => e.statusCode, 'statusCode', 422)
              .having((e) => e.code, 'code', CommerceErrorCode.validationFailed)
              .having((e) => e.requestId, 'requestId', 'req-42'),
        ),
      );
    });

    test('an error code the client does not recognize maps to CommerceErrorCode.unknown, never throws while parsing', () async {
      final transport = FakeCommerceTransport.always(
        jsonResponse(500, errorEnvelope('a_future_code', 'oops')),
      );
      final client = CommerceClient(
        config: _config(),
        sessionStore: InMemorySecureSessionStore(),
        transport: transport,
      );

      await expectLater(
        client.getStorefront(),
        throwsA(
          isA<CommerceApiException>().having(
            (e) => e.code,
            'code',
            CommerceErrorCode.unknown,
          ),
        ),
      );
    });

    test('a non-JSON-object response body raises CommerceProtocolException, not a raw type error', () async {
      final transport = FakeCommerceTransport.always(
        const CommerceHttpResponse(statusCode: 200, headers: {}, body: '[]'),
      );
      final client = CommerceClient(
        config: _config(),
        sessionStore: InMemorySecureSessionStore(),
        transport: transport,
      );

      await expectLater(
        client.getStorefront(),
        throwsA(isA<CommerceProtocolException>()),
      );
    });
  });

  group('cart (write tier, optional customer identity)', () {
    test('a stored cart token is attached to a cart request', () async {
      final sessionStore = InMemorySecureSessionStore();
      await sessionStore.writeCartToken('cart-token-abc');
      final transport = FakeCommerceTransport.always(
        jsonResponse(200, {
          'data': {
            'status': null,
            'items': [],
            'subtotal': money(amountMinor: 0),
            'currency': 'SAR',
            'has_unavailable_items': false,
          },
          'meta': successMeta(),
        }),
      );
      final client = CommerceClient(
        config: _config(),
        sessionStore: sessionStore,
        transport: transport,
      );

      await client.getCart();

      expect(
        transport.requests.single.headers['X-Cart-Token'],
        'cart-token-abc',
      );
    });

    test(
      'a fresh X-Cart-Token from the response is persisted for the next call',
      () async {
        final sessionStore = InMemorySecureSessionStore();
        final transport = FakeCommerceTransport.always(
          jsonResponse(
            201,
            {
              'data': {
                'status': 'open',
                'items': [],
                'subtotal': money(amountMinor: 0),
                'currency': 'SAR',
                'has_unavailable_items': false,
              },
              'meta': successMeta(),
            },
            headers: {'X-Cart-Token': 'new-cart-token'},
          ),
        );
        final client = CommerceClient(
          config: _config(),
          sessionStore: sessionStore,
          transport: transport,
        );

        await client.addCartItem(productId: 'p1', quantity: 1);

        expect(await sessionStore.readCartToken(), 'new-cart-token');
      },
    );

    test(
      'addCartItem omits product_variant_id/unit_key from the body when absent',
      () async {
        final transport = FakeCommerceTransport.always(
          jsonResponse(200, {
            'data': {
              'status': null,
              'items': [],
              'subtotal': money(amountMinor: 0),
              'currency': 'SAR',
              'has_unavailable_items': false,
            },
            'meta': successMeta(),
          }),
        );
        final client = CommerceClient(
          config: _config(),
          sessionStore: InMemorySecureSessionStore(),
          transport: transport,
        );

        await client.addCartItem(productId: 'p1', quantity: 3);

        final body = transport.requests.single.body!;
        expect(body.contains('product_variant_id'), isFalse);
        expect(body.contains('unit_key'), isFalse);
        expect(body.contains('"quantity":3'), isTrue);
      },
    );

    test(
      'a stored customer token is attached to cart calls but never required',
      () async {
        final sessionStore = InMemorySecureSessionStore();
        await sessionStore.writeCustomerToken('customer-token-xyz');
        final transport = FakeCommerceTransport.always(
          jsonResponse(200, {
            'data': {
              'status': null,
              'items': [],
              'subtotal': money(amountMinor: 0),
              'currency': 'SAR',
              'has_unavailable_items': false,
            },
            'meta': successMeta(),
          }),
        );
        final client = CommerceClient(
          config: _config(),
          sessionStore: sessionStore,
          transport: transport,
        );

        await client.getCart();

        expect(
          transport.requests.single.headers['X-Customer-Token'],
          'customer-token-xyz',
        );
      },
    );

    test('a 401 on an optional-customer-tier call clears the stored (now-stale) customer token', () async {
      final sessionStore = InMemorySecureSessionStore();
      await sessionStore.writeCustomerToken('stale-token');
      final transport = FakeCommerceTransport.always(
        jsonResponse(401, errorEnvelope('unauthenticated', 'bad token')),
      );
      final client = CommerceClient(
        config: _config(),
        sessionStore: sessionStore,
        transport: transport,
      );

      await expectLater(client.getCart(), throwsA(isA<CommerceApiException>()));

      expect(await sessionStore.readCustomerToken(), isNull);
    });
  });

  group('auth (sensitive tier — no session identity yet)', () {
    test('registerCustomer sends no cart/customer token and returns verification_required', () async {
      final transport = FakeCommerceTransport.always(
        jsonResponse(202, {
          'data': {'verification_required': true},
          'meta': successMeta(),
        }),
      );
      final client = CommerceClient(
        config: _config(),
        sessionStore: InMemorySecureSessionStore(),
        transport: transport,
      );

      final accepted = await client.registerCustomer(
        displayName: 'سلمى',
        email: 's@example.com',
        password: 'p4ssword',
      );

      expect(accepted, isTrue);
      final sent = transport.requests.single;
      expect(sent.headers.containsKey('X-Cart-Token'), isFalse);
      expect(sent.headers.containsKey('X-Customer-Token'), isFalse);
    });

    test('loginCustomer persists the token to the session store and returns only the customer identity', () async {
      final sessionStore = InMemorySecureSessionStore();
      final transport = FakeCommerceTransport.always(
        jsonResponse(200, {
          'data': {
            'token': 'super-secret-customer-token',
            'customer': {
              'id': 'c1',
              'display_name': 'سلمى',
              'email': 's@example.com',
              'phone': null,
              'email_verified': true,
              'phone_verified': false,
              'is_active': true,
              'last_login_at': null,
            },
          },
          'meta': successMeta(),
        }),
      );
      final client = CommerceClient(
        config: _config(),
        sessionStore: sessionStore,
        transport: transport,
      );

      final customer = await client.loginCustomer(
        email: 's@example.com',
        password: 'p4ssword',
      );

      expect(customer.displayName, 'سلمى');
      expect(
        await sessionStore.readCustomerToken(),
        'super-secret-customer-token',
      );
    });

    test(
      'verifyOtp persists the token the same way loginCustomer does',
      () async {
        final sessionStore = InMemorySecureSessionStore();
        final transport = FakeCommerceTransport.always(
          jsonResponse(200, {
            'data': {
              'token': 'otp-issued-token',
              'customer': {
                'id': 'c2',
                'display_name': null,
                'email': null,
                'phone': '+966500000000',
                'email_verified': false,
                'phone_verified': true,
                'is_active': true,
                'last_login_at': null,
              },
            },
            'meta': successMeta(),
          }),
        );
        final client = CommerceClient(
          config: _config(),
          sessionStore: sessionStore,
          transport: transport,
        );

        await client.verifyOtp(phone: '+966500000000', code: '123456');

        expect(await sessionStore.readCustomerToken(), 'otp-issued-token');
      },
    );
  });

  group('customer-required tier (me, logout)', () {
    test('getMe throws MissingCustomerSessionException before sending any request when no session is stored', () async {
      final transport = FakeCommerceTransport.always(
        jsonResponse(200, {'data': {}, 'meta': successMeta()}),
      );
      final client = CommerceClient(
        config: _config(),
        sessionStore: InMemorySecureSessionStore(),
        transport: transport,
      );

      await expectLater(
        client.getMe(),
        throwsA(isA<MissingCustomerSessionException>()),
      );
      expect(transport.requests, isEmpty);
    });

    test(
      'getMe sends the stored customer token and parses the profile',
      () async {
        final sessionStore = InMemorySecureSessionStore();
        await sessionStore.writeCustomerToken('customer-token');
        final transport = FakeCommerceTransport.always(
          jsonResponse(200, {
            'data': {
              'customer': {
                'id': 'c1',
                'display_name': 'سلمى',
                'email': 's@example.com',
                'phone': null,
                'email_verified': true,
                'phone_verified': false,
                'is_active': true,
                'last_login_at': null,
              },
              'partner_link': {'linked': false, 'partner_id': null},
            },
            'meta': successMeta(),
          }),
        );
        final client = CommerceClient(
          config: _config(),
          sessionStore: sessionStore,
          transport: transport,
        );

        final me = await client.getMe();

        expect(me.customer.displayName, 'سلمى');
        expect(me.partnerLink.linked, isFalse);
        expect(
          transport.requests.single.headers['X-Customer-Token'],
          'customer-token',
        );
      },
    );

    test('logoutCustomer clears the local token only after a successful server response', () async {
      final sessionStore = InMemorySecureSessionStore();
      await sessionStore.writeCustomerToken('customer-token');
      final transport = FakeCommerceTransport.always(
        jsonResponse(200, {
          'data': {'logged_out': true},
          'meta': successMeta(),
        }),
      );
      final client = CommerceClient(
        config: _config(),
        sessionStore: sessionStore,
        transport: transport,
      );

      await client.logoutCustomer();

      expect(await sessionStore.readCustomerToken(), isNull);
    });

    test('logoutCustomer does not clear the local token when the server call fails', () async {
      final sessionStore = InMemorySecureSessionStore();
      await sessionStore.writeCustomerToken('customer-token');
      final transport = FakeCommerceTransport.always(
        jsonResponse(500, errorEnvelope('internal_error', 'boom')),
      );
      final client = CommerceClient(
        config: _config(),
        sessionStore: sessionStore,
        transport: transport,
      );

      await expectLater(
        client.logoutCustomer(),
        throwsA(isA<CommerceApiException>()),
      );

      expect(await sessionStore.readCustomerToken(), 'customer-token');
    });
  });

  test('mediaUri builds an authenticated-request URL under the configured base path', () {
    final client = CommerceClient(
      config: _config(),
      sessionStore: InMemorySecureSessionStore(),
    );
    expect(
      client.mediaUri('m1').toString(),
      'https://api.example.com/commerce/v1/media/m1',
    );
  });
}
