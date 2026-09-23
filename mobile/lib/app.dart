import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'app/awj_runtime_shell.dart';
import 'commerce/commerce.dart';

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

  void _onLocaleChanged(Locale locale) {
    setState(() => _locale = locale);
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AWJ Mobile Runtime',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorSchemeSeed: const Color(0xFF0F6A5A),
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
