# AWJ App Builder — Commerce Data & Dynamic Runtime V1 — Phase 1: Evidence & Architecture

**Date:** 2026-09-24
**Status:** DECISION GATE — awaiting Safwan / ChatGPT review. No binding, condition, visibility,
Data Resource Registry, or new runtime contract has been implemented. This document is the required
Phase 1 output per the horizon mission; implementation must not start until §8 is resolved.
**Scope:** Continuation of AWJ App Builder Horizon V1 (CLOSED). This is the promised follow-up
architecture decision for the connected deferred track: `APP-BUILDER-7` (Data/Actions/
Conditions/Visibility) and the real-Commerce-binding clause carried out of `APP-BUILDER-11`.

---

## 0. Method

Per `AWJ-HORIZON-SYSTEM.md`, this pass separates **Repository evidence** (§1) from **External
evidence** (§2) from **AWJ Decision / Proposal** (§3–§7) from **Open Decision** (§8), and does not
broadly re-explore what Horizon V1 already evidenced. Three focused, read-only evidence passes were
run in parallel over: (a) the App Builder backend contract, (b) the Flutter mobile runtime, (c) the
real AWJ Commerce API surfaces and Storefront data flow. Their findings are consolidated below with
file:line citations preserved.

---

## 1. Repository evidence

### 1.1 App Builder backend contract — `app/Services/AppBuilder/*`

The schema/registry/publish pipeline built in Horizon V1 is complete, tenant/RBAC-safe, and
immutably versioned, but **structurally cannot express data binding, conditions, or visibility
today** — this is not an oversight, it is a closed contract:

- **`AppSchemaParser.php`** — pure structural validator (byte-for-byte port of the tested Dart
  contract). Component node keys are a **closed allowlist**: `type, id, optional, props, children,
  action` (`COMPONENT_KEYS`, line 38). Any other key — `binding`, `dataSource`, `resource`,
  `condition`, `visibility` — is rejected as `unknown_field` today. Depth ≤32, node count ≤500,
  props nesting ≤8, collection length ≤64. Does not check component/action identity against a
  registry (that is `CompatibilityResolver`'s job).
- **`CompatibilityResolver.php`** — resolves `schemaVersion`/`minRuntimeVersion` and
  `requiredCapabilities` against a `CapabilityManifest`, then walks the component tree: an
  unsupported **required** component/action fails the **whole document** closed; an **optional**
  one is pruned with a `fallbacks` entry and publish continues. Called only at publish time, not at
  draft save. **No data-resource dimension exists in it at all today.**
- **`ComponentRegistry.php`** — 15 components (`Page, Section, Text, Image, ProductList,
  ProductCard, ProductDetail, Price, VariantSelector, Quantity, AddToCart, CartList, CartSummary,
  Button, NavigationTarget`), purely descriptive metadata (props/children rules/actionability). Not
  wired back into parser/resolver validation of prop shapes (deliberate — "ربط هذا السجلّ بتحقّق
  فعلي... قرار منفصل لمهمة لاحقة").
- **`ActionRegistry.php`** — 6 actions (`navigate, openProduct, addToCart, updateCartQuantity,
  removeCartItem, refresh`), each carrying `dispatchStatus = ActionDefinition::DISPATCH_PROVEN_NOOP`
  (line 15 defines the constant; lines 40/50/62/73/83/91 apply it to all six). This status means
  "proven to decode/validate correctly in this contract, zero real commerce effect **through this
  contract**" — see §1.2 for why this is only half the picture.
- **`DataResourceRegistry.php`** — **deliberately empty**: `public const RESOURCES = [];`, private
  constructor, guarded by `tests/Feature/DataResourceRegistryTest.php` to stay empty until an
  explicit decision changes it. Docblock records why: no `bindings` field exists in the tested
  schema contract; `RuntimeCapabilities` defines no "data resource" capability identity; the
  prerequisite doc `COMMERCE_MOBILE_API_READINESS.md` referenced by an earlier `DATA_RESOURCE_
  REGISTRY_V1.md` draft does not exist in this repo. **This is the single clearest artifact proving
  live-data binding has zero backend scaffolding today — not even a stub.**
- **Conditions/Visibility**: zero hits for `condition|visibility|visible_if` in any `.php`/`.dart`
  source. Only forward-looking doc mentions (`AWJ_APP_BUILDER_HORIZON_V1.md`, the
  `APP-BUILDER-6`/`-12` reports) — a named-but-unbuilt concept, not even primitively started.
- **Component data-binding today**: purely static/presentational. `ProductCard` props are literal
  author-entered `title`/`imageUrl`/`amountMinor`; `ProductList`/`CartList` are unbounded-children
  containers rendering whatever static children the merchant drops in; `VariantSelector.options` is
  a merchant-typed string array with **no** real selection→variant wiring; `AddToCart`/`Button` can
  carry an `action` (e.g. `addToCart` with a literal `productId` string) but that id is manually
  typed in the Inspector, never resolved from a live product picker.

### 1.2 Mobile Flutter runtime — `mobile/lib/*`

**Two independently-built subsystems currently disagree on how far "runtime proof" reached, and
this disagreement is itself the central finding of this evidence pass:**

- The **App Builder horizon** (backend contract, above) never proves real Commerce
  dispatch/binding — `DataResourceRegistry` is empty, `ActionRegistry` marks every action
  `DISPATCH_PROVEN_NOOP`, and the schema contract structurally forbids a `bindings` key.
- The **Mobile Runtime horizon** (already closed, `mobile/`) independently built **real** Commerce
  data fetching and **real** add-to-cart/update/remove dispatch — but did so by hand-writing the
  binding and screen composition directly in Dart, entirely outside the schema pipeline.

Evidence:

- **Schema fetch**: no real remote fetch exists. `lib/app/runtime_schema.dart` bundles
  `kHomeSchemaJson`/`kCartSchemaJson` as hardcoded Dart string constants. `lib/startup/
  last_known_good.dart` is a fully designed, unit-tested **decision mechanism** (fetch-succeeded/
  fetch-failed/cache-corrupted/incompatible fail-closed paths, integrity-digest-checked cache,
  rollback-target selection) that is **never wired to a real network call or real on-device cache**
  — its own doc comment says so explicitly.
- **Data for ProductList/ProductDetail**: real `commerce/v1` HTTP calls via `lib/commerce/
  commerce_client.dart`, but **the binding is imperative and per-screen**, not schema-declared:
  `lib/app/home_screen.dart` fetches products then builds fresh `ProductCard` `SchemaComponent`
  nodes in Dart and splices them into a named schema "slot" (`hydrateNode`, `lib/app/
  experience_hydration.dart`); `lib/app/product_screen.dart` doesn't even parse a bundled schema for
  its `ProductDetail` tree — it's built directly in Dart from the fetched detail response; `lib/app/
  cart_screen.dart` does the same slot-hydration pattern for cart lines. Registry widgets themselves
  (`component_widgets.dart`) never call the API — by explicit doc comment, "Real data binding is
  MOBILE-RUNTIME-4/5's job."
- **Action dispatch is actually real in `mobile/` today**, despite the backend's `DISPATCH_PROVEN_
  NOOP` label: `lib/app/runtime_action_handler.dart`'s `RuntimeActionHandler` (wired in production at
  `awj_runtime_shell.dart`) makes real `commerce/v1` cart mutations for `addToCart`/
  `updateCartQuantity`/`removeCartItem`, never optimistically, only after server acceptance.
  `NoopActionHandler` still exists but is only the test/default fallback, not what ships. The
  `DISPATCH_PROVEN_NOOP` string appears **nowhere** in `mobile/` — it is purely a backend App
  Builder contract label describing what the *schema/canvas* can prove, not what the shipped
  runtime does.
- **Tenant/session**: tenant identity is a **build-time secret** (`COMMERCE_STORE_BEARER_TOKEN` via
  `--dart-define`, `lib/commerce/commerce_config.dart`), never derived from schema — the schema
  parser has no field for it at all. Customer/cart tokens are stored via `flutter_secure_storage`
  (Keychain/Keystore); no login UI is wired anywhere yet (`grep` for `LoginScreen`/`verifyOtp` finds
  only unused client method definitions) — the runtime today operates purely as a guest.
- **Theme tokens**: parsed (`ThemeTokens`, arbitrary `Map<String,String>`) but **never applied**.
  `lib/app.dart` hardcodes `colorSchemeSeed: Color(0xFF0F6A5A)` — coincidentally matching the
  fixture schema's own hardcoded value, not derived from it. No radius/density/product-card-style
  token is consumed anywhere in `component_widgets.dart`.
- **Compatibility/fail-closed**: `CompatibilityResolver` (Dart, mirrored 1:1 by the PHP port) fails
  a **required** unsupported node closed for the whole document, prunes an **optional** one with a
  fallback note, and `selectRollbackTarget()` picks the newest schema still compatible with the
  current manifest. This machinery already exists and is exactly the mechanism §3.6 proposes reusing
  for new capability gating.

### 1.3 AWJ Commerce API surfaces — the real backend truth to bind to

**Four separate customer-facing/M2M API surfaces exist; they must not be conflated:**

| Prefix | Route file | Consumer | Auth |
|---|---|---|---|
| `api/*` | `routes/api.php` | merchant/staff web app | Sanctum user token + RBAC |
| `api/v1` | `routes/api_public.php` | 3rd-party M2M | scoped API keys |
| `store/v1` | `routes/api_storefront.php` | Next.js storefront (`storefront/`), anonymous browser | host-based tenant + cookie cart token |
| **`commerce/v1`** | `routes/api_commerce.php` | **the mobile app / App Builder output** | store bearer + optional `X-Customer-Token` |

**`commerce/v1` is the one the Data Resource Registry must bind to.** It already has a canonical
machine-readable contract: `docs/openapi/commerce-api-v1.yaml` (OpenAPI 3, "AWJ Commerce Mobile
API", 1883 lines), which `mobile/lib/commerce/commerce_config.dart` names explicitly as its source
of truth. `storefront/` must **not** be used as the binding model — its README states it is a
mid-migration fork of the open-source Spree Commerce storefront, and its cart/checkout/customer-auth
code paths still speak the Spree SDK protocol, not AWJ's. Only its `storefrontFetch()` single-funnel
pattern and its `mappers.ts` adapter-boundary idea (raw wire contract → normalized shape → per-
target view) are reusable ideas, not its code.

Per-resource evidence on `commerce/v1`:

- **Categories** — `GET categories`, `GET categories/{id}` → `CommerceCategoryController`. No
  English name field today (`name_en` missing) — confirmed schema gap.
- **Products** — `GET products` (filter: `search`, `category_id`; sort: allow-listed `name`,
  `sale_price`, `created_at`, both directions; pagination: `page`/`per_page`, max 100), `GET
  products/{id}` → `CommerceProductController`. Wire shape includes `name`+`name_en` (dual-field
  localization, no `Accept-Language` negotiation — client picks the field), `price.amount_minor` +
  `currency` (always resolved via `CommercePriceResolver`, never a raw column — consistent with
  CLAUDE.md's minor-units rule), `in_stock: bool|null` (derived, `null` = "unknown" when no
  `FulfillmentPolicy` configured, never a lying `false`), `is_variant_managed`, `options`/`variants`
  (detail only) as real relations off `ProductOption`/`ProductOptionValue`/`ProductVariant` models
  (server-computed `combination_key`, DB-unique constrained).
- **Cart** — real, server-authoritative model (`CommerceCart`/`CommerceCartItem`, `CompanyWide`),
  never a financial document. Guest identity is an opaque bearer token, sha256-hashed at rest,
  carried as `X-Cart-Token` (never `Authorization`). One-shot lifecycle: `active → checkout →
  CommerceOrder created → consumed` (terminal — a consumed cart can never be reused; buying again
  needs a new cart/token).
- **Checkout/Orders** — `CommerceOrder != Invoice`: no ledger/inventory effect at creation or
  confirmation; `status` is `draft`/`confirmed` only; payment/fulfillment axes are not built yet.
- **Customer auth** — phone+OTP or email+password, `X-Customer-Token`, fully implemented
  server-side but **unused by the mobile UI today** (no login screen wired — see §1.2).
- **Promotions/policies** — **no resource exists on `commerce/v1` today.** Advertising promotions
  in the App Builder would be new backend surface, not a registry-binding problem.
- **Tenant boundary, without merchant login**: the store bearer resolves tenant identity server-side
  from `ApiClient.tenant_id` (`AuthenticateApiClient`, "لا من ترويسة/معامل استعلام/جسم" — never
  header/query/body), then `ResolveCommerceChannel` resolves the tenant's single active `mobile`
  `SalesChannel` with zero client input, fail-closed 404 otherwise. An optional customer token layers
  on top, itself re-checked against `tenant_id` server-side even though it rides the same request as
  the store bearer. **Tenant authority is already 100% server-derived on this surface — nothing new
  is required for this invariant; the Data Resource Registry inherits it for free by binding to
  `commerce/v1` rather than inventing a parallel channel.**
- **Versioning convention**: path-segment only (`commerce/v1`), no header-based content
  negotiation; a future v2 would be a new prefix + new `ServiceProvider`, never in-place
  reinterpretation of an existing path.

### 1.4 App Builder web UI — merchant-facing localization gap (confirmed, in scope per mission)

Chrome (buttons, section titles, empty states) is translated in `ar.json`/`en.json`. **The
selectable/displayed values are not**:

- `inspector.tsx:286` — component header renders `{definition.type}` raw (literally "ProductCard").
- `inspector.tsx:341-346` — "Add item" dropdown options are `componentTypeOptions.map(type =>
  <option>{type}</option>)` — English camelCase identifiers with no Arabic labels.
- `inspector.tsx:306-311` — action-type dropdown, same raw-identifier pattern.
- `inspector.tsx:138,205` — every prop/param row label is the raw registry key (`amountMinor`,
  `imageUrl`, `cartItemId`, `productId`).
- `layers-tree.tsx:110`, `canvas.tsx:36-46,83` — tree rows and canvas `TypeTag` badges show
  `node.type` raw.

No translation-key concept exists per component/action/prop type in `ComponentRegistry`/
`ActionRegistry` today — only the surrounding chrome is localized.

### 1.5 Theme token canvas/runtime rendering gap (confirmed, in scope per mission)

Confirmed on **both** ends of the pipeline, already documented as a known limitation at Horizon V1
closure:

- **Web canvas**: `canvas.tsx:303-315`'s own code comment: only `primaryColor` is wired into live
  CSS vars; radius/density/product-card-style are persisted/diffed/synced but never visually
  reflected. `web/tailwind.config.ts:27-29` hardcodes `borderRadius: { DEFAULT: '0.5rem' }` as a
  literal, not `var(--radius)` — the code-level cause.
- **Flutter runtime**: `AppSchema.theme` is parsed but never read anywhere at runtime;
  `component_widgets.dart` uses fixed Material defaults throughout (`Card`, `Quantity`, `Button`,
  etc.) with no theme-resolver layer translating tokens into `ThemeData`/`CardTheme`.

This is a small, independent, well-scoped fix (§9, task `APP-BUILDER-20`) — it does not require
redesigning theme tokens, only wiring the already-persisted values into the two rendering targets
that currently ignore them.

---

## 2. External evidence

Kept explicitly separate from AWJ's own decision, per the horizon's evidence-pass rule.

- **Shopify Storefront API** — versioned by URL path segment (`/api/2026-07/graphql.json`),
  quarterly release cadence; the 2026-07 Collections model introduces "typed inclusion conditions
  plus manual selections" as its constrained condition mechanism for group membership — a
  precedent for a small, typed, non-expression-language condition vocabulary rather than free-form
  rules. ([shopify.dev/docs/api/usage/versioning](https://shopify.dev/docs/api/usage/versioning),
  [shopify.dev/changelog/new-collection-model-and-apis-now-available](https://shopify.dev/changelog/new-collection-model-and-apis-now-available))
- **Builder.io custom components / data binding** — components declare typed input props; CMS
  content is bound onto those props declaratively through the visual editor; the platform's own
  community feedback notes that some interaction patterns (e.g. user-driven list add/remove) still
  require code — evidence that a purely declarative binding model has known, acceptable limits, not
  a reason to add an expression engine. ([builder.io/c/docs/data-binding-overview](https://www.builder.io/c/docs/data-binding-overview))
- **Server-driven UI, "Blueprint" pattern** — "a UI contract that carries structure — which
  components go where, with what data bindings, visibility, and access rules. It never carries
  behavior; logic stays in typed, testable code." This is close to a direct precedent for AWJ's own
  existing invariant (schema is declarative/untrusted, logic lives in `LedgerService`/Commerce
  services) and directly supports §3.3's typed-signal condition model over any expression parser.
  ([dev.to/kensaadi — "Your UI config quietly became a programming language. Here's the fix"](https://dev.to/kensaadi/your-ui-config-quietly-became-a-programming-language-heres-the-fix-19kb))
- **Apple App Store Review Guideline 2.5.2** — apps "may not download, install, or execute code
  which introduces or changes features or functionality," with a narrow, inapplicable educational-
  app exception. Does not explicitly bless "content-only" updates, but by clear implication a
  JSON-only, declarative, non-executable schema update (no new component/action *identity*, only new
  structure/props/bindings/visibility using an already-shipped, closed vocabulary) sits outside this
  restriction, while shipping a new component/action/resource *type* the installed binary doesn't
  already know about does not. ([developer.apple.com/app-store/review/guidelines](https://developer.apple.com/app-store/review/guidelines/))
- **Google Play** — dynamic code loading (fetching and executing interpreted/native code at
  runtime) is treated as a deceptive-behavior/malware risk category, reinforcing the same
  restriction from the other major platform: ship logic in the binary, only data over the wire.
  ([developer.android.com/privacy-and-security/risks/dynamic-code-loading](https://developer.android.com/privacy-and-security/risks/dynamic-code-loading))

**AWJ consequence of combined external evidence**: the existing invariant ("App Schema is
declarative untrusted configuration, no eval/arbitrary JS/SQL/HTTP") is not just an AWJ preference —
it is the load-bearing reason a schema-only update can plausibly avoid store review at all on both
platforms. Any binding/condition design that introduced an expression language or arbitrary
resource-URL field would both violate AWJ's own non-negotiable and put every "instant update" claim
at legal/policy risk. This hardens, not loosens, the proposal in §3.

---

## 3. AWJ Decision / Proposal

### 3.1 Data Resource Registry — proposed V1 resource set

Binds to `commerce/v1` only (§1.3), never `store/v1` or the Spree-transitional `storefront/`.

| Resource ID | Source | Readable fields | Filter | Sort | Pagination | Localization | Auth | Tenant boundary |
|---|---|---|---|---|---|---|---|---|
| `commerce.categories` | `GET commerce/v1/categories[/{id}]` | id, name, name_en\* | — | — | list only | dual-field, client picks | store bearer | inherited from `commerce/v1` (server-derived, §1.3) |
| `commerce.products` | `GET commerce/v1/products[/{id}]` | id, name, name_en, description, sku, category, price(amount_minor,currency), in_stock, thumbnail_url, media(detail), is_variant_managed, options, variants | `category_id`, `search` (registry allowlist only) | `name`, `sale_price`, `created_at` × asc/desc (registry allowlist only) | `page`/`per_page`, max 100 | dual-field | store bearer | inherited |
| `commerce.cart` | `GET commerce/v1/cart` | items, totals (whatever the endpoint already returns) | — | — | — | n/a | store bearer + `X-Cart-Token` | inherited |

\* `commerce.categories.name_en` is currently `null` on the wire — the registry must expose this as
a known gap (fall back to `name`), not silently invent an English value.

**Explicitly excluded from V1**, with reasons (an owner call in §8, not a technical blocker):

- `commerce.customer.profile` / `commerce.orders` — the endpoints exist and are fully built
  server-side, but **no login UI is wired in `mobile/` at all** (§1.2). Binding a component to
  customer data before a login flow exists would render nothing meaningful. Recommend deferring to
  a follow-on task once a login screen is built, not blocking this registry's V1 shape.
- `commerce.promotions` — no backend resource exists yet (§1.3). Out of scope; would be new
  Commerce Core surface, not a registry-binding task.

**Per-resource contract, standardized across all three (mirrors what `commerce/v1` already does,
so no new envelope is invented)**:
- Errors/loading/empty: reuse the existing `PublicApiResponse`/`PublicApiErrorCode` envelope
  `commerce/v1` already returns; the registry defines no parallel error shape.
- Compatibility/version behavior: each resource id is implicitly bound to one API version
  (`commerce/v1` today); a hypothetical `commerce/v2` migration ships as new resource ids
  (`commerce.products.v2`), never silent reinterpretation — mirrors the path-segment-only
  versioning convention already used across all four API surfaces.

### 3.2 App Schema Binding

- Add one new **optional** component-node key, `binding`, to the currently closed key-list. Its
  presence is gated by a new `requiredCapabilities` entry (e.g. `"dataBinding": "1.0"`) — an
  installed runtime that doesn't declare this capability treats any node carrying `binding` exactly
  like an unsupported component today (optional node → pruned with a fallback note; required node →
  whole document fails closed). **No new fail-closed mechanism needs to be built — `Compatibility
  Resolver` already does this for components/actions; this is the same mechanism applied to one more
  node-level concept.**
- Only components whose `ComponentDefinition` declares a new metadata field, `bindableResource:
  string[]` (the resource ids it may bind to), may carry `binding` at all — initially
  `ProductList`/`CartList` (list-shaped, bind to `commerce.products`/`commerce.cart`) and
  `ProductDetail`/`CartSummary` (single-item-shaped). `AppSchemaParser` structurally validates the
  binding object's shape (closed sub-key list: `resource`, `query`, `itemProps`); `Compatibility
  Resolver` validates resource identity + field/filter/sort allowlist against `DataResourceRegistry`
  at publish time (new resolution step, same phase split already used for components/actions).
- Binding shape (closed JSON, no arbitrary expressions):
  ```json
  {
    "resource": "commerce.products",
    "query": { "category_id": "$route.categoryId", "sort": "name" },
    "itemProps": { "title": "name", "imageUrl": "thumbnail_url", "amountMinor": "price.amount_minor" }
  }
  ```
  `query` values are either literal scalars or one of a small enumerated set of runtime-context
  references (`$route.categoryId`, `$context.customerId`, …) — never a string template or
  evaluated expression. `itemProps` maps a component's existing registry-declared prop name to a
  resource-declared readable field path; both sides are validated against static registries, so an
  unknown field or unknown prop is rejected at publish time, not at runtime.

### 3.3 Conditions / Visibility

- New optional `visibility` key, same capability-gating mechanism as §3.2 (`"visibility": "1.0"`).
- Closed, typed condition shape — no expression engine, per the external evidence in §2:
  ```json
  { "any": [
      { "signal": "product.inStock", "operator": "isTrue" },
      { "signal": "cart.itemCount", "operator": "gt", "value": 0 }
  ]}
  ```
  Enumerated **signals** (read-only, resolved server-side-shaped data already fetched for the node's
  binding, or a small fixed context set: `cart.itemCount`, `customer.isAuthenticated`,
  `product.inStock`, a bound item's own resolved fields). Enumerated **operators**: `equals,
  notEquals, gt, lt, gte, lte, in, isTrue, isFalse`. Bounded nesting via `all`/`any` combinators,
  reusing the existing depth budget (≤4, well inside today's ≤8 props-nesting limit).
- **Visibility is presentation only, never authorization** — stated as a hard invariant, not a
  recommendation: hiding an `AddToCart` button changes nothing about `commerce/v1`'s own
  independent, already-enforced auth/tenant checks on the cart-mutation endpoint. A hidden control
  and a shown-but-rejected control must produce the identical server-side outcome. This costs
  nothing new to build — it falls out of the fact that every action already dispatches to a real,
  independently-authorized endpoint (§1.2, §1.3) regardless of the schema's rendering decision.

### 3.4 Actions

- **Reuse `ActionRegistry`'s existing 6 actions verbatim** — no rebuild, per the mission's explicit
  instruction.
- The real work is reconciling §1.2's "two truths": once `binding` (§3.2) supplies live item
  context, an action's params (e.g. `addToCart`'s `productId`) can reference that context (e.g.
  `"$item.id"`, using the same enumerated-reference syntax as §3.2, never a literal merchant-typed
  string) instead of being hand-typed in the Inspector. `RuntimeActionHandler` (already real, §1.2)
  needs to resolve such a reference against the currently-rendered bound item before dispatching —
  an extension of existing code, not new dispatch logic.
- Once an action is reachable end-to-end through a bound, schema-declared path,
  `ActionRegistry`'s `dispatchStatus` for that action should be updated to reflect it (a new status,
  e.g. `DISPATCH_LIVE`, distinct from `DISPATCH_PROVEN_NOOP`) so the Inspector UI stops implying
  Commerce actions do nothing — they already do, in the runtime, just not yet through the schema.

### 3.5 Mobile Runtime resolution pipeline

```
Published Schema (fetch — see §8 Decision Point 1)
  → CompatibilityResolver (extended: also resolves binding/visibility capability + resource identity)
  → for each node carrying `binding`: a new BindingResolver issues the real commerce/v1 call via the
    existing CommerceClient (extended, not replaced) and hydrates itemProps
  → for each node carrying `visibility`: evaluate against already-resolved context, prune or keep
  → ComponentRegistry renders (unchanged)
  → user taps an actionable node → decodeAction (unchanged) → AppActionDispatcher.dispatch
  → RuntimeActionHandler (already real, extended to resolve dynamic params from bound item context)
  → commerce/v1 mutation (unchanged endpoints)
```

This pipeline **generalizes** the three currently-duplicated, hand-written binding implementations
(`home_screen.dart`, `product_screen.dart`, `cart_screen.dart`'s independent fetch+`hydrateNode`
logic) into one schema-driven resolver, rather than adding a fourth parallel implementation.
Tenant/session boundary is unchanged: the store bearer remains a build-time secret outside schema
reach; `BindingResolver` only ever calls the same fixed, store-bearer-scoped `commerce/v1` base URL
the client already uses — it cannot address any other tenant's data because nothing about tenant
resolution moves into the schema or the resolver.

### 3.6 Versioning / migrations

- Both new schema keys (`binding`, `visibility`) ship behind their own `requiredCapabilities`
  entries, never a bare `schemaVersion` bump alone. An already-published schema declares neither
  capability and is completely unaffected — it validates and renders exactly as it does today,
  forever. A newly-authored schema using either feature simply will not render on an
  outdated-but-still-supported installed app until that app updates its manifest — this is the
  **same, already-tested** optional-node-pruned / required-node-fails-closed behavior `Compatibility
  Resolver` already implements for components and actions; no new failure mode is introduced.
- `DataResourceRegistry` resource ids are versioned by implication (`commerce.products` implies
  `commerce/v1`); a future `commerce/v2` migration adds new resource ids rather than reinterpreting
  existing ones, mirroring the path-segment-only API versioning convention already in force across
  all four surfaces (§1.3).

---

## 4. Update / Release Matrix

| Change | Category |
|---|---|
| A product's price/name/stock/image changes in Commerce Core | **A** — resolved live by `BindingResolver` at render time; no republish needed, works today even for `ProductDetail`'s existing hardcoded fetch |
| A `ProductList`'s query (category filter, sort order) changes | **B** — schema edit → Draft → Validate → Publish (binding is schema-declared, §3.2) |
| A new page, new layout, added/removed component, new condition rule, new binding on an existing bindable component, theme token change | **B** |
| A schema starts using a **capability the installed app doesn't support yet** (e.g. `binding`/`visibility` before that runtime ships) | **C** *in principle* — but see the flag below: **no live fetch/cache loop exists to deliver this "compatible runtime update" today** |
| A new component type, new action type, or new resource id not already compiled into the shipped Dart binary (`ComponentRegistry`/`ActionRegistry`/`DataResourceRegistry` are static Dart maps, not server-driven) | **D** — new native build required |
| Any native build (category D) reaching end users | **E** — App Store / Google Play submission and review |
| Actual propagation timing/rollout of an approved build | **F** — depends on phased-rollout settings and each user's own auto-update settings; not instantaneous even after E |

**Critical, evidence-based flag — this is the single most consequential open question for the whole
horizon:** `mobile/` does **not** fetch published schemas over the network at all today (§1.2 —
bundled fixtures only). `last_known_good.dart`'s fetch/fallback/cache logic is fully designed and
unit-tested but never wired to a real HTTP call or real on-device cache. **Until that wiring exists,
every App-Builder-driven experience change — however "no-code" it looks in the web Builder — still
requires a new native build (category D) to reach any device, regardless of category A/B classification
above.** This would substantially undercut the App Builder's core merchant promise. Per the mission's
own instruction ("Do not claim OTA/immediate native behavior without evidence"), this document
makes no such claim and instead raises it as Decision Point 1 in §8.

---

## 5. Same-Store Proof — what is achievable under this proposal, and what is not yet

Achievable end-to-end under §3, once implemented and approved:

```
AWJ product (Product/ProductVariant, real backend row)
  → Storefront representation (existing store/v1 path, unaffected)
  → App resource (commerce.products via commerce/v1 — same authoritative price/stock resolvers
    CommercePriceResolver/AvailableToSellService already used by both Storefront and the existing
    hardcoded mobile screens)
  → mobile rendering (ComponentRegistry, unchanged)
  → variant/options (already real models, exposed on product detail; VariantSelector's live wiring
    is new work per §3.2/§3.4)
  → price/inventory (already live, unchanged)
  → Add to Cart (already real dispatch per §1.2/§3.4, just not yet schema-reachable)
  → cart/checkout boundary (already real, unchanged — CommerceCart's one-shot lifecycle)
```

**Not provable without a further owner decision**: whether this journey happens *inside a
merchant-published, no-code-configured experience* (requires §8 Decision Point 1 resolved) or only
*inside a new native build carrying an updated fixture schema* (achievable without that decision, but
does not prove the "no-code" claim the App Builder exists for). The integrated proof task (§9,
`APP-BUILDER-18`) must state honestly which of these two it demonstrates and must not present a
fixture-schema build as equivalent to a live no-code publish.

---

## 6. Security / Tenant Isolation analysis

- Tenant authority remains 100% server-side under this proposal — nothing changes about how
  `commerce/v1` resolves tenant (§1.3). The schema never gains a tenant/resource-URL/SQL field; the
  new `binding`/`visibility` vocabularies are closed, statically-validated enumerations, never
  string-interpolated or evaluated (§2's external evidence directly informs this: an expression
  engine would be both an AWJ invariant violation and an Apple/Google policy risk).
- No new backend endpoint is introduced by this proposal — binding/condition resolution happens
  client-side in the Flutter runtime against the already-tenant-scoped, already-authorized
  `commerce/v1` API. If a future Preview feature needs server-side binding resolution (e.g. for a
  web-based live preview), that would need its own cross-tenant negative tests at that time — flagged
  as a forward note, not built here.
- Visibility is explicitly barred from ever gating authorization (§3.3) — this closes off the most
  common real-world mistake in server-driven UI systems (hiding a control instead of also checking
  the server), and costs nothing extra to enforce because every dispatched action already goes
  through its own independent `commerce/v1` auth check regardless of what the UI shows.
- `AppSchemaParser`'s validation stays a closed allowlist extended only additively — no existing key
  changes meaning, so no existing security boundary weakens.

---

## 7. Backward compatibility analysis

- Every already-published `BuilderPublishedExperienceVersion` declares no `dataBinding`/
  `visibility` capability and contains no `binding`/`visibility` keys — it is structurally
  unaffected by this proposal; `AppSchemaParser`/`CompatibilityResolver` will parse and resolve it
  identically to today.
- `AppSchemaParser`'s `COMPONENT_KEYS` allowlist gains two new **optional** entries; no existing key
  is removed, renamed, or repurposed.
- `ComponentDefinition`/`ActionDefinition` gain new optional metadata fields (`bindableResource`,
  param-reference eligibility) — purely additive, existing registry consumers (the Inspector, the
  Dart-side manifest mirror) are unaffected until they choose to read the new fields.
- `DataResourceRegistry` goes from a guarded-empty stub to a guarded-populated one — the existing
  test (`DataResourceRegistryTest.php`) will need updating as part of implementation, which is
  expected and was anticipated by the stub's own design.

---

## 8. Open Decision — Escalation Packet

Per `docs/autonomous-engineering/DECISION-ESCALATION.md`'s required format. This is the mission's
own "FIRST mandatory escalation."

### DECISION REQUIRED
**Decision ID:** ADR-APP-BUILDER-COMMERCE-RUNTIME-V1-01
**Task / blocker:** Approve or amend the Data Resource Registry / App Schema Binding / Conditions-
Visibility / Real Dispatch architecture proposed in §3 before any implementation task is promoted to
`ready`.
**Why a decision is required now:** This is exactly the boundary that made `APP-BUILDER-7` and part
of `APP-BUILDER-11` `decision_required` in the prior horizon — an unlocked Data Source Registry
contract and an unbuilt condition/expression model. Building anything here without a locked contract
repeats that same escalation.
**Current repository evidence:** §1 (backend contract is closed/empty by design; mobile runtime
already does real dispatch and real data fetching, but only through hand-written, non-schema-driven
code; `commerce/v1` is the real, documented API surface to bind to; no live schema-fetch/cache loop
is wired).
**External evidence:** §2 (Shopify's typed-condition Collections model, Builder.io's declarative
binding-with-known-limits, the "Blueprint" structure-only server-driven-UI pattern, and both Apple's
and Google's policies against downloaded/executable code — all point toward a small, closed, typed
vocabulary rather than an expression engine).

**Option A — Adopt the proposal in §3 as-is (recommended).** Locks Data Resource Registry to
`commerce/v1`'s 3 justified resources (§3.1), adds `binding`/`visibility` as capability-gated
optional schema keys (§3.2/§3.3), reuses the existing 6 actions with dynamic-param resolution
(§3.4), generalizes the mobile runtime's three duplicated hand-written binding implementations into
one resolver (§3.5). *Benefits:* directly evidence-grounded, reuses every existing mechanism
(`CompatibilityResolver`'s fail-closed/prune logic, `commerce/v1`'s existing tenant/auth boundary,
`RuntimeActionHandler`'s already-real dispatch) rather than inventing new ones; fully backward
compatible (§7); matches external precedent (§2) closely enough to defend against an app-store
policy challenge. *Risks:* still leaves Decision Point 1 (below) open — without it, the "no-code"
promise is only partially delivered. *Cost:* moderate — one new backend resolution step, one new
mobile resolver replacing three ad hoc ones, no new backend endpoints.

**Option B — Narrower V1: bindings only, defer Conditions/Visibility to a follow-on decision.**
Ship §3.1/§3.2/§3.4/§3.5 now; treat §3.3 as its own future architecture decision. *Benefits:*
smaller, faster to land; Conditions/Visibility genuinely has the least existing precedent of the
four concepts and the most room for scope creep into an expression language if rushed. *Risks:*
does not close the originally-deferred `APP-BUILDER-7` scope in one horizon, extending this
connected-deferred track further; merchants get live data but not conditional/personalized layouts.

**Other viable options:** Reject binding/visibility as schema concepts entirely and require any
"dynamic" behavior to ship as a new native build per merchant segment — technically simplest, but
abandons the App Builder's stated purpose and contradicts the mission's non-negotiable principle.
Not recommended; included only for completeness.

**Decision Point 1 (nested, must be resolved either way):** Does this horizon also wire the live
publish → fetch → on-device-cache loop (extending `last_known_good.dart`, which is already fully
designed and unit-tested but has zero real I/O — §1.2, §4)? **Without it, §3's entire binding/
visibility mechanism only ever runs against a schema baked into a native build at compile time**,
which satisfies the architecture-decision-gate this document exists for, but does not satisfy the
mission's "prove the generated mobile experience consumes the same Commerce Core... via true no-code
publish" spirit. Recommend: **yes, include it** — it is the one piece of infrastructure that turns
everything else in §3 from "a better-typed static app" into an actual App Builder, and the
groundwork (`last_known_good.dart`) already exists and is tested; wiring it is bounded, known-scope
work (a fetch endpoint reusing `BuilderPublishedExperienceVersion`'s existing immutable rows, plus a
platform cache read/write), not a new architecture decision.

**Decision Point 2:** Confirm exclusion of `commerce.customer.profile`/`commerce.orders` from V1
(§3.1) given no login UI exists in `mobile/` yet — recommend confirming exclusion; building a
customer-data binding before any login flow ships would be speculative.

**Claude recommendation:** Option A, with Decision Point 1 resolved **yes** and Decision Point 2
resolved **exclude for V1**. This is the smallest architecture that actually closes the deferred
`APP-BUILDER-7`/`APP-BUILDER-11` track, reuses every existing safety mechanism instead of inventing
new ones, and is fully defensible against both AWJ's own non-negotiables and the external
Apple/Google evidence in §2.

**What changes if accepted:** `AppSchemaParser` gains two new optional keys behind capability gates;
`DataResourceRegistry` gains 3 real resources; `ComponentRegistry`/`ActionRegistry` gain additive
metadata; the mobile runtime gains one generalized binding/visibility resolver replacing three ad
hoc implementations; (if Decision Point 1 = yes) a real publish→fetch→cache loop is wired for the
first time.

**What remains unchanged:** Every already-published experience version; the `commerce/v1` API
contract and its tenant/auth boundary; the 15 existing components and 6 existing actions'
identities; `LedgerService`/accounting semantics (zero accounting impact — this horizon touches no
financial posting path); RBAC gates (`apps_builder.*`); the "Commerce Core is sole business-truth
authority" invariant.

**Can unrelated work continue safely?:** YES — the Builder UX/localization pass (§10) and the
theme-token canvas/runtime rendering fix (§11) have **no dependency** on this decision and can be
scheduled independently once authorized, per the mission's own item ordering (7 and 8 are listed
alongside, not after, the data/runtime work).

---

## 9. Proposed implementation queue (post-approval only — not authorized, blocked on §8)

Draft task decomposition, to be finalized once §8 resolves (per the mission: "the exact task
decomposition must come from evidence, not this approximate list"):

1. `APP-BUILDER-13` — Data Resource Registry V1 foundation (populate `DataResourceRegistry` with
   the 3 resources in §3.1; update its guarding test).
2. `APP-BUILDER-14` — App Schema binding contract (`AppSchemaParser` optional `binding` key +
   capability gate; `CompatibilityResolver` resource/field-allowlist resolution).
3. `APP-BUILDER-15` — Builder Data UX (Inspector surface for choosing a resource/query/itemProps
   binding on a bindable component).
4. `APP-BUILDER-16` — Conditions/Visibility contract (§3.3) + Inspector surface.
5. `APP-BUILDER-17` — Mobile runtime binding/visibility resolver (§3.5), replacing the three ad hoc
   hand-written implementations in `home_screen.dart`/`product_screen.dart`/`cart_screen.dart`.
6. `APP-BUILDER-18` — Real action dispatch wired through schema bindings (§3.4); `ActionRegistry`
   status update.
7. `APP-BUILDER-19` — Live publish → fetch → cache loop (§8 Decision Point 1), if approved.
8. `APP-BUILDER-20` — Same-Store integrated proof (§5), honestly scoped to what §7's decisions
   actually enabled.
9. `APP-BUILDER-21` — App Builder UX/localization pass (§10) — independent, can run in parallel.
10. `APP-BUILDER-22` — Canvas + Flutter theme-token rendering fix (§11) — independent, can run in
    parallel.
11. `APP-BUILDER-23` — Horizon closure report.

---

## 10. Mandatory UX/localization pass — evidence (task-ready, independent of §8)

Confirmed gap (§1.4): merchant-facing Layers/Inspector/canvas panels display raw internal schema
identifiers (`ProductCard`, `addToCart`, `amountMinor`, …) with no translation layer, while
surrounding chrome is already localized. Proposed fix: add a `labels: {ar: string, en: string}`
metadata field to each `ComponentDefinition`/`ActionDefinition`/prop definition (additive, no schema
identifier renamed — the mission is explicit that internal identifiers like `ProductList`,
`AddToCart` must not change), then have `inspector.tsx`/`layers-tree.tsx`/`canvas.tsx` render the
localized label with the raw identifier as a secondary/tooltip value for merchants who also work
with support docs referencing the technical name. This is additive metadata + a rendering change,
not a contract change — it does not need to wait on §8 and can be its own independent task
(`APP-BUILDER-21`).

## 11. Known canvas/runtime theme-token gap — evidence (task-ready, independent of §8)

Confirmed on both the Next.js Builder canvas (`tailwind.config.ts`'s hardcoded `borderRadius.
DEFAULT`) and the Flutter runtime (`ThemeTokens` parsed but never read) — §1.5. Proposed fix: wire
`--radius`/density/product-card-style as real CSS custom properties consumed by `tailwind.config.ts`
on the web side, and add a thin theme-resolver in `lib/app.dart` that maps `ThemeTokens` into
`ThemeData`/`CardTheme`/spacing constants on the Flutter side. No token redesign — this is purely
closing the "persisted but not rendered" gap already named as a known limitation in the
`APP-BUILDER-12` closure report. Independent of §8 (`APP-BUILDER-22`).
