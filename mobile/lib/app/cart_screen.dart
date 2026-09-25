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

/// Cart — the vertical slice's "Cart read/update/remove"
/// (`AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md` §5), now resolved through the
/// real `binding.collect` mechanism (`APP-BUILDER-17` slice 3b).
///
/// Like Home, the static shell comes from `kCartSchemaJson`. `CartList`
/// declares `binding: {resource: "commerce.cart", collect: "items"}` with
/// one authored composite line template (`Text`/`Price`/`Quantity`/
/// `Button` — there is no dedicated "CartItem" type in the horizon's MR-04
/// component list, so a line is a small `Section` containing them, exactly
/// the composition MR-04's own component set was designed to support);
/// `resolveNodeBindings` repeats that template once per cart item, resolving
/// every `$item.*` reference (including `Quantity`/`Button`'s action
/// params — `cartItemId`/`quantity` — *before* dispatch, so
/// `updateCartQuantity`/`removeCartItem` always carry the real item's id,
/// never a hand-typed one). `CartSummary` stays outside the binding
/// mechanism deliberately: `itemCount`/`summaryLabel` are a locale-formatted
/// aggregate, not a per-item field, so it is computed here from the same
/// raw fetch `CartList`'s binding consumes (a single
/// `CommerceClient.fetchBindingResource('commerce.cart')` call serves both;
/// no second, typed `getCart()` fetch is needed).
class CartScreen extends StatefulWidget {
  final CommerceClient client;
  final RuntimeState state;
  final AppActionDispatcher dispatcher;
  final Locale locale;

  const CartScreen({
    super.key,
    required this.client,
    required this.state,
    required this.dispatcher,
    required this.locale,
  });

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  SchemaComponent? _basePage;
  String? _incompatibleMessage;
  Map<String, Object?>? _cart;
  String? _errorMessage;
  bool _loading = true;
  int _lastHandledCartVersion = -1;

  @override
  void initState() {
    super.initState();
    widget.state.addListener(_onStateChanged);
    _resolveSchema();
    _load();
  }

  @override
  void dispose() {
    widget.state.removeListener(_onStateChanged);
    super.dispose();
  }

  void _onStateChanged() {
    if (widget.state.cartVersion != _lastHandledCartVersion) {
      _lastHandledCartVersion = widget.state.cartVersion;
      _load();
    }
  }

  void _resolveSchema() {
    final result = resolveRuntimeSchema(
      kCartSchemaJson,
      CapabilityManifest.current(currentRuntimePlatform()),
    );
    switch (result) {
      case RenderableExperience e:
        _basePage = e.pages['cart'];
      case IncompatibleExperience e:
        _incompatibleMessage = e.message;
    }
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final raw = await widget.client.fetchBindingResource('commerce.cart');
      setState(() {
        _cart = raw is Map ? raw.cast<String, Object?>() : const {};
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
      setState(() {
        _errorMessage = RuntimeStrings.of(widget.locale).connectionError;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = RuntimeStrings.of(widget.locale);
    if (_incompatibleMessage != null) {
      return IncompatibleView(message: _incompatibleMessage!);
    }
    final basePage = _basePage;
    if (basePage == null) {
      return Center(child: Text(strings.cartLoadError));
    }
    if (_loading && _cart == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_errorMessage != null && _cart == null) {
      return ErrorRetryView(message: _errorMessage!, onRetry: _load);
    }

    final cart = _cart ?? const <String, Object?>{};
    final itemCount = (readFieldPath(cart, 'items') as List?)?.length ?? 0;
    final subtotalAmountMinor = readFieldPath(cart, 'subtotal.amount_minor');

    var hydrated = hydrateNode(
      basePage,
      'cart-go-home',
      (node) => withProp(node, 'label', strings.continueShopping),
    );
    hydrated = resolveNodeBindings(hydrated, {'commerce.cart': cart});
    // The line template's Quantity/Button controls carry locale-invariant
    // literal defaults in the bundled schema (never actually shown); every
    // repeated line shares the same descendant id (see
    // `binding_resolution.dart`'s own note on why that never collides as a
    // Flutter key), so one `hydrateNode` pass localizes all of them at once
    // — the same pattern already used for `home-tagline`/`cart-go-home`.
    hydrated = hydrateNode(
      hydrated,
      'cart-line-template-qty',
      (node) => withProp(
        withProp(node, 'decreaseLabel', strings.quantityDecrease),
        'increaseLabel',
        strings.quantityIncrease,
      ),
    );
    hydrated = hydrateNode(
      hydrated,
      'cart-line-template-remove',
      (node) => withProp(node, 'label', strings.removeItem),
    );
    hydrated = hydrateNode(
      hydrated,
      'slot.cart.summary',
      (node) => SchemaComponent(
        type: node.type,
        id: node.id,
        optional: node.optional,
        action: node.action,
        children: node.children,
        props: {
          'itemCount': itemCount,
          'subtotalAmountMinor': subtotalAmountMinor is int ? subtotalAmountMinor : 0,
          'summaryLabel': strings.itemsCount(itemCount),
        },
      ),
    );
    return ComponentView(node: hydrated, onAction: widget.dispatcher.dispatch);
  }
}
