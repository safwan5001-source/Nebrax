import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'app/awj_runtime_shell.dart';
import 'app/runtime_schema.dart';
import 'commerce/commerce.dart';
import 'schema/schema.dart';

/// This runtime's default brand seed color — used whenever the bundled
/// schema carries no `theme.tokens.colorPrimary`, or an invalid one.
const Color _kDefaultSeedColor = Color(0xFF0F6A5A);

/// APP-BUILDER-22 — closes the "theme tokens parsed but never read" gap
/// (`AWJ_APP_BUILDER_COMMERCE_RUNTIME_V1_EVIDENCE.md` §11): [AppSchema.theme]
/// was already validated at parse time (MOBILE-RUNTIME-2) but nothing ever
/// consumed it — [ThemeData] used an unrelated hardcoded literal instead.
///
/// Reads `theme.tokens.colorPrimary` from [schemaJson] as the app's Material
/// 3 seed color. Same defensive posture `component_widgets.dart` already
/// uses for schema props: a missing token, a malformed schema, or a value
/// that is not a `#RRGGBB` hex string all fall back to [_kDefaultSeedColor]
/// rather than throwing — a bundled schema's theme is presentation-only and
/// must never be able to crash app boot.
Color themeSeedColorFromSchema(String schemaJson) {
  try {
    final tokens = AppSchema.parse(schemaJson).theme.tokens;
    final hex = tokens['colorPrimary'];
    if (hex == null) return _kDefaultSeedColor;
    final hexDigits = RegExp(r'^#([0-9a-fA-F]{6})$').firstMatch(hex.trim())?.group(1);
    if (hexDigits == null) return _kDefaultSeedColor;
    return Color(int.parse('FF$hexDigits', radix: 16));
  } on SchemaFormatException {
    return _kDefaultSeedColor;
  }
}

/// AWJ Mobile Runtime — root application widget.
///
/// Boots into [AwjRuntimeShell] (MOBILE-RUNTIME-5), which wires the App
/// Schema/compatibility kernel (MOBILE-RUNTIME-2), the Component/Action
/// Registry (MOBILE-RUNTIME-3), and the Commerce client (MOBILE-RUNTIME-4)
/// into real Home/Product/Cart screens.
///
/// MOBILE-RUNTIME-6 makes this widget stateful so it can own the one
/// [Locale] the whole runtime shares — it must live *above* [MaterialApp]
/// to drive `MaterialApp.locale`/`localizationsDelegates`/`supportedLocales`
/// (Flutter's framework localizations, e.g. built-in `Cancel`/`OK` labels
/// where a platform widget shows one) and the [Directionality] every screen
/// renders under. Arabic + RTL remains the default direction per AWJ's
/// project-wide rule ("اللغة: تواصل بالعربية. الواجهات RTL أولاً" —
/// CLAUDE.md); English/LTR is a runtime, in-app toggle
/// (`AwjRuntimeShell`'s app-bar action), never a device-locale-only choice —
/// MR-10 requires the app to carry both, not just follow the OS.
class AwjMobileRuntimeApp extends StatefulWidget {
  /// Test-only override, forwarded to [AwjRuntimeShell].
  final CommerceClient? client;

  const AwjMobileRuntimeApp({super.key, this.client});

  @override
  State<AwjMobileRuntimeApp> createState() => _AwjMobileRuntimeAppState();
}

class _AwjMobileRuntimeAppState extends State<AwjMobileRuntimeApp> {
  Locale _locale = const Locale('ar');

  /// Computed once — [kHomeSchemaJson] is a compile-time bundled constant,
  /// not a per-build value, so re-parsing it on every rebuild (e.g. the
  /// locale toggle) would be pure waste.
  late final Color _seedColor = themeSeedColorFromSchema(kHomeSchemaJson);

  void _onLocaleChanged(Locale locale) {
    setState(() => _locale = locale);
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AWJ Mobile Runtime',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorSchemeSeed: _seedColor,
        useMaterial3: true,
      ),
      locale: _locale,
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const [Locale('ar'), Locale('en')],
      builder: (context, child) {
        return Directionality(
          textDirection: _locale.languageCode == 'en'
              ? TextDirection.ltr
              : TextDirection.rtl,
          child: child!,
        );
      },
      home: AwjRuntimeShell(
        client: widget.client,
        locale: _locale,
        onLocaleChanged: _onLocaleChanged,
      ),
    );
  }
}
