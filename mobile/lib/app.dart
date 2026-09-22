import 'package:flutter/material.dart';

/// AWJ Mobile Runtime — root application widget.
///
/// This is the MOBILE-RUNTIME-1 proof shell only: a reproducible,
/// analyzable, testable Flutter workspace. It intentionally does not yet
/// render an App Schema (MOBILE-RUNTIME-2/3), call the Commerce API
/// (MOBILE-RUNTIME-4), or offer ar/en language switching
/// (MOBILE-RUNTIME-6). Arabic + RTL is the default direction per AWJ's
/// project-wide rule ("اللغة: تواصل بالعربية. الواجهات RTL أولاً" —
/// CLAUDE.md), applied here as a plain [Directionality] override until the
/// full localization delegate stack lands in MOBILE-RUNTIME-6.
class AwjMobileRuntimeApp extends StatelessWidget {
  const AwjMobileRuntimeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AWJ Mobile Runtime',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorSchemeSeed: const Color(0xFF0F6A5A), useMaterial3: true),
      builder: (context, child) {
        return Directionality(textDirection: TextDirection.rtl, child: child!);
      },
      home: const _RuntimeShellScreen(),
    );
  }
}

class _RuntimeShellScreen extends StatelessWidget {
  const _RuntimeShellScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('أَوْج — AWJ Mobile Runtime')),
      body: const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'إثبات وقت التشغيل الجوّال قيد البناء.\n'
            'Mobile runtime proof under construction — Horizon V1.',
            textAlign: TextAlign.center,
          ),
        ),
      ),
    );
  }
}
