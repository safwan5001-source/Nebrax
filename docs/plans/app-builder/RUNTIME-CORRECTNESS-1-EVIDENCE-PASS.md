# RUNTIME-CORRECTNESS-1 — Evidence Lock

DATE: 2026-09-26
HORIZON: `AWJ_APP_BUILDER_RUNTIME_CORRECTNESS_FOLLOWUP_V1.md`
STARTING MAIN SHA: `298908cb3d5c8809f6bce34e1abacc6c2f1a0695`
CURRENT MAIN SHA AT EVIDENCE TIME: `52d1ede313196c4042fe47c44b2c6fcd57af8c84` (this Horizon's own merge)
SCOPE: Evidence only. No runtime/test code changed. No behavior changed.

## Verdict (up front)

**RUNTIME-CORRECTNESS-2 is READY.** No Decision Gate is triggered. Both LIVE-PREVIEW-7 findings
are re-confirmed against current `main`, unchanged in substance. The smallest safe generic fix
for Finding B can use the schema's existing `node.type` field — already a first-class, already-
capability-gated identifier (`RuntimeCapabilities.components['CartSummary']`) — with no new
schema/API field and no special-cased id. The bundled Default Experience has exactly one
`CartSummary` node, so no multiple-node ambiguity exists in any schema this repository ships or
tests today.

## 1. Finding A — the exact overclaiming tests/comments

Two PHP tests author a `ProductList` bound to `commerce.products` with an `itemProps` key, and
both claim (in their doc comments) more than their assertions prove:

### `tests/Feature/AppBuilderIntegratedProofTest.php:277-328`
(`integrated_proof_accepts_binding_structurally_and_now_publishes_a_shipped_resource_binding`)

- Schema authored (lines 296-302):
  ```php
  ['type' => 'ProductList', 'id' => 'bound-list', 'binding' => [
      'resource' => 'commerce.products',
      'itemProps' => ['title' => 'name'],
  ]]
  ```
- Doc comment (lines 266-274) claims this proof "**يعبر الآن** فعلياً إلى نشرٍ حقيقي لربط بيانات
  حيّ" ("**now actually crosses** into a real publish of a live data binding").
- What it actually asserts: `PUT .../draft` → `200`, `POST .../validate` → `valid: true`,
  `POST .../versions` → `201` with the binding echoed back verbatim in the stored schema, plus two
  static assertions on `DataResourceRegistry::RESOURCES` / `RuntimeCapabilities::DATA_RESOURCES`.
  **No fetch, no `CompatibilityResolver`, no Dart runtime, no rendering of any kind.** "Live data
  binding" here means only "the server accepted and stored the binding" — not that any device ever
  hydrates it.

### `tests/Feature/AppBuilderSameStoreProofTest.php:77-192`
(`published_app_builder_experience_and_storefront_web_resolve_the_identical_commerce_core_product_data`)

- Schema authored (lines 126-131), same shape, with two `itemProps`:
  ```php
  ['type' => 'ProductList', 'id' => 'products', 'binding' => [
      'resource' => 'commerce.products',
      'itemProps' => ['title' => 'name', 'amountMinor' => 'price.amount_minor'],
  ]]
  ```
- Doc comment (lines 149-153) claims the fetched document, run through `CompatibilityResolver`,
  "**is genuinely renderable on this shipped runtime — not just structurally accepted at draft
  time**."
- What it actually asserts: `$result->compatible === true` — i.e. `CompatibilityResolver::resolve()`
  accepted the schema's structure/capabilities. `CompatibilityResolver` never touches `binding`
  target shapes at runtime and never renders anything; "compatible" is a structural/version/
  capability verdict, not a rendering verdict. The test then separately verifies REST-level
  product-data parity between `commerce/v1` and `store/v1` (a real, valid, but unrelated claim) —
  it never boots the Dart runtime or asserts any rendered widget.

**Both comments conflate "server accepted/validated a `binding` node" with "the real runtime
renders live per-item data from it."** Those are different claims, and neither test proves the
second one for this specific shape (`itemProps` on a resource whose own wire shape is a list).

## 2. What these tests actually assert (summary)

| Test | Structural validity | Validate/Publish/fetch | Binding *accepted* | Real runtime hydration/rendering |
|---|---|---|---|---|
| `AppBuilderIntegratedProofTest` (the `itemProps`-list case) | ✅ asserted | ✅ asserted (draft/validate/publish) | ✅ (echoed in stored schema) | ❌ never exercised |
| `AppBuilderSameStoreProofTest` (the `itemProps`-list case) | ✅ asserted | ✅ (draft/validate/publish/fetch byte-identity) | ✅ (`CompatibilityResolver.compatible === true`) | ❌ never exercised — no Dart shell, no widget assertion for this schema |

Both tests are valid and useful for exactly what they assert (structural acceptance + publish/fetch
round-trip + REST product-data parity). The defect is **wording only** — RC-2's job.

## 3. The real Dart/runtime binding grammar for list resources

`mobile/lib/app/binding_resolution.dart`, `_resolveBoundNode()` (lines 129-173), branches in this
order on a bound node:

1. **`binding.collect != null`** → always "repeat": read `collect`'s dotted path off the resolved
   resource, expect a `List`, and call `_repeatTemplate` (used by `CartList` — `commerce.cart` +
   `collect: "items"`).
2. **`resolvedResource is List`** (no `collect` needed) → "collection is the resource result
   itself": `_repeatTemplate` directly on the raw list. This is the branch `ProductList` bound to
   `commerce.products` actually takes, because `commerce.products`'s own wire shape is already a
   JSON array.
3. **Otherwise (single object)** → **only here** does `binding.itemProps` get read
   (`readFieldPath(resolvedResource, fieldPath)` per prop), for "a future `CartSummary`-style
   binding" per the file's own comment (line 156).

`_repeatTemplate` (lines 187-203) requires **exactly one authored child** as the item template; it
substitutes `$item.<field>` (via `substituteItemRefsInProps`) into that template once per list
entry. If the bound node has zero or more-than-one children, it fails closed to **zero** rendered
items — never throws, never falls back to `itemProps`.

**Consequence confirmed for both tests above:** their authored `ProductList` nodes (1) have no
`children` key at all (zero authored item template) and (2) are bound to `commerce.products`, a
list-shaped resource. Even if these tests did boot the real runtime, `itemProps` would never be
read (branch 2 wins over branch 3), and `_repeatTemplate` would render **zero** items because no
template child exists. This is exactly what LIVE-PREVIEW-7's closure report already recorded:
"structurally valid, publishes successfully, renders empty on device." Re-confirmed against
current `main`.

The real, working list-binding grammar (proof: `mobile/test/app/awj_runtime_shell_startup_test.dart`
group E, lines 247-268, and the shared fixture `contracts/app-builder/integrated-proof-schema.v1.json`)
is `binding: {resource: "commerce.products"}` **with an authored `ProductCard` template child**
using `$item.name`/`$item.price.amount_minor` — never `itemProps` for a list-shaped resource.

## 4. Tracing `CartSummary`: published schema → startup → hydration → rendered props

1. **Published schema**: a `CartSummary` node on the `cart` page, e.g.
   `{"type": "CartSummary", "id": "<any-id>", "props": {"itemCount": 0, "subtotalAmountMinor": 0}}`
   — the bundled Default schema's own copy is `mobile/lib/app/runtime_schema.dart:135`, id
   `slot.cart.summary`. The shared LIVE-PREVIEW-7 fixture
   (`contracts/app-builder/integrated-proof-schema.v1.json`, `cart` page) uses a **different**,
   generically-authored id: `cart-summary`, same static `itemCount: 0, subtotalAmountMinor: 0`
   props.
2. **Startup/runtime shell**: `resolveRealStartup` → `resolveStartup` (`mobile/lib/startup/
   last_known_good.dart`) picks the Published Experience or falls back per the AWJ Runtime Boot
   contract, entirely agnostic to node ids — this stage never inspects `CartSummary` at all.
3. **`CompatibilityResolver`** (`mobile/lib/schema/compatibility.dart`) gates the whole tree by
   type/version/capability — also entirely id-agnostic.
4. **Hydration** — `CartScreen.build()` (`mobile/lib/app/cart_screen.dart:167-208`):
   - computes live `itemCount`/`subtotalAmountMinor`/`summaryLabel` from the real fetched cart
     (lines 164-165, 202-205);
   - calls `hydrateNode(hydrated, 'slot.cart.summary', (node) => SchemaComponent(... props: {
     itemCount, subtotalAmountMinor, summaryLabel }))` (lines 193-208) — **a hardcoded literal id**.
   - `hydrateNode` (`mobile/lib/app/experience_hydration.dart:18-28`) is a pure structural tree
     walk that replaces the node whose `id == targetId`; it is fail-safe (returns the tree
     unchanged if no node has that id — never throws), and it already walks/transforms **every**
     matching node across sibling subtrees independently (it recurses per-child in a loop, not
     "stop at first match"), it just happens to be called with an id-based predicate today.
5. **Rendered props**: `ComponentRegistry` maps `'CartSummary'` (type) →
   `buildCartSummary` (`mobile/lib/registry/component_widgets.dart:377-407`), which reads
   `props['itemCount']`/`props['subtotalAmountMinor']`/`props['summaryLabel']` and renders them —
   this widget itself is already fully generic; it has no id dependency at all.

**Confirmed defect**: for the shared fixture's own `cart-summary` id (≠ `slot.cart.summary`),
step 4's `hydrateNode` call never matches, so the node keeps its authored static
`itemCount: 0, subtotalAmountMinor: 0` forever — even though the same screen already fetched a
real cart with 1 item / 12345 minor subtotal in the existing group-E fixture data
(`awj_runtime_shell_startup_test.dart:211-233`). No existing test currently asserts this value
(group E's cart test only checks the cart line item text, not the summary), which is why this
defect has shipped silently. **This is a concrete, reproducible, zero-guesswork proof of Finding
B**, not just the closure report's own prior claim.

## 5. Every hardcoded node-id dependency involved in live cart summary recomputation

Only **one** id is involved in the *live cart summary* recomputation path:

- `mobile/lib/app/cart_screen.dart:195` — `'slot.cart.summary'`, the sole hardcoded id feeding
  `itemCount`/`subtotalAmountMinor`/`summaryLabel` into a `CartSummary` node.

Three other `hydrateNode` calls exist in `cart_screen.dart`/`home_screen.dart`
(`'cart-go-home'`, `'cart-line-template-qty'`, `'cart-line-template-remove'`, `'home-tagline'`,
`'home-go-cart'`), but these localize static UI strings (button labels) on the bundled Default
schema's own fixed slots — they are unrelated to "live cart summary recomputation," out of this
task's stated scope (`itemCount`/`subtotal`), and are not touched by this Horizon.

## 6. Can the smallest safe generic fix use existing node type/structure semantics?

**Yes**, with no schema/API change:

- `SchemaComponent.type` (`mobile/lib/schema/app_schema.dart:287`) is already a required,
  non-empty, capability-gated `String` on every node — `RuntimeCapabilities.components['CartSummary']
  = 1` (`mobile/lib/schema/registry_identifiers.dart:30`) already treats `'CartSummary'` as *the*
  canonical, versioned identifier for this component kind. No new field, no new contract.
- `hydrateNode`'s tree walk already visits every node exactly once; its only id-specific part is
  the `root.id == targetId` equality check (`experience_hydration.dart:23`). Generalizing the
  match predicate to `root.type == 'CartSummary'` (or a small `hydrateNodesByType` sibling
  function reusing the same recursive shape) requires no change to the walk itself, no new public
  schema/API field, and no new capability.
- Because the existing walk already applies its transform independently to every matching node it
  finds across sibling subtrees (see §4 point 4), a type-based match is automatically deterministic
  for the "N `CartSummary` nodes" case too: every `CartSummary` node found receives the same
  live-computed `itemCount`/`subtotalAmountMinor`/`summaryLabel`, since those values are cart-level
  aggregates with no per-node distinguishing dimension in the schema today (no node carries any
  other identifying prop, e.g. a scope/filter). This is additive, explicit, and does not require
  inventing a new schema role: **no genuine multi-node ambiguity exists to gate on.**
- No repository schema (bundled Default, the shared LIVE-PREVIEW-7 fixture, or any test fixture)
  authors more than one `CartSummary` node per page today (confirmed by grep across
  `mobile/lib/app/runtime_schema.dart` and `contracts/app-builder/*.json`), so RC-3/RC-4 do not
  need to invent new multi-node product semantics — only preserve the deterministic "apply to all
  matches" behavior the existing walk already provides for free.

**No Decision Gate is triggered**: this is a type-keyed generic lookup using a field the schema
already carries and already capability-gates, not a new schema semantic role.

## 7. Existing tests/harnesses to extend (not duplicate)

- **`mobile/test/app/experience_hydration_test.dart`** — already tests `hydrateNode`'s id-based
  walk (deep nesting, fail-safe miss, root replacement). A generalized type-based variant belongs
  here as sibling unit tests, not a new file.
- **`mobile/test/app/awj_runtime_shell_startup_test.dart` group E** — already boots the real
  `AwjRuntimeShell` against the shared `contracts/app-builder/integrated-proof-schema.v1.json`
  fixture with real fake `commerce/v1` responses (`items: [1 item], subtotal: 12345`), and already
  navigates to Cart. This is the correct, existing integrated-proof harness for RUNTIME-CORRECTNESS-4:
  its cart-page fixture node already uses the non-default id `cart-summary` (not `slot.cart.summary`),
  so it is *already* an arbitrary-id fixture — it just needs a new assertion on the rendered
  summary text/amount (currently absent) to turn this into a red-then-green proof. No second
  runtime harness or fixture is needed.
- **`tests/Feature/AppBuilderIntegratedProofTest.php` / `AppBuilderSameStoreProofTest.php`** — RC-2
  corrects their doc-comment wording in place; their assertions are not touched.

## 8. Decision Gate check (all 8 gates)

1. New public schema/API field or semantic role — **not needed** (type-keyed lookup uses an
   existing field).
2. Multiple valid `CartSummary` instances requiring a new product rule — **no such schema exists**
   today; the existing walk's "apply to every match" behavior is already deterministic.
3. Auth/token/RBAC/Tenant Isolation/Commerce authorization change — **none required**; this is a
   pure client-side Dart tree-walk change.
4. Weakening compatibility/fail-closed behavior — **none**; `hydrateNode`'s fail-safe-on-miss
   behavior is preserved unchanged.
5. Customer identity/product route context/other out-of-horizon capability — **not implicated**.
6. Material runtime architecture redesign — **not needed**; this is a ~5-line predicate
   generalization inside an existing pure function.
7. Arbitrary executable merchant code — **not implicated**.
8. Scope creep into Builder Preview live data, theme wiring, visibility, App Factory,
   signing/distribution/submission, Production deploy — **not implicated**.

**No gate triggers. RUNTIME-CORRECTNESS-2 is READY.**
