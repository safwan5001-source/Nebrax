# AWJ Component Registry V1 — Contract Draft

**Status:** Draft implementation-facing contract  
**Parent:** `AWJ_APP_BUILDER_PRODUCT_ARCHITECTURE_V1.md`  
**Related:** `APP_SCHEMA_V1.md`

## 1. Purpose

The Component Registry defines the **approved visual/runtime capabilities** that an AWJ App Schema may instantiate.

It separates:

- **Component Definition** — AWJ-owned type, contract, validation and capability metadata.
- **Component Instance** — merchant-configured use of that type inside an App Schema.

The registry is framework-neutral. A component ID such as `commerce.productGrid` is an AWJ capability identifier, not a Flutter/Dart class name.

## 2. Core invariant

A component is presentation + interaction capability, **not business authority**.

A Product Card may display price returned by AWJ Commerce and emit an approved “open product” event. It cannot author the authoritative price, bypass publication rules, select another tenant, or decide that payment succeeded.

## 3. Definition model

Conceptual definition:

```json
{
  "type": "commerce.productGrid",
  "version": 1,
  "category": "commerce",
  "displayName": {"ar": "شبكة المنتجات", "en": "Product Grid"},
  "props": {},
  "bindings": {},
  "events": {},
  "children": {},
  "accessibility": {},
  "compatibility": {},
  "editor": {}
}
```

Exact serialization is not locked yet.

## 4. Stable identity and versioning

Each definition has:
- stable type ID;
- contract version;
- compatibility requirements;
- lifecycle status: active / deprecated / removed candidate;
- migration/fallback metadata where supported.

Never reuse a component type/version for incompatible semantics.

Published schemas remain interpretable according to their recorded contract/runtime compatibility.

## 5. Registry categories

V1 categories:

### Commerce
Components that present or interact with AWJ Commerce resources.

### Content
Merchant-authored presentation/content.

### Layout
Safe structural composition primitives.

### Navigation
Controls/surfaces that invoke registered navigation capabilities.

These categories organize the Builder; they do not grant permissions.

## 6. Definition metadata

A Component Definition can declare:

### Props
Merchant-editable values:
- type;
- required/default;
- enum/range/length constraints;
- localized or non-localized;
- theme-aware behavior;
- editor control hint;
- whether changing it can have native impact.

### Bindings
Named data slots:
- accepted resource/result type;
- required/optional;
- collection/single-value expectation;
- loading/empty/error support.

### Events
Typed events emitted by the component:
- tap;
- itemTap;
- submit;
- change;
- retry;
- other AWJ-defined events.

An event does not itself perform privileged work.

### Children
- none;
- bounded children;
- specific accepted categories/types;
- ordered/unordered;
- minimum/maximum;
- slot-based composition.

### Accessibility
Required runtime semantics and merchant-supplied fields where applicable.

### Compatibility
Required runtime capability/version and safe fallback behavior.

### Editor metadata
How Builder presents the definition:
- icon/category;
- Inspector groups;
- basic vs advanced controls;
- insert/drop constraints;
- preview fixtures.

Editor metadata never weakens runtime validation.

## 7. Prop type candidates

V1 may standardize:
- string;
- localized string;
- boolean;
- integer/decimal with bounded range;
- enum;
- semantic color/theme role;
- spacing/size preset;
- asset reference;
- page/navigation reference;
- duration/date window where approved.

Avoid free-form CSS, arbitrary expressions, raw URLs and framework objects in normal props.

## 8. Commerce binding rule

Commerce components consume typed Data Resources.

Examples:

```text
commerce.productGrid
  items <- commerce.products

commerce.categoryList
  items <- commerce.categories

commerce.cartSummary
  cart <- commerce.cart
```

The component does not fetch an arbitrary endpoint.

Tenant/customer/publication/pricing/inventory authorization is enforced by the resource/backend.

## 9. Initial V1 registry candidate

This is the **candidate minimum**, to be confirmed against Commerce Mobile API Readiness and runtime proof.

### Content

#### `content.heading`
Purpose: localized heading/title.

Props:
- text;
- semantic text role/alignment;
- limited spacing/style options.

Accessibility:
- correct semantic heading behavior where applicable.

#### `content.text`
Purpose: localized supporting/body text.

No arbitrary HTML/script.

#### `content.image`
Purpose: managed AWJ image/media.

Props:
- asset reference;
- fit/aspect behavior;
- merchant alt/semantic description where appropriate.

No arbitrary filesystem path.

#### `content.hero`
Purpose: branded hero/banner.

May support:
- localized title/subtitle;
- managed image;
- approved CTA event/action;
- bounded presentation variants.

### Layout

#### `layout.section`
Purpose: page section boundary with theme-aware spacing/background.

#### `layout.stack`
Purpose: vertical composition.

#### `layout.row`
Purpose: bounded horizontal composition where responsive behavior is safe.

#### `layout.grid`
Purpose: constrained responsive grid.

V1 should prefer presets over arbitrary pixel positioning.

### Commerce

#### `commerce.categoryList`
Binding:
- category collection resource.

Events:
- `itemTap(categoryRef)`.

Presentation:
- list/grid/chips only where runtime provides accessible/mobile-safe variants.

#### `commerce.productGrid`
Binding:
- product collection resource.

Props:
- approved card variant;
- bounded columns/layout;
- item limit/pagination presentation where resource supports it.

Events:
- `itemTap(productRef)`;
- optional approved quick-add event only if product eligibility/options semantics are safe.

It does not own product prices/stock.

#### `commerce.productCard`
Binding:
- typed product summary.

Displays approved fields such as:
- media;
- localized name;
- authoritative price presentation;
- availability/promotion indicators returned by backend.

Events:
- open product;
- approved add-to-cart when eligibility permits.

#### `commerce.productDetail`
Prefer an AWJ-owned composed capability for V1 rather than allowing merchants to accidentally remove critical commerce behavior.

Potential data:
- media;
- name/description;
- price;
- availability;
- options/variants;
- quantity;
- add-to-cart.

Exact decomposition remains open until Product/Variant mobile API proof.

#### `commerce.productMedia`
Displays authorized product media references.

#### `commerce.productPrice`
Displays server-returned pricing only.

Merchant may style presentation within approved variants; cannot provide authoritative amount.

#### `commerce.productOptions`
Displays supported option/variant selection.

Selection is UI state; backend validates purchasable variant/combination.

#### `commerce.quantitySelector`
Bounded local quantity intent.

Backend/cart action validates final quantity.

#### `commerce.addToCart`
Emits registered cart action with typed product/variant/quantity input.

Never mutates local cart as final authority.

#### `commerce.cartItems`
Binding:
- authoritative cart resource.

#### `commerce.cartSummary`
Displays totals returned by cart/checkout backend.

No client-calculated authoritative tax/discount/grand total.

#### `commerce.checkoutEntry`
Entry to trusted checkout capability.

Does not embed merchant-authored payment logic.

#### `commerce.orderList`
Authenticated customer order collection, if Commerce Mobile API Readiness confirms V1.

#### `commerce.orderSummary`
Authenticated order summary/detail presentation under backend authorization.

### Navigation

#### `navigation.button`
Merchant-configurable label/style + registered action.

#### `navigation.bottomNav`
AWJ-owned mobile navigation structure with bounded destinations and required/system destination rules.

#### `navigation.menu`
Approved navigation entries to registered destinations.

No arbitrary privileged route creation.

## 10. Product publication behavior

Product components must respect Commerce publication/channel rules.

A merchant placing `commerce.productGrid` on a page does **not** make unpublished products visible.

The Data Resource determines which products/categories are available to the current app/channel/market/tenant.

## 11. Pricing and inventory safety

Components:
- display authoritative server results;
- may display loading/stale/error states;
- may cache only according to approved runtime/resource policy.

Components MUST NOT:
- calculate authoritative invoice/cart totals;
- override price lists;
- make stock authoritative from local state;
- accept a schema-authored “in stock” flag as truth;
- bypass promotion eligibility.

## 12. Cart safety

Quick Add is only available when the Action/Data contracts can resolve a valid purchasable configuration.

If a product requires option selection or other required purchase configuration, Builder/runtime should route to Product Detail or an approved selector instead of guessing.

Add-to-cart is idempotent/race-safe according to backend cart contract, not because the visual component assumes success.

## 13. Checkout/payment safety

Payment UI requiring native/provider SDK capability is not a generic merchant component.

Payment and checkout components/actions are AWJ-owned trusted capabilities and may require native-release classification when SDK/entitlement/config changes.

No component receives raw payment-provider secret keys through App Schema.

## 14. Component composition

Composition is explicitly constrained.

Examples:
- `layout.section` may accept content/commerce/layout children.
- `commerce.productCard` may be closed/composed in V1 rather than accepting arbitrary children.
- `navigation.bottomNav` accepts bounded navigation destinations, not arbitrary layout children.

This prevents invalid or unsafe UI trees.

## 15. Locked system behavior

A component may contain AWJ-controlled behavior that merchant styling cannot remove.

Examples may include:
- required purchase-state handling;
- authentication gate;
- accessibility semantics;
- error/retry behavior;
- legal/payment indicators;
- safe-area/platform behavior.

Builder explains locked behavior when relevant.

## 16. Responsive/mobile behavior

Definitions own safe responsive behavior.

Merchant controls semantic presets, not device-specific absolute positioning by default.

Every V1 component must be tested against:
- representative small/large phone sizes;
- Arabic RTL;
- English LTR;
- text expansion;
- dynamic/accessibility text sizing where supported by platform baseline.

## 17. Theme integration

Components consume semantic theme roles.

Example:
```text
surface.primary
text.primary
brand.primary
spacing.section
shape.card
```

Exact token names belong to Theme contract later.

Merchant overrides use Builder controls; schema/runtime remain independent of Flutter styling classes.

## 18. Loading, empty, error states

Commerce/data-bound definitions declare supported states.

V1 defaults should be AWJ-owned and safe.

Merchant may configure bounded content such as an empty-state message/image where appropriate, but cannot suppress critical errors in a way that falsely indicates successful purchase/payment.

## 19. Accessibility contract

Definition specifies what runtime guarantees and what merchant must provide.

Runtime-owned:
- roles/traits;
- focus/tap semantics;
- minimum interactive behavior;
- platform semantics.

Merchant-owned where applicable:
- meaningful content label/description;
- text content.

Builder validation flags missing required accessibility content.

## 20. Localization contract

Localized props explicitly declare localization behavior.

A component must not infer Arabic/English by duplicating the component tree unless intentional.

Layout behavior must be direction-aware.

## 21. Events

Events carry minimum typed context.

Example:
```text
productGrid.itemTap -> productRef
categoryList.itemTap -> categoryRef
button.tap -> no privileged payload by default
```

Do not expose entire backend objects or secrets as event payloads when a safe reference is enough.

## 22. Native-impact metadata

Definitions/capabilities identify whether using/configuring them can require native support.

Examples:
- ordinary hero/product grid: Experience-only candidate if runtime already supports it;
- new component type absent from installed runtime: native runtime update;
- component requiring a new native SDK/permission: native build/release.

Publish impact analysis consumes this metadata.

## 23. Compatibility and fallback

A definition can declare:
- minimum runtime capability;
- safe fallback component/behavior;
- whether absence is a blocker.

Security-sensitive commerce/actions fail closed if unsupported.

Do not silently replace checkout/payment/auth behavior with misleading UI.

## 24. Deprecation

Deprecation lifecycle:
1. Active.
2. Deprecated — existing schemas still supported; Builder discourages new insertion.
3. Migration available where semantically safe.
4. Removal only after compatibility/support policy allows it.

Published apps must not break merely because Builder catalog stops showing a deprecated component.

## 25. Builder behavior

Component palette only exposes:
- components allowed for current app/runtime target;
- components allowed for current parent/drop slot;
- components available to current product/feature entitlement if applicable.

Inspector is generated primarily from Definition metadata.

Design mode uses merchant-friendly labels.
Develop mode may expose stable type/version and binding/action diagnostics.

## 26. Registry governance

New V1 component requires:
- stable business purpose;
- definition contract;
- prop validation;
- binding/event contract;
- accessibility behavior;
- RTL/LTR behavior;
- loading/empty/error behavior;
- compatibility/native-impact classification;
- tests;
- security review if it touches sensitive capability.

Avoid near-duplicate components that differ only visually; use variants when semantics are the same.

## 27. Testing requirements per component

At minimum:
- definition/schema validation;
- valid/invalid props;
- child constraints;
- binding type validation;
- event/action compatibility;
- RTL/LTR rendering;
- accessibility baseline;
- loading/empty/error;
- compatibility/fallback;
- snapshot/golden/visual regression where appropriate;
- tenant-sensitive resource/action integration tests outside the visual component layer.

Commerce-sensitive components also require negative tests proving client/schema values cannot override server authority.

## 28. Open decisions

- exact V1 component inventory after Commerce API readiness;
- composed vs primitive Product Detail structure;
- quick-add eligibility UX;
- cart/checkout component decomposition;
- account/auth component inventory;
- order tracking/detail scope;
- reusable merchant sections;
- carousel/slider inclusion in V1;
- video support;
- web-content/WebView component policy;
- form/input component scope;
- map/location component scope;
- push/in-app promotion components;
- exact responsive presets;
- exact accessibility conformance baseline;
- exact registry serialization/storage.

## 29. Acceptance criteria

COMPONENT_REGISTRY_V1 can be implementation-locked when:

1. every V1 component has a stable framework-neutral definition;
2. every commerce component maps to a typed Data Resource and/or registered Action;
3. no component can become price/inventory/payment/tenant authority;
4. Product → options → cart behavior is safe for representative AWJ product models;
5. child/composition constraints prevent invalid trees;
6. Arabic RTL and English LTR behavior is defined/testable;
7. accessibility responsibilities are explicit;
8. native-impact/compatibility metadata is defined;
9. Flutter proof can map representative definitions through a registry adapter without leaking Flutter names into schema;
10. Builder Inspector can be generated from definition metadata for representative components.
