import 'package:flutter/widgets.dart';

import '../schema/schema.dart';
import 'component_widgets.dart' as widgets;

/// Dispatches a schema-declared action. Implementations decode+dispatch via
/// `AppActionDispatcher.dispatch` (`lib/actions/action_dispatcher.dart`) —
/// this typedef exists so widget builders don't need to import the
/// dispatcher class itself, only the function shape.
typedef ActionDispatch = Future<void> Function(ActionRef action);

typedef ComponentBuilder = Widget Function(
  BuildContext context,
  SchemaComponent node,
  ActionDispatch onAction,
);

/// Maps each MR-04 component type identifier to its Flutter widget builder.
///
/// This map's key set is asserted (in `test/registry/component_registry_test.dart`)
/// to equal `RuntimeCapabilities.components.keys` exactly — the schema/
/// compatibility kernel (MOBILE-RUNTIME-2) and this rendering registry share
/// one identifier source of truth and must never silently drift apart: a
/// component the manifest claims to support but this map cannot actually
/// render would be a real capability-manifest lie, not just a missing
/// feature.
class ComponentRegistry {
  const ComponentRegistry._();

  static final Map<String, ComponentBuilder> builders = {
    'Page': widgets.buildPage,
    'Section': widgets.buildSection,
    'Text': widgets.buildText,
    'Image': widgets.buildImage,
    'ProductList': widgets.buildProductList,
    'ProductCard': widgets.buildProductCard,
    'ProductDetail': widgets.buildProductDetail,
    'Price': widgets.buildPrice,
    'VariantSelector': widgets.buildVariantSelector,
    'Quantity': widgets.buildQuantity,
    'AddToCart': widgets.buildAddToCart,
    'CartList': widgets.buildCartList,
    'CartSummary': widgets.buildCartSummary,
    'Button': widgets.buildButton,
    'NavigationTarget': widgets.buildNavigationTarget,
  };
}

/// Renders one [SchemaComponent] node (and, recursively, its children) using
/// [ComponentRegistry.builders].
///
/// The node passed here is expected to already be the *resolved* (fallback-
/// pruned) tree from `CompatibilityResolver.resolve()` — see
/// `ExperienceView`. Even so, this widget never trusts that assumption
/// blindly: an unrecognized `type` renders nothing rather than throwing, so
/// a schema/runtime mismatch that somehow slipped through an earlier layer
/// degrades safely instead of crashing the app.
class ComponentView extends StatelessWidget {
  final SchemaComponent node;
  final ActionDispatch onAction;

  const ComponentView({super.key, required this.node, required this.onAction});

  @override
  Widget build(BuildContext context) {
    final builder = ComponentRegistry.builders[node.type];
    if (builder == null) {
      return const SizedBox.shrink();
    }
    return KeyedSubtree(
      key: ValueKey(node.id),
      child: builder(context, node, onAction),
    );
  }
}

/// Renders a list of already-resolved sibling nodes, each through
/// [ComponentView]. A small helper so component builders don't repeat the
/// `.map(...).toList()` boilerplate.
List<Widget> buildChildren(SchemaComponent node, ActionDispatch onAction) {
  return [for (final child in node.children) ComponentView(node: child, onAction: onAction)];
}
