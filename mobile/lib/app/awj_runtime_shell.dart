import 'package:flutter/material.dart';

import '../actions/actions.dart';
import '../commerce/commerce.dart';
import '../deeplink/deep_link_channel.dart';
import '../push/push_channel_adapter.dart';
import '../push/push_controller.dart';
import '../schema/schema.dart';
import '../startup/startup.dart';
import 'cart_screen.dart';
import 'home_screen.dart';
import 'product_screen.dart';
import 'runtime_action_handler.dart';
import 'runtime_config.dart';
import 'runtime_schema.dart';
import 'runtime_state.dart';
import 'runtime_status_views.dart';
import 'runtime_strings.dart';

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
///
/// Locale itself is owned one level up, by [AwjMobileRuntimeApp] (it must
/// live above `MaterialApp` to drive `MaterialApp.locale`) — this shell only
/// receives the current [locale] and forwards it to every screen, and calls
/// [onLocaleChanged] (which also re-points [CommerceClient.setLocale], see
/// `commerce_client.dart`) when the toggle in its app bar is tapped.
class AwjRuntimeShell extends StatefulWidget {
  /// Test-only override — production code always uses the default (`null`),
  /// which builds a real [CommerceClient] from [buildRuntimeCommerceConfig].
  final CommerceClient? client;
  final Locale locale;
  final ValueChanged<Locale> onLocaleChanged;

  /// Test-only override for the AWJ Runtime Boot resolver's on-device
  /// last-known-good cache — production code always uses the default
  /// (`null`), which builds a real [FileExperienceCache].
  final ExperienceCache? experienceCache;

  const AwjRuntimeShell({
    super.key,
    this.client,
    required this.locale,
    required this.onLocaleChanged,
    this.experienceCache,
  });

  @override
  State<AwjRuntimeShell> createState() => _AwjRuntimeShellState();
}

class _AwjRuntimeShellState extends State<AwjRuntimeShell> with WidgetsBindingObserver {
  late final CommerceClient _client;
  late final ExperienceCache _experienceCache;
  late final RuntimeState _state;
  late final AppActionDispatcher _dispatcher;
  late final DeepLinkController _deepLinks;
  late final ChannelPushAdapter _pushAdapter;
  late final PushController _push;

  /// The AWJ Runtime Boot contract's own decision for this boot: `null`
  /// while [_resolveStartupExperience] is still in flight (rendered as a
  /// brief loading state — startup never blocks the shell itself from
  /// existing, only what Home/Cart render as their content), then exactly
  /// one of [UseFreshExperience]/[UseDefaultExperience]/[UseLastKnownGood]/
  /// [ControlledUnavailable] for the rest of this app session. Resolved
  /// once at boot, not per screen — switching between Home/Product/Cart
  /// never re-fetches or re-decides this.
  StartupDecision? _startupDecision;

  /// Tracks whether the app has actually been backgrounded since the last
  /// refresh, so the `resumed -> inactive -> paused -> inactive -> resumed`
  /// sequence real devices send (Flutter's own documented lifecycle order —
  /// `inactive` is a transient state on the way in and out of `paused`, not
  /// a background state itself) still triggers exactly one refresh, rather
  /// than requiring an exact `paused` immediately followed by `resumed`
  /// with nothing in between.
  bool _wasPaused = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _client =
        widget.client ??
        CommerceClient(
          config: buildRuntimeCommerceConfig(),
          sessionStore: FlutterSecureSessionStore(),
        );
    _client.setLocale(widget.locale.languageCode);
    _experienceCache = widget.experienceCache ?? const FileExperienceCache();
    _state = RuntimeState();
    _dispatcher = AppActionDispatcher(
      RuntimeActionHandler(client: _client, state: _state, onError: _showError),
    );
    _state.addListener(_onStateChanged);
    // A validated deep link is dispatched through the exact same
    // `AppActionDispatcher` every schema-driven tap already uses — never a
    // parallel navigation path (`deep_link_resolver.dart`'s own doc comment
    // explains why its output can only ever be `navigate`/`openProduct`).
    _deepLinks = DeepLinkController(onAction: _dispatcher.dispatch);
    _deepLinks.start();
    // A notification tap resolves through the exact same allowlisted
    // navigate/openProduct-only pipeline as a deep link — see
    // `push_payload_resolver.dart`'s own doc comment for why it can never
    // smuggle a destructive action.
    _pushAdapter = ChannelPushAdapter();
    _push = PushController(adapter: _pushAdapter, onAction: _dispatcher.dispatch);
    _push.start();
    _resolveStartupExperience();
  }

  @override
  void didUpdateWidget(covariant AwjRuntimeShell oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.locale != widget.locale) {
      _client.setLocale(widget.locale.languageCode);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _state.removeListener(_onStateChanged);
    _state.dispose();
    _pushAdapter.dispose();
    super.dispose();
  }

  /// MR-16 ("resume after background"): re-validates on-screen data through
  /// the exact same allowlisted `refresh` action every screen already
  /// listens for (MR-05's action registry, wired since MOBILE-RUNTIME-3) —
  /// never a new navigation or business-authority path of its own. Only
  /// fires on a genuine paused -> resumed transition, never on the initial
  /// lifecycle callback a fresh cold start also receives (that path is
  /// already "Boot -> ... -> Home from App Schema" — refreshing again on
  /// top of it would just duplicate the first fetch for no reason).
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) {
      _wasPaused = true;
    } else if (state == AppLifecycleState.resumed && _wasPaused) {
      _wasPaused = false;
      _state.markRefreshRequested();
    }
  }

  void _onStateChanged() => setState(() {});

  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  void _toggleLocale() {
    widget.onLocaleChanged(
      Locale(widget.locale.languageCode == 'en' ? 'ar' : 'en'),
    );
  }

  /// The AWJ Runtime Boot contract's real entry point: the *only* place in
  /// the shipped app that calls [resolveRealStartup]. Runs once per app
  /// session (`initState`), and again whenever [ErrorRetryView] (rendered
  /// for [ControlledUnavailable]) asks for a retry — never per screen, per
  /// tab switch, or per rebuild.
  Future<void> _resolveStartupExperience() async {
    final decision = await resolveRealStartup(
      client: _client,
      cache: _experienceCache,
      manifest: CapabilityManifest.current(currentRuntimePlatform()),
    );
    if (!mounted) return;
    setState(() => _startupDecision = decision);
  }

  /// The live [RenderableExperience] Home/Cart should render instead of the
  /// bundled Default AWJ Experience — present only for [UseFreshExperience]/
  /// [UseLastKnownGood]. `null` for [UseDefaultExperience] (deliberately: the
  /// Default AWJ Experience is not a [RenderableExperience] fetched/cached/
  /// resolved through this pipeline at all — see [UseDefaultExperience]'s own
  /// doc comment) and while [_startupDecision] is still resolving, so Home/
  /// Cart keep rendering the bundled default they always have until this
  /// boot's real answer is known.
  RenderableExperience? get _liveExperience {
    final decision = _startupDecision;
    if (decision is UseFreshExperience) return decision.experience;
    if (decision is UseLastKnownGood) return decision.experience;
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final strings = RuntimeStrings.of(widget.locale);
    return Scaffold(
      appBar: AppBar(
        title: const Text('أَوْج — AWJ Mobile Runtime'),
        actions: [
          TextButton(
            key: const ValueKey('locale-toggle'),
            onPressed: _toggleLocale,
            child: Text(
              strings.languageToggleLabel,
              style: const TextStyle(color: Colors.white),
            ),
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    final decision = _startupDecision;
    // `ControlledUnavailable` is the AWJ Runtime Boot contract's own
    // "neither Published, Default, nor last-known-good is safe to render"
    // answer — shown in place of Home/Product/Cart entirely, exactly like
    // `IncompatibleView`/`ErrorRetryView` already replace a single screen's
    // body on a narrower failure, never a blank screen or a silent guess.
    if (decision is ControlledUnavailable) {
      return ErrorRetryView(message: decision.message, onRetry: _resolveStartupExperience);
    }

    final liveExperience = _liveExperience;
    return switch (_state.page) {
      RuntimePage.home => HomeScreen(
        client: _client,
        state: _state,
        dispatcher: _dispatcher,
        locale: widget.locale,
        experience: liveExperience,
      ),
      RuntimePage.product => ProductScreen(
        productId: _state.selectedProductId!,
        client: _client,
        dispatcher: _dispatcher,
        locale: widget.locale,
      ),
      RuntimePage.cart => CartScreen(
        client: _client,
        state: _state,
        dispatcher: _dispatcher,
        locale: widget.locale,
        experience: liveExperience,
      ),
    };
  }
}
