import 'package:flutter/material.dart';

import 'preview/device_preview_app.dart';

/// MOBILE-PREVIEW-7 — the merchant-usable physical-device preview entry
/// point: receives the QR/deep-link's one-time exchange reference,
/// exchanges it for a real `PreviewSession` bearer over HTTPS, then renders
/// the exact same MOBILE-PREVIEW-6 runtime (`PreviewRuntimeView`/
/// `PreviewClient`) — never `main.dart` (the production entry point,
/// untouched by this task) and never `main_preview.dart` (MOBILE-PREVIEW-6's
/// own developer/dart-define entry path, which stays exactly as it was).
///
/// The only compile-time configuration this build needs is the `/preview/v1`
/// base URL — no bearer, since the whole point of this entry point is to
/// obtain one itself from a scanned link:
///
/// ```
/// flutter run -t lib/main_device_preview.dart \
///   --dart-define=PREVIEW_BASE_URL=https://`<host>`/preview/v1
/// ```
void main() {
  const baseUrl = String.fromEnvironment(
    'PREVIEW_BASE_URL',
    defaultValue: 'https://commerce.invalid/preview/v1',
  );
  runApp(AwjDevicePreviewApp(baseUrl: Uri.parse(baseUrl)));
}
