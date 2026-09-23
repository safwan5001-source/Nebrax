import 'package:flutter/material.dart';

import 'app/awj_runtime_shell.dart';
import 'commerce/commerce.dart';

/// AWJ Mobile Runtime — root application widget.
///
/// Boots into [AwjRuntimeShell] (MOBILE-RUNTIME-5), which wires the App
/// Schema/compatibility kernel (MOBILE-RUNTIME-2), the Component/Action
/// Registry (MOBILE-RUNTIME-3), and the Commerce client (MOBILE-RUNTIME-4)
/// into real Home/Product/Cart screens. ar/en language switching remains
/// MOBILE-RUNTIME-6's outcome. Arabic + RTL is the default direction per
/// AWJ's project-wide rule ("اللغة: تواصل بالعربية. الواجهات RTL أولاً" —
/// CLAUDE.md), applied here as a plain [Directionality] override until the
/// full localization delegate stack lands in MOBILE-RUNTIME-6.
class AwjMobileRuntimeApp extends StatelessWidget {
  /// Test-only override, forwarded to [AwjRuntimeShell].
  final CommerceClient? client;

  const AwjMobileRuntimeApp({super.key, this.client});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AWJ Mobile Runtime',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorSchemeSeed: const Color(0xFF0F6A5A),
        useMaterial3: true,
      ),
      builder: (context, child) {
        return Directionality(textDirection: TextDirection.rtl, child: child!);
      },
      home: AwjRuntimeShell(client: client),
    );
  }
}
