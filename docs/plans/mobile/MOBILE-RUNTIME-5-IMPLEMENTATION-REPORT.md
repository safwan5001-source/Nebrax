# MOBILE-RUNTIME-5 — Implementation Report

STATUS: done
DATE: 2026-09-23

## Outcome

Real Home/Product/Cart screens now exist under `mobile/lib/app/`, wiring
MOBILE-RUNTIME-2's schema/compatibility kernel, MOBILE-RUNTIME-3's
Component/Action Registry, and MOBILE-RUNTIME-4's `CommerceClient` into the
horizon's own vertical proof slice: boot → resolve compatibility → Home
from App Schema → live product list from `/commerce/v1` → Product screen
(media/variant/quantity/availability) → Add to Cart → Cart read/update/
remove (`AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md` §5). MOBILE-RUNTIME-1's
placeholder shell and MOBILE-RUNTIME-3's temporary `NoopActionHandler` are
both replaced by real implementations. Deep links (MR-08) and push (MR-09)
remain out of scope — `MOBILE-RUNTIME-7`/`8`.

## Repository evidence / root cause

Continuation of the horizon, not a bug fix. Evidence read before starting:
- `docs/plans/mobile/AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md` §5 (vertical
  proof slice) and §4 MR-06 (state separation: server-authoritative
  Commerce data / published Experience config / navigation parameters /
  ephemeral UI state / sensitive session material — kept separate).
- `mobile/lib/schema/compatibility.dart` read in full: confirmed every
  component/action a schema node uses is checked against the manifest
  regardless of `requiredCapabilities` (a separate, additional check) —
  meaning a bundled schema needs no `requiredCapabilities` block to use any
  of the 15 MR-04 component types at version 1.
- `mobile/lib/registry/component_widgets.dart` read in full: confirmed
  `Quantity`/`VariantSelector` are genuinely local-state-only when given no
  `action` (never dispatch), and that `ProductDetail` already renders
  title/description/image/price in one component — reused directly rather
  than re-assembled from `Text`/`Image`/`Price`.
- MOBILE-RUNTIME-3's own report's "Discovered backlog": "MOBILE-RUNTIME-5
  will need a page-level state coordinator so a `Quantity` selection can
  flow into a sibling `AddToCart` tap's dispatched params" — read and
  resolved by this task (see "Approach chosen" item 4 below).
- No existing `lib/app/` — confirmed via `find`.

## Approach chosen

1. **Home and Cart parse a real bundled App Schema; Product does not.**
   `runtime_schema.dart` holds `kHomeSchemaJson`/`kCartSchemaJson`, each
   parsed via `AppSchema.parse` and resolved via `CompatibilityResolver`
   against `CapabilityManifest.current(currentRuntimePlatform())` — the
   exact same pipeline MOBILE-RUNTIME-2's tests already exercise, now
   exercised for real inside the running app. Product is a single-instance,
   parameterized screen (`productId` is only known once a card is tapped);
   MR-04 explicitly forbids "remote expressions with general code
   semantics", so there is no schema templating mechanism to safely fill a
   `{productId}` placeholder, and inventing one only for this screen would
   be exactly the kind of templating/expression surface the horizon rules
   out. Product instead builds its `SchemaComponent` tree directly in Dart
   from the fetched `CommerceProductDetail`, still rendered through the
   identical `ComponentRegistry`/`ComponentView` and dispatched through the
   identical `AppActionDispatcher` every schema-driven screen uses — the
   same typed primitives, just screen-owned instead of parsed. This
   asymmetry is a deliberate, documented architecture decision (see the
   doc comment atop `product_screen.dart`), not an inconsistency.
2. **Live data fills declared "data slot" nodes, never a templating
   mechanism** (`experience_hydration.dart`'s `hydrateNode`). Home's
   schema declares an empty `ProductList` node at a fixed id
   (`slot.home.products`); Cart's declares an empty `CartList`
   (`slot.cart.items`) and a zeroed `CartSummary` (`slot.cart.summary`).
   After `CompatibilityResolver.resolve()` returns the *structurally*
   resolved page, each screen walks it and replaces exactly that one node
   (children, or the whole node for `CartSummary`'s props) with content
   built from a live `CommerceClient` response — reusing
   `SchemaComponent.withChildren()` (already public, already used by
   `CompatibilityResolver` itself for fallback-pruning) and, for
   `CartSummary`, a direct `SchemaComponent(...)` reconstruction (all
   fields are already public/const-constructible — no kernel change
   needed). Compatibility resolution and data hydration are therefore two
   fully separate steps: a schema's declared structure is checked *before*
   any live data exists, and live data can never introduce a component/
   action type the manifest didn't already approve.
3. **`RuntimeActionHandler`** (`runtime_action_handler.dart`) replaces
   `NoopActionHandler`: `navigate`/`openProduct` mutate `RuntimeState`
   (ephemeral navigation state, MR-06) with no network call;
   `addToCart`/`updateCartQuantity`/`removeCartItem` call `CommerceClient`
   and only mark `RuntimeState.cartVersion` changed *after* a call the
   server actually accepted — never optimistically before the response,
   and a `CommerceApiException`/`CommerceProtocolException` is reported via
   an `onError` callback (surfaced as a `SnackBar` by the shell) rather
   than thrown into the widget tree or silently swallowed.
4. **The MOBILE-RUNTIME-3 "sibling wiring" gap is resolved by a
   screen-owned coordinator, not a registry change.** A `SchemaComponent`'s
   `props` are JSON-safe scalars only (MR-04) — there is structurally no
   way for a schema-declared `Quantity` node to expose its live value to a
   *sibling* `AddToCart` node; MOBILE-RUNTIME-3's `Quantity`/`AddToCart`
   remain exactly as designed and are reserved for **Cart-line editing**,
   where a real `cartItemId` already exists (used as-is in
   `cart_screen.dart`). For the Product screen's "choose quantity/variant,
   then add" interaction — which has no `cartItemId` yet — a single
   screen-owned `_PurchasePanel` `StatefulWidget` holds both the variant
   choice and quantity as one widget's state and, only on "Add to Cart",
   dispatches one fully-populated `addToCart` `ActionRef` through the
   *same* `AppActionDispatcher.dispatch` every schema-driven component
   uses. No local value is ever treated as already server-confirmed (MR-06)
   — the button stays disabled when `inStock` is false, and only a
   dispatched action (never a local `setState`) can change server state.
5. **`RuntimeState`** (`runtime_state.dart`) is the one ephemeral-UI-state
   class for the whole app: which top-level screen is showing
   (`RuntimePage`), the selected product id (a navigation parameter, never
   business data), and two bump counters (`cartVersion`, `refreshVersion`)
   screens listen to so they know when to re-fetch. It holds no product/
   cart data itself — every screen re-fetches from `CommerceClient`
   directly, so there is exactly one source of truth for server data and
   one for navigation/ephemeral state, per MR-06.
6. **No production tenant credential anywhere.** `runtime_config.dart`
   builds the app's one `CommerceConfig` from `--dart-define` values
   (`COMMERCE_BASE_URL`/`COMMERCE_STORE_BEARER_TOKEN`), defaulting to an
   obviously non-functional placeholder host (`commerce.invalid`, an
   RFC 2606 reserved test TLD) so an unconfigured build fails closed
   through the exact same error-handling path every screen already has,
   rather than silently pointing at a real service. No real AWJ Commerce
   tenant/deployment exists for this proof horizon to point at instead.
7. **Loading/error/incompatible states are explicit, never a blank
   screen.** Every screen shows a spinner while its first fetch is in
   flight, `ErrorRetryView` (with a retry button) on a Commerce API/
   transport failure, and `IncompatibleView` if `CompatibilityResolver`
   ever returns an `IncompatibleExperience` for a bundled schema (a
   defensive path — the bundled schemas are this runtime's own, so this
   should never trigger in practice, but the fail-closed contract from
   MOBILE-RUNTIME-2 is honored regardless of source).
8. **No new dependency.**

## Why this approach fits AWJ

- MR-03 (Commerce contract is authoritative) is preserved end-to-end: no
  screen computes a price/stock/availability value — every number shown
  (`amountMinor`, `inStock`, cart totals) is a direct pass-through from a
  `CommerceClient` response, formatted for display only.
- MR-06 (state separation) is structural, not just documented: server data
  lives only in each screen's own fetched-response fields; navigation/
  ephemeral UI state lives only in `RuntimeState`/`_PurchasePanel`; session
  material stays entirely inside `CommerceClient` (MOBILE-RUNTIME-4,
  untouched by this task).
- Fail-closed/fail-safe carries through unchanged from MOBILE-RUNTIME-2/3:
  an unrecognized `navigate` pageId is a no-op (not a crash); a data-slot
  id not found leaves the schema's declared content untouched
  (`hydrateNode`'s own fail-safe); a Commerce API error surfaces a retry
  state, never a stuck spinner or a silent failure.
- Zero touch on `app/`, `database/`, `routes/`, or any PHP/Laravel code.

## Changed files

```
mobile/lib/app/awj_runtime_shell.dart       (new)
mobile/lib/app/cart_screen.dart             (new)
mobile/lib/app/experience_hydration.dart    (new)
mobile/lib/app/home_screen.dart             (new)
mobile/lib/app/product_screen.dart          (new)
mobile/lib/app/runtime_action_handler.dart  (new)
mobile/lib/app/runtime_config.dart          (new)
mobile/lib/app/runtime_schema.dart          (new)
mobile/lib/app/runtime_state.dart           (new)
mobile/lib/app/runtime_status_views.dart    (new)
mobile/lib/app.dart                         (replaced placeholder shell with AwjRuntimeShell)
mobile/test/app/experience_hydration_test.dart    (new — 4 tests)
mobile/test/app/fake_commerce.dart                (new — test helper, not a test file)
mobile/test/app/runtime_action_handler_test.dart  (new — 6 tests)
mobile/test/app/runtime_state_test.dart           (new — 4 tests)
mobile/test/app/vertical_slice_test.dart          (new — 1 end-to-end test)
mobile/test/widget_test.dart                (updated — injects a fake CommerceClient)
docs/plans/mobile/MOBILE-RUNTIME-5-IMPLEMENTATION-REPORT.md  (new, this file)
```

## Tests and exact results

```
$ flutter analyze
Analyzing mobile...
No issues found! (ran in 1.0s)

$ flutter test
...
00:04 +116: All tests passed!
```

116 tests total: 15 new (4 `experience_hydration_test.dart` + 4
`runtime_state_test.dart` + 6 `runtime_action_handler_test.dart` + 1
`vertical_slice_test.dart`, verified by direct `grep -c` count against each
file) on top of the 101 carried over from MOBILE-RUNTIME-1–4. All green,
including:
- `hydrateNode` proven to find/replace a deeply nested target, replace the
  root itself, and leave the tree untouched (fail-safe) when the target id
  is absent;
- every `RuntimeActionHandler` method proven against a scripted
  `FakeCommerceTransport` — success marks `cartVersion` and hits the right
  endpoint with the right body; a server error reports via `onError` and
  leaves `cartVersion` unchanged; `refresh` touches no network call at all;
- a single end-to-end `vertical_slice_test.dart` widget test drives the
  full proof slice against a small stateful fake `/commerce/v1` server: Home
  renders its schema-declared hero plus two live product cards → tapping
  one opens Product with its real description → Add to Cart → back to
  Home → to Cart → the real line (product name + `"1 عنصر"` summary) shows
  → removing it empties the cart (`"0 عنصر"`) — the first test in this
  repository that exercises Home→Product→Cart as one continuous flow.
- `test/widget_test.dart` (carried over from MOBILE-RUNTIME-1) now injects
  a fake `CommerceClient` — the original test building a real one hung
  `pumpAndSettle` because the default client's `FlutterSecureSessionStore`
  has no mocked platform channel in this test file and the default
  `CommerceConfig` points at a placeholder host with no `FakeCommerceTransport`,
  so the widget test's own `CommerceClient` override (added specifically
  for this) is now exercised the way it was designed to be.

## Build / lint / typecheck

`flutter analyze` (above, 0 issues). No native build attempted — out of
this task's scope (MOBILE-RUNTIME-9).

## CI

PR #956 opened on head `7d22b1e9e66d88bbe2f5d0376cb14bb72ee93c16`; all 6
required checks (`mobile-ci.yml` analyze+test, `ci.yml` sqlite+pgsql, each
×2 for push+PR events) passed — `conclusion: success` on every run.

## Pre-merge review

- PRE_MERGE_REVIEW: **PASS**
- Reviewed Head SHA: `7d22b1e9e66d88bbe2f5d0376cb14bb72ee93c16`
- Findings / resolution: fresh Reviewer + AWJ Guardian pass against the
  complete final diff (`git diff 226fde8 7d22b1e`, 18 files, 2001
  insertions, 35 deletions):
  - All 6 required checks green on this exact head: `mobile (analyze +
    test)` ×2, `php artisan test (L11, sqlite)` ×2, `php artisan test
    (L11, pgsql)` ×2 — all `conclusion: success`. `mergeable_state: clean`.
  - Re-ran `flutter pub get && flutter analyze && flutter test` directly
    against this exact head in this session: 0 analyze issues, 116/116
    tests passing — not just trusting the CI badge.
  - Confirmed by direct inspection that `RuntimeState.markCartChanged()`
    is only called after a successful `CommerceClient` response in all
    three cart-mutating handler methods (`onAddToCart`,
    `onUpdateCartQuantity`, `onRemoveCartItem`), each with a corresponding
    failure-path test proving `cartVersion` stays unchanged and `onError`
    fires instead.
  - Confirmed `hydrateNode` only ever replaces the exact node matching its
    `targetId`, leaving siblings/ancestors untouched, and is fail-safe
    (returns the tree unchanged) when the target id is absent — proven by
    dedicated tests, not just asserted in prose.
  - Confirmed the Product-screen architecture decision (bypassing schema
    parsing, building the tree directly in Dart) is documented in the
    file's own doc comment, not a silent inconsistency with Home/Cart's
    schema-driven approach.
  - Diff contains exactly the files this task's own change list names —
    no checkout/payment/order/address UI, no deep links, no push, ahead of
    MOBILE-RUNTIME-6/7/8's scope.
  - The one PR comment (`chatgpt-codex-connector[bot]` reporting it hit
    its own Codex usage limit) carries no review finding — no action
    needed.
  - No accounting/tenant/RBAC/API/DB code touched.
  - No unresolved review finding or Decision Gate.

## Self-review

### Implementer
Did I satisfy MOBILE-RUNTIME-5's outcome ("Home/Product/Cart vertical UI")
and the horizon's §5 vertical slice? Yes — boot, compatibility resolution,
Home-from-schema, live product list, Product screen with variant/quantity/
availability, Add to Cart, Cart read/update/remove are all exercised
end-to-end by `vertical_slice_test.dart` against a fake server standing in
for `/commerce/v1`. Is there a simpler design than per-screen "data slot"
hydration? Considered building Home/Cart directly in Dart like Product —
rejected because the vertical slice's own wording ("Home from App Schema")
and MR-04's intent (a real declarative document driving structure) would
otherwise be unproven; the chosen design proves both patterns are valid
and know when each applies. Did I reuse existing authority instead of
duplicating business logic? Yes — no pricing/stock/cart-total logic exists
anywhere in this diff; every number shown is a direct field from a
`CommerceClient` response.

### Reviewer
What would I reject if this PR came from another engineer? I specifically
checked: (1) that `RuntimeState.cartVersion` is only bumped *after* a
successful `CommerceClient` call in every one of the three cart-mutating
handlers, never before or unconditionally — verified by
`runtime_action_handler_test.dart`'s explicit failure-case assertions;
(2) that `hydrateNode` cannot silently corrupt an unrelated node — it only
ever replaces the exact node matching `targetId`, proven by a nested-tree
test that checks sibling nodes are untouched; (3) that Product's decision
to bypass schema parsing is a *documented* architecture call (the doc
comment atop `product_screen.dart`), not a quietly inconsistent shortcut;
(4) that the original `test/widget_test.dart`'s network hang was actually
root-caused (a real, unconfigured `CommerceClient` with no fake transport
in a test) rather than just silenced by upping a timeout. Is any code
broader than the task? No checkout/payment/order/address UI, no deep
links, no push — all still out of scope per the horizon's own dependency
table. Are tests proving behavior rather than implementation trivia? Yes —
the end-to-end test asserts on rendered Arabic text and cart-line presence/
absence, not on internal widget-tree shape.

### AWJ Guardian
Can Tenant A affect/read Tenant B? Not applicable at this layer — tenant
resolution is entirely server-side via the store bearer token
`CommerceClient` already treats as opaque (MOBILE-RUNTIME-4); this task
adds no tenant-selection code. Is any financial value computed with unsafe
types or client authority? No — `amountMinor`/`subtotalAmountMinor` values
shown in Home/Product/Cart are all direct pass-throughs from
`CommerceMoney` fields; no widget in this diff adds, multiplies, or
otherwise derives a total. Can authorization be bypassed? No — every
Commerce-affecting action still goes through `CommerceClient`
(MOBILE-RUNTIME-4's own token/session handling, untouched here); nothing
in this task reads or writes a session token directly. Could a locally
selected quantity/variant become business authority? No — `_PurchasePanel`'s
selection is plain `StatefulWidget` state that only ever becomes a
dispatched `addToCart` `ActionRef`; the cart is not considered updated
until `CommerceClient.addCartItem` returns successfully and
`RuntimeState.markCartChanged()` fires the next `CartScreen` re-fetch, i.e.
the UI always reflects the server's own subsequent read, not the local tap.
Could retries duplicate side effects? `addCartItem`/`updateCartItem`/
`removeCartItem` match MOBILE-RUNTIME-4's own idempotency story exactly
(cart resolves by token, updates are plain overwrites) — this task adds no
retry logic of its own. Are secrets/PII exposed? None exist in this
layer — no token is read, logged, or displayed by any screen.

## Accounting impact

None — no checkout/payment/order call exists anywhere in this horizon yet;
Add to Cart/Cart read-update-remove are pre-checkout operations with no
accounting-affecting server-side effect.

## Tenant / branch isolation impact

None from this task's own code — tenant/channel resolution is entirely
server-side via the store bearer token `CommerceClient` already treats as
opaque configuration (MOBILE-RUNTIME-4).

## Security / authorization impact

Positive, structural: no token is ever read/written/displayed by any
screen in this diff (that boundary stays entirely inside
`CommerceClient`/`SecureSessionStore`, MOBILE-RUNTIME-4); every
Commerce-affecting UI action funnels through the same typed
`AppActionDispatcher.dispatch` → `RuntimeActionHandler` → `CommerceClient`
path, with explicit error surfacing rather than silent failure.

## Backward compatibility

`mobile/lib/app.dart`'s public `AwjMobileRuntimeApp` widget gained an
optional `client` parameter (test-only override, defaults to building a
real client) — additive, not a breaking change to its existing
zero-argument constructor usage. No other existing file outside the new
`lib/app/`/`test/app/` directories was modified except
`test/widget_test.dart` (updated to inject a fake client, per "Tests and
exact results" above).

## API / DB / migration impact

None — this is mobile-side UI/screen code against an already-existing,
unmodified `CommerceClient` (MOBILE-RUNTIME-4); no server-side file was
touched.

## External research used

None new — this task wires together three already-accepted, already-tested
AWJ contracts (MOBILE-RUNTIME-2/3/4) rather than adopting new external
platform behavior. Flutter APIs used (`ChangeNotifier`, `StatefulWidget`
lifecycle, `ScaffoldMessenger`, `ChoiceChip`, `ListView`) are all stable,
long-standing framework APIs.

## Risks / remaining work

- The bundled `kHomeSchemaJson`/`kCartSchemaJson` are this runtime's own
  fixtures, not fetched from a real AWJ backend endpoint — no such endpoint
  is defined anywhere in this horizon (App Schema delivery/versioning
  infrastructure is explicitly out of this proof's scope per
  `AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md` §11). Swapping a bundled schema
  for a fetched one is a drop-in change at the one call site
  (`resolveRuntimeSchema`) when that infrastructure exists.
- No real Commerce deployment/tenant exists to point this app at by
  default — `runtime_config.dart`'s placeholder host makes an unconfigured
  build fail closed through the same error-handling path every screen
  already has, which is itself proof that path works, not a hidden gap.

## Discovered backlog

- Checkout/payment/order-history/address-book UI (their `CommerceClient`
  methods don't exist yet either — MOBILE-RUNTIME-4's own documented scope
  boundary) remain for whichever future task takes on checkout, outside
  this horizon's 10-task queue.
- `HomeScreen`'s `ProductList` shows every returned product on one
  unpaginated page (`CommerceClient.listProducts()`'s `page`/`perPage`
  params are unused here) — pagination/infinite-scroll is a UI-polish
  concern outside this proof's vertical-slice bar, not a correctness gap
  (the underlying client already supports it, per MOBILE-RUNTIME-4's
  report).

## Git state

- Branch: `claude/awj-mobile-runtime-horizon-v1-g0n8mm`
- PR: #956
- Base SHA: `226fde865a7067b8b1d7391b7a5e214ff4f58859` (`origin/main`, PR #955)
- Head SHA: `7d22b1e9e66d88bbe2f5d0376cb14bb72ee93c16` (pushed)

## Recommended next dependency-ready task

`MOBILE-RUNTIME-6` (ar/en + RTL/LTR + theme/accessibility) — depends on
this task per the horizon's dependency table (§8 row 6) and does not
require this task's own Post-Merge Review to start, though this session
continues sequentially. `MOBILE-RUNTIME-7` (Universal/App Links) also
becomes dependency-ready once this task merges (depends on
MOBILE-RUNTIME-3 + this task).
