import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'preview_client.dart';
import 'preview_runtime_view.dart';

/// Root widget for the Preview-only entry point (`main_preview.dart`) — the
/// "safe development/preview entry path" MOBILE-PREVIEW-6 asks for, kept
/// deliberately separate from [AwjMobileRuntimeApp] (the production shell)
/// rather than a mode flag threaded through it, per [PreviewRuntimeView]'s
/// own doc comment on why the two stay structurally apart.
///
/// Arabic/RTL default, matching every other AWJ surface (CLAUDE.md) — no
/// locale toggle here (a preview build has one job).
class AwjPreviewApp extends StatelessWidget {
  final PreviewClient? client;

  const AwjPreviewApp({super.key, this.client});

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
        body: PreviewRuntimeView(client: client),
      ),
    );
  }
}
