# LIVE-PREVIEW-5 — Runtime-Aware Pre-Publish Validation

DATE: 2026-09-25
HORIZON: `AWJ_APP_BUILDER_LIVE_RUNTIME_PREVIEW_V1.md`
PREDECESSOR: LIVE-PREVIEW-4 — DONE / PASS (`LIVE-PREVIEW-4-ACTION-THEME-VISIBILITY-PARITY.md`)
SCOPE: "Inspect existing validation first. Strengthen the existing Validate → Publish boundary
only where evidence shows a gap. Reuse existing schema/version/capability contracts; do not
create duplicate validators."

## Inspection first (per this task's own instruction)

LIVE-PREVIEW-1 §6 already established the core finding: `BuilderPublishedExperienceVersionService
::validate()`/`publish()` already call the real, shared `CompatibilityResolver` against
`CapabilityManifest::current()` — the exact same authority the mobile boot resolver uses. That
gate is **not** the gap. Re-reading `CompatibilityResolver.php`/`compatibility.dart` line by line
for this task turned up one concrete, narrow gap instead:

**When a *required* (non-optional) node fails compatibility, the failure message names only the
page, never the node.** `resolveComponent()`/`_resolveComponent()` already records rich detail
(`componentId`, `componentType`, `reason`) for the *optional*-and-pruned case (`$fallbacks`), but
the *required*-and-blocking case — the one that actually stops a publish — bubbles up through the
recursion as a bare `false`/`null`, and the top-level `resolve()` only ever produced: *"page
\"home\" contains a required, unsupported component or action."* On a page with more than a
handful of nodes, a merchant (or a future LIVE-PREVIEW-4-style Preview banner) has no way to say
*which* one to fix. This is real evidence of a gap in the existing Validate → Publish boundary
itself — not a missing check, a missing *diagnostic* on an already-correct check.

## What was built (PHP only)

`app/Services/AppBuilder/CompatibilityResolver.php`: `resolveComponent()` gained one new
by-reference output parameter, `?array &$requiredFailure`, set to `['componentId' =>
$node['id'], 'componentType' => $node['type']]` at the exact point `$unsupportedHere` trips —
i.e. the real offending node, not wherever the recursion happens to unwind to. It is explicitly
cleared (`$requiredFailure = null`) when a failure is instead absorbed as a safe optional
fallback, so a deeper, ultimately-pruned failure never leaks into an unrelated later error
message. `resolve()`'s page loop now appends `" (component \"{id}\" of type \"{type}\")"` to the
existing message whenever this detail is available. The `reason` constant
(`REASON_MISSING_REQUIRED_CAPABILITY`) and every other successful/failure code path are
byte-for-byte unchanged — this only enriches one string.

**Deliberately not done**: mirroring the same enrichment into `mobile/lib/schema/
compatibility.dart`'s `_resolveComponent`/`IncompatibleExperience.message`. That message is
never merchant-facing — mobile only ever shows a generic `ControlledUnavailable` state to end
customers, per the AWJ Runtime Boot contract (already proven under the separate, closed APP
RUNTIME BOOT-1 horizon) — so there is no user this detail would reach on that side, and touching
mobile files would pull in `mobile-ci.yml`'s full analyze/test/Android/iOS-release cycle for a
change with no observable effect there. The Dart/PHP mirror-invariant this codebase otherwise
holds is about *behavior* (compatible/incompatible/fallbacks), not the exact wording of a
diagnostic string aimed at a human debugging their own schema — recorded here explicitly so a
future task doesn't read the asymmetry as an oversight.

**Deliberately not attempted**: any change to what counts as compatible/incompatible, to
`AppSchemaParser`'s structural validation, to the draft-save (authoring) vs. publish (compatibility)
validation split, or to any HTTP status/response shape. `POST .../validate` and `POST
.../versions` still return exactly the same JSON keys on success and failure as before — only
the string value of an existing `message` field gained detail. No new schema field, no new route,
no new capability namespace, no duplicate validator.

## Evidence

- **Focused**: `php artisan test --filter=CompatibilityResolverTest` — 38/38 passed (59
  assertions) — confirms every existing fail-closed/fallback/binding/visibility case this file's
  own test suite covers is unaffected; none of them assert on the old message's exact wording
  (confirmed by inspection — `grep -n message tests/Feature/CompatibilityResolverTest.php`
  returns nothing), so there was nothing to update there.
- **Broader**: `php artisan test --filter="AppSchemaParserTest|AppBuilderIntegratedProofTest|
  AppBuilderSameStoreProofTest|BuilderAppTest|AppBuilderRegistryTest"` — 67/67 passed (251
  assertions), including `BuilderAppTest`'s own `publish rejects a schema referencing an
  unsupported required component`/`validate rejects the same incompatible draft publish would
  reject` cases — both still pass unchanged since they assert on HTTP status/error presence, not
  message text.
- **Full suite**: `php artisan test` (whole repository) — run before commit per this repo's own
  mandatory pre-PR protocol; result recorded in the durable horizon state once complete.

## No new accounting entries

This task touches no financial/accounting code path — `CompatibilityResolver` is App Builder
publish-safety logic, not a ledger-affecting service. No journal entry table applies; the
project's pre-PR protocol's "show the resulting journal entry" requirement is not applicable to
this change.

## Decision Gate check

No Decision Gate applies. No schema/API contract change (an existing string field's content, not
its shape), no capability broadened, no new validator (the existing one is reused and extended
in place, per the task's own instruction), no Tenant Isolation/RBAC/Commerce authorization
surface touched, no mobile file changed.

## Remaining gaps (carried forward, unchanged in nature)

- Compatibility gating still runs only at explicit Validate/Publish, never live during editing —
  LIVE-PREVIEW-1's own original observation, out of this narrow task's scope (it was about
  strengthening the *existing* boundary, not moving it earlier into the editing flow; that would
  be a materially different, larger change warranting its own evidence pass if pursued).
- The optional-fallback path's `reason` string remains generic ("unsupported component/action,
  or an unsupported required descendant within this optional subtree") — left as-is since that
  path already identifies the specific `componentId`/`componentType`, unlike the required-failure
  path this task fixed; the generic *reason* wording there was never the actual gap.
- Real live product/cart data, visibility evaluation, and theme-to-shipped-app wiring remain
  deferred exactly as recorded under LIVE-PREVIEW-3/4.

## Next task readiness

**LIVE-PREVIEW-6 — Draft / Default / Published Preview States: READY.** No new Decision Gate
evidence found in this task that would block it. LIVE-PREVIEW-1 §7 already established the
concrete gap LIVE-PREVIEW-6 must close: the Builder has no way to preview a Published version or
the Default AWJ Experience — Preview only ever shows the live draft.
