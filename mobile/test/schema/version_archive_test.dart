import 'dart:convert';
import 'dart:io';

import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:flutter_test/flutter_test.dart';

/// CPT-05 / AD-02 — «أرشيف نسخ» على جانب Dart: الوثائق المجمَّدة المشتركة مع PHP
/// (`contracts/app-builder/archive/`) يجب أن تُحلَّل وتُحسَم توافقياً بالنتيجة المسجَّلة نفسها **للأبد**، فلا ميزة جديدة تكسر
/// نسخة سبق نشرها. لا تُعدَّل وثيقة قائمة أبداً؛ يُضاف ملف جديد لكل شكل جديد.
void main() {
  const root = '../contracts/app-builder/archive';
  final indexFile = File('$root/index.v1.json');
  if (!indexFile.existsSync()) {
    throw StateError('Archive index not found at "$root" (resolved from ${Directory.current.path}). `flutter test` must run from `mobile/`.');
  }
  final index = jsonDecode(indexFile.readAsStringSync()) as Map<String, Object?>;
  final versions = (index['versions'] as List).cast<Map<String, Object?>>();

  CapabilityManifest manifestFor(String runtime) {
    final current = CapabilityManifest.current(RuntimePlatform.android);
    switch (runtime) {
      case '1.1.0':
        expect(current.runtimeVersion.toString(), '1.1.0');
        return current;
      case '1.0.0':
        // الجيل 1.0.0 كما كان تماماً: بلا ميزتي الغلاف (AD-04) — يُبنى صراحةً لأن `current` صار 1.1.0.
        return CapabilityManifest(
          platform: RuntimePlatform.android,
          runtimeVersion: const SchemaVersion(1, 0, 0),
          minSupportedSchemaVersion: current.minSupportedSchemaVersion,
          maxSupportedSchemaVersion: current.maxSupportedSchemaVersion,
          components: current.components,
          actions: current.actions,
          nativeCapabilities: current.nativeCapabilities,
          dataResources: current.dataResources,
          schemaFeatures: {
            for (final e in current.schemaFeatures.entries)
              if (e.key != NavigationShell.featureTabs && e.key != NavigationShell.featureAppBar) e.key: e.value,
          },
        );
    }
    fail('جيل Runtime غير معروف: $runtime — أضف manifest الجيل الجديد هنا');
  }

  test('the archive index is well formed', () {
    expect(index['contract'], 'app-builder.version-archive');
    expect(versions, isNotEmpty);
  });

  for (final entry in versions) {
    final file = entry['file']! as String;
    final expect_ = (entry['expect']! as Map).cast<String, Object?>();

    test('$file still parses and resolves exactly as recorded', () {
      final raw = File('$root/$file').readAsStringSync();
      final schema = AppSchema.parse(raw); // لا استثناء: يُحلَّل للأبد

      for (final runtime in expect_.keys) {
        final outcome = (expect_[runtime]! as Map).cast<String, Object?>();
        final result = const CompatibilityResolver().resolve(schema, manifestFor(runtime));

        expect(result is RenderableExperience, outcome['compatible'], reason: '$file @ $runtime: التوافق تغيّر');
        if (result is RenderableExperience) {
          expect(
            result.fallbacks.map((f) => f.componentId).toList(),
            (outcome['fallbackIds']! as List).cast<String>(),
            reason: '$file @ $runtime: ما يُسقَط تغيّر',
          );
        }
      }
    });
  }
}
