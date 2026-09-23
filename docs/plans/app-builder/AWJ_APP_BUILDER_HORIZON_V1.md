# AWJ App Builder Horizon V1

**Status:** Execution authorization candidate  
**Parent architecture:** `docs/plans/store/AWJ_APP_BUILDER_PRODUCT_ARCHITECTURE_V1.md`  
**Runtime prerequisite:** Mobile Runtime Proof V1 CLOSED on `main@a3acb3f`

## Objective

Build the first production-grade AWJ App Builder authoring foundation that lets a merchant create and edit a safe, versioned mobile commerce experience which the proven AWJ Flutter Runtime can consume.

This horizon is the **App Builder** stage only. It does not authorize App Factory, production signing, App Store/Google Play submission, or production release.

## Fixed boundaries

- AWJ Commerce remains source of truth for catalog, price, availability, customer, cart, orders, payments and shipping.
- Builder owns experience/design/configuration, not business authority.
- Store Customizer ≠ App Builder ≠ App Factory.
- App Schema is declarative untrusted configuration, never arbitrary executable code.
- No schema may select tenant authority, execute SQL, load arbitrary code/packages, or override server pricing/tax/inventory/payment/auth.
- Trusted runtime capabilities are allowlisted through Component, Action and Data Resource registries.
- Draft Experience, Published Experience and Native Build Release remain distinct.
- Published experience is immutable/versioned; merchant edits a Draft.
- Arabic/RTL is first-class; English/LTR supported.
- Mobile UX remains mobile-appropriate even when importing shared store brand/theme intent.
- No WebView as primary runtime.
- No production deploy/release under this horizon.

## V1 product slice

### App Manager / creation
- Apps list and app overview foundation.
- Create app via: Use My Store Design / Choose Template / Start From Scratch.
- Every path produces a safe minimum commerce shell.
- App identity/metadata is tenant-scoped and permission-gated.

### Builder workspace
Desktop-first professional workspace with:
- Pages / Components / Layers
- interactive canvas/device preview
- Inspector: Content, Layout, Style, Data, Actions, Conditions, Visibility, Advanced
- undo/redo/history appropriate to V1
- Draft/Saved state
- validation/issues
- locale + device preview controls
- Design mode and bounded Develop mode

Mobile admin UX is required for essential management/review actions, but full drag-heavy authoring may remain desktop-optimized if documented and intentionally designed.

### Experience contract
Implement the minimum server-side persistence/validation needed for:
- Draft Experience
- versioned App Schema
- Component Registry metadata for Inspector
- Action Registry
- Data Resource Registry
- theme/navigation/pages/assets references
- compatibility validation against runtime capabilities
- immutable Published Experience Version

Do not invent a second schema/runtime contract when the Mobile Runtime Proof already established compatible primitives. Reuse/extend the accepted contract pack and proven runtime semantics.

### Theme / Store design reuse
“Use My Store Design” is first-class:
- share brand assets/tokens/compatible intent, not web markup
- map web concepts to mobile equivalents
- track inherited vs app override
- support Detect → Diff → Preview → Apply for meaningful sync
- never silently overwrite app overrides

### Templates
Templates use the same App Schema/runtime and may provide pages, navigation, theme defaults, placeholders and bindings. No separate runtime per template.

### Publish boundary
V1 Builder must support Draft → Validate → Publish → immutable Published Experience Version, with compatibility checks. Publishing experience is **not** native binary release.

A compatible rollback mechanism may be included only to the extent required by existing runtime compatibility contracts; do not cross into App Factory/release management.

## Explicitly out of scope

- App Factory/build farm
- Apple/Google signing/account ownership
- App Store/Google Play submission/release
- production rollout
- permanent push/messaging provider
- payment-provider selection/native payment SDK commitment
- arbitrary merchant code, arbitrary HTTP, packages, SQL or eval
- marketplace/extensions ecosystem
- full general-purpose workflow/automation engine
- advanced collaboration/multiplayer editing
- full analytics platform
- offline-first commerce
- AI-generated executable runtime behavior
- real-device Preview Session infrastructure (belongs to Preview & Testing horizon unless a small interface is required)
- broad Store Customizer redesign

## Architecture decisions

AB-01 — **Reuse the proven Flutter runtime contract.** Builder emits versioned declarative experience compatible with the accepted App Schema/registry/runtime model.

AB-02 — **Server-authoritative persistence and validation.** Drafts and Published Experience Versions are tenant-scoped backend resources. Frontend editor state is not authority.

AB-03 — **Published versions immutable.** Publishing creates a new immutable version after validation/compatibility checks.

AB-04 — **No remote code.** Components/actions/resources are stable allowlisted IDs and typed configuration. This aligns with platform security direction and the runtime proof.

AB-05 — **Metadata-driven Inspector.** Component definitions expose merchant-editable typed properties, validation, bindings/events/child rules/accessibility metadata; editor does not hard-code an unrelated form model for every component.

AB-06 — **Single source of commerce truth.** Data bindings reference registered resources; no product/price/stock/customer/order copies in schema.

AB-07 — **Draft isolation.** Draft preview/edit endpoints cannot mutate published experience implicitly.

AB-08 — **Theme inheritance is explicit.** Shared store/app brand values preserve provenance and app overrides; sync is reviewable.

AB-09 — **System commerce screens stay safe.** Product/cart/account/checkout capabilities may be presentation-customizable only within registered safe boundaries; merchants cannot remove/replace required security/business contracts.

AB-10 — **Progressive disclosure.** Design is merchant-friendly; Develop exposes typed data/actions/state/conditions/diagnostics without becoming an unrestricted IDE.

AB-11 — **Builder is framework-aware only at the runtime capability boundary.** Persisted App Schema remains framework-neutral; Flutter implementation details do not leak into merchant-authored contract.

AB-12 — **Accessibility and bidi are contract concerns.** Components/Inspector/preview must preserve ar/en, RTL/LTR and accessibility metadata/validation.

## Dependency-safe task queue

1. **APP-BUILDER-1 — Domain/persistence foundation**
   - App, Draft Experience, Published Experience Version lifecycle and tenant/RBAC boundary.
   - migrations/models/services/API contracts; immutable publish semantics.
2. **APP-BUILDER-2 — Schema validation + runtime capability contract**
   - align backend validator with accepted App Schema and Mobile Runtime capability manifest; compatibility negatives.
3. **APP-BUILDER-3 — Component/Action/Data Resource registries**
   - metadata contracts powering Inspector and safe bindings/actions.
4. **APP-BUILDER-4 — App Manager + creation wizard**
   - Apps/overview and three creation paths with safe shell.
5. **APP-BUILDER-5 — Builder workspace shell**
   - Pages/Components/Layers, canvas, Inspector, save state, locale/device controls, responsive admin baseline.
6. **APP-BUILDER-6 — Visual editing + history**
   - select/add/remove/reorder, property edits, bounded drag/direct manipulation, undo/redo, dirty/save semantics.
7. **APP-BUILDER-7 — Data/Actions/Conditions/Visibility**
   - bounded Develop controls using registries; no arbitrary code/HTTP.
8. **APP-BUILDER-8 — Theme + Use My Store Design**
   - shared brand/theme mapping, inherited/override provenance, Detect/Diff/Preview/Apply.
9. **APP-BUILDER-9 — Templates + navigation/pages**
   - same schema/runtime; safe system page constraints and minimum shell.
10. **APP-BUILDER-10 — Validate/Publish/Version/Rollback foundation**
   - Draft → Validate → Published Experience; immutable versions; compatibility-safe rollback within contract.
11. **APP-BUILDER-11 — Integrated vertical proof + UX/security closure**
   - create app → edit → bind real Commerce resource → validate → publish → proven Flutter runtime consumes compatible experience fixture/contract; tenant/RBAC/security/accessibility/bidi/regression evidence.
12. **APP-BUILDER-12 — Horizon closure**
   - final reports, limitations, deferred Preview/App Factory items, next-horizon recommendation; STOP.

A downstream task is not ready until predecessor post-merge review passes unless the horizon documents a safe independent dependency.

## Quality Gates

### A — Tenant / RBAC / persistence
- cross-tenant reads/writes/publish return safe denial/not-found semantics
- permissions cover view/manage/publish as appropriate
- draft and published identities cannot cross tenant/app
- SQLite + PostgreSQL for persistence/security-sensitive changes

### B — Contract safety
- malformed/unknown/too-new schema negatives
- no tenant authority in schema
- no arbitrary code/URL/SQL/package execution
- typed property/action/resource validation
- runtime capability compatibility tests

### C — Commerce authority
- price/availability/cart/payment/auth remain server-authoritative
- schema references resources rather than copying business truth
- no new financial semantics without Decision Gate

### D — Builder UX
- focused, slice-specific UI/UX Evidence Pass completed and documented before implementation
- External Evidence / AWJ UX Decision / Open Decision are separated truthfully
- final implementation conforms to AWJ Design System; no copied external visual identity and no parallel ad-hoc design language
- current Store Customizer interaction patterns are not inherited automatically
- evidence includes Desktop + responsive/mobile, ar/en, RTL/LTR, accessibility and key states/interactions
- dense, professional AWJ workspace
- keyboard/mouse desktop path
- responsive/mobile management path
- ar/en + RTL/LTR
- accessible controls/labels/focus
- clear Draft/Saved/Validation/Published state

### E — Version/publish
- publish is explicit
- immutable published versions
- failed validation cannot publish
- compatibility failure cannot silently publish
- rollback only to compatible experience
- experience publish never claims native release

### F — Regression / review
- focused tests first, broader suites based on risk
- exact final Head CI
- Implementer + Reviewer + AWJ Guardian
- PRE_MERGE_REVIEW and POST_MERGE_REVIEW per Horizon System

## Definition of Done

The horizon is complete only when repository evidence proves:
1. tenant-scoped App/Draft/Published Experience lifecycle exists;
2. a merchant can create an app through the approved creation flow;
3. Builder can author pages/components/properties using registry metadata;
4. data/actions/conditions remain allowlisted and typed;
5. real AWJ Commerce resources remain authoritative;
6. theme/store-design reuse preserves overrides and requires review before meaningful sync;
7. templates use the same contract/runtime;
8. validation catches unsafe/incompatible schema;
9. publish creates immutable compatible Published Experience;
10. proven Flutter Runtime can consume the resulting compatible experience contract without a parallel runtime;
11. each major Builder UI slice has a documented focused UI/UX Evidence Pass and AWJ UX Decision before implementation;
12. final Builder UI demonstrably follows the AWJ Design System rather than competitor identity or automatic Store Customizer inheritance;
13. ar/en, RTL/LTR and accessibility evidence exists;
14. tenant/RBAC/security/backcompat negatives pass;
15. final closure report distinguishes measured/proven items from deferred Preview/App Factory/release work;
16. no production deploy/release/signing occurred without owner approval.

## Decision Escalation Gates

Stop and ask Safwan for:
- material change to App Schema security/authority model
- breaking /commerce/v1 or public API change
- new accounting/payment semantics
- arbitrary-code/plugin/runtime execution proposal
- strategic third-party builder/runtime dependency or license lock-in
- production Bundle/Application ID commitment if registration is required
- Apple/Google ownership/signing/release
- permanent messaging/push/payment vendor
- destructive migration
- production deploy/release
- major scope expansion into Preview & Testing or App Factory

Routine editor implementation choices do not require interruption when they remain inside these contracts.

## Horizon End

At completion:
- persist final state and closure report;
- list deferred Preview & Testing/App Factory items explicitly;
- do not automatically start Preview & Testing;
- STOP for Safwan + ChatGPT review.
