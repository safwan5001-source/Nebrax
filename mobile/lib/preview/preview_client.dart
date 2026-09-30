import 'dart:convert';

import '../commerce/commerce_error.dart' show CommerceTransportException;
import '../commerce/commerce_transport.dart';
import '../commerce/resilient_transport.dart';
import 'preview_config.dart';
import 'preview_fetch_outcome.dart';

/// Typed client for the `preview/v1` surface (MOBILE-PREVIEW-6) —
/// structurally the smallest possible client: exactly one method, no
/// cart/customer/session-token plumbing at all, because `preview/v1`
/// exposes exactly one read
/// (`docs/plans/app-builder/MOBILE-PREVIEW-5-SECURITY-ARCHITECTURE.md` §9's
/// data-access matrix — nothing else is reachable through this credential).
///
/// Reuses [CommerceTransport]/[IoCommerceTransport]/[ResilientCommerceTransport]
/// unmodified — the transport boundary was already generic HTTP plumbing
/// with no Commerce-specific auth baked in, so this is real reuse, not a
/// parallel copy of `commerce_client.dart`'s request machinery.
class PreviewClient {
  final PreviewConfig config;
  final CommerceTransport _transport;

  PreviewClient({required this.config, CommerceTransport? transport})
    : _transport = transport ?? ResilientCommerceTransport(IoCommerceTransport());

  Future<PreviewFetchOutcome> fetchExperience() async {
    final CommerceHttpResponse response;
    try {
      final basePathSegments = config.baseUrl.pathSegments.where((s) => s.isNotEmpty);
      response = await _transport.send(
        CommerceHttpRequest(
          method: CommerceHttpMethod.get,
          uri: config.baseUrl.replace(pathSegments: [...basePathSegments, 'experience']),
          headers: {
            'Authorization': 'Bearer ${config.sessionToken}',
            'Accept': 'application/json',
          },
        ),
      );
    } on CommerceTransportException {
      return const PreviewFetchUnavailable('transport_error');
    } catch (_) {
      return const PreviewFetchUnavailable('unknown_error');
    }

    final Object? decoded;
    try {
      decoded = response.body.isEmpty ? <String, Object?>{} : jsonDecode(response.body);
    } catch (_) {
      return const PreviewFetchUnavailable('protocol_error');
    }
    if (decoded is! Map) {
      return const PreviewFetchUnavailable('protocol_error');
    }
    final envelope = decoded.cast<String, Object?>();

    // §5.15: expired/revoked/unknown are structurally indistinguishable —
    // this client neither receives nor infers which one it was.
    if (response.statusCode == 401) {
      return const PreviewFetchUnauthorized();
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return PreviewFetchUnavailable('http_${response.statusCode}');
    }

    final data = envelope['data'];
    if (data is! Map) {
      return const PreviewFetchUnavailable('protocol_error');
    }
    final map = data.cast<String, Object?>();
    final schema = map['schema'];
    if (schema is! Map) {
      return const PreviewFetchUnavailable('protocol_error');
    }

    final draftRevisionRaw = map['draft_revision'];
    final expiresAtRaw = map['expires_at'];

    return PreviewFetchSucceeded(
      rawSchemaJson: jsonEncode(schema),
      draftRevision: draftRevisionRaw is int ? draftRevisionRaw : null,
      draftChanged: map['draft_changed'] == true,
      expiresAt: expiresAtRaw is String ? DateTime.tryParse(expiresAtRaw) : null,
    );
  }
}
