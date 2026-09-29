import 'package:flutter/material.dart';

import 'preview/preview.dart';

/// MOBILE-PREVIEW-6 — the safe development/preview entry point, never the
/// production entry point (`main.dart`/`AwjMobileRuntimeApp`, untouched by
/// this task). Launch explicitly with a real `PreviewSession` bearer:
///
///   flutter run -t lib/main_preview.dart \
///     --dart-define=PREVIEW_SESSION_TOKEN=<raw bearer from the Builder> \
///     --dart-define=PREVIEW_BASE_URL=https://<host>/preview/v1
///
/// An ordinary build (this file not selected as the entry point, or run
/// without those defines) never renders this screen and never even
/// constructs a [PreviewConfig] with a real token — see
/// `preview_config.dart`'s own doc comment.
void main() {
  runApp(const AwjPreviewApp());
}
