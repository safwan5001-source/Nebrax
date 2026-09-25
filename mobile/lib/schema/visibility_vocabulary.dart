/// The `visibility` condition tree's closed signal vocabulary (`ADR-01`
/// §3.3, `APP-BUILDER-16`) — mirrors `App\Services\AppBuilder\VisibilitySignal`
/// (PHP) literally: same identifiers, same wire strings. Each signal names a
/// real runtime context value (cart/customer/product) resolved at evaluation
/// time — never a free expression, never a path to data outside this closed
/// list. Extending this later (e.g. reading a field off a bound item) is a
/// separate decision needing a new contract for passing that item's context
/// into the condition tree — not invented here.
class VisibilitySignal {
  const VisibilitySignal._();

  /// The current cart's item count — an integer.
  static const cartItemCount = 'cart.itemCount';

  /// Whether an authenticated customer session exists (`X-Customer-Token`
  /// valid) — a boolean.
  static const customerIsAuthenticated = 'customer.isAuthenticated';

  /// The current product's stock availability — a nullable boolean (the same
  /// `null`-means-unknown meaning as `in_stock` in `commerce/v1`).
  static const productInStock = 'product.inStock';

  static const List<String> all = [cartItemCount, customerIsAuthenticated, productInStock];
}

/// The `visibility` condition tree's closed comparison-operator vocabulary —
/// mirrors `App\Services\AppBuilder\VisibilityOperator` (PHP) literally. No
/// general expression engine (`ADR-01`): each operator dictates its own
/// `value` shape, checked by [CompatibilityResolver] at semantic-resolution
/// time — this class is only an identity dictionary, the same role
/// `RegistryVisibilityOperator` plays on the web Inspector.
class VisibilityOperator {
  const VisibilityOperator._();

  static const equals = 'equals';
  static const notEquals = 'notEquals';
  static const greaterThan = 'gt';
  static const lessThan = 'lt';
  static const greaterThanOrEqual = 'gte';
  static const lessThanOrEqual = 'lte';

  /// Wire value `'in'` — named `inList` here since `in` is a Dart keyword.
  static const inList = 'in';
  static const isTrue = 'isTrue';
  static const isFalse = 'isFalse';

  static const List<String> all = [
    equals,
    notEquals,
    greaterThan,
    lessThan,
    greaterThanOrEqual,
    lessThanOrEqual,
    inList,
    isTrue,
    isFalse,
  ];

  /// Operators that reject `value` entirely.
  static const List<String> noValue = [isTrue, isFalse];

  /// Operators that require `value` to be a non-empty list of scalars.
  static const List<String> listValue = [inList];
}
