# MOBILE-PREVIEW-2 — Current Runtime / Preview Architecture Evidence

**Horizon:** AWJ App Builder — Real Mobile Preview  
**Status:** EVIDENCE PASS / ARCHITECTURE DECISION READY FOR REVIEW  
**Repository:** `safwan5001-source/Nebrax`  
**Base SHA:** `42155191c18b17cee66438b7e22affddd94dafaf`  
**Scope:** Architecture evidence only. No implementation.

---

## 1. Purpose

MOBILE-PREVIEW-2 answers one question:

> What should AWJ use for Browser App Preview without creating a second runtime truth, weakening auth boundaries, or delaying the Real Runtime / Physical Device path?

This pass inspects only the current Builder Canvas, PreviewState wiring, Flutter runtime boot, compatibility/runtime registry, commerce transport/session/cache assumptions, and current runtime integration points.

No broad repository rediscovery was performed.

---

## 2. Current Builder evidence

### 2.1 Builder workspace already separates source state

The current Builder route:

`web/src/app/(app)/app-builder/[id]/builder/page.tsx`

already has:

`PreviewState = 'draft' | 'published' | 'default'`

Behavior:
- Draft is editable.
- Published and Default are read-only.
- Published reuses the existing versions endpoints.
- Default uses the bundled `DEFAULT_APP_EXPERIENCE`.
- Publish remains explicit and separate.

This is a good foundation for the new Design / App Preview UX.

### 2.2 Current Canvas is explicitly not Flutter

`web/src/modules/app-builder/canvas.tsx` documents itself as:

- React/Tailwind;
- framework-neutral approximation;
- not literal Flutter rendering;
- read-only at the Canvas renderer level;
- binding-aware using `resolveNodeBindings`;
- sample-data-backed;
- honest about unsupported visibility;
- capability-aligned where currently implemented.

This means the current Canvas is already suitable as an **authoring renderer**, but not as proof of the native Flutter runtime.

### 2.3 Current Canvas mixes authoring chrome with preview rendering

The Canvas currently includes:
- selectable node frames;
- type tags;
- hover rings;
- selected rings;
- fallback selection mapping for repeated binding nodes;
- unsupported-visibility badges.

This is useful in Design mode, but exactly the wrong chrome for a merchant-facing App Preview mode.

Therefore MOBILE-PREVIEW-3 should **reuse semantic rendering capability**, but not expose current Canvas selection/edit affordances in Preview mode.

---

## 3. Current Flutter runtime evidence

### 3.1 Real boot path exists and is authoritative

`mobile/lib/app/awj_runtime_shell.dart` now calls:

`resolveRealStartup(...)`

using:
- the real CommerceClient;
- the real ExperienceCache;
- the current CapabilityManifest.

The startup decision is one of:
- UseFreshExperience;
- UseDefaultExperience;
- UseLastKnownGood;
- ControlledUnavailable.

This is the real runtime truth and must remain authoritative for Real Runtime Preview.

### 3.2 Real compatibility authority exists

`mobile/lib/schema/compatibility.dart` provides one pure:

`CompatibilityResolver.resolve(schema, manifest)`

It:
- fail-closes on unsupported required capabilities;
- prunes optional unsupported subtrees;
- gates bindings / collect;
- gates visibility only when capability exists;
- returns an explicit incompatible state instead of guessing.

Browser Preview must not implement a different compatibility meaning.

### 3.3 Real component registry exists

`mobile/lib/registry/component_registry.dart` maps runtime component identifiers to actual Flutter widget builders.

The registry key set is contract-tested against RuntimeCapabilities.

This is materially stronger proof than the React Canvas renderer and is the core reason Real Runtime Preview must ultimately use Flutter.

### 3.4 Live runtime hydration exists

The real runtime hydrates commerce data into schema nodes, including the newly-corrected generic:

`hydrateNodesByType(..., 'CartSummary', ...)`

This is already verified by runtime/widget tests from Runtime Correctness Follow-up V1.

---

## 4. Flutter Web feasibility evidence

Flutter Web is **architecturally possible**, but the current `mobile/` runtime does **not** compile to web unchanged.

### 4.1 Network transport is mobile-only today

`mobile/lib/commerce/commerce_transport.dart` imports:

`dart:io`

and `IoCommerceTransport` uses `HttpClient`.

The file explicitly says:

> If a future task adds web as a target, this transport would need a dart:io-free alternative.

Therefore an embedded Flutter Web preview requires at least a web transport implementation or conditional import.

### 4.2 Experience cache is mobile-filesystem-specific

`mobile/lib/startup/experience_cache.dart` imports:

- `dart:io`
- `path_provider`

and the production implementation is `FileExperienceCache`.

A Flutter Web build needs a separate cache implementation or a preview-specific no-persistence strategy.

### 4.3 Secure session semantics are not reusable blindly

`FlutterSecureSessionStore` is documented specifically as:
- iOS Keychain;
- Android Keystore / encrypted storage.

Even if the package has a web implementation, the current AWJ security contract is written around native secure storage.

Browser Preview must not silently downgrade that contract or store customer/cart credentials in ordinary browser storage.

This is especially important because MP-1 already locked:
- no hidden token forwarding;
- no merchant/admin token in browser;
- no long-lived store credential in preview.

### 4.4 Runtime config expects a store bearer credential

`mobile/lib/app/runtime_config.dart` builds CommerceConfig from:

- `COMMERCE_BASE_URL`
- `COMMERCE_STORE_BEARER_TOKEN`

The bearer is sensitive read-tier tenant access.

Embedding this directly into a browser-delivered Flutter Web bundle would expose it to the browser and is unacceptable.

This is a hard architecture boundary until the Preview Session/Auth Decision Gate is resolved.

### 4.5 Native platform integrations are not Browser Preview features

The runtime shell initializes:
- DeepLinkController through MethodChannel;
- ChannelPushAdapter through MethodChannel.

They are fail-safe when plugins/native sides are missing, but they are still native integration concerns.

Browser Preview does not need to reproduce push or OS-level deep-link delivery to be useful.

Trying to make browser preview emulate them would expand scope and create misleading proof.

---

## 5. Architecture options evaluated

### Option A — Use current React renderer for Browser App Preview

**Pros**
- already exists;
- already supports Draft / Published / Default source selection;
- already has binding conformance work;
- no mobile build/runtime packaging required;
- no store-bearer exposure;
- no new auth/session contract required for initial preview shell;
- fast and low-risk for MP-3.

**Cons**
- not actual Flutter widget rendering;
- component presentation can drift unless continuously conformance-tested;
- cannot prove native runtime details.

**Assessment:** suitable for Browser Preview if truth-labeled clearly.

---

### Option B — Embedded Flutter Web as Browser App Preview now

**Pros**
- closer visual/widget parity with actual Flutter runtime;
- reuses ComponentRegistry and CompatibilityResolver;
- reduces React-vs-Flutter presentation drift.

**Cons / blockers now**
- `dart:io` commerce transport;
- file-based ExperienceCache;
- store bearer provisioning would expose sensitive credential if done naively;
- native secure-session semantics cannot be copied into browser without a separate security design;
- platform integrations still differ from native;
- would force auth/session architecture before MP-5.

**Assessment:** technically feasible later, but **not safe as MP-3's first implementation**.

---

### Option C — Hybrid

**Definition**
- Design mode: existing React Builder Canvas.
- Browser App Preview: React-based non-editing preview shell using the existing schema/runtime-contract mirror and conformance fixtures.
- Real Runtime Preview: actual Flutter runtime.
- Physical Device Preview: actual Flutter runtime on iOS/Android.
- Flutter Web remains an optional future optimization after preview-session/auth architecture exists.

**Pros**
- preserves current safe auth boundaries;
- delivers the phone-frame App Preview UX quickly;
- does not pretend Browser Preview is native;
- keeps actual Flutter as the only Real Runtime truth;
- avoids embedding sensitive store bearer credentials in browser;
- lets MP-5 solve preview session/auth once for real-runtime/device work;
- no unnecessary mobile refactor before product UX exists.

**Cons**
- Browser Preview still needs continuous conformance tests;
- React visual parity will never be identical to Flutter;
- some native behavior must be labeled unavailable.

**Assessment:** safest and smallest architecture for this Horizon.

---

## 6. Architecture decision

### MP2-D1 — Choose Hybrid

**Decision: ACCEPTED FOR HORIZON IMPLEMENTATION**

AWJ should implement:

`Design Canvas (React) → Browser App Preview (React, non-editing) → Real Runtime Preview (Flutter) → Physical Device Preview (Flutter)`

Browser Preview is a merchant UX/product surface.

Real Runtime Preview is the runtime proof surface.

They share:
- App Schema;
- declared capabilities;
- binding semantics/conformance fixtures;
- Draft / Published / Default source concepts;
- data contracts where safe.

They do **not** share the claim that they are equivalent execution environments.

---

## 7. Why Flutter Web is not selected for MP-3

Flutter Web is **not rejected permanently**.

It is deferred because the current runtime has three real boundaries that must not be bypassed:

1. browser-incompatible transport/cache implementation;
2. sensitive store-bearer provisioning;
3. native secure-session assumptions.

Solving those only to display the first Browser Preview shell would prematurely pull MP-5's security architecture into MP-3.

That would violate this Horizon's sequencing.

Flutter Web may be reconsidered after MP-5 if:
- a short-lived preview session can supply data safely;
- web transport can be introduced behind existing interfaces;
- cache/session implementations remain fail-closed;
- bundle/startup performance is acceptable;
- it demonstrably reduces drift enough to justify complexity.

---

## 8. MOBILE-PREVIEW-3 implementation boundary

MP-3 should build **Browser App Preview Shell only**.

### Required

- top-level Design / App Preview switch;
- App Preview removes selection/editing chrome;
- central phone/device frame on desktop;
- iPhone / Android visual frame presets;
- mobile viewport sizing;
- Draft / Published / Default source selector;
- locale / RTL / LTR;
- Full Preview mode;
- explicit truth badge:
  - `معاينة المتصفح / Browser Preview`;
- sample-data badge remains when sample data is used;
- clean loading / no-published / unavailable states;
- no hidden editor actions while Preview is active.

### Reuse

Reuse:
- current PreviewState source logic;
- current schema;
- current binding-resolution mirror;
- current sample-resource data;
- existing registry metadata;
- existing theme preview behavior where truthful.

Do not duplicate PreviewState fetching.

### Do not implement yet

Do not implement in MP-3:
- preview-session tokens;
- live merchant commerce data;
- store bearer forwarding;
- admin Sanctum forwarding;
- Flutter Web embedding;
- QR;
- Universal/App Links;
- physical device preview;
- signing/distribution;
- theme/runtime redesign;
- visibility capability expansion.

---

## 9. MOBILE-PREVIEW-4 boundary

MP-4 should strengthen semantic parity between Browser Preview and shipped runtime.

Focus:
- action availability / disabled states;
- navigation semantics;
- binding / collect conformance;
- component registry identifier parity;
- supported property behavior where practical;
- explicit unsupported/native-only states.

The goal is not pixel-identical Flutter rendering.

The goal is:
**same schema meaning, honest execution difference.**

---

## 10. MOBILE-PREVIEW-5 remains the security Decision Gate

MP-2 confirms MP-5 is genuinely required.

Before Real Runtime Preview can consume Draft or live merchant data, AWJ must decide:
- preview-session issuer;
- opaque token format;
- tenant/app binding;
- revision/snapshot binding;
- TTL;
- revocation;
- replay controls;
- data-access scope;
- how runtime obtains commerce access without receiving merchant/admin auth;
- whether the session is usable by browser, Flutter runtime, or both;
- audit/logging;
- cross-tenant negative behavior.

No implementation in MP-3/4 may pre-decide this by smuggling existing credentials into the browser.

---

## 11. Security findings

### PASS
Current architecture already has strong separations:
- Builder merchant auth is separate from mobile commerce auth.
- Store bearer is not hardcoded in repository.
- customer/cart session values do not surface to widgets.
- runtime startup has explicit safe failure states.
- compatibility is fail-closed.
- transport, secure-session store, and experience cache already use interfaces.

These interfaces are useful seams for later preview work.

### Important risk to avoid
Do not interpret those interfaces as permission to create weak browser implementations.

A `WebSecureSessionStore` or `WebCommerceTransport` would still require explicit security review if it carries real credentials.

---

## 12. Backward compatibility

The Hybrid decision is additive.

It does not change:
- current Design Canvas behavior;
- Draft save;
- Validate / Publish;
- Published Experience;
- Default Experience;
- LKG behavior;
- mobile startup;
- ComponentRegistry;
- CompatibilityResolver;
- Commerce API;
- Tenant Isolation;
- RBAC;
- auth/token issuance.

---

## 13. Decision Gate status

**No Decision Gate triggered in MP-2.**

Reason:
This task only selects an implementation architecture that explicitly avoids crossing the auth/session boundary.

The mandatory Preview Session/Auth gate remains at MP-5.

---

## 14. Recommended next task

Proceed to:

**MOBILE-PREVIEW-3 — Browser App Preview Shell**

Recommended implementation approach:
- small, isolated web PR;
- reuse current Builder route/state;
- introduce a Preview-only presentation wrapper;
- keep the existing Canvas rendering logic but suppress authoring chrome through an explicit mode rather than forking the renderer;
- add phone-frame/device presets and Full Preview;
- preserve all current Draft / Published / Default semantics;
- tests focused on:
  - no editing controls active in Preview;
  - source switching;
  - device frame/viewport;
  - RTL/LTR;
  - sample-data honesty;
  - returning to Design restores editor state.

Given the scope is a bounded web feature, **Cursor** is a good implementation tool for MP-3.

---

## 15. MP-2 result

**MOBILE-PREVIEW-2 — PASS**

Architecture decision:

**Hybrid**

`React Design Canvas → React Browser App Preview → Flutter Real Runtime Preview → Flutter Physical Device Preview`

Key rationale:
- fastest path to the merchant UX Safwan requested;
- no credential leakage;
- no auth architecture pulled forward;
- no second runtime truth because Browser Preview is explicitly truth-labeled and conformance-tested;
- actual Flutter remains the authoritative Real Runtime / device proof;
- Flutter Web remains available as a future optimization, not a prerequisite.
