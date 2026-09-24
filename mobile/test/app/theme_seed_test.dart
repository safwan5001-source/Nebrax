import 'package:awj_mobile_runtime/app.dart';
import 'package:awj_mobile_runtime/app/runtime_schema.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../schema/test_schemas.dart';

void main() {
  group('themeSeedColorFromSchema', () {
    test('reads a valid colorPrimary hex token as the seed color', () {
      final json = baseSchemaJson();
      json['theme'] = {
        'tokens': {'colorPrimary': '#1E3A5F'},
      };
      final seed = themeSeedColorFromSchema(encodeSchema(json));
      expect(seed, const Color(0xFF1E3A5F));
    });

    test('falls back to the default brand color when colorPrimary is absent', () {
      final json = baseSchemaJson();
      json['theme'] = {'tokens': <String, String>{}};
      final seed = themeSeedColorFromSchema(encodeSchema(json));
      expect(seed, const Color(0xFF0F6A5A));
    });

    test('falls back to the default brand color when colorPrimary is not a hex string', () {
      final json = baseSchemaJson();
      json['theme'] = {
        'tokens': {'colorPrimary': 'not-a-color'},
      };
      final seed = themeSeedColorFromSchema(encodeSchema(json));
      expect(seed, const Color(0xFF0F6A5A));
    });

    test('falls back to the default brand color on a malformed schema', () {
      final seed = themeSeedColorFromSchema('{ not valid json');
      expect(seed, const Color(0xFF0F6A5A));
    });

    test('the runtime\'s actual bundled home schema seeds the app\'s known brand color', () {
      // Guards against silently drifting the literal in `kHomeSchemaJson`
      // out of sync with the app's own documented default.
      expect(themeSeedColorFromSchema(kHomeSchemaJson), const Color(0xFF0F6A5A));
    });
  });
}
