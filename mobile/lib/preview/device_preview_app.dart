import 'dart:async' show unawaited;

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'preview_client.dart';
import 'preview_config.dart';
import 'preview_deep_link_channel.dart';
import 'preview_exchange_client.dart';
import 'preview_exchange_outcome.dart';
import 'preview_runtime_view.dart';

/// The merchant-usable physical-device preview entry point's own state
/// machine (MOBILE-PREVIEW-7) — exhaustive and closed, matching MOBILE-
/// PREVIEW-6's own "honest controlled state, never a silent fallback"
/// discipline (`PreviewFetchOutcome`/`PreviewStartupDecision`).
enum DevicePreviewPhase { waitingForLink, exchanging, ready, invalid, unavailable }

/// Root widget for `main_device_preview.dart` — receives the approved deep
/// link, extracts the one-time exchange reference, exchanges it over HTTPS
/// for a real `PreviewSession` bearer, and hands off to the **same**
/// [PreviewRuntimeView]/[PreviewClient] MOBILE-PREVIEW-6 already ships
/// (via a [PreviewConfig] built from the exchanged bearer at runtime,
/// instead of MOBILE-PREVIEW-6's `--dart-define` developer path). Never
/// forks the preview runtime contract: this widget's only job is turning
/// "a scanned link" into a working [PreviewConfig] — rendering itself stays
/// entirely [PreviewRuntimeView]'s.
///
/// The exchanged bearer is held only in memory for the lifetime of this
/// widget/app session — it is never written back into a URI, `SharedPreferences`,
/// or any log line; [PreviewExchangeClient] itself never places it in a
/// query string either (§5.10, RFC 6750 §5).
class AwjDevicePreviewApp extends StatefulWidget {
  /// The `/preview/v1` base URL this build talks to.
  final Uri baseUrl;

  /// Test-only overrides — production code always uses the real channel/
  /// client built from [baseUrl].
  final PreviewDeepLinkController? deepLinkController;
  final PreviewExchangeClient? exchangeClient;
  final PreviewClient? previewClientOverride;

  const AwjDevicePreviewApp({
    super.key,
    required this.baseUrl,
    this.deepLinkController,
    this.exchangeClient,
    this.previewClientOverride,
  });

  @override
  State<AwjDevicePreviewApp> createState() => _AwjDevicePreviewAppState();
}

class _AwjDevicePreviewAppState extends State<AwjDevicePreviewApp> {
  late final PreviewDeepLinkController _deepLinks;
  late final PreviewExchangeClient _exchangeClient;
  DevicePreviewPhase _phase = DevicePreviewPhase.waitingForLink;
  PreviewClient? _client;

  @override
  void initState() {
    super.initState();
    _exchangeClient = widget.exchangeClient ?? PreviewExchangeClient(baseUrl: widget.baseUrl);
    _deepLinks = widget.deepLinkController ?? PreviewDeepLinkController(onReference: _onReference);
    _deepLinks.start();
  }

  void _onReference(String reference) {
    // A second link while one is already in flight/succeeded never
    // re-triggers — the exchange reference is one-time by contract (§8),
    // and a stray duplicate delivery must never re-exchange it or reset an
    // already-rendered preview.
    if (_phase == DevicePreviewPhase.exchanging || _phase == DevicePreviewPhase.ready) {
      return;
    }
    setState(() => _phase = DevicePreviewPhase.exchanging);
    unawaited(_exchange(reference));
  }

  Future<void> _exchange(String reference) async {
    final outcome = await _exchangeClient.exchange(reference);
    if (!mounted) return;

    if (outcome is PreviewExchangeSucceeded) {
      setState(() {
        _client = widget.previewClientOverride ??
            PreviewClient(
              config: PreviewConfig(baseUrl: widget.baseUrl, sessionToken: outcome.sessionToken),
            );
        _phase = DevicePreviewPhase.ready;
      });
      return;
    }
    if (outcome is PreviewExchangeInvalid) {
      setState(() => _phase = DevicePreviewPhase.invalid);
      return;
    }
    setState(() => _phase = DevicePreviewPhase.unavailable);
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AWJ — معاينة',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorSchemeSeed: const Color(0xFF0F6A5A), useMaterial3: true),
      locale: const Locale('ar'),
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const [Locale('ar'), Locale('en')],
      builder: (context, child) => Directionality(textDirection: TextDirection.rtl, child: child!),
      home: Scaffold(
        appBar: AppBar(title: const Text('معاينة — أَوْج')),
        body: _body(),
      ),
    );
  }

  Widget _body() {
    switch (_phase) {
      case DevicePreviewPhase.waitingForLink:
        return const _StatusView(
          icon: Icons.qr_code_scanner,
          message: 'امسح رمز الاستجابة السريعة من لوحة تحكّم المتجر لبدء المعاينة.',
        );
      case DevicePreviewPhase.exchanging:
        return const _StatusView(icon: null, message: 'جارٍ الاتصال…', showSpinner: true);
      case DevicePreviewPhase.ready:
        return PreviewRuntimeView(client: _client);
      case DevicePreviewPhase.invalid:
        return const _StatusView(
          icon: Icons.error_outline,
          message: 'هذا الرمز لم يعد صالحاً. اطلب رمزاً جديداً من لوحة التحكّم وأعد المسح.',
        );
      case DevicePreviewPhase.unavailable:
        return const _StatusView(
          icon: Icons.wifi_off,
          message: 'تعذّر الاتصال بخدمة المعاينة حالياً.',
        );
    }
  }
}

class _StatusView extends StatelessWidget {
  final IconData? icon;
  final String message;
  final bool showSpinner;

  const _StatusView({required this.icon, required this.message, this.showSpinner = false});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (showSpinner)
              const CircularProgressIndicator()
            else if (icon != null)
              Icon(icon, size: 48),
            const SizedBox(height: 16),
            Text(message, textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }
}
