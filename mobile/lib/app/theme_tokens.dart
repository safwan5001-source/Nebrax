import 'package:flutter/material.dart';

/// This runtime's default brand seed color — used whenever the experience
/// carries no (valid) primary-color token.
const Color kDefaultSeedColor = Color(0xFF0F6A5A);

/// AD-03 (S04a) — the canonical primary-color token is `colorPrimary`; the
/// older web editor wrote `primaryColor`, kept here as a **read-only
/// synonym** (published versions are never rewritten). Order = priority.
const List<String> kPrimaryColorTokenKeys = ['colorPrimary', 'primaryColor'];

final RegExp _hex6 = RegExp(r'^#([0-9a-fA-F]{6})$');

/// First *valid* `#RRGGBB` among [kPrimaryColorTokenKeys], else
/// [kDefaultSeedColor]. Never throws: a theme is presentation-only and must
/// never be able to crash app boot (same posture as `component_widgets.dart`).
Color seedColorFromTokens(Map<String, String>? tokens) {
  if (tokens == null) return kDefaultSeedColor;
  for (final key in kPrimaryColorTokenKeys) {
    final raw = tokens[key];
    if (raw == null) continue;
    final digits = _hex6.firstMatch(raw.trim())?.group(1);
    if (digits != null) return Color(int.parse('FF$digits', radix: 16));
  }
  return kDefaultSeedColor;
}

/// The Material 3 theme for an experience's `theme.tokens` (`null` = no live
/// experience yet / Default AWJ Experience → the brand default).
ThemeData themeDataFor(Map<String, String>? tokens) {
  return ThemeData(colorSchemeSeed: seedColorFromTokens(tokens), useMaterial3: true);
}
