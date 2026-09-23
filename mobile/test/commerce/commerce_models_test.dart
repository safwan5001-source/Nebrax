import 'package:awj_mobile_runtime/commerce/commerce.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_transport.dart';

void main() {
  test('parsing tolerates an additional field the client does not know about (forward compatibility)', () {
    final envelope = {
      'data': {'name': 'أَوْج', 'a_field_from_a_future_server': 'ignored'},
      'meta': successMeta(),
    };
    expect(parseStorefrontResponse(envelope).name, 'أَوْج');
  });

  test('a missing required (non-nullable) field raises CommerceProtocolException, never a raw TypeError', () {
    final envelope = {
      'data': {
        'status': null,
        'items': [],
        'subtotal': money(),
        // 'currency' omitted — required and non-nullable on `Cart`.
        'has_unavailable_items': false,
      },
      'meta': successMeta(),
    };
    expect(
      () => parseCartResponse(envelope),
      throwsA(isA<CommerceProtocolException>()),
    );
  });

  test('a category nests children and ancestors', () {
    final category = CommerceCategory.fromJson({
      'id': 'root',
      'name': 'المطبخ',
      'description': null,
      'color': null,
      'parent_id': null,
      'children': [
        {
          'id': 'child',
          'name': 'أواني',
          'description': null,
          'color': null,
          'parent_id': 'root',
        },
      ],
      'ancestors': [],
    });
    expect(category.children.single.name, 'أواني');
  });

  test('CommerceCart parses items, subtotal, and availability', () {
    final cart = CommerceCart.fromJson({
      'status': 'open',
      'items': [
        {
          'id': 'ci-1',
          'product_id': 'p1',
          'product_variant_id': null,
          'variant_descriptor': null,
          'product_name': 'تمر',
          'unit_key': 'box',
          'unit_name': 'صندوق',
          'quantity': 2,
          'unit_price': money(amountMinor: 5000),
          'line_total': money(amountMinor: 10000),
          'available': true,
        },
      ],
      'subtotal': money(amountMinor: 10000),
      'currency': 'SAR',
      'has_unavailable_items': false,
    });

    expect(cart.items.single.quantity, 2);
    expect(cart.items.single.lineTotal.amountMinor, 10000);
    expect(cart.hasUnavailableItems, isFalse);
  });

  test('CommerceErrorCode.fromWire maps every documented code and falls back to unknown', () {
    const documented = [
      'internal_error',
      'bad_request',
      'not_found',
      'method_not_allowed',
      'validation_failed',
      'unauthenticated',
      'forbidden',
      'tenant_context_required',
      'client_inactive',
      'insufficient_scope',
      'rate_limited',
      'idempotency_key_required',
      'invalid_idempotency_key',
      'idempotency_conflict',
      'idempotency_in_progress',
      'review_required',
      'cart_merged',
    ];
    for (final code in documented) {
      expect(
        CommerceErrorCode.fromWire(code),
        isNot(CommerceErrorCode.unknown),
      );
    }
    expect(
      CommerceErrorCode.fromWire('something_new'),
      CommerceErrorCode.unknown,
    );
  });
}
