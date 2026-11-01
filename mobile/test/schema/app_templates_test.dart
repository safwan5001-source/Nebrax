import 'dart:convert';
import 'dart:io';

import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:flutter_test/flutter_test.dart';

/// AD-11 / S22a (ONB-04) — كل قالب في سجل الخادم (`resources/app-builder/templates/*.v1.json`) يُحلَّل في Dart ويعمل على الجيل
/// 1.0.0 والحالي بلا إسقاط عقد اختيارية: لا قالب يتضمن عقدة غير مدعومة على الجهاز. الملفات نفسها يقرؤها اختبار PHP.
void main() {
  const dir = '../resources/app-builder/templates';
  final folder = Directory(dir);
  if (!folder.existsSync()) {
    throw StateError('Templates folder not found at "$dir" (resolved from ${Directory.current.path}); run flutter test from mobile/.');
  }
  final files = folder.listSync().whereType<File>().where((f) => f.path.endsWith('.v1.json')).toList()..sort((a, b) => a.path.compareTo(b.path));

  CapabilityManifest legacy() {
    final current = CapabilityManifest.current(RuntimePlatform.android);
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
          if (!e.key.startsWith('navigation.')) e.key: e.value,
      },
    );
  }

  test('there are at least three templates', () => expect(files.length, greaterThanOrEqualTo(3)));

  for (final file in files) {
    final template = jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
    test('${template['key']}: parses and renders on 1.0.0 and the current generation with nothing dropped', () {
      final schema = AppSchema.parse(jsonEncode(template['schema']));
      for (final manifest in [legacy(), CapabilityManifest.current(RuntimePlatform.android)]) {
        final result = const CompatibilityResolver().resolve(schema, manifest);
        expect(result, isA<RenderableExperience>(), reason: '${template['key']} @ ${manifest.runtimeVersion}');
        expect((result as RenderableExperience).fallbacks, isEmpty);
      }
    });
  }
}
