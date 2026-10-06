# CUST-HV V2c — Public Delivery, Published-Reference Gate, Publish Verification, Reconciler — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V2c** — third and last V2 sub-slice (V2a #1255 and V2b #1262 precede it) |
| **Branch** | `cust-hv/v2c-public-delivery` |
| **PR** | see PR description (opened with this report) |
| **Base SHA** | `origin/main` after V2b merged |
| **Authority** | V0 §7.8 (references, publish validation, public access; AMEND-1/4/5/9/10/12/14/16), §7.9 (delete & lifecycle, AMEND-6), §7.11 (tests), AMEND-21 |
| **Depends on** | V2a, V2b (both merged) |

V2c closes V2: after it, a published document can reference Customizer media and the storefront can render it — **through one same-origin path, behind one gate, with Publish never generating anything**. Still **nothing user-visible and nothing enabled** (`STOREFRONT_MEDIA_R2_ENABLED` off by default; no document can carry a `MediaRef` until V4/V5 add media fields to the normalizer).

---

## Implemented

### 1. Published-reference gate — a normalised set, not a JSON scan
`storefront_published_media (storefront_id, media_id)` is rebuilt **from one choke point**: a `saved` hook on `StorefrontPresentation` fires whenever `published_config` is written, whatever path wrote it (immediate publish, scheduled dispatch, the compatibility publish, backfill). A new publish path cannot forget it, and it runs inside the publish transaction, so the set never disagrees with the published head. Non-UUID garbage inside a document never enters the set. The public route reads one indexed row (`isPublished(storefrontId, mediaId)`) — **no per-request JSON decode** (V0 §7.8).

### 2. Public origin route (Laravel)
`GET /store/v1/media/customizer/{id}/{file}` on the trusted host-resolution group (`ResolveStorefrontDomain` — not registered on the legacy `{tenantSlug}` branch).

| Rule | Behaviour |
|---|---|
| `{id}` | media UUID → base ladder, or 32-hex `transformKey` → transform derivative (the row names its source media) |
| `{file}` | `{width}w.{webp\|jpg}` / `thumb-{160\|320}.{webp\|jpg}`; **format is an explicit segment** (AMEND-12); a derivative's file must equal its own row's width + format; thumbnails are base-only |
| Gate | served **only if** the *published* document of the host-resolved storefront references the media; draft/version-only references do not count |
| Failures | unknown / deleted / not-ready / unpublished / off-ladder / foreign-tenant / unknown host → **one uniform 404** (asserted: identical bodies, modulo `request_id`) |
| Cache (AMEND-16) | origin is **`private, no-store`**, always; carries a content-derived `ETag` (base: `sha256(asset hash : file)`; derivative: the `transformKey` itself) |
| Revalidation | `If-None-Match` → **304 after the whole gate re-runs and without reading R2**; so unpublishing ends serving at the next revalidation even with a replayed ETag (asserted) |

### 3. Same-origin proxy (Next.js) — the only shared-cacheable layer
`/api/storefront/media/customizer/[id]/[file]` validates both params against the contract **before** forwarding, forwards the visitor host + gateway secret (same pattern as product media), forwards `If-None-Match`, and sets its **own** `Cache-Control: public, max-age=300, must-revalidate` + the origin's ETag. Failures are never given a public header (`404 → no-store`, any other upstream error → `502 no-store`). A shared cache keyed on the proxy URL is host-partitioned by construction (each storefront is its own origin), so no `Vary` is needed — the AMEND-16 argument, now with tests. `toRenderableMediaUrl` also maps the raw origin path `/store/v1/media/customizer/...` to the proxy path (or drops it when outside the contract) — **no renderer can leak the raw path**.

### 4. Publish verification — read-only, in the one existing gate
`StorefrontMediaPublishGate` is called from `StorefrontPresentationPublishValidator::errors()` — the single place all four publish paths already use (immediate, legacy, schedule, scheduled dispatch; V3 proved each path calls it). Documents without a `mediaId` never touch the media tables (asserted by query log). For every `MediaRef` anywhere in the document it returns path-specific 422 entries with stable codes:

`media_missing` · `media_not_ready` · `alt_required_ar` / `alt_required_en` (per locale; **the library default covers its own locale only, Arabic never stands in for English, only a real boolean `decorative: true` is exempt** — AMEND-10/14) · `transform_invalid` · `derivative_not_ready` · `derivative_failed`.

**It never generates** (AMEND-9, invariant 2): a missing/pending/failed derivative is *rejected*; the test asserts zero storage writes and zero rows created.

### 5. Reconciler (V0 §7.9)
`storefront-media:reconcile --tenant=<uuid> [--limit=200] [--dry-run]` — a manual, **tenant-scoped** (never crosses tenants), bounded, idempotent tool in the same shape as the existing R2 backfill command.
- **Purges** assets soft-deleted past `purge_after`: deletes the original, the ladder and all derivative objects, then the derivative rows and the published-set rows, then marks `purged`. A storage failure leaves the asset `deleted` for the next run (no orphan objects with a lost row) — tested incl. recovery.
- **Reaps orphan derivatives**: a framing (`usage_key`) no draft, version or published document references any more, older than a 24 h grace (so a framing being edited now is never reaped). The live set is computed by the existing reference scanner over **every** container (published, version, compatibility draft) — tested for all three.

---

## Invariants

| Invariant | Status |
|---|---|
| **Tenant Isolation** | Public route: tenant from the host only (`TenantContext` set by the trusted middleware); another tenant's published media is a 404 on this host; reconciler is tenant-scoped and restores the previous context. No new authenticated route. |
| **Auth / RBAC** | Public route is anonymous by design, read-only, rate-limited by the existing public limiter. Nothing new on `commerce.manage` surfaces. |
| **Draft vs Published** | The gate reads the **published** document only; draft/version references never make bytes public. Publish validation fails closed on all four paths; the previous published state is untouched on failure (V3/H1 guarantee). |
| **Revision / concurrency** | The set is rebuilt inside the existing locked publish transactions; no new lock. |
| **Media ownership** | A deleted/purged/not-ready asset serves nothing; delete is still blocked while referenced (V2a); purge removes objects before the row state changes. |
| **Commerce / accounting truth** | Untouched. No journal entries. |
| **Backward compatibility** | Additive table + routes; existing public media routes unchanged; documents without media unaffected (no DB access added to their publish path). |
| **Production infrastructure** | None new. The reconciler is manual because Production has no `schedule:run`; nothing critical depends on it. |

---

## Verification

| Gate | Result |
|---|---|
| New backend | `StorefrontMediaDeliveryTest` **12** (set follows `published_config`; public serving, headers, ETag/304, instant unpublish; uniform 404 matrix; derivative row/width/format rules; publish-gate codes & alt resolution; never-generates; reconciler purge/idempotency/failure-recovery/orphans; command guards) |
| Related suites | `StorefrontMedia*`, `StorefrontPresentation*`, `CommerceModuleBoundary`, `BranchIsolationGuard`, `StorefrontDomainMediaVisibility`, catalog = **398 passed** |
| Storefront | proxy route **6** + path/contract helpers **3** (headers, 304 pass-through, failure never public, param rejection) · biome ✓ · tsc ✓ |
| Full backend | see PR description; PostgreSQL by CI |

## Risks / deferred

- **End-to-end publish with media** is proven at the validator/gate level and by the four publish paths already calling the validator; a full API round-trip needs a document that *carries* a `MediaRef`, which arrives when V4/V5 add media fields to the normalizer (until then the normalizer drops unknown keys, so no document can reference media — by design, nothing is enabled).
- **No bucket listing** exists in `R2StorageService` (deliberately), so objects with no row (a crash between `put` and the row update) cannot be swept. Derivative keys are deterministic, so a retry overwrites rather than duplicates; the class is negligible in practice. Adding a listing capability would be a separate infrastructure decision.
- **Reconciler is manual** (no scheduler in Production). If a scheduler is ever provisioned it is one line; until then purge timing is an operations action.
- **Cache window:** after unpublish, a shared cache in front of the proxy may serve a hit for up to 5 minutes (AMEND-16 — stated, not hidden); the origin itself stops at once.
- **Operational prerequisites** carried from V2a/V2b (R2 credentials verified, PHP upload limits, RAM vs decode budget, one 40 MP render inside the FPM timeout) remain the go-live checklist; V2c adds none.

## Next dependency-safe slice

**V4 — MediaPicker / Image Editor / Logos** (depends on V2, now complete): picker, crop/focal/fit/rotate/zoom/reset, decorative toggle, per-usage AR/EN alt with resolved-fallback preview, per-usage processing/ready/failed/Retry against the V2b API, logos + favicon → `MediaRef`. V5 (+V1B) is independent and unblocked.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
