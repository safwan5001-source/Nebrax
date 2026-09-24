# ADR-01 — App Builder Commerce Data Resource Registry, Schema Binding, Conditions/Visibility & Real Runtime Dispatch (V1)

DATE: 2026-09-24
STATUS: accepted
DECIDED_BY: Safwan (owner), with ChatGPT/Claude evidence-and-architecture pass
SUPERSEDES: none — this is the resolution of the `APP-BUILDER-7` / `APP-BUILDER-11` connected
deferred track from AWJ App Builder Horizon V1.
RELATED_TASKS: `APP-BUILDER-7` (deferred, now resolved by this ADR), `APP-BUILDER-11` (its
real-Commerce-binding clause, now resolved by this ADR), `APP-BUILDER-13`..`APP-BUILDER-23`
(this horizon's implementation queue, see `TASK-QUEUE.md`).

## Context

AWJ App Builder Horizon V1 shipped a complete, tenant/RBAC-safe, immutably-versioned schema/
registry/publish pipeline, but its own contract structurally forbade any data binding, condition,
or visibility concept, and left `DataResourceRegistry` a deliberate empty stub. Meanwhile the
already-closed Mobile Runtime horizon independently built real `commerce/v1` data fetching and real
cart-action dispatch — but entirely through hand-written per-screen Dart code, never through the
schema. This left the App Builder able to publish an experience that cannot render live merchant
data or dispatch a real commerce action through its own declared contract, despite the mobile
runtime already being capable of both outside that contract.

A full evidence pass (`AWJ_APP_BUILDER_COMMERCE_RUNTIME_V1_EVIDENCE.md`) was completed against the
real backend contract, the real Flutter runtime, and the real `commerce/v1` API surface (as opposed
to `store/v1` or the still-Spree-transitional `storefront/` app), plus external evidence from
Shopify's typed-condition Collections model, Builder.io's declarative data-binding pattern, the
"Blueprint" server-driven-UI pattern, and Apple/Google policy on downloaded/executable code.

## Decision

**Option A adopted**, with both nested Decision Points resolved and one amendment, per the owner's
explicit approval:

1. **Data Resource Registry** binds to `commerce/v1` only. V1 scope: `commerce.categories`,
   `commerce.products`, `commerce.cart`. **`commerce.customer.profile` and `commerce.orders` are
   excluded from V1** (Decision Point 2 = EXCLUDE) — no login UI exists in the mobile runtime yet,
   so binding to customer-scoped data would be speculative. Revisit once a login flow ships.
2. **App Schema Binding**: a new optional `binding` component-node key, gated by a new
   `requiredCapabilities` entry, restricted to components whose registry metadata declares
   `bindableResource`. Closed JSON shape only (`resource`, `query`, `itemProps`); query values are
   literal scalars or a small enumerated set of runtime-context references — never a string
   template or evaluated expression.
3. **Conditions/Visibility**: a new optional `visibility` key, same capability-gating mechanism.
   **Closed, typed, allowlisted signal/operator model — no expression language, no eval, no
   arbitrary JS/HTTP/GraphQL/SQL**, per explicit owner instruction and per the external evidence.
   Visibility is presentation-only and never a substitute for server-side authorization; every
   dispatched action continues to be independently authorized by `commerce/v1` regardless of what
   the schema rendered.
4. **Actions**: reuse the existing 6-action `ActionRegistry` verbatim. Action params may reference
   bound item context via the same enumerated-reference syntax as bindings. Once an action is
   reachable end-to-end through a bound, schema-declared path, its `dispatchStatus` is updated from
   `DISPATCH_PROVEN_NOOP` to reflect real dispatch.
5. **Mobile Runtime**: one generalized binding/visibility resolution pipeline replaces the three
   duplicated hand-written implementations in `home_screen.dart`/`product_screen.dart`/
   `cart_screen.dart`. Tenant/session boundary is unchanged — bindings never carry tenant identity;
   the resolver only ever calls the app's own fixed, store-bearer-scoped `commerce/v1` base URL.
6. **Decision Point 1 = YES**: the live Published Schema → fetch → verified on-device cache / Last
   Known Good loop (extending `mobile/lib/startup/last_known_good.dart`, which is fully designed
   and unit-tested but has zero real I/O wired) **is in scope and required for this horizon**.
   Without it, the entire binding/visibility mechanism would only ever run against a schema baked
   into a native build, which does not satisfy the mission's "true no-code publish" requirement.
7. **`commerce/v1` is confirmed as the mobile App Builder commerce API contract.** Storefront Web
   and the Mobile App remain two presentation channels over the same authoritative AWJ Commerce
   Core; neither owns commerce data or business rules independently.
8. **Amendment (owner-issued)**: the current build-time `COMMERCE_STORE_BEARER_TOKEN` mechanism is
   recorded as **current-state evidence, not a permanently locked architecture assumption**.
   Credential provisioning/rotation/revocation for store bearer tokens is an explicit **future App
   Factory / security lifecycle boundary** — this horizon documents the boundary but does **not**
   expand into App Factory, signing, or credential-lifecycle tooling. Any future change to how the
   store bearer is provisioned/rotated is its own decision, not assumed here.
9. **Mandatory, not optional, in this horizon**: `APP-BUILDER-21` (App Builder UX/localization pass
   — replacing raw merchant-facing schema identifiers with localized human labels **without
   renaming any internal schema identifier**) and `APP-BUILDER-22` (closing the theme-token
   canvas/runtime rendering gap for radius/density/product-card-style) are both required horizon
   deliverables, not independent nice-to-haves.

## Alternatives considered

- **Option B** (bindings only, defer Conditions/Visibility to a separate future decision) — rejected
  by the owner; Conditions/Visibility is explicitly required in this horizon, kept safe via the
  closed/typed/allowlisted model rather than by deferral.
- **Reject binding/visibility as schema concepts entirely**, requiring a new native build per
  merchant segment — rejected as contradicting the App Builder's stated purpose.

## Evidence

### Repository evidence
See `AWJ_APP_BUILDER_COMMERCE_RUNTIME_V1_EVIDENCE.md` §1 in full (App Builder backend contract,
Flutter mobile runtime, `commerce/v1` API surface, Builder UX localization gap, theme-token
rendering gap).

### External evidence
See `AWJ_APP_BUILDER_COMMERCE_RUNTIME_V1_EVIDENCE.md` §2 (Shopify Storefront API versioning /
Collections typed-inclusion-conditions model; Builder.io declarative data binding; the "Blueprint"
server-driven-UI structure-only pattern; Apple App Store Review Guideline 2.5.2 and Google Play's
dynamic-code-loading policy, both reinforcing "declarative data only, no executable code downloaded
at runtime").

## Rationale

The proposal reuses every existing safety mechanism (`CompatibilityResolver`'s fail-closed/prune
logic, `commerce/v1`'s already-server-derived tenant/auth boundary, `RuntimeActionHandler`'s
already-real dispatch) rather than inventing new ones, and its closed/typed/allowlisted vocabulary
for bindings and conditions is directly supported by external precedent from both a mature headless-
commerce platform (Shopify) and a mature visual-builder platform (Builder.io), while avoiding the
policy risk both Apple and Google attach to downloaded/executable code.

## Consequences

- `AppSchemaParser`'s closed key-list gains two new **optional**, capability-gated keys.
- `DataResourceRegistry` goes from a guarded-empty stub to a guarded-populated one (3 resources).
- `ComponentDefinition`/`ActionDefinition` gain additive metadata (`bindableResource`, dynamic-param
  eligibility, and — per `APP-BUILDER-21` — localized label metadata).
- The mobile runtime gains a real publish→fetch→cache loop for the first time.
- `ActionRegistry`'s `dispatchStatus` values change from uniformly `DISPATCH_PROVEN_NOOP` to
  reflecting real dispatch once schema-reachable.

## Compatibility / migration impact

Every already-published `BuilderPublishedExperienceVersion` declares neither new capability and
contains neither new key — it is structurally unaffected and continues to parse/resolve/render
identically. New capabilities fail closed (prune optional nodes, reject whole documents for
required ones) on any runtime that predates them, using the same mechanism already proven for
components/actions — no new failure mode is introduced.

## Security / tenant / accounting impact

No accounting/financial posting path is touched by this horizon. Tenant authority remains 100%
server-derived on `commerce/v1` (unchanged). No new backend endpoint is introduced for binding/
visibility resolution — it happens client-side in the Flutter runtime against the already-tenant-
scoped, already-authorized `commerce/v1` API. Visibility is explicitly barred from ever gating
authorization. RBAC gates (`apps_builder.*`) are unchanged. Credential lifecycle for the store
bearer token remains explicitly out of scope (see amendment above) and must not be silently
expanded into during implementation.

## Follow-up

Implementation queue finalized in `docs/autonomous-engineering/TASK-QUEUE.md` under "Horizon: AWJ
App Builder — Commerce Data & Dynamic Runtime V1" (`APP-BUILDER-13` through `APP-BUILDER-23`,
promoted to `ready` in dependency order). Any further material decision discovered during
implementation (e.g. an ambiguous field mapping, a genuinely new security trade-off) must be raised
as its own Decision Escalation per `DECISION-ESCALATION.md`, not silently resolved.

## Amendment (2026-09-24) — Storefront completeness is not a Mobile App Builder prerequisite

Owner clarification, recorded verbatim as guidance binding on every remaining task in this horizon
(`APP-BUILDER-15` through `APP-BUILDER-23`), not a new decision superseding anything above:

- **Storefront Web feature/UI completeness is never a prerequisite for App Builder work.**
  Storefront Web and the Mobile App are independent presentation channels over the same
  authoritative AWJ Commerce Core — this was already true of `commerce/v1` vs `store/v1` (§1.3 of
  the evidence doc), but is now stated as an explicit horizon-wide rule: the still-mid-migration
  Spree-based `storefront/` app's own incompleteness (cart/checkout/customer-auth still Spree-shaped,
  per the evidence pass) must never be treated as blocking, gating, or a pacing dependency for any
  App Builder or Mobile Runtime task. The two channels share Commerce truth; they do not share a
  release schedule.
- **The Mobile App must share real Commerce truth, never invent a substitute.** Products, variants/
  options, pricing, inventory, and any other Commerce capability the Mobile App surfaces must come
  from the authoritative `commerce/v1` contract (the same models/services `store/v1` and the
  merchant-facing `api/*` surface already use) — never an app-specific duplicate, a hardcoded
  fixture standing in for a real capability, or a parallel data path invented to route around a gap.
- **A missing Commerce capability is a recorded gap, not an invitation to invent one.** If an
  approved App Builder capability needs something `commerce/v1` does not yet expose (the evidence
  doc already named two: no `commerce.promotions` resource at all, and `commerce.categories` lacking
  `name_en`), the correct action is to record it explicitly as a Commerce Core dependency/gap in the
  relevant task's implementation report and in `TASK-QUEUE.md` — continuing the rest of the
  authorized horizon around it. Escalate to the owner only if the specific gap actually blocks a
  task inside this horizon's approved scope; do not escalate speculatively for gaps that don't block
  anything currently authorized.
- **Consequence for `APP-BUILDER-20` (Same-Store Proof) specifically**: the proof must demonstrate
  that Storefront Web and Mobile App consume the *same Commerce Core data/business rules* (shared
  models, shared price/availability resolvers, shared tenant/channel boundary) — it does **not**
  require the Storefront Web *application* itself to be feature-complete, and must not be blocked
  waiting for `storefront/`'s Spree-to-AWJ migration to finish.

This reaffirms, rather than changes, the horizon's non-negotiable principle: **one Commerce Core,
multiple presentation channels.**
