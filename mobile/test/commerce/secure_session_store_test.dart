import 'package:awj_mobile_runtime/commerce/commerce.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// [FlutterSecureSessionStore] is a thin wrapper over `flutter_secure_storage`,
/// whose real Keychain/Keystore-backed behavior needs a device/emulator this
/// repository's CI does not have (documented gap since MOBILE-RUNTIME-1's
/// performance-baseline report). What *is* verifiable headlessly is the
/// contract this wrapper promises: which key each session field is stored
/// under, and that a null write means "delete", not "store the string
/// null" — proven here by mocking the plugin's own method channel rather
/// than touching a real secure enclave.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
  final calls = <MethodCall>[];
  final values = <String, String>{};

  setUp(() {
    calls.clear();
    values.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (MethodCall call) async {
          calls.add(call);
          switch (call.method) {
            case 'write':
              values[call.arguments['key'] as String] =
                  call.arguments['value'] as String;
              return null;
            case 'read':
              return values[call.arguments['key'] as String];
            case 'delete':
              values.remove(call.arguments['key'] as String);
              return null;
            default:
              return null;
          }
        });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test('writeCustomerToken/readCustomerToken round-trip through the plugin channel', () async {
    const store = FlutterSecureSessionStore();

    await store.writeCustomerToken('a-customer-token');
    expect(await store.readCustomerToken(), 'a-customer-token');
    expect(calls.map((c) => c.method), containsAllInOrder(['write', 'read']));
    expect(values['awj.commerce.customer_token'], 'a-customer-token');
  });

  test('writing a null token deletes the key rather than storing the literal string "null"', () async {
    const store = FlutterSecureSessionStore();
    await store.writeCartToken('temp');
    expect(values['awj.commerce.cart_token'], 'temp');

    await store.writeCartToken(null);

    expect(values.containsKey('awj.commerce.cart_token'), isFalse);
    expect(calls.last.method, 'delete');
  });

  test('customer and cart tokens are stored under distinct keys', () async {
    const store = FlutterSecureSessionStore();
    await store.writeCustomerToken('customer-value');
    await store.writeCartToken('cart-value');

    expect(values['awj.commerce.customer_token'], 'customer-value');
    expect(values['awj.commerce.cart_token'], 'cart-value');
  });

  test('clear() deletes both keys', () async {
    const store = FlutterSecureSessionStore();
    await store.writeCustomerToken('customer-value');
    await store.writeCartToken('cart-value');

    await store.clear();

    expect(values, isEmpty);
  });
}
