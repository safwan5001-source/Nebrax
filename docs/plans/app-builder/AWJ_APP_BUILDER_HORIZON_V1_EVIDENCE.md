# AWJ App Builder Horizon V1 — Evidence Pass

**Date:** 2026-09-23  
**Purpose:** focused evidence baseline for authorizing App Builder implementation after Mobile Runtime Proof V1.

## Repository evidence

The accepted App Builder contract pack already establishes:
- App Manager before editor;
- Visual Builder + bounded Developer Workspace;
- Use My Store Design / Template / Scratch creation paths;
- declarative App Schema;
- Component, Action and Data Resource registries;
- Draft vs Published Experience vs Native Build separation;
- Store/App theme sharing with override tracking;
- tenant/security constraints;
- Preview and App Factory as distinct layers.

Mobile Runtime Proof V1 is durably closed and proved:
- Flutter viability;
- App Schema parsing/compatibility;
- Component + Action Registry runtime behavior;
- typed /commerce/v1 client and secure session boundary;
- Home/Product/Cart vertical runtime slice;
- ar/en + RTL/LTR + accessibility;
- deep links;
- push adapter boundary;
- Android/iOS non-production release-build proof;
- compatibility/security/performance primitives and evidence.

Therefore App Builder must build **on** this runtime contract rather than inventing another renderer or business-data authority.

## Current official external evidence

### Flutter architecture
Flutter's current official architecture guidance emphasizes separation of concerns, UI/data layers, repositories/services, single sources of truth, declarative UI and testability. AWJ applies this as supporting evidence for keeping Builder UI/editor state separate from server-authoritative persistence and Commerce truth.

Sources:
- https://docs.flutter.dev/app-architecture
- https://docs.flutter.dev/app-architecture/guide
- https://docs.flutter.dev/app-architecture/concepts

### Dynamic code safety
Android's current security guidance strongly discourages loading executable code from outside the APK because of injection/tampering, testing and version-management risk. Android 14 guidance likewise recommends avoiding dynamic code loading where possible.

Sources:
- https://developer.android.com/privacy-and-security/security-tips
- https://developer.android.com/about/versions/14/behavior-changes-14

AWJ consequence: App Builder V1 remains declarative and capability-based. Remote experience configuration selects allowlisted components/actions/resources; it does not deliver arbitrary executable code.

## AWJ decisions derived from combined evidence

1. Reuse the accepted declarative App Schema + trusted Flutter Runtime.
2. Keep Commerce and backend services authoritative for business truth.
3. Persist Draft/Published Experience server-side with tenant/RBAC enforcement.
4. Keep Published Experience immutable/versioned.
5. Drive Inspector from registry metadata.
6. Keep merchant-authored behavior within allowlisted typed capabilities.
7. Treat theme sharing as provenance + mapping + review, not web-to-mobile copying.
8. Keep App Factory, signing and store release outside this horizon.

## Evidence gaps intentionally deferred

The following do not block App Builder V1 and belong to later horizons/Decision Gates:
- production Apple/Google signing and account ownership;
- production store submission/release automation;
- real-device Preview Session transport/QR mechanism;
- permanent push/messaging provider;
- payment-provider/native SDK commitment;
- production Bundle/Application ID registration;
- full device-backed performance program.

These must not be silently guessed into App Builder implementation.
