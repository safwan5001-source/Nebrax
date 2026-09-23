# APP-BUILDER-3 — Implementation Report

STATUS: merged, post-merge review in progress
DATE: 2026-09-23

## Outcome

Added the Component/Action/Data Resource registry **metadata** contracts (props, children
rules, actionability, typed action inputs) that a future Inspector will read — extending
`RuntimeCapabilities` (APP-BUILDER-2's identity-only registry) without changing any existing
validation/publish behavior.

## Repository evidence / root cause

`RuntimeCapabilities.php`'s own doc comment (written in APP-BUILDER-2) says explicitly: "سجلّات
المكوّنات/الإجراءات/الموارد الكاملة (خصائص، تحقق قيم، meta المحرّر) هي APP-BUILDER-3 — هذا الصنف
يعرف فقط «هوية + رقم إصدار»". The horizon doc's task 3 says the same: "metadata contracts powering
Inspector and safe bindings/actions", against the identifiers `RuntimeCapabilities` already fixed —
no new identifier-set decision here.

Two research findings materially shaped scope, both found by reading the actual, tested Mobile
Runtime source rather than the illustrative architecture docs (the same anti-duplication discipline
APP-BUILDER-2 established):

1. **No "bindings" field exists in the real schema contract.** `COMPONENT_REGISTRY_V1.md` §6
   describes a "Bindings" metadata concept (named data slots bound to a resource). But
   `SchemaComponent._allowedKeys` in `mobile/lib/schema/app_schema.dart` is
   `{'type', 'id', 'optional', 'props', 'children', 'action'}` — a `bindings` key would be
   structurally rejected (`unknown_key`) by the proven, tested parser. Building "binding" metadata
   for a schema field that does not exist would repeat APP-BUILDER-1's original mistake (building
   from the illustrative doc instead of the real, tested contract) one layer up.
2. **No Commerce Mobile API readiness evidence exists.** `DATA_RESOURCE_REGISTRY_V1.md` itself
   gates every resource on `COMMERCE_MOBILE_API_READINESS.md` (§40/§41/§43) — that document does
   not exist in this repository. The Mobile Runtime Proof horizon (closed at MOBILE-RUNTIME-10)
   never built live data binding either; a source comment in `component_widgets.dart` says so
   directly: "Real data binding (a live product list, live prices) is MOBILE-RUNTIME-4/5's job" —
   tasks that were never scheduled/built in that horizon.

Both findings are implementation-scoping facts grounded in repository evidence, not product
decisions with multiple valid answers (no Decision Escalation Gate trigger: no security/authority
model change, no `/commerce/v1` change, no new payment/accounting semantics, no vendor lock-in) —
handled as routine engineering judgment per the horizon's own "routine editor implementation
choices do not require interruption" clause.

## Approach chosen

- **`ComponentRegistry::definitions()`**: one `ComponentDefinition` per one of the 15 real
  components, with every `props` entry, `childrenRule`, and `actionable` flag **read directly off
  `mobile/lib/registry/component_widgets.dart`'s `build*` functions** — e.g. `ProductCard` has no
  `PropDefinition` for `children` because `buildProductCard` never calls `buildChildren`;
  `VariantSelector.actionable = false` because `buildVariantSelector` never reads `node.action` at
  all (an attached action is schema-legal but has zero runtime effect); `Quantity` is the only
  component whose definition declares `injectedRuntimeActionParams = ['quantity']`, matching
  `_QuantityWidgetState._change` merging the live counter value into `action.params` on every tap.
- **`ActionRegistry::definitions()`**: one `ActionDefinition` per one of the 6 real actions, with
  every `ActionParamDefinition` (required/nullable/default/minValue) **mirroring `decodeAction()`
  in `mobile/lib/actions/app_action.dart` exactly** — e.g. `addToCart.quantity` has `minValue: 1`
  because `decodeAction` rejects `quantity <= 0`, while `updateCartQuantity.quantity` has
  `minValue: 0` because that same function explicitly allows zero. Every definition's
  `dispatchStatus` is `DISPATCH_PROVEN_NOOP` because `NoopActionHandler` is the only
  `ActionHandler` implementation that exists — no action has a proven business effect yet.
- **`DataResourceRegistry::RESOURCES`**: intentionally empty `array`, not missing by oversight. The
  class exists (establishing the structural seam the task's name promises) but is populated with
  zero resources, since inventing resource identifiers with no schema binding mechanism and no API
  readiness evidence behind them would be pure speculation. A dedicated test
  (`DataResourceRegistryTest`) guards it staying empty until a future task adds real evidence.
- **No change to `AppSchemaParser`/`CompatibilityResolver`.** These registries are read contracts
  for a future Inspector UI; they do not add a new hard-validation gate at draft-save or publish
  time. This matches the Mobile Runtime's own defensive (never-rejecting) prop handling — every
  `_stringProp`/`_intProp` accessor in `component_widgets.dart` silently falls back on a
  missing/wrong-typed prop rather than throwing, so a PHP-side hard prop-type validator would
  enforce something the actual runtime does not. Wiring registry-driven validation into
  save/publish is left as future, separately-decided work.
- Small supporting value objects (`PropType`, `PropDefinition`, `ChildrenRule`,
  `ComponentDefinition`, `ActionParamDefinition`, `ActionRiskClass`, `ActionDefinition`) — one
  class per file (PSR-4), `readonly` constructor-promoted properties, matching APP-BUILDER-2's
  established style (`CompatibilityResult`, `SchemaVersion`).

## Why this approach fits AWJ

Directly satisfies AB-11 ("Builder is framework-aware only at the runtime capability boundary") —
every metadata fact here is read off the actual Flutter implementation, not invented, and no
Flutter class name leaks into the PHP contract (identifiers stay the schema-level `Page`,
`ProductCard`, `addToCart`, etc. already fixed by `RuntimeCapabilities`). Satisfies the horizon's
explicit anti-duplication rule twice over: once for schema fields (no invented `bindings` key) and
once for data resources (no invented endpoint/resource without readiness evidence).

## Changed files

- New: `app/Services/AppBuilder/PropType.php`, `PropDefinition.php`, `ChildrenRule.php`,
  `ComponentDefinition.php`, `ComponentRegistry.php`, `ActionParamDefinition.php`,
  `ActionRiskClass.php`, `ActionDefinition.php`, `ActionRegistry.php`, `DataResourceRegistry.php`
- New tests: `tests/Feature/ComponentRegistryTest.php` (7 tests), `tests/Feature/ActionRegistryTest.php`
  (6 tests), `tests/Feature/DataResourceRegistryTest.php` (1 test)
- No modified files — this task adds a new read-only metadata layer beside `RuntimeCapabilities`;
  it does not touch `AppSchemaParser`, `CompatibilityResolver`, models, migrations, routes, or any
  existing test.

## Tests and exact results

- `php artisan test --filter="ComponentRegistryTest|ActionRegistryTest|DataResourceRegistryTest"`
  → **14/14 passed** (116 assertions), SQLite, local.
- Full local `php artisan test` → **4626 passed, 35 failed, 49 skipped** (29166 assertions). All 35
  failures are the two pre-existing, local-environment-only gaps already root-caused and documented
  in APP-BUILDER-1's report (missing local `bcmath` extension — `Fuel*Test` families; `setup.sh`
  never copying `app/Mail/` — `AuthRecoveryTest`/`DocumentCenterSecureIntakeTest`). Confirmed by
  name: zero App-Builder-related failures, zero regressions. Real CI (`ci.yml`, which has `bcmath`
  and copies `app/Mail` correctly) is the authoritative full-matrix check, run below.
- `php artisan test --filter="BranchIsolationGuardTest|ApplicationCatalogTest|ApplicationAccessGateGuardTest|RbacTest|RoleTest|TenantApplicationTest"`
  → unaffected (this task adds no model/migration/route/RBAC entry); no new run needed beyond the
  full-suite run above, which already includes them and shows no failures among them.

## CI

GitHub Actions on PR head `82cbc1aade73c0d6b69f99289b1abc312df3a4b0` (PR #973), both the
push-triggered and pull_request-triggered workflow runs, all 4 checks green:
`php artisan test (L11, sqlite)` and `(L11, pgsql)` success on both runs.

## Pre-merge review

- PRE_MERGE_REVIEW: **PASS**
- Reviewed Head SHA: `82cbc1aade73c0d6b69f99289b1abc312df3a4b0`
- Findings / resolution: No open findings. `chatgpt-codex-connector[bot]` posted only a
  usage-limit notice (did not perform a review). No human review posted.

## Merge

- Merge status: **merged** via standing authority (squash, no unresolved Decision Gate, required
  CI green on exact head, no unapproved scope expansion, no production deploy/release).
- Merge SHA: `4256d0aadb1a53f5288d054d5d937cd85ddf4d97`

## Post-merge review

- POST_MERGE_REVIEW: **PASS**
- `main@4256d0a` confirmed as `origin/main`'s tip at merge time, a single-parent squash (parent
  `6e15810`), zero content drift from the reviewed head `82cbc1a`
  (`git diff 82cbc1aade73c0d6b69f99289b1abc312df3a4b0 origin/main -- app database routes tests docs/plans/app-builder`
  was empty). Post-merge CI (`ci.yml` run
  [35931041709](https://github.com/safwan5001-source/Nebrax/actions/runs/35931041709) on the merge
  commit) completed with both jobs green: `php artisan test (L11, sqlite)` (completed 23:04:54 UTC)
  and `php artisan test (L11, pgsql)` (completed 23:16:15 UTC).
- Reviewed Merge SHA: `4256d0aadb1a53f5288d054d5d937cd85ddf4d97`
- Target-branch checks/smoke: post-merge `ci.yml` run
  [35931041709](https://github.com/safwan5001-source/Nebrax/actions/runs/35931041709) — both jobs
  `success`.
- Findings / resolution: none.

## Self-review

### Implementer

Satisfied the actual outcome (describe the 15 components and 6 actions' real prop/param shape for
a future Inspector) using only evidence already proven by the closed Mobile Runtime horizon's own
252-test suite — no new runtime behavior invented, no schema field invented.

### Reviewer

- No code broader than the task: no `AppSchemaParser`/`CompatibilityResolver` change, no HTTP
  endpoint, no App Manager/Builder workspace UI (those are APP-BUILDER-4/5, which require their own
  UI/UX Evidence Pass).
- `DataResourceRegistry` deliberately ships empty rather than populated with invented resources —
  the more defensible choice given zero schema-level binding mechanism and zero
  `COMMERCE_MOBILE_API_READINESS.md` evidence; documented explicitly rather than silently deferred.
- Parity tests (`ComponentRegistry`/`ActionRegistry` key sets vs. `RuntimeCapabilities`) mirror the
  guard pattern the Dart suite already established (`component_registry_test.dart` line 36-43,
  `app_action_test.dart` line 101-120) — same anti-drift discipline on the PHP side.

### AWJ Guardian

- **No tenant authority added**: pure metadata, no query, no model, no migration.
- **No new schema field/validation surface**: registries are consumed by nothing yet (no Inspector
  exists before APP-BUILDER-5+); `AppSchemaParser`'s accepted shape is unchanged.
- **No fabricated capability**: `ActionDefinition::DISPATCH_PROVEN_NOOP` on every one of the 6
  actions makes explicit that none has a real business effect today, preventing a future Inspector
  from implying `addToCart` does something it does not yet do.
- **No tenant/branch/RBAC/ApplicationCatalog change**: this task touches none of those layers.

## Accounting impact

**None.** No journal entries, no monetary field mutated, no `LedgerService` call site touched.
`PropType::AMOUNT_MINOR` is a descriptive label for an existing Mobile Runtime prop convention
(minor-unit display formatting only, `formatMinorAmount()`), not a new monetary computation.

## Tenant / branch isolation impact

None — no model/migration/route changed. These classes are stateless, tenant-agnostic metadata
(the same component/action shape applies to every tenant's app).

## Security / authorization impact

None. No new route, no new permission, no change to `AppSchemaParser`/`CompatibilityResolver`'s
existing fail-closed structural/compatibility guarantees.

## Backward compatibility

Fully additive — no existing class, route, or test file was modified.

## API / DB / migration impact

None. No route, migration, or API shape changed.

## External research used

Read `mobile/lib/registry/component_widgets.dart`, `component_registry.dart`,
`mobile/lib/actions/app_action.dart`, `action_dispatcher.dart`, `mobile/lib/schema/app_schema.dart`,
`mobile/test/actions/app_action_test.dart`, `mobile/test/registry/component_registry_test.dart` (the
accepted, tested Mobile Runtime Proof V1 source and its own test suite) — internal repository
evidence, not external platform research, per Gate 1. Also read `COMPONENT_REGISTRY_V1.md`,
`ACTION_REGISTRY_V1.md`, `DATA_RESOURCE_REGISTRY_V1.md` (the illustrative architecture docs) to
identify where they diverge from what was actually built/tested.

## Risks / remaining work

- `DataResourceRegistry` stays empty until a future task adds (a) a real `bindings`-equivalent
  field to the schema contract (a Mobile Runtime-side decision, tested there first, mirrored here
  exactly as APP-BUILDER-2 did for schema validation) and (b) real Commerce Mobile API readiness
  evidence. Both are explicitly out of this task's scope, not silently dropped.
- Wiring `ComponentRegistry`/`ActionRegistry` into `AppSchemaParser` as an optional stricter
  authoring-time validation layer (catching a malformed `props`/`action.params` shape before
  publish, beyond today's defensive-fallback behavior) is a real, separate future decision — noted
  here, not implemented, since it would be a behavior change beyond what this task's identifiers
  require.
- First real consumer of these registries is APP-BUILDER-5 (Builder workspace shell, Inspector) —
  until then this is a proven-but-unused contract, same status `RuntimeCapabilities` had between
  APP-BUILDER-2 and this task.

## Discovered backlog

None new beyond APP-BUILDER-1's carried-forward `setup.sh` `app/Mail` gap (unaffected by this task).

## Git state

- Branch: `claude/awj-app-builder-horizon-v1-e4iy21`
- PR: [#973](https://github.com/safwan5001-source/Nebrax/pull/973) (merged)
- Base SHA: `6e158104f306d6d287cda7bf1628221c635e4975`
- Head SHA (reviewed pre-merge): `82cbc1aade73c0d6b69f99289b1abc312df3a4b0`
- Merge SHA: `4256d0aadb1a53f5288d054d5d937cd85ddf4d97`

## Recommended next dependency-ready task

`APP-BUILDER-4` — App Manager + creation wizard (Apps list/overview, Use My Store Design / Choose
Template / Start From Scratch, safe minimum commerce shell). **Requires a UI/UX Evidence Pass and
AWJ Design System conformance check before implementation**, per this horizon's own gate for the
first major Builder UI slice.
