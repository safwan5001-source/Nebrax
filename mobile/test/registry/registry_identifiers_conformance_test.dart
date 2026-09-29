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
}
