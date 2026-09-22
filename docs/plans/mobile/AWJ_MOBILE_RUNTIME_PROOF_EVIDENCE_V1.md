# AWJ Mobile Runtime Proof — Evidence & Decision Register V1

**Prepared:** 2026-09-22  
**Horizon:** `AWJ Mobile Runtime Proof Horizon V1`

## External Evidence

| Area | Current first-party evidence | Horizon implication |
|---|---|---|
| Flutter i18n | https://docs.flutter.dev/ui/internationalization | Use framework localization; prove ar/en and RTL/LTR. |
| Flutter navigation/deep links | https://docs.flutter.dev/ui/navigation and https://docs.flutter.dev/ui/navigation/deep-linking | Use Router-compatible navigation and prove incoming links. |
| Flutter accessibility | https://docs.flutter.dev/ui/accessibility | Accessibility is a release-quality gate, not polish. |
| Apple Universal Links | https://developer.apple.com/documentation/Xcode/allowing-apps-and-websites-to-link-to-your-content | Use verified web/app association; web fallback exists when app unavailable. |
| Apple link security | https://developer.apple.com/documentation/Xcode/supporting-universal-links-in-your-app | Validate all incoming URL parameters; do not expose sensitive/destructive actions. |
| Apple Keychain | https://developer.apple.com/documentation/security/keychain-services | Secure small session secrets behind platform storage. |
| Android App Links | https://developer.android.com/training/app-links/verify-applinks | Use verified HTTP(S) hosts / Digital Asset Links. |
| Android Keystore | https://developer.android.com/privacy-and-security/keystore | Protect key material with platform-backed facilities. |
| FCM Flutter | https://firebase.google.com/docs/cloud-messaging/flutter/get-started | Feasible push proof path; iOS needs Push Notifications/background setup. |
| FCM lifecycle | https://firebase.google.com/docs/cloud-messaging/flutter/receive-messages | Test foreground/background/terminated interaction paths where available. |

## AWJ Decisions

1. Flutter-first proof; fallback preserved.
2. App Schema is AWJ-owned, versioned, declarative and capability-bounded.
3. Component and Action Registries are allowlisted.
4. Commerce Core and `/commerce/v1` remain authoritative.
5. Sensitive session material uses secure-storage abstraction.
6. Deep links map only to validated allowlisted navigation.
7. Push is behind an adapter; proof transport does not become permanent provider policy.
8. Arabic default + English + RTL/LTR are mandatory.
9. Accessibility and release-mode buildability are proof gates.
10. No production signing/release/store submission in this horizon.

## Open / Decision-Gated

- Permanent mobile runtime family if Flutter fails a material proof.
- Permanent push/messaging provider.
- Payment provider/native payment SDK.
- Apple/Google account ownership and signing automation.
- Production preview distribution mechanism.
- Full App Builder schema breadth.
- App Factory implementation.

## Evidence discipline

Before implementation decisions that depend on changing platform behavior, re-open the relevant first-party source and record the date/effect in the implementation report. Repository evidence wins over stale assumptions about current AWJ code; owner-approved product invariants remain binding.

## Hardening Pass — Runtime Compatibility and Operations

Cross-check against the repository's existing `RUNTIME_COMPATIBILITY_V1.md` identified proof obligations that must not be lost in a narrower Flutter prototype. The horizon therefore explicitly carries forward:

- capability manifest/runtime handshake rather than version-only compatibility;
- old/new Runtime ↔ Experience version-skew tests;
- per-platform capability divergence;
- compatibility-safe rollback;
- native-capability-before-Experience rollout ordering;
- store availability ≠ installed runtime;
- safe last-known-good startup without turning presentation cache into commerce authority;
- cold-start/resume/network interruption/retry behavior;
- privacy-safe diagnostics;
- reproducible performance/binary observations;
- dependency license/maintenance/security/supply-chain review.

These are AWJ proof requirements derived from the existing repository compatibility architecture. Exact implementation fields, budgets and transport remain evidence-driven implementation details unless a material Decision Gate is reached.
