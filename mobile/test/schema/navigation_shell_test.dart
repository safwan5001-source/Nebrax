import 'dart:convert';
import 'dart:io';

import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_schemas.dart';

/// AD-04 / S09a — غلاف التنقل (`navigation.tabs` / `navigation.appBar`). المحلل يطابق PHP حرفياً عبر ملف حالات مشترك،
/// والجيل 1.0.0 (المانيفست الحالي) لا يعلن ميزتي الغلاف فيرفض مخططاً يستعملهما بدل إسقاط التبويبات بصمت.
const _fixturePath = '../contracts/app-builder/navigation-shell.v1.json';

Map<String, Object?> _fixture() {
  final file = File(_fixturePath);
  if (!file.existsSync()) {
    throw StateError('Shared fixture not found at "$_fixturePath" (cwd ${Directory.current.path}); run flutter test from mobile/.');
  }
  return jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
}

String _schemaJson(Map<String, Object?> navigation, List<String> pageIds) {
  final json = baseSchemaJson();
  final pages = json['pages'] as Map<String, Object?>;
  for (final id in pageIds) {
    if (id == 'home') continue;
    pages[id] = componentNode(type: 'Page', id: '$id-root');
  }
  json['navigation'] = {'initialPageId': 'home', ...navigation};
  return encodeSchema(json);
}

CapabilityManifest _manifest({Map<String, int> features = const {}, SchemaVersion version = const SchemaVersion(1, 1, 0)}) => CapabilityManifest(
  platform: RuntimePlatform.android,
  runtimeVersion: version,
  minSupportedSchemaVersion: const SchemaVersion(1, 0, 0),
  maxSupportedSchemaVersion: const SchemaVersion(1, 0, 0),
  components: RuntimeCapabilities.components,
  actions: RuntimeCapabilities.actions,
  nativeCapabilities: RuntimeCapabilities.nativeCapabilities,
  dataResources: RuntimeCapabilities.dataResources,
  schemaFeatures: {
    for (final e in RuntimeCapabilities.schemaFeatures.entries)
      if (!e.key.startsWith('navigation.')) e.key: e.value,
    ...features,
  },
);

void main() {
  final fixture = _fixture();
  final pageIds = (fixture['pages'] as List).cast<String>();
  final limits = fixture['limits'] as Map<String, Object?>;

  test('the Dart constants equal the shared fixture limits', () {
    expect(NavigationShell.tabIcons, (limits['icons'] as List).cast<String>());
    expect(NavigationShell.maxTabs, limits['max_tabs']);
    expect(NavigationShell.maxVisibleTabs, limits['max_visible_tabs']);
    expect(NavigationShell.maxTabTitle, limits['max_tab_title']);
    expect(NavigationShell.maxAppBarTitle, limits['max_app_bar_title']);
    final features = fixture['features'] as Map<String, Object?>;
    expect(NavigationShell.featureTabs, features['tabs']);
    expect(NavigationShell.featureAppBar, features['appBar']);
  });

  for (final raw in (fixture['cases'] as List)) {
    final c = raw as Map<String, Object?>;
    test('parser agrees with PHP: ${c['name']} -> ${c['valid'] == true ? 'valid' : 'invalid'}', () {
      final json = _schemaJson((c['navigation'] as Map).cast<String, Object?>(), pageIds);
      if (c['valid'] == true) {
        expect(() => AppSchema.parse(json), returnsNormally);
      } else {
        expect(() => AppSchema.parse(json), throwsA(isA<SchemaFormatException>()));
      }
    });
  }

  test('a parsed shell exposes visible tabs in order, hidden ones kept but excluded from visibleTabs', () {
    final schema = AppSchema.parse(
      _schemaJson({
        'tabs': [
          {'pageId': 'home', 'title': 'الرئيسية', 'icon': 'home'},
          {'pageId': 'about', 'title': 'عنّا', 'icon': 'menu', 'hidden': true},
          {'pageId': 'shop', 'title': 'المتجر', 'icon': 'store'},
        ],
        'appBar': {'title': 'متجري', 'showCart': true},
      }, pageIds),
    );
    expect(schema.navigation.tabs, hasLength(3));
    expect(schema.navigation.visibleTabs.map((t) => t.pageId), ['home', 'shop']);
    expect(schema.navigation.appBar?.title, 'متجري');
    expect(schema.navigation.appBar?.showCart, isTrue);
  });

  group('compatibility (generation gate)', () {
    final withTabs = _schemaJson({
      'tabs': [
        {'pageId': 'home', 'title': 'ر', 'icon': 'home'},
      ],
    }, pageIds);
    final withBar = _schemaJson({
      'appBar': {'title': 'x'},
    }, pageIds);
    const resolver = CompatibilityResolver();

    test('the 1.0.0 generation cannot render tabs or appBar (fail closed, never drops them)', () {
      final legacy = _manifest(version: const SchemaVersion(1, 0, 0));
      expect(resolver.resolve(AppSchema.parse(withTabs), legacy), isA<IncompatibleExperience>());
      expect(resolver.resolve(AppSchema.parse(withBar), legacy), isA<IncompatibleExperience>());
    });

    test('the current build (1.1.0) renders both', () {
      final current = CapabilityManifest.current(RuntimePlatform.android);
      expect(resolver.resolve(AppSchema.parse(withTabs), current), isA<RenderableExperience>());
      expect(resolver.resolve(AppSchema.parse(withBar), current), isA<RenderableExperience>());
    });

    test('each key is gated by its own feature', () {
      expect(resolver.resolve(AppSchema.parse(withTabs), _manifest(features: {'navigation.tabs': 1})), isA<RenderableExperience>());
      expect(resolver.resolve(AppSchema.parse(withTabs), _manifest(features: {'navigation.appBar': 1})), isA<IncompatibleExperience>());
      expect(resolver.resolve(AppSchema.parse(withBar), _manifest(features: {'navigation.appBar': 1})), isA<RenderableExperience>());
      expect(resolver.resolve(AppSchema.parse(withBar), _manifest(features: {'navigation.tabs': 1})), isA<IncompatibleExperience>());
    });

    test('a schema without the shell is unaffected', () {
      final plain = AppSchema.parse(_schemaJson(const {}, pageIds));
      expect(resolver.resolve(plain, CapabilityManifest.current(RuntimePlatform.android)), isA<RenderableExperience>());
    });
  });
}
