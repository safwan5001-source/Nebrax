# AWJ Runtime Compatibility V1 — Contract Draft

**Status:** Draft implementation-facing contract  
**Parent:** `AWJ_APP_BUILDER_PRODUCT_ARCHITECTURE_V1.md`  
**Related:** `APP_SCHEMA_V1.md`, `COMPONENT_REGISTRY_V1.md`, `ACTION_REGISTRY_V1.md`, `DATA_RESOURCE_REGISTRY_V1.md`

## 1. Purpose

This contract defines how AWJ safely evolves a published mobile experience while customers may have **different installed native app/runtime versions**.

It prevents a remote App Builder publish from breaking older installed apps or silently introducing native capabilities that have not passed Apple/Google distribution.

Core distinction:

```text
Experience Version != Native Binary Version != Store Rollout != Device Installed Version
```

## 2. Four independent version/state dimensions

AWJ must track separately:

1. **Experience Version** — immutable declarative schema/content published by AWJ.
2. **Native Runtime/Binary Version** — compiled iOS/Android app/runtime capabilities.
3. **Store Release/Rollout State** — Apple/Google availability to a population.
4. **Device Installed Version** — what a specific customer's device actually runs.

Never infer #4 solely from #3.

## 3. Compatibility principle

A Published Experience may use only capabilities guaranteed by its declared compatibility contract, or explicitly defined safe fallbacks.

Before Publish:

```text
Draft Experience
 -> enumerate Components + Actions + Resources + Native Capabilities
 -> resolve required capability versions
 -> compare against supported runtime population/policy
 -> classify impact
 -> block / fallback / publish / require native release
```

## 4. Capability-based compatibility

Do not couple compatibility only to a monolithic app version such as `>= 1.4.0`.

Prefer a capability manifest concept:

```json
{
  "runtime": "1.4.0",
  "capabilities": {
    "commerce.productGrid": 2,
    "commerce.cart.add": 1,
    "navigation.deepLink": 1,
    "native.push": 1
  }
}
```

Exact syntax is open.

This allows AWJ to reason about what the installed runtime can actually execute.

## 5. Experience requirements

Published Experience records required capabilities, directly or as a normalized generated manifest.

Conceptually:

```json
{
  "schemaVersion": "1.x",
  "minimumRuntime": "1.3.0",
  "requiredCapabilities": {
    "commerce.productGrid": 1,
    "commerce.cart.add": 1
  }
}
```

Builder should generate requirements from the schema; merchants should not manually type compatibility versions.

## 6. Publish impact classes

Every meaningful Draft diff is classified.

### A — Experience-only

Eligible when installed runtime already supports the changed semantics.

Examples:
- localized text;
- remote image/content asset reference;
- supported theme values;
- reorder supported components;
- existing component prop;
- existing route/navigation destination;
- supported visibility/scheduling rule;
- existing typed Data Resource configuration.

### B — Native iOS required

Change requires iOS binary/runtime capability not already available to targeted installed runtime.

### C — Native Android required

Same for Android.

### D — Native both required

New runtime/component/native capability needed on both.

### E — Mixed

Part can be remotely published but another part requires native release. AWJ must not produce a partially broken experience.

## 7. Native-required triggers

Examples:
- new Component type absent from installed runtime;
- incompatible Component contract change;
- new native SDK/library;
- new OS permission/entitlement;
- push native setup change;
- deep-link/universal-link/app-link native configuration;
- payment/auth native implementation change;
- native bug/performance fix;
- min OS / target SDK compatibility change;
- bundled executable/native asset change;
- runtime engine behavior change that cannot be represented by existing capability.

## 8. Fail-closed rules

If runtime encounters an unsupported **security/business-sensitive** capability:
- do not execute;
- do not reinterpret;
- do not guess;
- do not downgrade to a semantically different action;
- show defined safe fallback/error;
- emit compatibility telemetry.

Checkout, payment, auth, tenant-sensitive and commerce mutations are fail-closed.

## 9. Safe fallback

Fallback is allowed only when Component/Capability Definition explicitly declares it and semantics remain safe.

Example candidate:
- unsupported decorative badge -> omit badge if contract says optional.

Unsafe fallback:
- unsupported payment capability -> “assume success”;
- unsupported cart action -> local-only cart mutation;
- unsupported auth -> expose protected content.

## 10. Older-device policy

AWJ must expect that some devices remain on older binaries because:
- automatic updates may be disabled;
- staged/phased rollout has not reached them;
- device/OS no longer supports newest binary;
- user has not installed the update;
- store processing/availability differs.

Therefore remote Experience publishing must not assume “store release completed = all devices updated.”

## 11. Compatibility targeting policy

Before Publish, AWJ should evaluate at least:
- currently supported production runtime versions;
- current iOS release state;
- current Android release state;
- minimum-supported runtime policy;
- known active-device/runtime distribution when telemetry is available.

V1 may use conservative minimum-supported-runtime policy before sophisticated adoption telemetry exists.

## 12. Native release sequencing

When Draft needs a new native capability, preferred sequence:

```text
1. Build runtime containing capability
2. Validate/TestFlight/Play test track
3. Store review/approval
4. Release native update
5. Observe sufficient availability/adoption according to policy
6. Publish Experience that requires capability
```

Do not publish the required Experience first and hope devices update later.

## 13. Forward-compatible deployment pattern

Where feasible, native releases should ship **dormant capability first**, then remote Experience activates it later.

This separates:
- binary distribution risk;
- Experience activation risk.

The capability must remain inert/safe until schema invokes it.

## 14. Emergency kill/fallback

AWJ should support server-controlled safety mechanisms for declarative capabilities where policy permits:
- stop serving a broken Published Experience;
- roll back to previous compatible Experience;
- disable an optional remote capability;
- force safe fallback.

This is not executable-code hot patching.

Native binary defects still require a corrected native version; remote Experience rollback cannot repair arbitrary compiled code.

## 15. Experience rollback

Rollback means selecting/re-publishing a previously validated **compatible Experience**.

Before rollback:
- verify target Experience compatibility with currently supported runtimes/resources;
- verify referenced assets/resources still exist;
- verify backend contracts still support it.

Do not equate Experience rollback with App Store binary rollback.

## 16. Native rollback/recovery

Native stores do not provide AWJ with a universal “put every device back on previous binary” primitive.

Apple documents that if an App Store version has an issue, you cannot revert the App Store to a previous version; a new corrected version must be created/submitted.

Therefore AWJ native recovery model is:
- halt/pause rollout where available;
- stop increasing exposure;
- publish/submit a fixed binary;
- optionally use Experience-level kill/fallback to reduce impact if the defect is remotely containable.

## 17. Apple release reality

Apple phased release for eligible app updates distributes automatic updates over seven days:
- Day 1: 1%
- Day 2: 2%
- Day 3: 5%
- Day 4: 10%
- Day 5: 20%
- Day 6: 50%
- Day 7: 100%.

Users can still manually download the update during phased release.

AWJ must model this as **Store Rollout**, not Device Adoption.

Apple also supports manual release, automatic release after approval, or automatic release no earlier than a specified date.

## 18. Google Play release reality

Google staged rollout exposes an update to a chosen percentage of users.

Important contract implication: Google states the staged-rollout percentage **does not increase automatically**; the developer controls increases.

Staged rollout applies to updates, not the first production release.

AWJ Release Center must therefore not show a Google staged release as “progressing automatically to 100%” unless AWJ itself is deliberately executing an approved rollout policy.

## 19. Store rollout vs device adoption

Release Center should display separate concepts:

```text
Store state:
Approved / Released / Phased 20% / Staged 10%

Device telemetry:
Runtime 1.3: x%
Runtime 1.4: y%
Unknown/offline: z%
```

Exact adoption analytics depend on privacy-safe runtime telemetry and are later implementation details.

## 20. Minimum-supported runtime

AWJ needs an explicit policy.

Candidate lifecycle:
- Supported;
- Update recommended;
- Update required for new experiences;
- Unsupported.

A merchant cannot arbitrarily lower compatibility below AWJ security/support policy.

Forced-update UX, if later used, must be cautious: a store update may not be available to every device/region instantly, and unsupported OS devices may never be eligible.

## 21. Required-update behavior

If a runtime is too old to safely operate:
- block only when necessary for security/data integrity;
- explain update requirement clearly;
- link to correct store path;
- avoid infinite loop when store has not made update available;
- retain minimal safe support/help path where possible.

Do not force update merely for cosmetic Builder changes.

## 22. Schema evolution

Schema parser versioning is separate from capability versions.

Rules:
- additive optional fields may be safely ignored only when contract explicitly permits;
- unknown security-sensitive fields/capabilities fail closed;
- breaking semantic changes require new schema/capability version;
- migrations happen in trusted Builder/backend tooling, not arbitrary runtime guesswork.

## 23. Component evolution

For a Component Definition:
- visual additive prop may be backward compatible if default semantics are defined;
- changing required binding/event semantics may require new component version;
- removing behavior requires deprecation/migration policy;
- runtime adapter must know supported definition versions.

## 24. Action evolution

Action contracts are stricter.

Breaking changes to:
- authorization;
- idempotency;
- input meaning;
- payment/order semantics;
- side effects

require explicit versioning.

Never reuse an action version after changing security semantics.

## 25. Data Resource evolution

Resource DTOs use additive/versioned evolution.

Clients must not depend on undocumented backend model fields.

Removing/renaming/changing meaning of a required field requires contract/version compatibility planning.

## 26. Platform divergence

iOS and Android may temporarily support different capability sets.

Experience requirements must therefore be evaluated per platform.

Builder can show:
- supported both;
- iOS only;
- Android only;
- requires iOS update;
- requires Android update.

Avoid lowest-common-denominator design when a deliberate platform-specific experience is safe, but V1 should favor parity for core commerce.

## 27. Compatibility matrix

Release Center should maintain a generated matrix such as:

| Capability | Experience requires | iOS production | Android production | Result |
|---|---:|---:|---:|---|
| productGrid | 2 | 2 | 2 | compatible |
| cart.add | 1 | 1 | 1 | compatible |
| native.push | 2 | 2 | 1 | Android native release required |

The actual UI should translate this into merchant-friendly impact rather than expose raw version tables by default.

## 28. Publish blocker examples

Block Publish when:
- required sensitive capability unavailable;
- schema version unsupported;
- required component has no safe fallback;
- resource/action contract unavailable;
- native release required but target production runtime cannot execute it;
- required app platform configuration is missing;
- rollback target is incompatible.

Warnings may be used for non-critical adoption/visual differences only when safe.

## 29. Telemetry

Runtime should report privacy-safe compatibility telemetry:
- app;
- platform;
- binary/runtime version;
- capability manifest/hash;
- Published Experience version;
- compatibility/fallback error class.

Do not include customer secrets/PII unnecessarily.

## 30. Runtime handshake

On Experience fetch/start, server/runtime may exchange:
- app identity;
- platform;
- runtime version;
- supported capability manifest/hash;
- locale/market/session context as authorized.

Server can then serve/deny/select an Experience version compatible with that runtime according to policy.

Exact negotiation protocol is open.

## 31. Multi-version serving

V1 should avoid complex permanent forks, but architecture must allow a safe transition window.

Possible policy:
- newest compatible Published Experience for runtime;
- otherwise last compatible Published Experience;
- otherwise update-required safe screen.

Do not let merchants manually create uncontrolled device-version forks.

## 32. Security update override

AWJ may need to raise minimum supported runtime for a critical security issue.

This requires:
- explicit security decision;
- release readiness;
- store availability consideration;
- user-safe messaging;
- audit.

Remote configuration must not be used to conceal an unresolved vulnerable native capability while continuing unsafe operations.

## 33. Preview compatibility

Preview must be explicit about target runtime.

Modes:
- latest Preview Runtime;
- selected production runtime/capability profile where supported.

Builder should warn when a Draft works in latest Preview Runtime but not in current production binaries.

This prevents “works in preview” from falsely implying “safe to publish.”

## 34. Build manifest integration

Native build manifest records:
- runtime source/version;
- supported capability manifest/hash;
- schema parser support;
- platform SDK/native dependencies;
- bundle/package identity;
- artifact digest.

Release Center links this immutable build evidence to compatibility decisions.

## 35. Testing

Required:
- old runtime + new compatible Experience;
- old runtime + unsupported decorative component with safe fallback;
- old runtime + unsupported sensitive action fails closed;
- new runtime + old Experience;
- per-platform capability divergence;
- rollback compatibility;
- malformed/unknown capability;
- Draft preview target mismatch;
- store rollout state not treated as device adoption;
- minimum-supported runtime transitions.

## 36. Open decisions

- exact capability-manifest format;
- semantic version vs integer capability versions;
- runtime handshake endpoint/protocol;
- minimum-supported-runtime policy;
- adoption telemetry thresholds before activating new capability;
- multi-version Experience serving duration;
- forced-update policy;
- exact rollback storage/retention;
- per-platform experience divergence scope;
- emergency kill-switch governance;
- automated rollout/adoption gates;
- offline startup when compatibility check cannot reach server.

## 37. Acceptance criteria

RUNTIME_COMPATIBILITY_V1 can be implementation-locked when:

1. Experience, native binary, store rollout and device installation are represented separately;
2. every Component/Action/Resource has compatibility metadata;
3. Publish can classify Experience-only vs native impact per platform;
4. unsupported sensitive capabilities fail closed;
5. native capability is distributed before remote Experience requires it;
6. Preview can test against production capability profiles;
7. Experience rollback cannot select an incompatible version;
8. Release Center never equates store release with all devices updated;
9. representative iOS/Android version-skew tests are defined;
10. build manifests provide immutable runtime/capability evidence.
