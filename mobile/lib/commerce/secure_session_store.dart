import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// The MR-07 secure-storage boundary for Commerce session material:
/// - the customer's own `customer:access` token (`X-Customer-Token`);
/// - the guest/customer cart identity (`X-Cart-Token`).
///
/// [CommerceClient] is the *only* code that reads or writes this — no token
/// ever surfaces to a widget, a log call, an analytics event, or a deep-link
/// query string. Implementations must never persist these values in plain
/// `SharedPreferences`/`shared_preferences`, a committed fixture, or any
/// other non-platform-secure location.
abstract interface class SecureSessionStore {
  Future<String?> readCustomerToken();
  Future<void> writeCustomerToken(String? token);

  Future<String?> readCartToken();
  Future<void> writeCartToken(String? token);

  /// Clears all stored session material (used on logout).
  Future<void> clear();
}

/// Pure-Dart, in-memory [SecureSessionStore] for tests and any host with no
/// platform secure-storage channel. **Never used for a real customer
/// session** — [CommerceClient]'s own constructor takes a store explicitly
/// so a caller cannot reach for this by accident in app code.
class InMemorySecureSessionStore implements SecureSessionStore {
  String? _customerToken;
  String? _cartToken;

  @override
  Future<String?> readCustomerToken() async => _customerToken;

  @override
  Future<void> writeCustomerToken(String? token) async =>
      _customerToken = token;

  @override
  Future<String?> readCartToken() async => _cartToken;

  @override
  Future<void> writeCartToken(String? token) async => _cartToken = token;

  @override
  Future<void> clear() async {
    _customerToken = null;
    _cartToken = null;
  }
}

/// Real [SecureSessionStore], backed by `flutter_secure_storage` (iOS
/// Keychain / Android Keystore-backed `EncryptedSharedPreferences` — see
/// this task's dependency review in
/// `docs/plans/mobile/MOBILE-RUNTIME-4-IMPLEMENTATION-REPORT.md`). Uses the
/// package's default options only — no biometric gating, so it requires no
/// extra native permission beyond what the package declares unconditionally.
class FlutterSecureSessionStore implements SecureSessionStore {
  static const _customerTokenKey = 'awj.commerce.customer_token';
  static const _cartTokenKey = 'awj.commerce.cart_token';

  final FlutterSecureStorage storage;

  const FlutterSecureSessionStore({
    this.storage = const FlutterSecureStorage(),
  });

  @override
  Future<String?> readCustomerToken() => storage.read(key: _customerTokenKey);

  @override
  Future<void> writeCustomerToken(String? token) {
    if (token == null) return storage.delete(key: _customerTokenKey);
    return storage.write(key: _customerTokenKey, value: token);
  }

  @override
  Future<String?> readCartToken() => storage.read(key: _cartTokenKey);

  @override
  Future<void> writeCartToken(String? token) {
    if (token == null) return storage.delete(key: _cartTokenKey);
    return storage.write(key: _cartTokenKey, value: token);
  }

  @override
  Future<void> clear() async {
    await storage.delete(key: _customerTokenKey);
    await storage.delete(key: _cartTokenKey);
  }
}
