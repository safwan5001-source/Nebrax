import 'package:flutter/widgets.dart';

import '../commerce/commerce.dart';
import '../schema/schema.dart';
import 'binding_resolution.dart';
import 'runtime_strings.dart';

/// Adds a synthesized `display_name` to each raw product item — whichever of
/// `name`/`name_en` matches [locale], via `localizedProductName`, the one
/// rule every screen shares. The generic `$item.*` mechanism has no per-locale
/// logic of its own (Decision Gate: no arbitrary expressions), so the locale
/// pick happens screen-side on the raw data before `resolveNodeBindings`.
List<Object?> localizeProductItems(List<Object?> rawProducts, Locale locale) {
  return [
    for (final entry in rawProducts)
      if (entry is Map)
        {
          ...entry.cast<String, Object?>(),
          'display_name': localizedProductName(
            entry['name'] is String ? entry['name'] as String : '',
            entry['name_en'] is String ? entry['name_en'] as String : null,
            locale,
          ),
        },
  ];
}

/// S06a — fetches, once each, every distinct data request the bindings under
/// [page] need (`commerce.products` per distinct sanitized query, and
/// `commerce.cart`), keyed by [bindingDataKey]. A page with no bindings
/// returns an empty map without touching the network. Any failure propagates
/// to the caller (the screen shows its retry state) — never partial data.
Future<Map<String, Object?>> fetchPageBindingData(CommerceClient client, SchemaComponent page) async {
  final requests = [
    ...collectBindingRequests(page, 'commerce.products'),
    ...collectBindingRequests(page, 'commerce.cart'),
  ];
  if (requests.isEmpty) return const {};
  final fetched = await Future.wait([
    for (final request in requests)
      client.fetchBindingResource(request.resource, query: request.query.isEmpty ? null : request.query),
  ]);
  return {for (var i = 0; i < requests.length; i++) requests[i].key: fetched[i]};
}
