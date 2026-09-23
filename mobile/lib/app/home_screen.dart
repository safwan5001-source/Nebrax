import 'package:flutter/material.dart';

import '../actions/actions.dart';
import '../commerce/commerce.dart';
import '../registry/registry.dart';
import '../schema/schema.dart';
import 'experience_hydration.dart';
import 'runtime_schema.dart';
import 'runtime_state.dart';
import 'runtime_status_views.dart';

/// Home — the vertical slice's "Home from App Schema" + "product list from
/// /commerce/v1" (`AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md` §5).
///
/// The page's static shell (hero section, "go to cart" link) comes from
/// `kHomeSchemaJson`, parsed and resolved through the exact same
/// `AppSchema.parse`/`CompatibilityResolver` pipeline MOBILE-RUNTIME-2
/// tests already exercise. The one dynamic area — the product list — is a
/// declared empty "data slot" node (`slot.home.products`) whose children
/// this screen fills from a live `CommerceClient.listProducts()` call via
/// `hydrateNode`, each result mapped to a `ProductCard` node with an
/// `openProduct` action carrying that product's real id.
class HomeScreen extends StatefulWidget {
  final CommerceClient client;
  final RuntimeState state;
  final AppActionDispatcher dispatcher;

  const HomeScreen({
    super.key,
    required this.client,
    required this.state,
    required this.dispatcher,
  });

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  SchemaComponent? _basePage;
  String? _incompatibleMessage;
  List<CommerceProductSummary>? _products;
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
      final page = await widget.client.listProducts();
      setState(() {
        _products = page.items;
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
        _errorMessage = 'تعذّر الاتصال بالخدمة';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_incompatibleMessage != null) {
      return IncompatibleView(message: _incompatibleMessage!);
    }
    final basePage = _basePage;
    if (basePage == null) {
      return const Center(child: Text('تعذّر تحميل الصفحة الرئيسية'));
    }
    if (_loading && _products == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_errorMessage != null && _products == null) {
      return ErrorRetryView(message: _errorMessage!, onRetry: _loadProducts);
    }

    final cards = [
      for (final product in _products ?? const <CommerceProductSummary>[])
        SchemaComponent(
          type: 'ProductCard',
          id: 'product-${product.id}',
          optional: true,
          props: {
            'title': product.name,
            'amountMinor': product.price.amountMinor,
            if (product.thumbnailUrl != null) 'imageUrl': product.thumbnailUrl!,
          },
          children: const [],
          action: ActionRef(
            type: 'openProduct',
            params: {'productId': product.id},
          ),
        ),
    ];
    final hydrated = hydrateNode(
      basePage,
      'slot.home.products',
      (node) => node.withChildren(cards),
    );
    return ComponentView(node: hydrated, onAction: widget.dispatcher.dispatch);
  }
}
