/**
 * Wire types for the AWJ Store Cart V1 API (`store/v1/cart*`), and the small
 * storefront-facing view model derived from them.
 *
 * These are AWJ-owned, deliberately NOT forced into `@spree/sdk`'s `Cart`/
 * `LineItem` shapes: that interface is a Spree checkout state machine
 * (`current_step`, `fulfillments`, `payments`, `billing_address`,
 * `payment_methods`, ...) with no AWJ equivalent, and AWJ Cart V1 has no
 * checkout yet (see docs/plans/store/AWJ_COM_7_SPREE_INTEGRATION_GATE.md).
 * Faking that whole state machine to reuse Spree-shaped cart UI verbatim
 * would be exactly the "new commerce architecture" this integration must
 * not introduce, and would risk Checkout-adjacent components (express
 * checkout, order lookup) running against data that was never real.
 *
 * `mapAwjCartToViewModel` below produces `StorefrontCart` — the thin shape
 * the storefront cart UI actually reads.
 */

export interface AwjCartMoney {
  amount_minor: number;
  currency: string;
}

/**
 * One personalization answer on a line (ADR-16), exactly as the API sends it.
 * `value_label` is the chosen option's label for a `select` field and `null`
 * for free text.
 */
export interface AwjLinePersonalization {
  key: string;
  label: string;
  label_en: string | null;
  value: string;
  value_label: string | null;
}

/** Raw `store/v1/cart*` line shape, exactly as `CommerceCartService::serialize()` returns it. */
export interface AwjCartLine {
  id: string;
  product_id: string | null;
  product_variant_id: string | null;
  /**
   * The chosen variant spelled out by the backend
   * (`DocumentLineVariantResolver::descriptor()`), e.g. "1 لتر / ستانلس ستيل".
   * `null` for a simple product, and also for a variant line that no longer
   * resolves — an unavailable line keeps its name snapshot but loses the
   * descriptor along with everything else `purchasable()` would have supplied.
   */
  variant_descriptor: string | null;
  product_name: string;
  unit_key: string;
  unit_name: string;
  quantity: number;
  unit_price: AwjCartMoney;
  line_total: AwjCartMoney;
  /**
   * false = the line is retained read/remove-only (product deleted,
   * unpublished, deactivated, UOM no longer valid, or its price no longer
   * resolves). Never dropped silently — see CommerceCartService::serialize().
   */
  available: boolean;
  /** ADR-16 — present only on a personalized line. */
  personalization?: AwjLinePersonalization[];
  /** ADR-18 — present only on an add-on line: the id of its parent line. */
  addon_of?: string;
  /** ADR-18 — present only on an add-on line: quantity per unit of the parent. */
  per_parent_quantity?: number;
}

/**
 * Raw `store/v1/cart*` response shape. Deliberately carries no cart id —
 * the backend never exposes one; the opaque `awj_cart_token` HttpOnly
 * cookie is the only handle, and it must never reach client JS or the URL.
 */
export interface AwjCart {
  status: "active" | null;
  items: AwjCartLine[];
  subtotal: AwjCartMoney;
  currency: string;
  has_unavailable_items: boolean;
}

/** The storefront cart view model — what UI components actually consume. */
export interface StorefrontCartLine {
  id: string;
  productId: string | null;
  variantId: string | null;
  /** The variant the shopper chose, as the backend spells it. `null` for a simple product. */
  variantDescriptor: string | null;
  name: string;
  unitKey: string;
  unitName: string;
  quantity: number;
  unitPrice: AwjCartMoney;
  lineTotal: AwjCartMoney;
  available: boolean;
  /** The shopper's personalization answers; empty for an ordinary line. */
  personalization: StorefrontLinePersonalization[];
  /** Parent line id when this is an add-on line (ADR-18), else `null`. */
  addonOf: string | null;
  /** Add-on quantity per unit of its parent; `null` on an ordinary line. */
  perParentQuantity: number | null;
}

/** A personalization answer ready to print — the label is chosen by locale in the UI. */
export interface StorefrontLinePersonalization {
  key: string;
  label: string;
  labelEn: string | null;
  /** What to show: the option label for a choice, the text otherwise. */
  display: string;
}

/** Normalizes the API's personalization rows; anything malformed is dropped. */
export function mapLinePersonalization(
  rows: AwjLinePersonalization[] | undefined,
): StorefrontLinePersonalization[] {
  if (!Array.isArray(rows)) return [];
  const out: StorefrontLinePersonalization[] = [];
  for (const row of rows) {
    if (
      typeof row !== "object" ||
      row === null ||
      typeof row.key !== "string" ||
      typeof row.label !== "string" ||
      typeof row.value !== "string"
    ) {
      continue;
    }
    const display =
      typeof row.value_label === "string" && row.value_label.trim() !== ""
        ? row.value_label
        : row.value;
    if (display.trim() === "") continue;
    out.push({
      key: row.key,
      label: row.label,
      labelEn: typeof row.label_en === "string" ? row.label_en : null,
      display,
    });
  }
  return out;
}

export interface StorefrontCart {
  /** Discriminant for `isStorefrontCart()` — narrows a shared cart-context value. */
  readonly kind: "awj";
  items: StorefrontCartLine[];
  subtotal: AwjCartMoney;
  currency: string;
  hasUnavailableItems: boolean;
  itemCount: number;
}

/**
 * Puts every add-on line directly under its parent, keeping the API's order
 * otherwise. The API lists lines by creation time, so two bouquets with their
 * own add-ons would otherwise interleave. An add-on whose parent is missing is
 * kept (never dropped) after the grouped lines — the server already marks it
 * unavailable.
 */
export function groupAddonLines<T>(
  rows: readonly T[],
  ids: { id: (row: T) => string | null; parent: (row: T) => string | null },
): T[] {
  const children = new Map<string, T[]>();
  const parents: T[] = [];
  const known = new Set<string>();
  for (const row of rows) {
    const id = ids.id(row);
    if (ids.parent(row) === null && id !== null) known.add(id);
  }
  const orphans: T[] = [];
  for (const row of rows) {
    const parent = ids.parent(row);
    if (parent === null) {
      parents.push(row);
    } else if (known.has(parent)) {
      const list = children.get(parent) ?? [];
      list.push(row);
      children.set(parent, list);
    } else {
      orphans.push(row);
    }
  }
  const out: T[] = [];
  for (const row of parents) {
    out.push(row);
    const id = ids.id(row);
    if (id !== null) out.push(...(children.get(id) ?? []));
  }
  return [...out, ...orphans];
}

/**
 * Display groups: an ordinary line with the add-ons that ride on it. An add-on
 * whose parent is not in the list becomes a group of its own (it stays visible).
 */
export function lineGroups<T>(
  rows: readonly T[],
  ids: { id: (row: T) => string | null; parent: (row: T) => string | null },
): Array<{ line: T; addons: T[] }> {
  const groups: Array<{ line: T; addons: T[] }> = [];
  const byId = new Map<string, { line: T; addons: T[] }>();
  for (const row of rows) {
    const parent = ids.parent(row);
    const target = parent === null ? undefined : byId.get(parent);
    if (target) {
      target.addons.push(row);
      continue;
    }
    const group = { line: row, addons: [] as T[] };
    groups.push(group);
    const id = ids.id(row);
    if (id !== null && parent === null) byId.set(id, group);
  }
  return groups;
}

export function mapAwjCartToViewModel(cart: AwjCart): StorefrontCart {
  const lines = cart.items.map(
    (line): StorefrontCartLine => ({
      id: line.id,
      productId: line.product_id,
      variantId: line.product_variant_id ?? null,
      variantDescriptor: line.variant_descriptor ?? null,
      name: line.product_name,
      unitKey: line.unit_key,
      unitName: line.unit_name,
      quantity: line.quantity,
      unitPrice: line.unit_price,
      lineTotal: line.line_total,
      available: line.available,
      personalization: mapLinePersonalization(line.personalization),
      addonOf: typeof line.addon_of === "string" ? line.addon_of : null,
      perParentQuantity:
        typeof line.per_parent_quantity === "number"
          ? line.per_parent_quantity
          : null,
    }),
  );

  const items = groupAddonLines(lines, {
    id: (line) => line.id,
    parent: (line) => line.addonOf,
  });

  return {
    kind: "awj",
    items,
    subtotal: cart.subtotal,
    currency: cart.currency,
    hasUnavailableItems: cart.has_unavailable_items,
    // Add-on lines ride on their parent (ADR-18): "a bouquet and a chocolate
    // box" is one thing in the bag, so only the lines the shopper added count.
    itemCount: items.reduce(
      (sum, item) => (item.addonOf ? sum : sum + item.quantity),
      0,
    ),
  };
}

export function isStorefrontCart(cart: unknown): cart is StorefrontCart {
  return (
    typeof cart === "object" &&
    cart !== null &&
    (cart as { kind?: unknown }).kind === "awj"
  );
}

/**
 * Integer-safe display formatting only — `amount_minor` is never divided,
 * rounded, or recomputed here. The backend's own value is authoritative;
 * this only chooses how to print it.
 */
export function formatMinorAmount(money: AwjCartMoney): string {
  try {
    return new Intl.NumberFormat("ar-SA", {
      style: "currency",
      currency: money.currency,
      currencyDisplay: "symbol",
    }).format(money.amount_minor / 100);
  } catch {
    return `${(money.amount_minor / 100).toFixed(2)} ${money.currency}`;
  }
}
