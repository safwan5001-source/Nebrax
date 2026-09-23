import 'package:flutter/material.dart';

import '../schema/schema.dart';
import 'component_registry.dart';

// ---------------------------------------------------------------------------
// Typed prop extraction — every accessor is defensive: a missing or
// wrong-typed prop value never throws during build, it falls back to a safe
// default. The schema layer (MOBILE-RUNTIME-2) already guarantees props are
// JSON-safe scalars/collections; it does not guarantee a given component
// instance actually set the specific keys/types *this* widget expects.
// ---------------------------------------------------------------------------

String _stringProp(SchemaComponent node, String key, {String fallback = ''}) {
  final value = node.props[key];
  return value is String ? value : fallback;
}

String? _optionalStringProp(SchemaComponent node, String key) {
  final value = node.props[key];
  return value is String ? value : null;
}

int _intProp(SchemaComponent node, String key, {int fallback = 0}) {
  final value = node.props[key];
  return value is int ? value : fallback;
}

List<String> _stringListProp(SchemaComponent node, String key) {
  final value = node.props[key];
  if (value is! List) return const [];
  return [
    for (final item in value)
      if (item is String) item,
  ];
}

/// Formats integer minor units (halalas) as a human-readable amount —
/// presentation only. This never computes a business total; the value
/// always comes from an already-resolved schema prop or (in later tasks)
/// the Commerce API response, never from arithmetic performed here.
String formatMinorAmount(int amountMinor, {String currencySymbol = 'ر.س'}) {
  final isNegative = amountMinor < 0;
  final abs = amountMinor.abs();
  final whole = abs ~/ 100;
  final fraction = (abs % 100).toString().padLeft(2, '0');
  return '${isNegative ? '-' : ''}$whole.$fraction $currencySymbol';
}

/// Wraps [child] so a tap dispatches [node]'s attached action, when present.
/// A component with no attached action renders as inert (reduced opacity,
/// no tap handler) rather than silently doing nothing on tap — the two are
/// visibly different states, matching RUNTIME_COMPATIBILITY_V1.md §9's
/// "fallback must never look like success."
class _ActionTappable extends StatelessWidget {
  final SchemaComponent node;
  final ActionDispatch onAction;
  final Widget child;

  const _ActionTappable({
    required this.node,
    required this.onAction,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    final action = node.action;
    if (action == null) {
      return Opacity(opacity: 0.5, child: IgnorePointer(child: child));
    }
    return InkWell(onTap: () => onAction(action), child: child);
  }
}

// ---------------------------------------------------------------------------
// Layout/content components
// ---------------------------------------------------------------------------

Widget buildPage(
  BuildContext context,
  SchemaComponent node,
  ActionDispatch onAction,
) {
  return ListView(
    padding: const EdgeInsets.all(16),
    children: buildChildren(node, onAction),
  );
}

Widget buildSection(
  BuildContext context,
  SchemaComponent node,
  ActionDispatch onAction,
) {
  final title = _optionalStringProp(node, 'title');
  return Padding(
    padding: const EdgeInsets.symmetric(vertical: 8),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (title != null) ...[
          Text(title, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
        ],
        Column(children: buildChildren(node, onAction)),
      ],
    ),
  );
}

Widget buildText(
  BuildContext context,
  SchemaComponent node,
  ActionDispatch onAction,
) {
  final text = _stringProp(node, 'text');
  final style = _stringProp(node, 'style', fallback: 'body');
  final textTheme = Theme.of(context).textTheme;
  final resolvedStyle = switch (style) {
    'title' => textTheme.titleLarge,
    'caption' => textTheme.bodySmall,
    _ => textTheme.bodyMedium,
  };
  return Text(text, style: resolvedStyle);
}

Widget buildImage(
  BuildContext context,
  SchemaComponent node,
  ActionDispatch onAction,
) {
  final url = _stringProp(node, 'url');
  final placeholder = Container(
    color: Theme.of(context).colorScheme.surfaceContainerHighest,
    alignment: Alignment.center,
    child: Icon(
      Icons.image_not_supported_outlined,
      color: Theme.of(context).colorScheme.outline,
    ),
  );
  // Only https is accepted — a schema is untrusted published content, and
  // restricting the scheme is a cheap, structural guard against anything
  // other than a plain remote image fetch (horizon MR-04: no arbitrary
  // HTTP action from schema; a passive, scheme-restricted image reference
  // is the "remote image/content asset reference" the App Builder
  // architecture doc explicitly allows as Experience-only content).
  if (!url.startsWith('https://')) {
    return AspectRatio(aspectRatio: 16 / 9, child: placeholder);
  }
  return AspectRatio(
    aspectRatio: 16 / 9,
    child: Image.network(
      url,
      fit: BoxFit.cover,
      errorBuilder: (context, error, stackTrace) => placeholder,
      loadingBuilder: (context, child, progress) {
        if (progress == null) return child;
        return Center(
          child: CircularProgressIndicator(
            value: progress.expectedTotalBytes != null
                ? progress.cumulativeBytesLoaded / progress.expectedTotalBytes!
                : null,
          ),
        );
      },
    ),
  );
}

Widget buildButton(
  BuildContext context,
  SchemaComponent node,
  ActionDispatch onAction,
) {
  final label = _stringProp(node, 'label', fallback: 'زر');
  final style = _stringProp(node, 'style', fallback: 'primary');
  final action = node.action;
  final onPressed = action == null ? null : () => onAction(action);
  return style == 'secondary'
      ? OutlinedButton(onPressed: onPressed, child: Text(label))
      : ElevatedButton(onPressed: onPressed, child: Text(label));
}

Widget buildNavigationTarget(
  BuildContext context,
  SchemaComponent node,
  ActionDispatch onAction,
) {
  final label = _stringProp(node, 'label', fallback: '');
  // "Forward" is a direction-dependent glyph (MR-11: "no direction-only
  // meaning") — `chevron_left` reads as forward in RTL but backward in
  // LTR, so it is never used unconditionally; it is picked from the
  // ambient `Directionality`, the same signal `Icon.textDirection` and
  // every other direction-aware widget in this tree already relies on.
  final isRtl = Directionality.of(context) == TextDirection.rtl;
  return _ActionTappable(
    node: node,
    onAction: onAction,
    child: ListTile(
      title: Text(label),
      trailing: Icon(isRtl ? Icons.chevron_left : Icons.chevron_right),
    ),
  );
}

// ---------------------------------------------------------------------------
// Commerce-presentational components
//
// These render from schema-declared props only. None of them call the
// Commerce API or compute an authoritative price/availability — that
// remains server-side per MR-03. Real data binding (a live product list,
// live prices) is MOBILE-RUNTIME-4/5's job; this task proves each component
// *can render*, typed and safely, from whatever data eventually feeds it.
// ---------------------------------------------------------------------------

Widget buildPrice(
  BuildContext context,
  SchemaComponent node,
  ActionDispatch onAction,
) {
  final amountMinor = _intProp(node, 'amountMinor');
  final currencySymbol = _stringProp(node, 'currencySymbol', fallback: 'ر.س');
  return Text(
    formatMinorAmount(amountMinor, currencySymbol: currencySymbol),
    style: Theme.of(context).textTheme.titleMedium
        ?.copyWith(fontWeight: FontWeight.bold),
  );
}

Widget buildProductCard(
  BuildContext context,
  SchemaComponent node,
  ActionDispatch onAction,
) {
  final title = _stringProp(node, 'title');
  final imageUrl = _optionalStringProp(node, 'imageUrl');
  final amountMinor = _intProp(node, 'amountMinor');
  return _ActionTappable(
    node: node,
    onAction: onAction,
    child: SizedBox(
      width: 160,
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (imageUrl != null)
              buildImage(
                context,
                SchemaComponent(
                  type: 'Image',
                  id: '${node.id}-image',
                  optional: true,
                  props: {'url': imageUrl},
                  children: const [],
                ),
                onAction,
              ),
            Padding(
              padding: const EdgeInsets.all(8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, maxLines: 2, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 4),
                  Text(
                    formatMinorAmount(amountMinor),
                    style: Theme.of(context).textTheme.bodyMedium
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

/// A fixed-height cross axis (the previous `SizedBox(height: 220)` +
/// `ListView`) assumed a text scale where two title lines plus a price line
/// fit under 220px; at an accessibility text scale (MR-11 large-text
/// resilience, Gate E) that assumption breaks and each [buildProductCard]
/// overflows its box. A `Row` in a horizontal `SingleChildScrollView`
/// instead sizes to whatever height the tallest card's content actually
/// needs at the active [MediaQuery] text scale — no magic constant to keep
/// in sync with font metrics, and still a single unbounded-width scroller
/// (this proof's product pages are never large enough to need the
/// virtualization a `ListView` would add over a `Row`).
Widget buildProductList(
  BuildContext context,
  SchemaComponent node,
  ActionDispatch onAction,
) {
  return SingleChildScrollView(
    scrollDirection: Axis.horizontal,
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final child in node.children)
          Padding(
            padding: const EdgeInsetsDirectional.only(end: 12),
            child: ComponentView(node: child, onAction: onAction),
          ),
      ],
    ),
  );
}

Widget buildProductDetail(
  BuildContext context,
  SchemaComponent node,
  ActionDispatch onAction,
) {
  final title = _stringProp(node, 'title');
  final description = _optionalStringProp(node, 'description');
  final imageUrl = _optionalStringProp(node, 'imageUrl');
  final amountMinor = _intProp(node, 'amountMinor');
  return Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      if (imageUrl != null)
        buildImage(
          context,
          SchemaComponent(
            type: 'Image',
            id: '${node.id}-image',
            optional: true,
            props: {'url': imageUrl},
            children: const [],
          ),
          onAction,
        ),
      const SizedBox(height: 12),
      Text(title, style: Theme.of(context).textTheme.titleLarge),
      const SizedBox(height: 4),
      Text(
        formatMinorAmount(amountMinor),
        style: Theme.of(context).textTheme.titleMedium
            ?.copyWith(fontWeight: FontWeight.bold),
      ),
      if (description != null) ...[
        const SizedBox(height: 8),
        Text(description, style: Theme.of(context).textTheme.bodyMedium),
      ],
      const SizedBox(height: 12),
      ...buildChildren(node, onAction),
    ],
  );
}

Widget buildAddToCart(
  BuildContext context,
  SchemaComponent node,
  ActionDispatch onAction,
) {
  final label = _stringProp(node, 'label', fallback: 'إضافة للسلة');
  final action = node.action;
  return ElevatedButton.icon(
    onPressed: action == null ? null : () => onAction(action),
    icon: const Icon(Icons.add_shopping_cart),
    label: Text(label),
  );
}

Widget buildCartList(
  BuildContext context,
  SchemaComponent node,
  ActionDispatch onAction,
) {
  return Column(children: buildChildren(node, onAction));
}

Widget buildCartSummary(
  BuildContext context,
  SchemaComponent node,
  ActionDispatch onAction,
) {
  final itemCount = _intProp(node, 'itemCount');
  final subtotalAmountMinor = _intProp(node, 'subtotalAmountMinor');
  // `summaryLabel` lets a locale-aware caller (`cart_screen.dart`) supply
  // its own already-pluralized/-translated text (MOBILE-RUNTIME-6,
  // `RuntimeStrings.itemsCount`) — this registry widget has no locale of
  // its own to format with (a `ComponentBuilder` has no such parameter),
  // so it only ever falls back to a bare count for a caller that omits it.
  final summaryLabel =
      _optionalStringProp(node, 'summaryLabel') ?? '$itemCount عنصر';
  return Card(
    child: Padding(
      padding: const EdgeInsets.all(12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(summaryLabel),
          Text(
            formatMinorAmount(subtotalAmountMinor),
            style: Theme.of(context).textTheme.titleMedium
                ?.copyWith(fontWeight: FontWeight.bold),
          ),
        ],
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Ephemeral-UI-state components
//
// VariantSelector's selected option and Quantity's current value are local,
// component-instance state per MR-06 ("ephemeral UI state") — they are
// never dispatched as a business action by themselves and can never become
// business authority (a locally-selected quantity is not a reserved/
// committed quantity until an explicit action like addToCart carries it
// through server-authoritative validation).
// ---------------------------------------------------------------------------

Widget buildVariantSelector(
  BuildContext context,
  SchemaComponent node,
  ActionDispatch onAction,
) {
  final options = _stringListProp(node, 'options');
  return _VariantSelectorWidget(options: options);
}

class _VariantSelectorWidget extends StatefulWidget {
  final List<String> options;
  const _VariantSelectorWidget({required this.options});

  @override
  State<_VariantSelectorWidget> createState() => _VariantSelectorWidgetState();
}

class _VariantSelectorWidgetState extends State<_VariantSelectorWidget> {
  int _selectedIndex = 0;

  @override
  Widget build(BuildContext context) {
    if (widget.options.isEmpty) return const SizedBox.shrink();
    return Wrap(
      spacing: 8,
      children: [
        for (var i = 0; i < widget.options.length; i++)
          ChoiceChip(
            label: Text(widget.options[i]),
            selected: _selectedIndex == i,
            onSelected: (_) => setState(() => _selectedIndex = i),
          ),
      ],
    );
  }
}

Widget buildQuantity(
  BuildContext context,
  SchemaComponent node,
  ActionDispatch onAction,
) {
  final initial = _intProp(node, 'value', fallback: 1);
  final min = _intProp(node, 'min', fallback: 1);
  final max = _intProp(node, 'max', fallback: 99);
  // Same locale-source limitation `buildCartSummary` documents: this
  // registry widget has no `Locale` of its own, so a locale-aware caller
  // (`cart_screen.dart`) supplies these (MR-11: icon-only controls need a
  // semantic label, not just a visible icon a screen reader cannot name).
  final decreaseLabel =
      _optionalStringProp(node, 'decreaseLabel') ?? 'إنقاص الكمية';
  final increaseLabel =
      _optionalStringProp(node, 'increaseLabel') ?? 'زيادة الكمية';
  return _QuantityWidget(
    initial: initial.clamp(min, max),
    min: min,
    max: max,
    action: node.action,
    onAction: onAction,
    decreaseLabel: decreaseLabel,
    increaseLabel: increaseLabel,
  );
}

class _QuantityWidget extends StatefulWidget {
  final int initial;
  final int min;
  final int max;
  final ActionRef? action;
  final ActionDispatch onAction;
  final String decreaseLabel;
  final String increaseLabel;

  const _QuantityWidget({
    required this.initial,
    required this.min,
    required this.max,
    required this.action,
    required this.onAction,
    required this.decreaseLabel,
    required this.increaseLabel,
  });

  @override
  State<_QuantityWidget> createState() => _QuantityWidgetState();
}

class _QuantityWidgetState extends State<_QuantityWidget> {
  late int _value = widget.initial;

  void _change(int delta) {
    final next = (_value + delta).clamp(widget.min, widget.max);
    if (next == _value) return;
    setState(() => _value = next);
    final action = widget.action;
    if (action != null) {
      widget.onAction(
        ActionRef(
          type: action.type,
          params: {...action.params, 'quantity': next},
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton(
          key: const ValueKey('quantity-decrement'),
          icon: const Icon(Icons.remove_circle_outline),
          tooltip: widget.decreaseLabel,
          onPressed: _value > widget.min ? () => _change(-1) : null,
        ),
        Text('$_value', style: Theme.of(context).textTheme.titleMedium),
        IconButton(
          key: const ValueKey('quantity-increment'),
          icon: const Icon(Icons.add_circle_outline),
          tooltip: widget.increaseLabel,
          onPressed: _value < widget.max ? () => _change(1) : null,
        ),
      ],
    );
  }
}
