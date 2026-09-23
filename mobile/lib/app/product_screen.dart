import 'package:flutter/material.dart';

import '../actions/actions.dart';
import '../commerce/commerce.dart';
import '../registry/registry.dart';
import '../schema/schema.dart';
import 'runtime_status_views.dart';

/// Product — the vertical slice's "Product screen", "media + variant/UOM
/// where applicable", "authoritative price/availability", and "Add to
/// Cart" (`AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md` §5).
///
/// Unlike Home/Cart, this screen does **not** parse a bundled App Schema.
/// A product page is inherently single-instance and parameterized by
/// whichever `productId` was tapped — MR-04 explicitly forbids "remote
/// expressions with general code semantics", so there is no schema
/// templating mechanism to fill a `{productId}` placeholder safely, and
/// inventing one only for this screen would be exactly the kind of
/// "arbitrary executable/expression" surface the horizon rules out. Instead
/// this screen builds its `SchemaComponent` tree directly in Dart from the
/// fetched `CommerceProductDetail`, still rendered through the identical
/// allowlisted Component Registry and dispatched through the identical
/// `AppActionDispatcher` every schema-driven screen uses — the same typed
/// rendering/dispatch primitives, just screen-owned instead of parsed.
///
/// This is also where MOBILE-RUNTIME-3's report deferred cross-component
/// wiring is resolved: `VariantSelector`/`Quantity` (MOBILE-RUNTIME-3) are
/// schema components whose live selection cannot flow into a *sibling*
/// node's dispatched action, because a `SchemaComponent`'s `props` are
/// JSON-safe scalars only (MR-04) — there is no way for one declared node
/// to observe another's live UI state. A single screen-owned
/// `_PurchasePanel` below holds both the variant choice and quantity as
/// one `StatefulWidget`'s state and, only when "Add to Cart" is tapped,
/// dispatches one fully-populated `addToCart` `ActionRef` through the same
/// `AppActionDispatcher.dispatch` — never a local value smuggled in as if
/// it were already server-confirmed (MR-06).
class ProductScreen extends StatefulWidget {
  final String productId;
  final CommerceClient client;
  final AppActionDispatcher dispatcher;

  const ProductScreen({
    super.key,
    required this.productId,
    required this.client,
    required this.dispatcher,
  });

  @override
  State<ProductScreen> createState() => _ProductScreenState();
}

class _ProductScreenState extends State<ProductScreen> {
  CommerceProductDetail? _product;
  String? _errorMessage;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant ProductScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.productId != widget.productId) _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    try {
      final product = await widget.client.getProduct(widget.productId);
      setState(() {
        _product = product;
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
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    final product = _product;
    if (product == null) {
      return ErrorRetryView(
        message: _errorMessage ?? 'تعذّر تحميل المنتج',
        onRetry: _load,
      );
    }

    final detailNode = SchemaComponent(
      type: 'ProductDetail',
      id: 'product-detail-${product.id}',
      optional: false,
      props: {
        'title': product.name,
        if (product.description != null) 'description': product.description!,
        if (product.media.isNotEmpty) 'imageUrl': product.media.first.url,
        'amountMinor': product.price.amountMinor,
      },
      children: const [],
    );
    const goHomeNode = SchemaComponent(
      type: 'NavigationTarget',
      id: 'product-go-home',
      optional: false,
      props: {'label': 'الرئيسية'},
      children: [],
      action: ActionRef(type: 'navigate', params: {'pageId': 'home'}),
    );

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        ComponentView(node: detailNode, onAction: widget.dispatcher.dispatch),
        const SizedBox(height: 16),
        _PurchasePanel(product: product, dispatcher: widget.dispatcher),
        const SizedBox(height: 16),
        ComponentView(node: goHomeNode, onAction: widget.dispatcher.dispatch),
      ],
    );
  }
}

class _PurchasePanel extends StatefulWidget {
  final CommerceProductDetail product;
  final AppActionDispatcher dispatcher;

  const _PurchasePanel({required this.product, required this.dispatcher});

  @override
  State<_PurchasePanel> createState() => _PurchasePanelState();
}

class _PurchasePanelState extends State<_PurchasePanel> {
  int _quantity = 1;
  int _selectedVariantIndex = 0;

  @override
  Widget build(BuildContext context) {
    final product = widget.product;
    final variants = product is CommerceVariantManagedProduct
        ? product.variants
        : const <CommerceProductVariant>[];
    final inStock = product.inStock ?? true;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (variants.isNotEmpty) ...[
          Wrap(
            spacing: 8,
            children: [
              for (var i = 0; i < variants.length; i++)
                ChoiceChip(
                  label: Text(
                    variants[i].descriptor ??
                        variants[i].sku ??
                        'خيار ${i + 1}',
                  ),
                  selected: _selectedVariantIndex == i,
                  onSelected: (_) => setState(() => _selectedVariantIndex = i),
                ),
            ],
          ),
          const SizedBox(height: 12),
        ],
        Row(
          children: [
            IconButton(
              key: const ValueKey('purchase-quantity-decrement'),
              icon: const Icon(Icons.remove_circle_outline),
              onPressed: _quantity > 1
                  ? () => setState(() => _quantity--)
                  : null,
            ),
            Text('$_quantity', style: Theme.of(context).textTheme.titleMedium),
            IconButton(
              key: const ValueKey('purchase-quantity-increment'),
              icon: const Icon(Icons.add_circle_outline),
              onPressed: () => setState(() => _quantity++),
            ),
            const SizedBox(width: 12),
            ElevatedButton.icon(
              onPressed: inStock ? _addToCart : null,
              icon: const Icon(Icons.add_shopping_cart),
              label: Text(inStock ? 'إضافة للسلة' : 'غير متوفر'),
            ),
          ],
        ),
      ],
    );
  }

  void _addToCart() {
    final product = widget.product;
    final variantId =
        product is CommerceVariantManagedProduct && product.variants.isNotEmpty
        ? product.variants[_selectedVariantIndex].id
        : null;
    widget.dispatcher.dispatch(
      ActionRef(
        type: 'addToCart',
        params: {
          'productId': product.id,
          'variantId': ?variantId,
          'quantity': _quantity,
        },
      ),
    );
  }
}
