/// LIVE-PREVIEW-2 (`AWJ_APP_BUILDER_LIVE_RUNTIME_PREVIEW_V1.md`) conformance
/// suite.
///
/// Loads the single canonical fixture at
/// `contracts/app-builder/binding-visibility-conformance.v1.json` (relative
/// to this package's root — `mobile-ci.yml` runs `flutter test` with
/// `working-directory: mobile`, matching the convention `flutter test` is
/// always invoked under) and asserts this repository's real
/// `resolveNodeBindings`/`evaluateVisibility` (`app/binding_resolution.dart`
/// — the source of truth) reproduce every case's expected output exactly.
///
/// `web/src/modules/app-builder/runtime-contract.test.ts` asserts the
/// *same* fixture file against the TypeScript port Builder Preview uses.
/// Whenever either implementation's behavior changes without the shared
/// fixture being updated to match, that side's own conformance test fails
/// here or there — this is what makes drift between the two ports
/// detectable rather than merely documented by comment.
library;

import 'dart:convert';
import 'dart:io';

import 'package:awj_mobile_runtime/app/binding_resolution.dart';
import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:flutter_test/flutter_test.dart';

const _fixturePath = '../contracts/app-builder/binding-visibility-conformance.v1.json';

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

/// Wraps an already-JSON-shaped component `node` as the sole child of a bare
/// `Page` root — the only way to obtain a real `SchemaComponent`/
/// `VisibilityNode` is through `AppSchema.parse` (both constructors are
/// library-private by design), exactly like this suite's neighbors
/// (`binding_resolution_test.dart`, `schema_binding_visibility_test.dart`).
String _wrapAsSchemaDocument(Object? node) {
  return jsonEncode({
    'schemaVersion': '1.0.0',
    'minRuntimeVersion': '1.0.0',
    'navigation': {'initialPageId': 'home'},
    'pages': {
      'home': {
        'type': 'Page',
        'id': 'home-root',
        'children': [node],
      },
    },
  });
}

SchemaComponent _parseNode(Object? nodeJson) {
  final schema = AppSchema.parse(_wrapAsSchemaDocument(nodeJson));
  return schema.pages['home']!.children.single;
}

VisibilityNode _parseVisibility(Object? conditionJson) {
  final schema = AppSchema.parse(
    _wrapAsSchemaDocument({'type': 'Button', 'id': 'x', 'visibility': conditionJson}),
  );
  return schema.pages['home']!.children.single.visibility!;
}

/// Serializes a resolved [SchemaComponent] back into the same plain-JSON
/// shape the fixture's `expected` field uses, so `expect(..., equals(...))`
/// can deep-compare them directly. Deliberately narrow: no fixture case
/// exercises a resolved node still carrying `visibility` with nested
/// structure this serializer would need to reproduce, so that field is
/// passed through only as already-decoded JSON (never re-derived), keeping
/// this test-only helper honest about what it actually verifies.
Map<String, Object?> _toComparableJson(SchemaComponent node) {
  final json = <String, Object?>{
    'type': node.type,
    'id': node.id,
    'optional': node.optional,
    'props': node.props,
    'children': node.children.map(_toComparableJson).toList(),
  };
  if (node.action != null) {
    json['action'] = {'type': node.action!.type, 'params': node.action!.params};
  }
  return json;
}

void main() {
  final fixture = _loadFixture();
  final bindingCases = (fixture['bindingCases'] as List)
      .map((entry) => (entry as Map).cast<String, Object?>())
      .toList();
  final visibilityCases = (fixture['visibilityCases'] as List)
      .map((entry) => (entry as Map).cast<String, Object?>())
      .toList();

  group('binding conformance (vs. web/src/modules/app-builder/runtime-contract.ts)', () {
    test('shared fixture is non-empty', () {
      expect(bindingCases, isNotEmpty);
      expect(visibilityCases, isNotEmpty);
    });

    for (final testCase in bindingCases) {
      test(testCase['id'] as String, () {
        final node = _parseNode(testCase['node']);
        final resourceData = (testCase['resourceData'] as Map).cast<String, Object?>();
        final resolved = resolveNodeBindings(node, resourceData);
        expect(_toComparableJson(resolved), equals(testCase['expected']));
      });
    }
  });

  group('visibility conformance (vs. web/src/modules/app-builder/runtime-contract.ts)', () {
    for (final testCase in visibilityCases) {
      test(testCase['id'] as String, () {
        final condition = _parseVisibility(testCase['condition']);
        final signals = (testCase['signals'] as Map).cast<String, Object?>();
        expect(evaluateVisibility(condition, signals), equals(testCase['expected']));
      });
    }
  });
}
