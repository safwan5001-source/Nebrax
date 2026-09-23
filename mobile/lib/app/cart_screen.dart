import 'package:flutter/material.dart';

import '../actions/actions.dart';
import '../commerce/commerce.dart';
import '../registry/registry.dart';
import '../schema/schema.dart';
import 'experience_hydration.dart';
import 'runtime_schema.dart';
import 'runtime_state.dart';
import 'runtime_status_views.dart';

/// Cart — the vertical slice's "Cart read/update/remove"
/// (`AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md` §5).
///
/// Like Home, the static shell comes from `kCartSchemaJson`; the two
/// dynamic slots (`slot.cart.items`, `slot.cart.summary`) are hydrated from
/// a live `CommerceClient.getCart()` call. Each cart line is composed from
/// already-allowlisted MOBILE-RUNTIME-3 component types (`Text`, `Price`,
/// `Quantity`, `Button`) — there is no dedicated "CartItem" type in the
/// horizon's MR-04 component list, so a line is a small `Section`
/// containing them, exactly the composition MR-04's own component set was
/// designed to support. `Quantity`'s dispatched `updateCartQuantity` here
/// carries the *real* `cartItemId` a cart line has (unlike the Product
/// screen's pre-add quantity, which has none yet — see `product_screen.dart`),
/// so it correctly uses MOBILE-RUNTIME-3's schema-driven `Quantity`
/// component rather than a screen-owned one.
class CartScreen extends StatefulWidget {
  final CommerceClient client;
  final RuntimeState state;
  final AppActionDispatcher dispatcher;

  const CartScreen({
    super.key,
    required this.client,
    required this.state,
    required this.dispatcher,
  });

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  SchemaComponent? _basePage;
  String? _incompatibleMessage;
  CommerceCart? _cart;
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
      final cart = await widget.client.getCart();
      setState(() {
        _cart = cart;
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
      return const Center(child: Text('تعذّر تحميل السلة'));
    }
    if (_loading && _cart == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_errorMessage != null && _cart == null) {
      return ErrorRetryView(message: _errorMessage!, onRetry: _load);
    }

    final cart = _cart;
    final lineNodes = <SchemaComponent>[
      for (final item in cart?.items ?? const <CommerceCartItem>[])
        SchemaComponent(
          type: 'Section',
          id: 'cart-line-${item.id}',
          optional: true,
          props: {'title': item.productName},
          children: [
            if (item.variantDescriptor != null)
              SchemaComponent(
                type: 'Text',
                id: 'cart-line-${item.id}-variant',
                optional: true,
                props: {'text': item.variantDescriptor!, 'style': 'caption'},
                children: const [],
              ),
            SchemaComponent(
              type: 'Price',
              id: 'cart-line-${item.id}-price',
              optional: true,
              props: {'amountMinor': item.lineTotal.amountMinor},
              children: const [],
            ),
            SchemaComponent(
              type: 'Quantity',
              id: 'cart-line-${item.id}-qty',
              optional: true,
              props: {'value': item.quantity, 'min': 1, 'max': 99},
              children: const [],
              action: ActionRef(
                type: 'updateCartQuantity',
                params: {'cartItemId': item.id, 'quantity': item.quantity},
              ),
            ),
            SchemaComponent(
              type: 'Button',
              id: 'cart-line-${item.id}-remove',
              optional: true,
              props: {'label': 'إزالة', 'style': 'secondary'},
              children: const [],
              action: ActionRef(
                type: 'removeCartItem',
                params: {'cartItemId': item.id},
              ),
            ),
          ],
        ),
    ];

    var hydrated = hydrateNode(
      basePage,
      'slot.cart.items',
      (node) => node.withChildren(lineNodes),
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
          'itemCount': cart?.items.length ?? 0,
          'subtotalAmountMinor': cart?.subtotal.amountMinor ?? 0,
        },
      ),
    );
    return ComponentView(node: hydrated, onAction: widget.dispatcher.dispatch);
  }
}
