# AWJ App Builder — Live Runtime & Preview V1 — Closure Report (LIVE-PREVIEW-8)

STATUS: **CLOSED / PASS**
DATE: 2026-09-25
HORIZON: `AWJ_APP_BUILDER_LIVE_RUNTIME_PREVIEW_V1.md`

## Horizon outcome

**AWJ App Builder — Live Runtime & Preview V1 is CLOSED.** All 8 tasks (LIVE-PREVIEW-1 through
LIVE-PREVIEW-8) are complete. The horizon closed the product/runtime loop between Builder,
Preview, validation, publishing, and the real AWJ mobile runtime: Preview now shares a documented,
conformance-tested contract with the real Flutter runtime rather than being an independently
maintained interpreter; unsupported capabilities (`visibility`, live theme tokens) are explicit
and fail-closed rather than simulated; pre-publish validation's diagnostics were strengthened; a
merchant can distinguish Draft, Published, and Default states; and the full integrated chain —
Builder Draft → Preview → Validate → Publish → `commerce/v1/experience` → real startup resolver →
runtime compatibility → runtime rendering — is now proven end-to-end with real contracts on one
canonical shared fixture, not isolated unit tests.

## 1. Task-by-task ledger

| Task | PR | Base SHA | Merge SHA | CI |
|---|---|---|---|---|
| LIVE-PREVIEW-1 | — (evidence-only, no code) | — | — | n/a |
| LIVE-PREVIEW-2 | #1014 | `fdfa0b34f5197c17f2da45b3bfad7a30bd124ed4` | `53bfc74dd7b6bc77fa4ff6fdf08bf0625ca136c9` | 12/12 green |
| LIVE-PREVIEW-3 | #1018 (Decision Gate docs) + #1019 (impl.) | `41b53fdb96a828276c6e1a1b532126302325f403` | `e906d48c022fbfd8f3671833b7db78caebd87dd5` | 6/6 green |
| LIVE-PREVIEW-4 | #1022 | `e906d48c022fbfd8f3671833b7db78caebd87dd5` | `fcb0e20b2b5c4cad8df9469e18d6d0d23002e2c9` | 6/6 green |
| LIVE-PREVIEW-5 | #1024 | `fcb0e20b2b5c4cad8df9469e18d6d0d23002e2c9` | `d565161dff81b65174fbb2fab443871176eb3940` | 4/4 green |
| LIVE-PREVIEW-6 | #1026 | `d565161dff81b65174fbb2fab443871176eb3940` | `d3dcf8f803034a9296aada58fcb89fbb437f52a8` | 6/6 green |
| LIVE-PREVIEW-7 | #1028 | `d3dcf8f803034a9296aada58fcb89fbb437f52a8` | `222fb9bfc77af79ea14b66b54ab680b2eaecabc1` | 8/8 green (after one CI-red fix cycle, see below) |
| LIVE-PREVIEW-8 | this document + durable-state update only (no code) | `222fb9bfc77af79ea14b66b54ab680b2eaecabc1` | — | n/a |

Every implementation task's full evidence — focused tests, broader suite, full web/PHP suite,
build, Decision Gate check — is recorded in that task's own `LIVE-PREVIEW-N-*.md` report and
summarized in the horizon document's own "Current durable state" log. This table is the index; it
does not repeat that evidence.

Every merge above is independently verified via `get_commit` against `main` — single-parent
squash merge, CI green on the head that was actually merged (not a stale earlier push).

**LIVE-PREVIEW-7's CI-red fix cycle**: its first real CI run failed `php artisan test (L11,
sqlite/pgsql)` — `AppBuilderPreviewToRuntimeIntegratedProofTest` was the first PHP test in this
repository to read a `contracts/app-builder/**` shared fixture via `base_path()`; every prior
consumer of that directory (LIVE-PREVIEW-2's conformance fixture) was TypeScript/Dart only, so
this repo's core-to-generated-app copy allowlist (`ci.yml`/`setup.sh`) never included
`contracts/`. Fixed by following the identical existing precedent already used for
`docs/openapi/*.yaml` (copied for the exact same `base_path()` reason): added
`contracts/app-builder` to both files' `mkdir -p`/`cp` steps. Re-verified green (8/8 checks,
including the `mobile` Dart job — the first real Flutter-toolchain verification of that PR's new
test code) before merge.

## 2. Exit criteria — evidenced

1. **Real mobile boot contract remains green** — `mobile-ci.yml`'s `mobile (analyze + test)` and
   `mobile (Android/iOS release build proof)` jobs passed on every PR in this horizon, including
   LIVE-PREVIEW-2's new conformance test and LIVE-PREVIEW-7's new `group('E — ...')` integrated
   cases — both real-CI-verified (this sandbox had no Flutter toolchain throughout the horizon).
2. **Preview semantics documented and aligned with the supported Runtime contract** —
   LIVE-PREVIEW-1's evidence pass named every divergence; LIVE-PREVIEW-2's `runtime-contract.ts`
   is a documented, conformance-tested port of `binding_resolution.dart`, not an independent
   interpreter.
3. **Supported binding/collection semantics do not silently diverge** — LIVE-PREVIEW-2's shared
   fixture (23 cases, asserted identically in TS and Dart), LIVE-PREVIEW-3's real field-contract
   sample data, LIVE-PREVIEW-7's shared integrated-proof fixture.
4. **Supported actions/theme/visibility do not silently diverge** — LIVE-PREVIEW-4: inert-vs-wired
   action dimming matches `_ActionTappable` exactly; unsupported `visibility` is explicit
   (permanent badge) and fail-closed (never evaluated, always shown), never simulated; Theme
   panel's `runtimeNote` states plainly that published colors don't reach the shipped app yet.
5. **Pre-publish validation rejects unsupported/incompatible schemas fail-closed** — the real,
   shared `CompatibilityResolver` gates every publish (confirmed already true at LIVE-PREVIEW-1
   §6); LIVE-PREVIEW-5 strengthened its diagnostic (names the actual offending node) without
   changing accept/reject behavior.
6. **Draft/Default/Published Preview states are unambiguous** — LIVE-PREVIEW-6's 3-way switcher,
   read-only lockout of every edit affordance on non-draft states, explicit per-state banners
   (the draft banner itself states it is "not a live version in the mobile app").
7. **Integrated evidence proves Builder → Preview → Validate → Publish → `commerce/v1/experience`
   → Runtime** — LIVE-PREVIEW-7's one canonical shared fixture, asserted byte-identically by a
   real-HTTP PHP test (Draft/Validate/Publish/fetch/compatibility), a real-component TypeScript
   Preview test, and a real-`AwjRuntimeShell` Dart test (fetch → `resolveRealStartup` →
   compatibility → rendering, Home and Cart).
8. **Relevant CI is green** — every merged PR's CI is recorded green in the table above; the one
   CI-red incident (LIVE-PREVIEW-7's first push) was root-caused, fixed, and re-verified green
   before merge, per this repo's own drive-to-green protocol.
9. **Tenant Isolation/security guarantees remain intact** — no task in this horizon touched RBAC,
   `TenantScope`/`BelongsToTenant`, auth/token issuance, or Commerce authorization; every task's
   own Decision Gate check confirms this explicitly. LIVE-PREVIEW-3's Decision Gate specifically
   existed *because* a real auth-boundary question was raised (store-bearer token exposure) — the
   owner-approved resolution (sample data only) was chosen precisely to avoid crossing it.
10. **Intentional deferrals are explicitly documented** — see §4 below.

All ten criteria are evidenced. **Horizon status: CLOSED / PASS.**

## 3. Integrated proof — what is now provably true end-to-end

For a schema using only the currently-shipped capability set (`RuntimeCapabilities`), on the
canonical fixture `contracts/app-builder/integrated-proof-schema.v1.json`:

- A merchant can author it in the Builder and see it accurately rendered in Preview, including
  bound `ProductList`/`CartList` content (against clearly-labeled sample data, LIVE-PREVIEW-3).
- `POST .../validate` and `POST .../versions` both accept it via the real, shared
  `CompatibilityResolver` — the same authority the shipped mobile runtime's Dart mirror uses.
- The published document is byte-identical from Draft through Publish through a real mobile
  client's `GET commerce/v1/experience` fetch (LIVE-PREVIEW-7, `AppBuilderSameStoreProofTest`).
- The real Flutter runtime's `resolveRealStartup` → `CompatibilityResolver` (Dart) →
  `AwjRuntimeShell` → `HomeScreen`/`CartScreen` pipeline accepts and actually renders it — real
  bound product/cart-item content included, not just structural acceptance (LIVE-PREVIEW-7's new
  `group('E — ...')`, verified on real CI with the Flutter toolchain).
- A merchant can distinguish their live Draft, their last Published version, and the Default AWJ
  Experience a customer sees before any publish — all three explicitly labeled, only Draft
  editable (LIVE-PREVIEW-6).

## 4. Intentional deferrals (complete list)

- **Real live product/cart data in Preview** (vs. clearly-labeled sample data) — deferred at
  LIVE-PREVIEW-3's Decision Gate (owner-approved option 3, 2026-09-25). Would require either
  minting/forwarding a store-bearer token from the Builder session, or a new Sanctum-authenticated
  internal proxy endpoint — both explicitly out of this horizon's scope. **Recommended as the
  next workstream's primary candidate** (§5).
- **Visibility evaluation in Preview** — `evaluateVisibility`/`pruneInvisible` exist
  (LIVE-PREVIEW-2, conformance-tested) but are deliberately not wired into `canvas.tsx` rendering,
  because the shipped runtime does not support `visibility` yet
  (`RuntimeCapabilities.SCHEMA_FEATURES` has no `visibility` key). A node carrying a `visibility`
  condition renders unconditionally with a permanent "not yet active" badge instead.
- **Theme tokens have ~zero live effect on the shipped runtime** — `mobile/lib/app.dart` seeds
  `colorPrimary` only once from the bundled compile-time Default schema, never from any
  resolved/published experience. Recorded as a mobile-side architectural gap, not "fixed" by a
  web-side key rename (LIVE-PREVIEW-4).
- **Compatibility gating runs only at explicit Validate/Publish**, never live during editing
  (LIVE-PREVIEW-1's original observation; out of scope — would be a materially larger change
  moving the gate earlier into the editing flow).
- **The optional-fallback path's `reason` string remains generic** in `CompatibilityResolver`
  (LIVE-PREVIEW-5) — only the *required*-failure path's diagnostic was strengthened; the
  generic wording there was never the actual gap this task found.
- **Two findings from LIVE-PREVIEW-7's evidence pass, recorded not fixed:**
  1. The `itemProps`-on-a-list-resource binding grammar `AppBuilderIntegratedProofTest`/
     `AppBuilderSameStoreProofTest` use for `ProductList` does not actually hydrate any items on
     the real runtime (structurally valid, publishes successfully, renders empty on device) —
     those two tests' own doc comments overclaim real-grammar parity; no behavior change needed
     since neither test asserts rendering.
  2. `HomeScreen`/`CartScreen`'s `hydrateNode(..., '<hardcoded-id>', ...)` calls (most materially
     `'slot.cart.summary'`) only recompute live values for the bundled Default schema's own node
     ids — a generically-authored Published Experience's `CartSummary` never gets its
     `itemCount`/`subtotal` live-recomputed unless it happens to reuse that exact id. Fixing this
     generically is a real runtime-rendering behavior change (likely: locate by node type instead
     of hardcoded id), reserved for owner review — not attempted in this horizon.
- **Real-device verification has not occurred** — `RuntimeCapabilities::DATA_RESOURCES`'s own doc
  comment (added under the separate, already-closed Commerce Data & Dynamic Runtime V1 horizon)
  already records this as a pre-existing constraint this horizon did not change: CI/release-build
  proof is accepted engineering evidence for this horizon, but real-device verification against a
  real, controlled tenant remains mandatory before any actual mobile distribution.
- **No mobile signing, distribution, TestFlight/Play submission, or Production deployment** —
  never in scope for this horizon; not approached.

## 5. Security / Tenant Isolation status

No task in this horizon touched RBAC (`Rbac::MATRIX`, `EnsurePermission`), `TenantScope`/
`BelongsToTenant`, auth/token issuance (Sanctum or the `commerce/v1` store-bearer mechanism), or
Commerce authorization. Every task's own Decision Gate check in its evidence doc confirms this
explicitly, and LIVE-PREVIEW-7's new PHP test reuses the exact same tenant-isolated
`registerTenant`/`ApiClientKeyService` setup pattern `AppBuilderSameStoreProofTest` already
established — no new auth path invented. LIVE-PREVIEW-3's Decision Gate exists precisely because
a real auth-boundary question was surfaced (store-bearer token exposure to the Builder session);
the owner-approved resolution (representative/sample data only, never live-fetched) was chosen
specifically to avoid crossing that boundary, not to work around it.

## 6. Risks and recommended next workstream

**Risks carried forward** (none block this horizon's closure; all are pre-existing or explicitly
deferred, not newly introduced):
- The two LIVE-PREVIEW-7 findings above (§4) are real, narrow correctness/completeness gaps in
  already-shipped, already-tested code — low risk today (both are either non-functional in a
  test's own claim, or degrade to "static instead of live" rather than crashing/erroring), but
  worth fixing before either code path is relied upon more heavily.
- Preview's sample-data-only bind means a merchant cannot yet see their *actual* catalog/cart
  shape in Preview — a real but bounded UX gap, not a correctness or security one.
- No real-device verification exists yet for any of this horizon's work, consistent with the
  pre-existing constraint recorded before this horizon began.

**Recommended next workstream** (in priority order):
1. **Real live product/cart data in Preview** — the highest-value deferred item, requiring a
   scoped Decision Gate of its own (token-minting vs. new proxy endpoint vs. another approach) to
   resolve the same auth-boundary question LIVE-PREVIEW-3 deferred.
2. **The two LIVE-PREVIEW-7 findings** — a small, well-scoped follow-up: correct the two
   proof tests' overclaiming doc comments (trivial), and separately scope a Decision Gate for
   `CartSummary`'s generic live-computation (a real runtime behavior change).
3. **Real-device verification** before any future mobile distribution — the standing constraint
   this horizon did not change or attempt to relax.
4. **Theme token wiring from a published experience to the shipped app** (`colorPrimary` gap) —
   a mobile-side architectural question, out of this horizon's web-only scope.

This horizon does not authorize or recommend Production deployment or mobile distribution as an
immediate next step — item 3 above is a prerequisite to either.
