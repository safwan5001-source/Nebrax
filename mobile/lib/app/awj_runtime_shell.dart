import 'package:flutter/material.dart';

import '../actions/actions.dart';
import '../commerce/commerce.dart';
import 'cart_screen.dart';
import 'home_screen.dart';
import 'product_screen.dart';
import 'runtime_action_handler.dart';
import 'runtime_config.dart';
import 'runtime_state.dart';

/// The runtime's real shell (replacing MOBILE-RUNTIME-1's placeholder):
/// owns the one [CommerceClient] and [RuntimeState] for the app's lifetime,
/// wires a real [RuntimeActionHandler] (replacing `NoopActionHandler`), and
/// switches between Home/Product/Cart per [RuntimeState.page] — the
/// vertical slice's "Boot -> ... -> Home ... -> Product ... -> Cart" flow
/// (`AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md` §5).
///
/// A [CommerceClient] is constructed once here, not per-screen — a fresh
/// client per screen would each read/write session tokens independently,
/// risking races on the same underlying secure storage keys for no benefit
/// (MR-07's boundary is per-runtime, not per-screen).
class AwjRuntimeShell extends StatefulWidget {
  final CommerceClient? client;

  /// Test-only override — production code always uses the default (`null`),
  /// which builds a real [CommerceClient] from [buildRuntimeCommerceConfig].
  const AwjRuntimeShell({super.key, this.client});

  @override
  State<AwjRuntimeShell> createState() => _AwjRuntimeShellState();
}

class _AwjRuntimeShellState extends State<AwjRuntimeShell> {
  late final CommerceClient _client;
  late final RuntimeState _state;
  late final AppActionDispatcher _dispatcher;

  @override
  void initState() {
    super.initState();
    _client =
        widget.client ??
        CommerceClient(
          config: buildRuntimeCommerceConfig(),
          sessionStore: FlutterSecureSessionStore(),
        );
    _state = RuntimeState();
    _dispatcher = AppActionDispatcher(
      RuntimeActionHandler(client: _client, state: _state, onError: _showError),
    );
    _state.addListener(_onStateChanged);
  }

  @override
  void dispose() {
    _state.removeListener(_onStateChanged);
    _state.dispose();
    super.dispose();
  }

  void _onStateChanged() => setState(() {});

  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('أَوْج — AWJ Mobile Runtime')),
      body: switch (_state.page) {
        RuntimePage.home => HomeScreen(
          client: _client,
          state: _state,
          dispatcher: _dispatcher,
        ),
        RuntimePage.product => ProductScreen(
          productId: _state.selectedProductId!,
          client: _client,
          dispatcher: _dispatcher,
        ),
        RuntimePage.cart => CartScreen(
          client: _client,
          state: _state,
          dispatcher: _dispatcher,
        ),
      },
    );
  }
}
