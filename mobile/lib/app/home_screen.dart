import 'package:flutter/material.dart';

import '../actions/actions.dart';
import '../commerce/commerce.dart';
import '../registry/registry.dart';
import '../schema/schema.dart';
import 'binding_resolution.dart';
import 'experience_hydration.dart';
import 'runtime_schema.dart';
import 'runtime_state.dart';
import 'runtime_status_views.dart';
import 'runtime_strings.dart';

/// Home — the vertical slice's "Home from App Schema" + "product list from
/// /commerce/v1" (`AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md` §5), now resolved
/// through the real `binding` mechanism (`APP-BUILDER-17` slice 3b).
///
/// The page's static shell (hero section, "go to cart" link) comes from
/// `kHomeSchemaJson`, parsed and resolved through the exact same
/// `AppSchema.parse`/`CompatibilityResolver` pipeline MOBILE-RUNTIME-2
/// tests already exercise — `ProductList` now declares a real
/// `binding.resource: "commerce.products"` there, so `CompatibilityResolver`
/// only lets this render at all once the manifest supports it (proven by
/// `RuntimeCapabilities.dataResources` now declaring it). The product list
/// itself is filled by `resolveNodeBindings` (`binding_resolution.dart`)
/// against the raw JSON this screen fetches via
/// `CommerceClient.fetchBindingResource('commerce.products')` — the
/// bundled schema's own `ProductCard` item template is repeated once per
/// product, with `$item.*` resolved from the wire response directly, never
/// through the typed `CommerceProductSummary` model (kept only for the raw
/// item's `name`/`name_en` locale pick below, since the generic binding
/// mechanism has no per-locale logic of its own — see `_localizeProducts`).
class HomeScreen extends StatefulWidget {
  final CommerceClient client;
  final RuntimeState state;
  final AppActionDispatcher dispatcher;
  final Locale locale;

  const HomeScreen({
    super.key,
    required this.client,
    required this.state,
    required this.dispatcher,
    required this.locale,
  });

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  SchemaComponent? _basePage;
  String? _incompatibleMessage;
  List<Object?>? _products;
  String? _errorMessage;
  bool _loading = true;
  int _lastHandledRefreshVersion = -1;

  @override
  void initState() {
    super.initState();
    widget.state.addListener(_onStateChanged);
    _resolveSchema();
    _loadProducts();
  }

  @override
  void dispose() {
    widget.state.removeListener(_onStateChanged);
    super.dispose();
  }

  void _onStateChanged() {
    if (widget.state.refreshVersion != _lastHandledRefreshVersion) {
      _lastHandledRefreshVersion = widget.state.refreshVersion;
      _loadProducts();
    }
  }

  void _resolveSchema() {
    final result = resolveRuntimeSchema(
      kHomeSchemaJson,
      CapabilityManifest.current(currentRuntimePlatform()),
    );
    switch (result) {
      case RenderableExperience e:
        _basePage = e.pages['home'];
      case IncompatibleExperience e:
        _incompatibleMessage = e.message;
    }
  }

  Future<void> _loadProducts() async {
    setState(() => _loading = true);
    try {
      final raw = await widget.client.fetchBindingResource('commerce.products');
      setState(() {
        _products = raw is List ? raw : const [];
        _errorMessage = null;
        _loading = false;
      });
    } on CommerceApiException catch (e) {
      setState(() {
        _errorMessage = e.message;
        _loading = false;
      });
    } on CommerceProtocolException catch (e) {
      setState(() {
        _errorMessage = e.message;
        _loading = false;
      });
    } catch (_) {
      // Any other transport failure (no network, DNS, an unconfigured
      // placeholder Commerce host — see `runtime_config.dart`) — this proof
      // has no real deployed tenant to point at by default.
      setState(() {
        _errorMessage = RuntimeStrings.of(widget.locale).connectionError;
        _loading = false;
      });
    }
  }

  /// Adds a synthesized `display_name` field to each raw product item —
  /// whichever of `name`/`name_en` matches [widget.locale], via the exact
  /// same `localizedProductName` rule every other screen already uses. The
  /// generic `$item.*` binding mechanism deliberately has no per-locale (or
  /// any other) logic of its own (Decision Gate: "no arbitrary
  /// expressions"), so a locale pick must happen here, screen-side, on the
  /// raw data *before* `resolveNodeBindings` ever sees it — never by
  /// inventing a schema-level conditional.
  ///
  /// Called from [build], not [_loadProducts]: `_products` itself must stay
  /// the raw, both-locales fetch (never pre-baked to one locale), so that
  /// toggling the app's locale — which rebuilds this widget with a new
  /// [widget.locale] but does **not** refetch — recomputes `display_name`
  /// fresh on every build, exactly like `localizedProductName` was already
  /// called fresh on every build before this screen used bindings.
  List<Object?> _localizeProducts(List<Object?> rawProducts) {
    return [
      for (final entry in rawProducts)
        if (entry is Map) _withDisplayName(entry.cast<String, Object?>()),
    ];
  }

  Map<String, Object?> _withDisplayName(Map<String, Object?> item) {
    return {
      ...item,
      'display_name': localizedProductName(
        item['name'] is String ? item['name'] as String : '',
        item['name_en'] is String ? item['name_en'] as String : null,
        widget.locale,
      ),
    };
  }

  @override
  Widget build(BuildContext context) {
    final strings = RuntimeStrings.of(widget.locale);
    if (_incompatibleMessage != null) {
      return IncompatibleView(message: _incompatibleMessage!);
    }
    final basePage = _basePage;
    if (basePage == null) {
      return Center(child: Text(strings.homeLoadError));
    }
    if (_loading && _products == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_errorMessage != null && _products == null) {
      return ErrorRetryView(message: _errorMessage!, onRetry: _loadProducts);
    }

    var hydrated = hydrateNode(
      basePage,
      'home-tagline',
      (node) => withProp(node, 'text', strings.tagline),
    );
    hydrated = hydrateNode(
      hydrated,
      'home-go-cart',
      (node) => withProp(node, 'label', strings.goToCart),
    );
    hydrated = resolveNodeBindings(hydrated, {
      'commerce.products': _localizeProducts(_products ?? const <Object?>[]),
    });
    return ComponentView(node: hydrated, onAction: widget.dispatcher.dispatch);
  }
}
