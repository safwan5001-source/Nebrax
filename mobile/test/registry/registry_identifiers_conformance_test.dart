/// MOBILE-PREVIEW-4 (`AWJ_APP_BUILDER_REAL_MOBILE_PREVIEW_HORIZON.md`)
/// conformance suite — Horizon requirement #5 ("Verify Browser Preview
/// coverage against runtime-supported component identifiers... No second
/// independent component contract").
///
/// Loads `contracts/app-builder/registry-identifiers.v1.json` (relative to
/// this package's root — matches `mobile-ci.yml`'s `working-directory: mobile`)
/// and asserts `RuntimeCapabilities.components`/`.actions` (the source of
/// truth this repository ships) match the shared list exactly.
/// `web/src/modules/app-builder/registry-identifiers.test.ts` asserts the
/// *same* fixture against the constants Browser Preview's `canvas.tsx`
/// switch/`action-semantics.ts` are tested against — a future capability
/// bump that edits one side without updating this fixture fails immediately
/// here or there, instead of silently drifting.
library;

import 'dart:convert';
import 'dart:io';

import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:flutter_test/flutter_test.dart';

const _fixturePath = '../contracts/app-builder/registry-identifiers.v1.json';

Map<String, Object?> _loadFixture() {
  final file = File(_fixturePath);
  if (!file.existsSync()) {
    throw StateError(
      'Shared conformance fixture not found at "$_fixturePath" (resolved from '
      '${Directory.current.path}). `flutter test` must be run from the `mobile/` '
      'directory — matches `mobile-ci.yml`\'s `working-directory: mobile`.',
    );
  }
  return jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
}

void main() {
  final fixture = _loadFixture();

  test('RuntimeCapabilities.components matches the shared fixture exactly', () {
    final expected = (fixture['components'] as List).cast<String>().toSet();
    expect(RuntimeCapabilities.components.keys.toSet(), expected);
  });

  test('RuntimeCapabilities.actions matches the shared fixture exactly', () {
    final expected = (fixture['actions'] as List).cast<String>().toSet();
    expect(RuntimeCapabilities.actions.keys.toSet(), expected);
  });

  // AD-02 / S11 — إضافات الجيل 1.2.0 في أقسام `*_v120` من العقد المشترك نفسه (الخادم يختبرها بالمثل).
  test('RuntimeCapabilities.*V120 match the shared fixture exactly', () {
    expect(RuntimeCapabilities.componentsV120.keys.toSet(), (fixture['components_v120'] as List).cast<String>().toSet());
    expect(RuntimeCapabilities.actionsV120.keys.toSet(), (fixture['actions_v120'] as List).cast<String>().toSet());
    expect(RuntimeCapabilities.dataResourcesV120.keys.toSet(), (fixture['dataResources_v120'] as List).cast<String>().toSet());
  });

  test('the shipped manifest is the cumulative 1.2.0 generation: base + V120, nothing leaks into 1.0.0/1.1.0', () {
    final current = CapabilityManifest.current(RuntimePlatform.android);
    expect(current.runtimeVersion.toString(), '1.2.0');
    expect(current.components.keys.toSet(), {...RuntimeCapabilities.components.keys, ...RuntimeCapabilities.componentsV120.keys});
    expect(current.actions.keys.toSet(), {...RuntimeCapabilities.actions.keys, ...RuntimeCapabilities.actionsV120.keys});

    for (final older in ['1.0.0', '1.1.0']) {
      final m = CapabilityManifest.generation(RuntimePlatform.android, older)!;
      expect(m.componentVersion('CategoryList'), isNull, reason: older);
      expect(m.actionVersion('openCategory'), isNull, reason: older);
      expect(m.actionVersion('openSearch'), isNull, reason: older);
      expect(m.resourceVersion('commerce.categories'), isNull, reason: older);
    }
    expect(CapabilityManifest.generation(RuntimePlatform.android, '1.0.0')!.schemaFeatureVersion('navigation.tabs'), isNull);
    expect(CapabilityManifest.generation(RuntimePlatform.android, '1.1.0')!.schemaFeatureVersion('navigation.tabs'), 1);
    expect(CapabilityManifest.generation(RuntimePlatform.android, '9.9.9'), isNull);
  });

  test('CompatibilityResolver.bindableResources matches the shared fixture (PHP ComponentDefinition::bindableResources)', () {
    final expected = (fixture['bindableResources'] as Map).map((k, v) => MapEntry(k as String, (v as List).cast<String>()));
    expect(CompatibilityResolver.bindableResources, expected);
  });

  test('a binding on a component the registry does not allow to bind that resource fails closed (parity with the server)', () {
    // ProductList مربوطة بـ commerce.categories: الخادم يرفضها (غير مسجَّلة للربط) فيجب أن يرفضها الجهاز كذلك لا أن يرندرها صامتاً.
    const resolver = CompatibilityResolver();
    final manifest = CapabilityManifest.generation(RuntimePlatform.android, '1.2.0')!;
    final schema = AppSchema.parse(
      '{"schemaVersion":"1.0.0","minRuntimeVersion":"1.0.0","navigation":{"initialPageId":"home"},"pages":{"home":{"type":"Page","id":"r","children":['
      '{"type":"ProductList","id":"x","binding":{"resource":"commerce.categories","itemProps":{}},"children":[]}]}}}',
    );
    expect(resolver.resolve(schema, manifest), isA<IncompatibleExperience>());
  });
}
