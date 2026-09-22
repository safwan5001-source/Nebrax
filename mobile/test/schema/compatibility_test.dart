import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_schemas.dart';

CapabilityManifest manifestOf({
  RuntimePlatform platform = RuntimePlatform.ios,
  String runtimeVersion = '1.0.0',
  String minSchema = '1.0.0',
  String maxSchema = '1.0.0',
  Map<String, int>? components,
  Map<String, int>? actions,
}) {
  return CapabilityManifest(
    platform: platform,
    runtimeVersion: SchemaVersion.parse(runtimeVersion),
    minSupportedSchemaVersion: SchemaVersion.parse(minSchema),
    maxSupportedSchemaVersion: SchemaVersion.parse(maxSchema),
    components: components ?? RuntimeCapabilities.components,
    actions: actions ?? RuntimeCapabilities.actions,
  );
}

void main() {
  const resolver = CompatibilityResolver();

  group('CompatibilityResolver — compatible cases', () {
    test('current schema + current runtime renders fully with no fallbacks', () {
      final schema = AppSchema.parse(encodeSchema(baseSchemaJson()));
      final result = resolver.resolve(schema, CapabilityManifest.current(RuntimePlatform.ios));

      expect(result, isA<RenderableExperience>());
      final renderable = result as RenderableExperience;
      expect(renderable.fallbacks, isEmpty);
      expect(renderable.pages['home']!.children, hasLength(2));
    });

    test('an older but still-supported schema renders on a wider-range runtime', () {
      final schema = AppSchema.parse(encodeSchema(baseSchemaJson(schemaVersion: '1.0.0')));
      final manifest = manifestOf(minSchema: '1.0.0', maxSchema: '2.0.0');

      expect(resolver.resolve(schema, manifest), isA<RenderableExperience>());
    });

    test('new runtime + older Experience remains compatible', () {
      final schema = AppSchema.parse(encodeSchema(baseSchemaJson(schemaVersion: '1.0.0')));
      final newerManifest = manifestOf(runtimeVersion: '3.0.0', minSchema: '1.0.0', maxSchema: '3.0.0');

      expect(resolver.resolve(schema, newerManifest), isA<RenderableExperience>());
    });

    test('an older runtime can still render a schema that only needs what it supports', () {
      final schema = AppSchema.parse(encodeSchema(baseSchemaJson()));
      final olderManifest = manifestOf(
        components: {
          ...RuntimeCapabilities.components,
        }..remove('VariantSelector'), // this schema never uses VariantSelector.
      );

      expect(resolver.resolve(schema, olderManifest), isA<RenderableExperience>());
    });
  });

  group('CompatibilityResolver — optional-component fallback', () {
    test('an unsupported optional component is omitted, rest of the page renders', () {
      final json = baseSchemaJson(
        pageOverride: componentNode(
          type: 'Page',
          id: 'home-root',
          children: [
            componentNode(type: 'FutureWidget', id: 'not-yet-supported', optional: true),
            componentNode(type: 'ProductList', id: 'featured'),
          ],
        ),
      );
      final schema = AppSchema.parse(encodeSchema(json));
      final result = resolver.resolve(schema, CapabilityManifest.current(RuntimePlatform.ios));

      expect(result, isA<RenderableExperience>());
      final renderable = result as RenderableExperience;
      expect(renderable.fallbacks, hasLength(1));
      expect(renderable.fallbacks.single.componentId, 'not-yet-supported');
      expect(renderable.pages['home']!.children, hasLength(1));
      expect(renderable.pages['home']!.children.single.id, 'featured');
    });

    test('an unsupported optional action is omitted along with its component', () {
      final json = baseSchemaJson(
        pageOverride: componentNode(
          type: 'Page',
          id: 'home-root',
          children: [
            componentNode(
              type: 'Button',
              id: 'buy-now',
              optional: true,
              action: {'type': 'buyNow', 'params': {}},
            ),
          ],
        ),
      );
      final schema = AppSchema.parse(encodeSchema(json));
      final result = resolver.resolve(schema, CapabilityManifest.current(RuntimePlatform.ios));

      expect(result, isA<RenderableExperience>());
      expect((result as RenderableExperience).fallbacks.single.componentId, 'buy-now');
    });
  });

  group('CompatibilityResolver — fail-closed cases', () {
    test('an unsupported required component fails the whole document closed', () {
      final json = baseSchemaJson(
        pageOverride: componentNode(
          type: 'Page',
          id: 'home-root',
          children: [componentNode(type: 'FutureWidget', id: 'must-have')],
        ),
      );
      final schema = AppSchema.parse(encodeSchema(json));
      final result = resolver.resolve(schema, CapabilityManifest.current(RuntimePlatform.ios));

      expect(result, isA<IncompatibleExperience>());
      expect(
        (result as IncompatibleExperience).reason,
        IncompatibilityReason.missingRequiredCapability,
      );
    });

    test('an unsupported required action fails the whole document closed', () {
      final json = baseSchemaJson(
        pageOverride: componentNode(
          type: 'Page',
          id: 'home-root',
          children: [
            componentNode(type: 'Button', id: 'buy-now', action: {'type': 'buyNow', 'params': {}}),
          ],
        ),
      );
      final schema = AppSchema.parse(encodeSchema(json));
      final result = resolver.resolve(schema, CapabilityManifest.current(RuntimePlatform.ios));

      expect(result, isA<IncompatibleExperience>());
    });

    test('a schema newer than the runtime supports is rejected (schemaVersionTooNew)', () {
      final schema = AppSchema.parse(encodeSchema(baseSchemaJson(schemaVersion: '2.0.0')));
      final manifest = manifestOf(minSchema: '1.0.0', maxSchema: '1.0.0');

      final result = resolver.resolve(schema, manifest);
      expect(result, isA<IncompatibleExperience>());
      expect((result as IncompatibleExperience).reason, IncompatibilityReason.schemaVersionTooNew);
    });

    test('a schema older than the runtime supports is rejected (schemaVersionTooOld)', () {
      final schema = AppSchema.parse(encodeSchema(baseSchemaJson(schemaVersion: '1.0.0')));
      final manifest = manifestOf(minSchema: '2.0.0', maxSchema: '3.0.0');

      final result = resolver.resolve(schema, manifest);
      expect(result, isA<IncompatibleExperience>());
      expect((result as IncompatibleExperience).reason, IncompatibilityReason.schemaVersionTooOld);
    });

    test('a schema requiring a newer runtime than installed is rejected (runtimeTooOld)', () {
      final schema = AppSchema.parse(encodeSchema(baseSchemaJson(minRuntimeVersion: '2.0.0')));
      final manifest = manifestOf(runtimeVersion: '1.0.0', minSchema: '1.0.0', maxSchema: '2.0.0');

      final result = resolver.resolve(schema, manifest);
      expect(result, isA<IncompatibleExperience>());
      expect((result as IncompatibleExperience).reason, IncompatibilityReason.runtimeTooOld);
    });

    test('a missing named required capability is rejected', () {
      final schema = AppSchema.parse(
        encodeSchema(baseSchemaJson(requiredCapabilities: {'commerce.notYetShipped': 1})),
      );
      final result = resolver.resolve(schema, CapabilityManifest.current(RuntimePlatform.ios));

      expect(result, isA<IncompatibleExperience>());
      expect(
        (result as IncompatibleExperience).reason,
        IncompatibilityReason.missingRequiredCapability,
      );
    });

    test('an old runtime with an unsupported required component fails closed', () {
      final schema = AppSchema.parse(encodeSchema(baseSchemaJson())); // uses ProductList, required.
      final oldManifest = manifestOf(
        components: {...RuntimeCapabilities.components}..remove('ProductList'),
      );

      expect(resolver.resolve(schema, oldManifest), isA<IncompatibleExperience>());
    });
  });

  group('CompatibilityResolver — iOS/Android capability divergence', () {
    test('the same schema can be compatible on one platform and not the other', () {
      final json = baseSchemaJson(
        pageOverride: componentNode(
          type: 'Page',
          id: 'home-root',
          children: [
            componentNode(
              type: 'AddToCart',
              id: 'add-to-cart',
              action: {'type': 'addToCart', 'params': {}},
            ),
          ],
        ),
      );
      final schema = AppSchema.parse(encodeSchema(json));

      final iosManifest = CapabilityManifest.current(RuntimePlatform.ios);
      final androidManifestMissingAddToCart = manifestOf(
        platform: RuntimePlatform.android,
        components: {...RuntimeCapabilities.components}..remove('AddToCart'),
      );

      expect(resolver.resolve(schema, iosManifest), isA<RenderableExperience>());
      expect(
        resolver.resolve(schema, androidManifestMissingAddToCart),
        isA<IncompatibleExperience>(),
      );
    });
  });

  group('selectRollbackTarget', () {
    test('selects the newest compatible candidate, skipping an incompatible newer one', () {
      final compatibleOld = AppSchema.parse(encodeSchema(baseSchemaJson(schemaVersion: '1.0.0')));
      final incompatibleNew = AppSchema.parse(encodeSchema(baseSchemaJson(schemaVersion: '5.0.0')));
      final manifest = manifestOf(minSchema: '1.0.0', maxSchema: '1.0.0');

      final selected = selectRollbackTarget([incompatibleNew, compatibleOld], manifest);

      expect(selected, isNotNull);
      expect(selected!.schemaVersion, const SchemaVersion(1, 0, 0));
    });

    test('returns null when nothing in the candidate list is compatible', () {
      final incompatibleOnly = AppSchema.parse(encodeSchema(baseSchemaJson(schemaVersion: '9.0.0')));
      final manifest = manifestOf(minSchema: '1.0.0', maxSchema: '1.0.0');

      expect(selectRollbackTarget([incompatibleOnly], manifest), isNull);
    });
  });
}
