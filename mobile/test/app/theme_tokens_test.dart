import 'package:awj_mobile_runtime/app/theme_tokens.dart';
import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../schema/test_schemas.dart';

/// AD-03 (S04a) — عقد رموز الثيم القانوني على جانب Flutter.
///
/// القواعد المثبَّتة هنا:
///  - الاسم القانوني `colorPrimary` يتقدّم، و`primaryColor` (الويب القديم) **مرادف مقروء فقط**.
///  - يُؤخذ **أول قيمة صالحة** بترتيب (قانوني، مرادف)؛ لا شيء صالح ⇒ لون العلامة الافتراضي. لا استثناء أبداً
///    (الثيم عرضي بحت ولا يجوز أن يكسر الإقلاع).
///  - صيغة `#RRGGBB` فقط (كما كان قبل S04).
///  - مفاتيح رموز **جديدة** مقبولة عند التحليل (الخريطة نصية حرّة)، بينما مفتاح **غير معروف على مستوى `theme`**
///    مرفوض — هذا هو سلوك «المفاتيح الجديدة» الذي يبني عليه AD-02 (S05): الإضافة داخل `tokens` آمنة للأجهزة
///    القديمة، أما إضافة مفتاح في المستوى الأعلى فتتطلب جيل Runtime جديداً.
void main() {
  const fallback = Color(0xFF0F6A5A);

  group('seedColorFromTokens', () {
    test('reads the canonical colorPrimary', () {
      expect(seedColorFromTokens({'colorPrimary': '#1E3A5F'}), const Color(0xFF1E3A5F));
    });

    test('reads the legacy primaryColor as a read-only synonym', () {
      expect(seedColorFromTokens({'primaryColor': '#B45309'}), const Color(0xFFB45309));
    });

    test('the canonical name wins when both are present', () {
      expect(seedColorFromTokens({'colorPrimary': '#1E3A5F', 'primaryColor': '#B45309'}), const Color(0xFF1E3A5F));
    });

    test('an invalid canonical value falls through to a valid legacy synonym (first valid wins)', () {
      expect(seedColorFromTokens({'colorPrimary': 'teal', 'primaryColor': '#B45309'}), const Color(0xFFB45309));
    });

    test('nothing valid (absent, malformed, 3-digit, alpha, empty) falls back to the brand default and never throws', () {
      for (final tokens in <Map<String, String>>[
        {},
        {'colorPrimary': ''},
        {'colorPrimary': '#FFF'},
        {'colorPrimary': '#FF1E3A5F'},
        {'colorPrimary': 'javascript:alert(1)'},
        {'primaryColor': 'red', 'colorPrimary': 'blue'},
      ]) {
        expect(seedColorFromTokens(tokens), fallback, reason: '$tokens');
      }
    });

    test('whitespace around a valid hex is tolerated', () {
      expect(seedColorFromTokens({'colorPrimary': '  #1e3a5f '}), const Color(0xFF1E3A5F));
    });
  });

  group('how the Dart parser treats new theme keys (the AD-02 behaviour this slice relies on)', () {
    Map<String, Object?> withTheme(Map<String, Object?> theme) => baseSchemaJson()..['theme'] = theme;

    test('new keys INSIDE theme.tokens are accepted by this runtime (tokens are a free string map)', () {
      final schema = AppSchema.parse(encodeSchema(withTheme({
        'tokens': {'colorPrimary': '#1E3A5F', 'colorSecondary': '#B45309', 'brightness': 'dark', 'radius.card': '12'},
      })));
      expect(schema.theme.tokens['colorSecondary'], '#B45309');
      expect(schema.theme.tokens['radius.card'], '12');
    });

    test('a new key at the theme level is REJECTED by this runtime (needs a runtime generation, not a token)', () {
      expect(
        () => AppSchema.parse(encodeSchema(withTheme({'tokens': <String, String>{}, 'typography': {'family': 'x'}}))),
        throwsA(isA<SchemaFormatException>()),
      );
    });

    test('non-string token values are rejected', () {
      expect(
        () => AppSchema.parse(encodeSchema(withTheme({'tokens': {'colorPrimary': 5}}))),
        throwsA(isA<SchemaFormatException>()),
      );
    });
  });

  group('themeDataFor', () {
    test('builds a Material 3 theme seeded from the resolved color', () {
      final theme = themeDataFor({'colorPrimary': '#1E3A5F'});
      expect(theme.useMaterial3, isTrue);
      expect(theme.colorScheme.primary, ThemeData(colorSchemeSeed: const Color(0xFF1E3A5F), useMaterial3: true).colorScheme.primary);
    });

    test('null tokens (no live experience) yield the brand default theme', () {
      expect(
        themeDataFor(null).colorScheme.primary,
        ThemeData(colorSchemeSeed: fallback, useMaterial3: true).colorScheme.primary,
      );
    });
  });
}
