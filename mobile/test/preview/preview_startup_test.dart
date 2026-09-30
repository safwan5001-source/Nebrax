import 'package:awj_mobile_runtime/preview/preview.dart';
import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:flutter_test/flutter_test.dart';

import '../schema/test_schemas.dart';

CapabilityManifest _manifest() {
  return CapabilityManifest(
    platform: RuntimePlatform.android,
    runtimeVersion: SchemaVersion.parse('1.0.0'),
    minSupportedSchemaVersion: SchemaVersion.parse('1.0.0'),
    maxSupportedSchemaVersion: SchemaVersion.parse('1.0.0'),
    components: RuntimeCapabilities.components,
    actions: RuntimeCapabilities.actions,
    nativeCapabilities: RuntimeCapabilities.nativeCapabilities,
  );
}

void main() {
  final compatibleJson = encodeSchema(baseSchemaJson(schemaVersion: '1.0.0'));
  final incompatibleJson = encodeSchema(baseSchemaJson(schemaVersion: '9.0.0'));

  group('resolvePreviewStartup — the real CompatibilityResolver decides, not a re-implementation', () {
    test('a compatible fetched snapshot -> PreviewReady, carrying draftChanged through', () {
      final decision = resolvePreviewStartup(
        fetch: PreviewFetchSucceeded(rawSchemaJson: compatibleJson, draftChanged: true),
        manifest: _manifest(),
      );

      expect(decision, isA<PreviewReady>());
      expect((decision as PreviewReady).draftChanged, isTrue);
      expect(decision.experience.pages.containsKey('home'), isTrue);
    });

    test('an incompatible fetched snapshot -> PreviewIncompatible, never rendered', () {
      final decision = resolvePreviewStartup(
        fetch: PreviewFetchSucceeded(rawSchemaJson: incompatibleJson),
        manifest: _manifest(),
      );

      expect(decision, isA<PreviewIncompatible>());
    });

    test('malformed schema bytes -> PreviewIncompatible, same as a real compatibility failure', () {
      final decision = resolvePreviewStartup(
        fetch: const PreviewFetchSucceeded(rawSchemaJson: '{not valid json'),
        manifest: _manifest(),
      );

      expect(decision, isA<PreviewIncompatible>());
    });

    test('PreviewFetchUnauthorized -> PreviewUnauthorized, structurally the only outcome for expired/revoked/unknown', () {
      final decision = resolvePreviewStartup(fetch: const PreviewFetchUnauthorized(), manifest: _manifest());

      expect(decision, isA<PreviewUnauthorized>());
    });

    test('PreviewFetchUnavailable -> PreviewUnavailable, never silently substituting Published/Default', () {
      final decision = resolvePreviewStartup(
        fetch: const PreviewFetchUnavailable('transport_error'),
        manifest: _manifest(),
      );

      expect(decision, isA<PreviewUnavailable>());
    });
  });
}
