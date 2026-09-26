# AWJ App Builder — Real Mobile Preview Horizon

**Status:** PROPOSED / DOCUMENTED — NOT STARTED  
**Repository:** `safwan5001-source/Nebrax`  
**Starting main SHA:** `07f9769463134b6c388ef31845289474bcf6d396`  
**Owner:** Safwan / AWJ  
**Scope:** Product + UX + Architecture planning only. No implementation is authorized by this document alone.

---

## 1. Why this Horizon exists

AWJ App Builder already has a real merchant-facing Builder workspace and web Canvas.

The current Canvas is useful for:
- editing the declarative App Schema;
- selecting pages/components;
- inspecting properties;
- previewing RTL/LTR and device widths;
- previewing Draft / Published / Default schema states;
- rendering schema-bound sample data where live merchant commerce data is intentionally unavailable;
- surfacing unsupported runtime capabilities honestly instead of pretending they work.

However, that Canvas is **not the actual Flutter application runtime rendered inside a real mobile-device experience**.

This creates an important UX distinction:

### Existing today — Design Canvas
A web-based authoring surface that approximates the mobile result while remaining faithful to the shared schema/runtime contract.

### Missing today — Real Mobile Preview
A dedicated preview experience that lets the merchant see and interact with the app as close as practical to the actual AWJ mobile runtime, clearly separated from the editor Canvas.

The product goal of this Horizon is to close that gap without creating a second runtime truth.

---

## 2. Product principle

AWJ must never imply that a web approximation is the final native rendering when it is not.

The Builder therefore needs two explicit modes:

1. **Design Canvas**
   - optimized for editing;
   - fast;
   - dense;
   - selectable;
   - inspector-friendly;
   - framework-neutral where required.

2. **Mobile Preview**
   - optimized for confidence in the final mobile experience;
   - non-editing-first;
   - device-shaped presentation;
   - runtime-semantic fidelity;
   - eventually able to continue onto a physical phone.

These modes may share schema, compatibility, data contracts, and preview-session infrastructure, but they must not silently diverge in behavior.

---

## 3. Reference direction

The experience should follow the product pattern used by mature commerce/app-builder systems such as Salla:

- editing and final-app preview are separate concepts;
- the merchant can inspect how the mobile application will actually feel, not only how components are arranged in an editor;
- preview should be understandable without knowing internal terms such as schema, runtime, capability manifest, or theme tokens;
- device preview should be visually obvious and confidence-building;
- physical-device preview should become a natural extension of browser preview.

### Evidence rule

Before implementation begins, the task must perform an **evidence-first benchmark pass** using original/current sources where possible.

The benchmark should study:
- Salla App Maker / mobile app preview;
- Shopify mobile/theme/app-preview patterns where relevant;
- Apple / Google / Flutter constraints relevant to browser, simulator, deep-link, install, and preview flows;
- any current industry pattern for QR/session-based device preview.

External evidence must be separated from AWJ decisions.

Do not copy another product mechanically.

---

## 4. Existing AWJ baseline that must be preserved

This Horizon starts from the existing App Builder / Mobile Runtime architecture.

The following remain source-of-truth constraints:

- the App Schema is declarative and versioned;
- compatibility is capability-gated and fail-closed;
- `commerce/v1` remains the mobile Commerce API;
- Published Experience remains the runtime source for released customer-facing experience;
- Default AWJ Experience remains the safe fallback;
- Last Known Good behavior remains controlled by the existing runtime contract;
- Tenant Isolation, RBAC, Commerce authorization, and token boundaries are not weakened;
- no arbitrary merchant JavaScript, Dart, eval, SQL, arbitrary HTTP, or executable plugins;
- the Builder Canvas must not invent runtime behavior that the mobile app cannot execute;
- the Mobile Preview must not become an independent schema interpreter with different semantics.

---

## 5. Current known boundary

The web Builder route is:

`/app-builder/[id]/builder`

It currently provides the authoring workspace and Canvas.

The existing Canvas is intentionally **not** Flutter rendered inside the browser.

The actual mobile behavior is implemented under the real mobile runtime and has integrated proof through:

`Published Experience → commerce/v1/experience → startup resolver → compatibility → runtime hydration → runtime rendering`

This Horizon must build on that path rather than replace it.

---

## 6. Target UX

Inside App Builder, the merchant should have a clearly visible switch between:

- **Design**
- **Preview**

Suggested Arabic labels:
- `تصميم`
- `معاينة التطبيق`

Suggested English labels:
- `Design`
- `App Preview`

The Preview mode should visually resemble a real phone experience rather than an editable canvas.

### Browser preview minimum

The first useful version should provide:

- iPhone-like and Android-like device frames;
- mobile viewport presets;
- portrait-first layout;
- optional device chrome treatment that does not obscure content;
- app navigation that behaves like the actual runtime;
- Draft / Published / Default state selection where safe and honest;
- locale and RTL/LTR selection;
- loading, unavailable, unsupported, and compatibility states;
- explicit indication when preview data is sample/non-live;
- clear indication when the preview is browser-rendered rather than device-runtime-rendered.

No fake native status bar behavior should be invented merely for appearance.

---

## 7. Physical-device preview target

The longer-term target is:

**Open on phone / Preview on device**

The merchant should be able to:

1. request a temporary preview session;
2. receive a QR code and/or deep link;
3. open the preview in an AWJ Preview host/application on a physical phone;
4. load only the intended tenant/app/draft preview context;
5. inspect the same schema under the actual mobile runtime;
6. expire/revoke the preview session safely.

The preferred direction is a short-lived preview-session token rather than exposing merchant admin auth or long-lived store credentials.

This is a future architecture decision and requires its own security Decision Gate before implementation.

---

## 8. Preview truth levels

AWJ should explicitly model preview confidence instead of treating all preview modes as equivalent.

### Level A — Design Canvas
Web approximation for editing.

### Level B — Browser Mobile Preview
Non-editing browser representation using the same schema/runtime semantics where feasible.

### Level C — Real Runtime Preview
Actual Flutter runtime executing the preview experience in an emulator/device-compatible path.

### Level D — Physical Device Preview
Actual Flutter runtime on a real phone through a controlled preview session.

The UI should not label Level A or Level B as “exact native preview” unless it truly is.

---

## 9. Data policy

This Horizon must not casually re-open the existing Builder Preview auth boundary.

Current Builder Preview product/cart data may use intentionally labeled sample data because the merchant web session and the mobile store-bearer boundary are different trust contexts.

Real merchant data in browser/mobile preview requires an explicit auth architecture decision.

Possible future approaches may include:
- short-lived preview-session token;
- dedicated merchant-authenticated preview proxy;
- scoped server-issued mobile preview credential.

Do not forward store-bearer tokens into the merchant browser merely to make preview look live.

Do not expose admin Sanctum credentials to a mobile preview client.

---

## 10. Draft preview architecture

A real Draft Preview must not overwrite or impersonate Published Experience.

The architecture should preserve:

- Draft remains mutable authoring state;
- Published remains immutable/runtime release state;
- preview session identifies a specific draft snapshot/revision;
- preview does not implicitly publish;
- changing Draft while a preview session is open must have an explicit refresh/versioning policy;
- stale preview sessions must fail safely.

A preview snapshot may be preferable to a moving raw draft pointer if reproducibility/security requires it.

This requires evidence and a focused architecture decision during implementation.

---

## 11. Proposed Horizon task queue

### MOBILE-PREVIEW-1 — Evidence & UX benchmark
**Goal:** establish the exact product/UX pattern before implementation.

Required:
- current Salla evidence;
- relevant Shopify/other mature builder evidence;
- native/mobile preview constraints;
- screenshots or documented interaction patterns where legally/technically available;
- retained/rejected patterns;
- AWJ-specific UX decision.

Deliverable:
`REAL-MOBILE-PREVIEW-1-EVIDENCE-PASS.md`

No code.

---

### MOBILE-PREVIEW-2 — Current runtime/preview architecture evidence
**Goal:** trace exactly what can be reused.

Inspect only:
- current Builder Canvas;
- PreviewState handling;
- shared schema/runtime contract;
- Flutter runtime boot;
- commerce experience fetch;
- compatibility resolver;
- current test harnesses;
- existing auth boundaries.

Deliverable:
short architecture evidence report and Decision Gate if necessary.

No broad repo rediscovery.

---

### MOBILE-PREVIEW-3 — Browser App Preview shell
**Goal:** introduce a distinct non-editing App Preview mode in the Builder.

Expected scope:
- Design / App Preview switch;
- device-frame shell;
- mobile viewport presets;
- clean non-editing presentation;
- Draft / Published / Default status indication;
- browser-preview truth label;
- loading/error/compatibility states.

Must reuse existing schema semantics.

Must not create a second component contract.

---

### MOBILE-PREVIEW-4 — Runtime semantic parity
**Goal:** ensure Browser App Preview resolves supported bindings, collections, actions, navigation, and capability states consistently with the shipped runtime contract.

Requirements:
- conformance fixtures;
- no unsupported capability simulation;
- fail-closed behavior where required;
- no silent fallback that looks like success.

If native-only behavior cannot be represented honestly in browser preview, show a clear preview limitation rather than inventing it.

---

### MOBILE-PREVIEW-5 — Preview Session security architecture
**Goal:** decide the safe mechanism for real-runtime / physical-device preview.

This is a mandatory Decision Gate before any token/session implementation.

Must decide:
- session issuer;
- token format/scopes;
- tenant/app binding;
- draft snapshot/revision binding;
- TTL;
- revocation;
- replay behavior;
- data-access scope;
- rate limits;
- logging/audit;
- whether an AWJ Preview app or app-specific development build consumes it;
- whether browser and physical-device preview use the same session contract.

Security review must explicitly cover tenant isolation and credential leakage.

---

### MOBILE-PREVIEW-6 — Real Runtime Preview
**Goal:** run the preview through the actual Flutter runtime using the approved preview-session contract.

Requirements:
- no Published Experience mutation;
- actual CompatibilityResolver;
- actual runtime component registry;
- actual hydration/rendering path;
- deterministic preview session;
- safe unavailable state;
- no admin-auth leakage.

---

### MOBILE-PREVIEW-7 — QR / Open on phone
**Goal:** make physical-device preview easy for merchants.

Expected UX:
- `Preview on phone` button;
- QR code;
- copy/open deep link where supported;
- session expiration shown clearly;
- regenerate/revoke;
- device connection state where feasible.

No signing/distribution/store submission is implicitly authorized by this task.

---

### MOBILE-PREVIEW-8 — Integrated proof & real-device verification
**Goal:** prove the entire path.

Minimum proof:
`Builder Draft → Preview session/snapshot → real runtime → compatibility → data/hydration → navigation/render → physical device`

Must include:
- tenant isolation negative tests;
- expired/revoked token tests;
- incompatible schema fail-closed tests;
- Draft ≠ Published proof;
- Default fallback unaffected;
- real Android device verification;
- real iOS device verification before declaring physical-device preview complete.

---

### MOBILE-PREVIEW-9 — Closure
Produce a durable closure report with:
- task/PR ledger;
- Base / Head / Merge SHAs;
- tests/build/CI;
- UX evidence;
- exact preview truth levels delivered;
- security and Tenant Isolation evidence;
- real-device evidence;
- known limitations;
- deferred signing/distribution/store-submission work;
- next recommended Horizon.

---

## 12. Decision Gates

Stop for Safwan before implementation if any task requires:

1. changing the public App Schema contract;
2. weakening fail-closed compatibility;
3. changing Tenant Isolation behavior;
4. changing RBAC or Commerce authorization semantics;
5. forwarding merchant/admin auth to a mobile runtime;
6. exposing long-lived store credentials;
7. introducing a new token/session architecture without explicit review;
8. publishing Draft as a side effect of Preview;
9. building a second independent component/runtime contract;
10. arbitrary executable merchant code;
11. material mobile runtime redesign;
12. mobile signing, TestFlight, Play distribution, App Store/Google Play submission, or Production release outside explicitly approved scope.

Ordinary missing UI or implementation inside an approved task is not a Decision Gate.

---

## 13. Security requirements

Preview must be tenant-bound from end to end.

Any future preview-session credential must be:
- short-lived;
- scoped to one tenant;
- scoped to one Builder App;
- ideally scoped to one immutable draft snapshot/revision;
- non-admin;
- non-reusable outside the intended preview channel where practical;
- revocable;
- auditable.

A cross-tenant preview request must return a safe denial/not-found outcome without leaking existence.

Preview must never bypass the existing Commerce authorization model merely because it is “temporary”.

---

## 14. Backward compatibility

This Horizon must preserve:

- current Builder Design Canvas;
- current Published Experience runtime;
- Default AWJ Experience;
- Last Known Good behavior;
- existing App Schema documents;
- existing actions/bindings/navigation;
- existing merchant editing flow;
- existing mobile startup behavior outside preview mode.

The preview feature is additive.

---

## 15. UX quality bar

AWJ is an everyday business/accounting product.

The Preview experience should prioritize:
- clarity;
- confidence;
- fast switching between edit and preview;
- obvious device context;
- honest state labeling;
- minimal chrome;
- responsive behavior;
- Arabic/English parity;
- RTL/LTR correctness;
- useful empty/loading/error states.

Avoid decorative phone mockups that reduce usable preview area without improving confidence.

---

## 16. Non-goals

This Horizon does not automatically include:

- building the final customer App Factory;
- creating per-merchant App Store/Google Play binaries;
- signing/certificates/provisioning profiles;
- TestFlight/Play Console submission;
- production app-store release automation;
- customer login/identity expansion;
- arbitrary native plugins;
- theme-system redesign;
- unrelated Store Customizer redesign;
- replacing the existing Design Canvas;
- unrelated ERP refactoring.

Those require their own approved scope.

---

## 17. Relationship to Runtime Correctness Follow-up

Do not start this Horizon before the current:

`AWJ_APP_BUILDER_RUNTIME_CORRECTNESS_FOLLOWUP_V1`

is CLOSED/PASS, unless Safwan explicitly changes priority.

Reason:
Real Mobile Preview should be built on a runtime whose current correctness findings are already closed.

As of this document's starting SHA, RUNTIME-CORRECTNESS-4 has landed on `main`; closure of that Horizon should still be confirmed before Mobile Preview implementation begins.

---

## 18. Recommended first implementation boundary

The first implementation slice should **not** jump directly to QR/device tokens.

Recommended order:

1. benchmark/evidence;
2. browser App Preview UX;
3. parity/conformance;
4. security architecture Decision Gate;
5. real Flutter runtime preview;
6. QR/device flow;
7. real-device verification.

This keeps UX work independent from sensitive auth/session work and prevents building a token system before the product flow is settled.

---

## 19. Exit criteria

This Horizon is complete only when:

1. Design Canvas and App Preview are visibly distinct;
2. App Preview has a clear device-oriented UX;
3. preview truth level is honestly communicated;
4. supported runtime semantics are shared/conformance-tested;
5. unsupported features do not masquerade as working;
6. real-runtime preview uses the actual Flutter compatibility/render path;
7. Draft Preview does not mutate Published Experience;
8. preview auth/session is tenant-isolated, scoped, short-lived, and tested;
9. QR/open-on-phone flow works safely;
10. real Android and iOS device verification is recorded;
11. existing Builder and runtime behavior remain backward compatible;
12. closure report documents remaining limitations and distribution boundaries.

---

## 20. Durable product decision

**AWJ will keep the current Builder Canvas as the editing surface and introduce a separate Real Mobile Preview experience.**

The Canvas is not to be renamed or presented as an exact native app preview.

The new preview direction is:

`Design Canvas → Browser App Preview → Real Flutter Runtime Preview → Physical Device Preview`

Each level must be explicit about what it proves.

No implementation, Production deploy, mobile signing, distribution, or store submission is authorized merely by this planning document.
