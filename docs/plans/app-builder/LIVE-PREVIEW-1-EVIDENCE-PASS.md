# LIVE-PREVIEW-1 — Preview Contract Evidence Pass

DATE: 2026-09-25
HORIZON: `AWJ_APP_BUILDER_LIVE_RUNTIME_PREVIEW_V1.md`
STARTING MAIN SHA: `ccc271b84feb188e421e5ed9ab5d6f80df797f6d` (PR #1012)
SCOPE: Evidence only. No Preview/runtime code changed. No behavior changed.

## Verdict (up front)

**LIVE-PREVIEW-2 is READY.** No Decision Gate is triggered (checked against all 8 gates in
§9 below). Preview and the real Flutter runtime consume the exact same wire schema and the
same structural types — the gap is entirely that Preview's React renderer
(`web/src/modules/app-builder/canvas.tsx`) interprets a component subtree literally (props as
authored) while the real runtime interprets the same subtree through three additional
resolution stages Preview never runs: capability/compatibility gating, binding resolution
(`$item.*`/`collect`), and visibility pruning. Closing this is deriving/porting an existing,
narrow, already-proven pure-function contract into a third environment (web) — the same pattern
this codebase already uses twice (PHP mirrors Dart for `CompatibilityResolver`,
`VisibilitySignal`, `VisibilityOperator`, `RuntimeCapabilities`) — not inventing a second
independent interpreter.

## 1. What Preview renders, and which schema/version it consumes

`AppBuilderWorkspacePage` (`web/src/app/(app)/app-builder/[id]/builder/page.tsx:69-94`) loads
exactly one thing: `GET /app-builder/apps/{id}/draft` → `BuilderDraftExperienceResource.schema`
— the **live draft**, always. There is no way in the Builder UI to preview:

- a **published** version (`BuilderPublishedExperienceVersionController::show` exists and is
  used only by `/app-builder/apps/{id}/versions` — a version-history list/diff view, not fed
  into `AppBuilderCanvas`);
- the **Default AWJ Experience** (`kHomeSchemaJson`/`kCartSchemaJson`, `mobile/lib/app/
  runtime_schema.dart`) — this concept has **no backend route, no web-side representation, and
  no string reference anywhere under `web/`** (confirmed by repo-wide search). It exists only
  as a Dart compile-time constant; see §7.

`AppBuilderCanvas` (`canvas.tsx:338-373`) receives `root: AppSchemaComponent | null` — already
one page's parsed root, handed down by the page component — and never reads or displays
`schema.schemaVersion`, `schema.minRuntimeVersion`, or `schema.requiredCapabilities` anywhere
(confirmed: zero references to those three fields in `page.tsx` or any `modules/app-builder/*`
file). A merchant previewing a draft has no on-screen signal of which schema version they are
authoring against, or what capabilities the draft would require at publish time.

The web (`app-builder.ts:97-115`) and Dart (`app_schema.dart:286-417`) `SchemaComponent` shapes
are structurally identical — `type/id/optional/props/children/action/binding/visibility` — so
this is not a version/shape mismatch. It is that Preview only ever walks `props` literally.

## 2. Component structure & theme token interpretation

`CanvasComponentNode` (`canvas.tsx:101-315`) is a `switch (node.type)` with one case per
registered component, each reading `node.props` defensively (same pattern as
`component_widgets.dart`'s `_stringProp`/`_intProp`/etc. — this defensive-read discipline **is**
mirrored correctly). Structurally this matches the real widget tree component-for-component;
`ComponentRegistry.php` (the Inspector's palette source) is itself documented as extracted
directly from `component_widgets.dart`'s real 15 widgets (`ComponentRegistry.php:9-13`), so the
Inspector never offers a component type the runtime doesn't have a widget for. **This part is
sound.**

Theme tokens are a confirmed, concrete divergence:

- `ThemePanel` (`theme-panel.tsx:29-31`) edits `primaryColor`, `accentColor`, `radius`,
  `density`, `productCardStyle`, `themePreset`, `fontPreset`, `displayName` into
  `schema.theme.tokens`, and `canvas.tsx:326-336` renders `primaryColor` + `radius` live in the
  canvas via CSS variables.
- The real runtime reads **exactly one** token, once, at app boot:
  `themeSeedColorFromSchema` (`mobile/lib/app.dart:19-36`) looks for
  `theme.tokens.colorPrimary` — a **different key** than the one the Builder writes
  (`primaryColor`). Nothing else in `mobile/lib` reads `theme.tokens` at all (repo-wide search,
  zero hits for `accentColor`/`radius`/`density`/`productCardStyle`/`fontPreset` on the mobile
  side).
- Worse: that one read is `late final Color _seedColor = themeSeedColorFromSchema(kHomeSchemaJson)`
  (`app.dart:75`) — computed **once, from the bundled compile-time Default schema**, never from
  whatever experience `resolveStartup` actually decides to render (Fresh/LastKnownGood/Default).
  A tenant's **published theme never reaches the real app's `ThemeData` at all**, regardless of
  key naming.

So today, 100% of what a merchant edits in the Theme panel is cosmetic to Preview only — none of
it is currently wired to affect the shipped runtime for a tenant's own published experience.

## 3. Bindings — `binding.collect`, `itemProps`, `$item.*`

**Preview does not evaluate `binding` at all.** `canvas.tsx` never reads `node.binding` — a
bound `ProductList`/`CartList` template child renders whatever literal `props` its author typed
on the template node itself (e.g. a placeholder `title`/`amountMinor`), never repeated, never
substituted. Confirmed: no reference to `binding`, `collect`, `itemProps`, or `$item` anywhere
in `canvas.tsx`.

The real runtime's binding pipeline (`mobile/lib/app/binding_resolution.dart`) is a complete,
already-proven three-part contract:

1. `resolveNodeBindings` walks the tree; a node with `binding.collect` set repeats its **single**
   authored child once per entry in the target list field, substituting `$item.<field>` through
   every prop/action-param in the repeated subtree (`_repeatTemplate`/`_instantiateTemplate`,
   lines 119-243).
2. A node whose resource is itself list-shaped (no `collect` needed) is likewise repeated.
3. A single-item binding (`itemProps`) substitutes resolved field values directly into the
   node's own props.

This is not theoretical/future-only: `RuntimeCapabilities.dataResources` and `schemaFeatures`
are **already populated** (`registry_identifiers.dart:110,129`: `commerce.products: 1,
commerce.cart: 1` and `binding.collect: 1`), and `CompatibilityResolver.php` (`bindingSupported`,
lines 137-212) already accepts and gates real bindings to those two resources today. A merchant
can author a `ProductList` bound to `commerce.products` (with an item template using
`$item.title`/`$item.amountMinor`) right now, publish it, and the real app will render live
product data — while Preview, for the exact same draft, shows only the template's literal
placeholder props, once, unrepeated. **This is an active divergence today, not a future one.**

Compounding it: the Inspector's own binding panel copy is now stale. `binding.runtimeNote`
(`ar.json:6902`) reads *"غير فعّال بعد في تطبيق الجوال — البناء الحالي لا يقرأ مصادر بيانات حيّة
بعد"* ("not yet active in the mobile app — the current build does not read live data sources
yet") — **false** for `commerce.products`/`commerce.cart` as of the capability tables cited
above. This is an Inspector-copy bug, not a Preview-rendering bug, but it directly misleads a
merchant about exactly the contract this evidence pass was asked to establish, so it is recorded
here rather than silently left for LP-2 to trip over.

## 4. Visibility semantics

Same shape of gap, one step earlier in the pipeline. Preview never reads `node.visibility` —
every node renders unconditionally regardless of any attached condition.

The real runtime has a complete, tested visibility evaluator
(`evaluateVisibility`/`pruneInvisible`, `binding_resolution.dart:254-300`) against a closed
signal vocabulary (`VisibilitySignal`: `cart.itemCount`, `customer.isAuthenticated`,
`product.inStock`) and closed operator set (`VisibilityOperator`) — but, unlike binding,
`schemaFeatures` for `'visibility'` is **still empty** on both sides
(`registry_identifiers.dart:129`; `RuntimeCapabilities.php` `SCHEMA_FEATURES`), matching the
Inspector's `visibility.runtimeNote` copy, which is **accurate** as written.

The practical consequence for Preview is sharper than for binding, because of a control that
does not exist yet: the Inspector has no `optional` toggle anywhere (`grep` of
`inspector.tsx` for `optional` returns nothing), so every node a merchant authors defaults to
`optional: false`. Given `visibility`'s `schemaFeatureVersion` is null, attaching **any**
`visibility` condition to **any** node today makes that node "required + unsupported" under
`CompatibilityResolver::resolveComponent` — which fails the **entire document** at
publish/validate time (`CompatibilityResolver.php:96-125`, the fail-closed
"required-unsupported-child fails the whole document" rule). Preview shows nothing wrong; the
Inspector's own copy says it "can be configured safely now"; the first the merchant learns
otherwise is the Validate dialog's raw compatibility-failure message. Worth flagging to the
owner even though it is one layer removed from Preview rendering itself.

## 5. Action representation & dispatch semantics

Preview never dispatches anything. `Button`/`AddToCart`/`NavigationTarget`/`Quantity` render as
static, non-interactive markup (`canvas.tsx:227-310`) — no click handler, no visual "inert vs.
wired" distinction.

The real runtime is explicit about exactly that distinction:
`_ActionTappable`/`buildButton`/`buildAddToCart` (`component_widgets.dart:55-74,171-183,355-367`)
render a component **with no attached action** as visibly inert (50% opacity +
`IgnorePointer`) versus one with an action as a live `InkWell`/enabled button — "the two are
visibly different states" is a documented, deliberate MR-11 requirement. Preview currently
collapses both states into the same static look, so a merchant cannot see, in Preview, whether
a button they configured actually has an action attached (a real authoring mistake the real app
would visibly flag). `AppActionDispatcher.dispatch` (`action_dispatcher.dart:48-71`) decodes and
routes six allowlisted actions (`navigate`, `openProduct`, `addToCart`,
`updateCartQuantity`, `removeCartItem`, `refresh`) to a typed handler — Preview has no
equivalent decode/dispatch step at all, so an action referencing an unknown/misspelled `type`
looks identical in Preview to a correctly wired one.

## 6. Compatibility / capability checks

**Split finding — this is the one part of the pipeline that already has real parity, just not
inside Preview itself.** `BuilderPublishedExperienceVersionService::validate()`/`publish()`
(`BuilderPublishedExperienceVersionService.php:80-106`) already calls the exact same
`CompatibilityResolver` against `CapabilityManifest::current()` that the mobile boot path uses
(`CompatibilityResolver.php` is documented 1:1 against `mobile/lib/schema/compatibility.dart`).
The web "Validate" dialog (`page.tsx:199-208,550-578`) already surfaces this real check before
every publish. So: **the publish gate is real and shared; the live-editing canvas is not
consulted by it at all.** A merchant can freely author unsupported/incompatible structures while
editing — Preview shows every node the same generic way regardless of support — and only
discovers a problem when they explicitly open the Publish dialog. There is no inline "this
won't render on real devices" signal anywhere during editing.

## 7. Can the Default AWJ Experience be previewed?

**No.** Confirmed by repository-wide search: no route, controller, or web reference to
`kHomeSchemaJson`/`kCartSchemaJson`/"Default AWJ Experience" exists outside `mobile/lib`. It is
a Flutter compile-time constant (`mobile/lib/app/runtime_schema.dart:26+`), rendered by
`UseDefaultExperience` (`mobile/lib/startup/last_known_good.dart:135-154`) whenever a tenant has
no Published Experience (`ExperienceFetchNotPublished` → straight to Default, never through
compatibility resolution or last-known-good — it is "always available, always compatible" by
construction, since it ships with the runtime build itself). A merchant cannot see, from the
Builder, what a customer sees before that merchant's first publish.

## 8. Gap matrix

| # | Dimension | Preview (web canvas) | Real runtime (Flutter) | Divergence | Severity |
|---|---|---|---|---|---|
| 1 | Source | Always live **draft** | Fresh / LastKnownGood / **Default** / ControlledUnavailable per AWJ Boot contract | Preview cannot show Published, Default, or LKG/unavailable states | High |
| 2 | Component tree/props | Literal `props` per node, full registry coverage | Same registry, same widgets | Parity (sound) | — |
| 3 | Theme tokens | 7 tokens edited, 2 rendered live in canvas | 1 token (`colorPrimary`) read, **once**, from the bundled Default schema only — never from a tenant's own published experience | Builder theme editing has ~zero live effect on the shipped app today | High |
| 4 | `binding`/`collect`/`itemProps`/`$item.*` | Not evaluated; template renders once, literally | Fully resolved: repeats templates, substitutes `$item.*`, already wired for `commerce.products`/`commerce.cart` | Active, present-day divergence for a capability already in production use | High |
| 5 | `visibility` | Not evaluated; every node always shown | Evaluator exists but `schemaFeatures['visibility']` unset everywhere → any authored condition on a non-optional node blocks publish entirely | Preview gives false confidence; Inspector has no `optional` control to make it safe | Medium-High |
| 6 | `action` | Static markup, no dispatch, no inert/live visual distinction | `AppActionDispatcher` decodes + routes 6 actions; inert vs. wired is a deliberate visible distinction | Preview cannot surface a misconfigured/unknown action, or missing action on an actionable component | Medium |
| 7 | Compatibility/capability gating | Not run during editing; only at explicit Validate/Publish | `CompatibilityResolver` real, shared, already correct | Gate itself has parity; only its absence *during editing* is the gap | Medium |
| 8 | Default AWJ Experience | Not previewable at all (no route/UI) | Bundled, always-on fallback | Merchants can't see pre-publish/no-publish state | Medium |
| 9 | Schema/capability visibility in UI | `schemaVersion`/`minRuntimeVersion`/`requiredCapabilities` never shown | N/A (runtime evidence, not a UI) | No in-Preview signal of what will be required at publish | Low |
| 10 | Inspector binding copy | "not active yet" note is stale for `commerce.products`/`commerce.cart` | Feature is live | Merchant-facing copy bug (Inspector, not Preview) | Low, quick fix |

## 9. Decision Gate check (all 8, `AWJ_APP_BUILDER_LIVE_RUNTIME_PREVIEW_V1.md` §Decision Gates)

1. **Incompatible schema semantics** — Not triggered. Web/Dart `SchemaComponent` shapes are
   structurally identical field-for-field; every gap above is "not yet interpreted," never
   "interpreted differently."
2. **Parity requires a second independent interpreter** — Not triggered. `resolveNodeBindings`/
   `evaluateVisibility`/`pruneInvisible` (Dart) are already small, pure, narrowly-scoped
   functions with no Flutter/widget dependency (`binding_resolution.dart`'s own header says so
   explicitly) operating on the same JSON-shaped schema Preview already parses. Porting/deriving
   the same narrow algorithm into TypeScript is the same pattern this codebase already applies
   twice over (PHP mirrors Dart for `CompatibilityResolver`, `VisibilitySignal`,
   `VisibilityOperator`, `RuntimeCapabilities` — each file says so in its own header comment),
   not a new, independently-designed interpreter.
3. **Required runtime feature not capability-gated** — Not triggered. Every feature found
   (components, actions, binding, `collect`, visibility) is already capability-gated through
   `CompatibilityResolver`/`CapabilityManifest`.
4. **Product route context / customer identity needed** — Not triggered. Nothing above requires
   `$route.productId` or `customer.*`; Product remains correctly out of schema-driven scope on
   both sides.
5. **Material public schema/API contract change** — Not triggered. Existing endpoints/schema
   fields are sufficient; no new field is required to close the gaps found.
6. **Tenant Isolation/RBAC/Commerce authorization change** — Not triggered. Preview is fully
   tenant/RBAC-scoped already (`apps_builder.view`/`.manage`/`.publish` + `commerce.app_builder`
   app-gate, `routes/api.php:900-935`); it fetches no live commerce data today, so there is no
   existing authorization surface to widen — adding binding *resolution* in LP-3 will need to
   reuse the same tenant-scoped commerce endpoints the app already calls elsewhere, not a new
   path.
7. **Arbitrary executable merchant code required** — Not triggered. `$item.*` substitution and
   visibility evaluation are both closed, non-expression mechanisms by design on the runtime
   side; nothing found requires more than mirroring that same closed mechanism.
8. **Scope expansion into App Factory/signing/distribution/Production** — Not triggered.

No Decision Gate applies. **LIVE-PREVIEW-2 is READY.**

## 10. Smallest recommended parity approach (for LP-2's own scoping, not adopted here)

In order of what LP-2 should establish first (each is a candidate for its own task/slice,
matching this horizon's own "small evidence-driven tasks" execution model):

1. Port `resolveNodeBindings`/`evaluateVisibility`/`pruneInvisible`'s exact algorithm
   (`binding_resolution.dart`) into a small, pure TypeScript module consumed by
   `canvas.tsx` — same fail-closed rules, same `$item.<field>` exact-string-only substitution,
   same "visibility is presentation-only" boundary. This is LP-2's "smallest shared/derived
   contract" in concrete terms.
2. Feed that module real (or realistic sample) resource data for `commerce.products`/
   `commerce.cart` specifically — the two resources already capability-gated — deferring any
   other resource. This is naturally LP-3's job ("Binding + Collection Preview Parity"), not
   LP-2's.
3. Give Preview a visible inert/live distinction for actionable components (mirrors
   `_ActionTappable` without needing a real dispatcher) — LP-4.
4. Run the *existing* `CompatibilityResolver` contract (already real, already shared) live
   during editing, not only at Validate/Publish, and surface unsupported/fallback nodes inline
   — LP-4/LP-5 boundary.
5. Fix the `theme.tokens` key mismatch (`primaryColor` → `colorPrimary`, or extend the runtime
   read) and decide whether/how a **published** tenant experience should ever seed the real
   app's `ThemeData` at all — currently it structurally cannot, regardless of Preview. This is a
   runtime-side question, likely outside LP-2's "Preview" framing entirely; flagging it for the
   owner rather than scoping it into this horizon's task queue unasked.
6. Add a `Draft` / `Default` / `Published` preview-state switcher — explicitly LP-6's job, not
   LP-2's, but LP-2's shared-contract module should be built so LP-6 can hand it a
   `kHomeSchemaJson`-equivalent fixture without new plumbing.

Separately (not blocking LP-2): correct the stale `binding.runtimeNote` Inspector copy (§3/§8
row 10), and consider whether an `optional` authoring control belongs in the Inspector before
merchants routinely hit the visibility fail-closed-whole-document behavior in §4 blind.

## 11. Security / Tenant Isolation

No issue found. Preview fetches no live commerce/customer data today (§3-§4), so there is no
cross-tenant leakage surface in the current canvas. All App Builder routes are correctly
permission- and app-gated (`routes/api.php:900-935`: `apps_builder.view/manage/publish` +
`commerce.app_builder`), and `BuilderApp`/`BuilderDraftExperience` are tenant-scoped models. The
one thing to carry into LP-3: when Preview starts fetching real resource data for binding
parity, it must reuse the tenant-scoped, already-authorized commerce endpoints/services the rest
of the app already calls — never a new unscoped read path — exactly as `ThemePanel`'s existing
"Use my store design" flow already does today (`theme-panel.tsx`, `commerce.manage`-gated).

## Exit-criteria mapping (horizon §"Exit criteria", item 2 only — this task's own scope)

"Preview semantics are documented and aligned with the supported Runtime contract" — documented
in full above (§1-§7); **not yet aligned** (that is LP-2 through LP-6's job, by the horizon's
own task breakdown). This document is the evidence baseline those tasks build from.
