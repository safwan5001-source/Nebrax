import 'dart:convert';

import 'commerce_config.dart';
import 'commerce_error.dart';
import 'commerce_models.dart';
import 'commerce_transport.dart';
import 'resilient_transport.dart';
import 'secure_session_store.dart';

/// Whether a call sends `X-Customer-Token`, per
/// `docs/openapi/commerce-api-v1.yaml`'s four auth tiers.
enum _CustomerTokenPolicy {
  /// Sensitive tier (`auth/register`, `auth/login`, `auth/otp/*`): a
  /// customer can't have a token yet, so never send one.
  none,

  /// Read/Write tier on Cart/Checkout: send it if stored, but a missing
  /// token never blocks the call (guest-usable).
  optional,

  /// Customer-required tier (`me`, `auth/logout`): the route always needs
  /// one — [MissingCustomerSessionException] is thrown client-side rather
  /// than sending a request guaranteed to 401.
  required,
}

/// Typed client for the tenant-facing `/commerce/v1` surface
/// (`docs/openapi/commerce-api-v1.yaml`), scoped to this horizon's Home/
/// Product/Cart vertical slice (MOBILE-RUNTIME-5) plus the customer
/// authentication entry points a secure session boundary needs to prove
/// (MR-07). Checkout/payments/orders/addresses are the documented contract's
/// business but are not part of this task — see this task's implementation
/// report for the explicit scope boundary.
///
/// This is the *only* place in the runtime that ever sees a customer or
/// cart token in cleartext: every method reads/writes them through
/// [SecureSessionStore] internally, and no method returns a raw token to
/// its caller (MR-07 — "No tokens in ... logs; analytics events; ...").
/// State separation (MR-06): every return type here is a plain,
/// server-parsed value object — this client holds no mutable cache and no
/// business-authoritative state of its own between calls.
class CommerceClient {
  final CommerceConfig config;
  final SecureSessionStore sessionStore;
  final CommerceTransport _transport;
  String _acceptLanguage = 'ar';

  /// Production code never passes [transport] — the default wraps the real
  /// [IoCommerceTransport] in a [ResilientCommerceTransport] (MR-16), so
  /// timeout/retry protection applies to every real request without any
  /// call site opting in. Tests always inject a fake transport directly
  /// (bypassing timeout/retry entirely, which is correct — they exercise
  /// [ResilientCommerceTransport] itself in `resilient_transport_test.dart`).
  CommerceClient({
    required this.config,
    required this.sessionStore,
    CommerceTransport? transport,
  }) : _transport = transport ?? ResilientCommerceTransport(IoCommerceTransport());

  /// Sets the `Accept-Language` value every subsequent request sends,
  /// aligning this client with the server's own locale resolution
  /// (`ADR-12`/`COM-MOBILE-I18N-1`: `ar`/`en` supported, `ar` default) —
  /// MR-10's "`Accept-Language` aligned with the existing Commerce API
  /// locale contract". Called by `AwjRuntimeShell` whenever the runtime's
  /// own UI locale changes (MOBILE-RUNTIME-6); never inferred from device
  /// locale on its own, since the app's displayed language and the
  /// language the server replies in must never silently diverge.
  void setLocale(String languageCode) {
    _acceptLanguage = languageCode;
  }

  // -- Storefront / Catalog / Media (read tier, no cart/customer identity) --

  Future<CommerceStorefront> getStorefront() async {
    final envelope = await _send(CommerceHttpMethod.get, const ['storefront']);
    return parseStorefrontResponse(envelope);
  }

  Future<List<CommerceCategory>> listCategories() async {
    final envelope = await _send(CommerceHttpMethod.get, const ['categories']);
    return parseCategoryListResponse(envelope);
  }

  Future<CommerceCategory> getCategory(String id) async {
    final envelope = await _send(CommerceHttpMethod.get, ['categories', id]);
    return parseCategoryResponse(envelope);
  }

  Future<CommerceProductPage> listProducts({
    int? page,
    int? perPage,
    String? search,
    String? categoryId,
    String? sort,
  }) async {
    final envelope = await _send(
      CommerceHttpMethod.get,
      const ['products'],
      query: {
        'page': ?page?.toString(),
        'per_page': ?perPage?.toString(),
        'search': ?search,
        'category_id': ?categoryId,
        'sort': ?sort,
      },
    );
    return parseProductListResponse(envelope);
  }

  Future<CommerceProductDetail> getProduct(String id) async {
    final envelope = await _send(CommerceHttpMethod.get, ['products', id]);
    return parseProductDetailResponse(envelope);
  }

  /// The `/media/{id}` route streams raw bytes (never a JSON envelope) — a
  /// UI layer renders it directly as an authenticated image request rather
  /// than going through this client's JSON envelope path. Building that
  /// request (attaching the same store-bearer `Authorization` header this
  /// client uses) is MOBILE-RUNTIME-5's concern, once there is an actual
  /// `Image` widget to wire it into.
  Uri mediaUri(String id) => config.baseUrl.replace(
    pathSegments: [...config.baseUrl.pathSegments, 'media', id],
  );

  // -- Cart (write tier; optional customer identity, cart-token session) ---

  Future<CommerceCart> getCart() async {
    final envelope = await _send(CommerceHttpMethod.get, const [
      'cart',
    ], customerTokenPolicy: _CustomerTokenPolicy.optional);
    return parseCartResponse(envelope);
  }

  Future<CommerceCart> addCartItem({
    required String productId,
    String? productVariantId,
    String? unitKey,
    required int quantity,
  }) async {
    final envelope = await _send(
      CommerceHttpMethod.post,
      const ['cart', 'items'],
      customerTokenPolicy: _CustomerTokenPolicy.optional,
      body: {
        'product_id': productId,
        'product_variant_id': ?productVariantId,
        'unit_key': ?unitKey,
        'quantity': quantity,
      },
    );
    return parseCartResponse(envelope);
  }

  Future<CommerceCart> updateCartItem({
    required String itemId,
    required int quantity,
  }) async {
    final envelope = await _send(
      CommerceHttpMethod.patch,
      ['cart', 'items', itemId],
      customerTokenPolicy: _CustomerTokenPolicy.optional,
      body: {'quantity': quantity},
    );
    return parseCartResponse(envelope);
  }

  Future<CommerceCart> removeCartItem({required String itemId}) async {
    final envelope = await _send(CommerceHttpMethod.delete, [
      'cart',
      'items',
      itemId,
    ], customerTokenPolicy: _CustomerTokenPolicy.optional);
    return parseCartResponse(envelope);
  }

  // -- Auth (sensitive tier: no session identity yet) -----------------------

  /// Always resolves to `verification_required` (true for both a new and an
  /// already-registered email) — no account-existence enumeration, per the
  /// contract's own documented behavior. Returns no token: registration
  /// alone never authenticates.
  Future<bool> registerCustomer({
    required String displayName,
    required String email,
    String? phone,
    required String password,
  }) async {
    final envelope = await _send(
      CommerceHttpMethod.post,
      const ['auth', 'register'],
      customerTokenPolicy: _CustomerTokenPolicy.none,
      body: {
        'display_name': displayName,
        'email': email,
        'phone': ?phone,
        'password': password,
      },
    );
    return parseRegisterResponse(envelope);
  }

  /// On success, persists the returned `customer:access` token into
  /// [SecureSessionStore] and returns only the customer identity — the raw
  /// token itself never leaves this client (MR-07).
  Future<CommerceCustomerIdentity> loginCustomer({
    required String email,
    required String password,
  }) async {
    final envelope = await _send(
      CommerceHttpMethod.post,
      const ['auth', 'login'],
      customerTokenPolicy: _CustomerTokenPolicy.none,
      body: {'email': email, 'password': password},
    );
    final result = parseTokenAuthResponse(envelope);
    await sessionStore.writeCustomerToken(result.token);
    return result.customer;
  }

  Future<bool> requestOtp({required String phone}) async {
    final envelope = await _send(
      CommerceHttpMethod.post,
      const ['auth', 'otp', 'request'],
      customerTokenPolicy: _CustomerTokenPolicy.none,
      body: {'phone': phone},
    );
    return parseOtpRequestResponse(envelope);
  }

  /// Same session-persistence contract as [loginCustomer].
  Future<CommerceCustomerIdentity> verifyOtp({
    required String phone,
    required String code,
  }) async {
    final envelope = await _send(
      CommerceHttpMethod.post,
      const ['auth', 'otp', 'verify'],
      customerTokenPolicy: _CustomerTokenPolicy.none,
      body: {'phone': phone, 'code': code},
    );
    final result = parseTokenAuthResponse(envelope);
    await sessionStore.writeCustomerToken(result.token);
    return result.customer;
  }

  // -- Customer-required tier -------------------------------------------

  /// Revokes the stored token server-side, then clears it locally. If the
  /// server call fails, the local token is deliberately **not** cleared —
  /// an unreachable server should not silently strand the app in a "logged
  /// out locally, still valid server-side" state; the caller may retry.
  Future<void> logoutCustomer() async {
    await _send(CommerceHttpMethod.post, const [
      'auth',
      'logout',
    ], customerTokenPolicy: _CustomerTokenPolicy.required);
    await sessionStore.writeCustomerToken(null);
  }

  Future<CommerceMeProfile> getMe() async {
    final envelope = await _send(CommerceHttpMethod.get, const [
      'me',
    ], customerTokenPolicy: _CustomerTokenPolicy.required);
    return parseMeResponse(envelope);
  }

  // -- Request plumbing -------------------------------------------------

  Future<Map<String, Object?>> _send(
    CommerceHttpMethod method,
    List<String> pathSegments, {
    Map<String, String>? query,
    Map<String, Object?>? body,
    _CustomerTokenPolicy customerTokenPolicy = _CustomerTokenPolicy.none,
  }) async {
    final headers = <String, String>{
      'Authorization': 'Bearer ${config.storeBearerToken}',
      'Accept': 'application/json',
      'Accept-Language': _acceptLanguage,
    };

    final cartToken = await sessionStore.readCartToken();
    if (cartToken != null) headers['X-Cart-Token'] = cartToken;

    switch (customerTokenPolicy) {
      case _CustomerTokenPolicy.none:
        break;
      case _CustomerTokenPolicy.optional:
        final token = await sessionStore.readCustomerToken();
        if (token != null) headers['X-Customer-Token'] = token;
      case _CustomerTokenPolicy.required:
        final token = await sessionStore.readCustomerToken();
        if (token == null) throw const MissingCustomerSessionException();
        headers['X-Customer-Token'] = token;
    }

    String? encodedBody;
    if (body != null) {
      headers['Content-Type'] = 'application/json';
      encodedBody = jsonEncode(body);
    }

    final basePathSegments = config.baseUrl.pathSegments.where(
      (s) => s.isNotEmpty,
    );
    final uri = config.baseUrl.replace(
      pathSegments: [...basePathSegments, ...pathSegments],
      queryParameters: (query == null || query.isEmpty) ? null : query,
    );

    final response = await _transport.send(
      CommerceHttpRequest(
        method: method,
        uri: uri,
        headers: headers,
        body: encodedBody,
      ),
    );

    final newCartToken =
        response.headers['X-Cart-Token'] ?? response.headers['x-cart-token'];
    if (newCartToken != null) {
      await sessionStore.writeCartToken(newCartToken);
    }

    final decoded = response.body.isEmpty
        ? <String, Object?>{}
        : jsonDecode(response.body);
    if (decoded is! Map) {
      throw CommerceProtocolException(
        'response body was not a JSON object',
        statusCode: response.statusCode,
      );
    }
    final envelope = decoded.cast<String, Object?>();

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return envelope;
    }

    final errorRaw = envelope['error'];
    if (errorRaw is! Map) {
      throw CommerceProtocolException(
        'error response missing "error" object',
        statusCode: response.statusCode,
      );
    }
    final error = errorRaw.cast<String, Object?>();
    final codeRaw = error['code'];
    final messageRaw = error['message'];
    final metaRaw = envelope['meta'];
    final requestId = (metaRaw is Map)
        ? metaRaw['request_id'] as String?
        : null;

    final exception = CommerceApiException(
      statusCode: response.statusCode,
      code: codeRaw is String
          ? CommerceErrorCode.fromWire(codeRaw)
          : CommerceErrorCode.unknown,
      message: messageRaw is String ? messageRaw : 'unknown error',
      requestId: requestId,
    );

    // A rejected customer-tier request means the stored token is stale or
    // foreign — drop it locally so the app doesn't keep resending a token
    // the server will never accept, rather than surfacing this as an
    // ordinary retryable error.
    if (response.statusCode == 401 &&
        customerTokenPolicy != _CustomerTokenPolicy.none) {
      await sessionStore.writeCustomerToken(null);
    }

    throw exception;
  }
}
