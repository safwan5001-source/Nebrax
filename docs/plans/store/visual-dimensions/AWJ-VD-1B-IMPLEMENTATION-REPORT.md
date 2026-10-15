# AWJ-VD-1B — Implementation Report (Facet visual storage and admin API)

STATUS: **MERGED** — PR #1491 merged by the owner as `5a10930fb16bb902e619e46b13930f0274a3ed85`. POST_MERGE_REVIEW: PASS — CI (sqlite + pgsql) green on main; Web CI and Storefront CI not triggered (no web/ or storefront/ changes).
DATE: 2026-10-14
HORIZON: AWJ-COMMERCE-VISUAL-DIMENSIONS-H1 · slice VD-1b (H1-1)
AUTHORITY:
- The owner authorized VD-1b and VD-4a, with decisions 1–3 on this slice:
  1. `visual: null` with a kept `visual_version`;
  2. inactive owners may be prepared;
  3. `media_not_ready` is a 422.
- This authorization covers this slice's DB and API changes only.

## Outcome

The visual identity (L2) of a facet and of each facet value is now stored and editable through the admin API, under D-04, D-11, D-16 and D-17.

The list endpoint returns it to every role that can read facets, with short-lived thumbnail previews.

**Not touched:**
- the public storefront (`meta.facets` and the image route are VD-1c);
- the editor UI (VD-3);
- `CatalogFacetFilter` and the `facet[key]=slug` filtering;
- RBAC roles, accounting and inventory.

## Data (§3.2)

`commerce_facet_visuals` (migration `2026_11_09_010000`):

| Column | Notes |
|---|---|
| `id` | uuid |
| `tenant_id` | FK, cascade |
| `commerce_facet_id` | FK, cascade |
| `commerce_facet_value_id` | nullable FK, cascade; NULL = the facet's own row |
| `schema_version` | 1 |
| `visual` | JSON, always the normalized document |
| `version` | integer token |
| timestamps | |

Indexes:
- `cfvis_value_unique` (one row per value);
- partial unique index `cfvis_facet_self_unique … WHERE commerce_facet_value_id IS NULL` (one self row per facet; SQLite and PostgreSQL);
- `cfvis_tenant_facet`.

**Model.** `CommerceFacetVisual extends BaseModel implements CompanyWide`.
- `saving` checks structurally that the facet belongs to the tenant and that the value belongs to that facet.
- Media checks live in the service, because they must run under the D-16 locks.

## API (§3.8-a)

| Route | Guard | Behaviour |
|---|---|---|
| `GET /api/commerce/workspace/facets` | `products.view` (unchanged) | **Additive:** `visual`, `visual_version`, `visual_preview` on every facet and value |
| `PUT …/facets/{id}/visual` | `commerce.manage` + self-service denial + named throttle `facet-visual-writes` (120/min per user, its own bucket) | facet row: `{self, defaults}` |
| `PUT …/facets/{id}/values/{valueId}/visual` | same | value row |

**Request body** `{visual: object|null, expected_version: int|null}`, read from the JSON body only:
- unknown keys and **any query-string parameter** are 422;
- `expected_version` must be a **JSON integer** ≥ 1 or null (`true`, `1.0` and `"1"` are refused);
- `visual: ""` is a 422 (it is not turned into the `null` remove path);
- every 422 carries `code: visual_invalid`.

**Responses:**
- `200 {data:{visual, version}}`;
- 404, the same for missing and foreign owners;
- 409 / 428 per the table below;
- 422 `{code:"visual_invalid", errors:{"visual.<path>":[code]}}`.

**Concurrency (D-17).** Token mandatory once a row exists:

| Stored row | `expected_version` | Result |
|---|---|---|
| none | null / absent | create, `version 1` |
| none | number | 409, `current_version: null` |
| present | null / absent | 428 `visual_precondition_required` |
| present | equal | update, `version + 1`; `visual: null` → `{}` tombstone (stored as a JSON **object**), row kept |
| present | different | 409 `visual_version_conflict` with `current_version` |
| concurrent creates | null / null | **serialized on the facet row**: the second meets the first's row → **428**. If a writer bypassed that lock, the unique index → **409**. Never 500 |

- The API never deletes a row, so no version number repeats for the same owner (anti-ABA).
- Rows go only with their owner, by cascade.
- **Decision 1:** after a tombstone, the list shows `visual: null` with the kept `visual_version`.

**Validation (D-11).**
- The strict `CommerceFacetVisualNormalizer::errors()` from VD-1a is mapped to field paths.
- Media is checked under lock:
  - deleted, purged, foreign or unknown media is `media_not_found` (TenantScope makes foreign and unknown indistinguishable);
  - variants still pending or failed is `media_not_ready` (**decision 3**).
- **Decision 2:** inactive facets and values may be prepared. Public display is VD-1c's gate.

**Previews for read-only roles.**
- `visual_preview: {thumb_160, thumb_320}` are signed URLs valid for 20 minutes, on the existing `commerce.workspace.storefront-media.file` route (variants only, never the original).
- They are generated **only for media referenced by the identities in that response**, so `products.view` never becomes a library reader. `GET storefront-media` stays `commerce.manage`.

## Media protection and D-16 (§3.8-d)

- **Scanner:** a new `facet_visual` container (with `storefront_id: ''`) is counted by `referencesFor()` and `allReferencedIds()`. As a result:
  - deletion is refused with `409 media_in_use`;
  - the usage endpoint lists it;
  - the "unused" filter excludes it.

  It is **excluded** from `liveUsageKeys()`, because facet framing is CSS on base thumbnails and must not keep a baked derivative alive.
- **Save:** one transaction locks the **facet row** first (the existing `CommerceFacetService` protocol), then the visual row, then the referenced media rows **in id order**. It re-checks them **after** the lock, then writes.
  - A concurrent facet or value deletion therefore either completes first (→ 404) or waits.
  - Lock order facet → visual → media matches `deleteFacet`/`deleteValue`, so it adds no deadlock cycle.
- **Delete** (`StorefrontMediaService::delete()`, an existing path):
  - it now runs in a transaction that locks the media row, then re-scans references after the lock;
  - a media row already deleted by a concurrent request is an idempotent no-op;
  - the caller's model reflects the deletion.
- **Result:** whichever path locks second sees the other's committed result. Delete-first makes the save 422; save-first makes the delete 409.

## Changed files

**New:**
- `database/migrations/2026_11_09_010000_create_commerce_facet_visuals_table.php`
- `app/Models/CommerceFacetVisual.php`
- `app/Services/Commerce/CommerceFacetVisualService.php`
- `app/Services/Commerce/CommerceFacetVisualException.php`
- `app/Http/Controllers/Api/CommerceFacetVisualController.php`
- `app/Http/Requests/SaveCommerceFacetVisualRequest.php`
- `tests/Feature/CommerceFacetVisualApiTest.php`
- `tests/Feature/CommerceFacetVisualPostgresConcurrencyTest.php`
- this report

**Modified:**
- `app/Providers/CommerceWorkspaceServiceProvider.php` (2 routes)
- `app/Http/Controllers/Api/CommerceFacetController.php` (`index` decorates the list)
- `app/Services/Commerce/StorefrontMediaService.php` (`delete()` under lock)
- `app/Services/Commerce/StorefrontMediaReferenceScanner.php` (`facet_visual` container)
- `tests/Feature/CommerceModuleBoundaryTest.php` (route allow-list)
- `AWJ-VD-H1-TASK-QUEUE.md`

## Tests and exact results (local)

| Suite | Result |
|---|---|
| `CommerceFacetVisual*` on SQLite (API + contract; the pgsql-only race tests are skipped) | **36 passed, 3 skipped (447 assertions)** |
| `CommerceFacetVisual*` on **local PostgreSQL 16** (API + contract + 3 real two-process races) | **39 passed (465 assertions)** |
| Related suites on PostgreSQL (`CommerceFacetApiTest`, `StorefrontMediaApiTest`, `CommerceModuleBoundaryTest`) | all pass except one **pre-existing local-only** failure (below) |
| PHP full (`php artisan test --parallel`, SQLite) | first run: 6935 tests, **1 failure** (the firewall classification above, fixed); re-run: **OK — 6935 tests, 52078 assertions, 0 failures, 98 skipped** |

**Pre-existing, local PostgreSQL only:** `StorefrontMediaApiTest › the library lists newest first … searches` fails locally with `SQLSTATE[HY093]`.
- The cause is the local `pdo_pgsql` (PHP 8.3.6), which misparses the existing `LIKE … ESCAPE '\'` search query next to `?` placeholders.
- It fails **identically without VD-1b** (verified on the VD-4a branch), and `main` is green on pgsql in CI.
- Not touched here; recorded as out of scope in the task-queue backlog (owner decision).

**`CommerceFacetVisualApiTest`** covers:
- every row of the D-17 table, the ABA sequence and two clients on the same version;
- a deterministic unique-index race → 409;
- the indexes themselves;
- the facet `self` + `defaults` row;
- strict 422 codes and the body allow-list;
- the media matrix: pending, failed, deleted, foreign, unknown;
- the RBAC matrix: accountant 403 on visuals and 200 on names, staff and self-service 403, guest 401, owner and admin 200;
- previews: the accountant gets links but no library, no link for unreferenced media, expiry, no original;
- isolation: foreign facet, value, or value of another facet → identical 404;
- inactive owners; cascades that leave assignments untouched;
- media protection, released by the tombstone;
- D-16 in both orders, including a stale model and the query-level proof that the lock comes before the re-scan, inside the transaction;
- the `liveUsageKeys()` exclusion;
- the exact additive key list of `GET facets`.

**`CommerceFacetVisualPostgresConcurrencyTest`** runs real processes against real locks:
- two creates → one row and a 409;
- a save arriving while a delete holds the lock waits, then gets 422 `media_not_found`;
- a delete arriving while a save holds the lock waits, then gets 409 `media_in_use`.

It asserts the waiting process actually waited.

## Reviews

### Codex (PR #1491)

| Finding | Decision |
|---|---|
| P2: the tombstone was persisted as the JSON array `[]`, not the object `{}` | **Fixed.** A model mutator stores `{}` (and any non-empty document as an object), and a test asserts the raw column value. |

### Independent code review (`505839a`)

Nothing blocking. 6 non-blocking findings and 8 nits; all are handled below.

| # | Finding | Decision |
|---|---|---|
| 1 | A create racing a facet/value delete could surface the model guard's `RuntimeException` as 500 | **Fixed:** the save locks the facet row first, so the delete completes before (→ 404) or waits. |
| 2 | `expected_version` accepted `true`, `1.0`, `"1"` | **Fixed:** strict JSON-integer rule, with tests. |
| 3 | `throttle:30,1` shared one per-user bucket with media uploads | **Fixed:** named limiter `facet-visual-writes`. The NAT-shared bucket of the existing signed preview route is pre-existing and unchanged (backlog). |
| 4 | On pgsql the index test passed on 25P02 (aborted transaction), not the unique index | **Fixed:** a savepoint per attempt, and the assertion checks SQLSTATE 23505 or SQLite UNIQUE. |
| 5 | Preview-expiry test had no positive control | **Fixed:** `URL::hasValidSignature` is asserted true before and false after 21 minutes. |
| 6 | `visual: ""` became `null` (remove) through the empty-string middleware | **Fixed:** `visual` is read from the raw JSON, so `""` is a 422 (test). |
| 7 | Unique/FK detection fell back to message text that embeds user values | **Fixed:** decided by SQLSTATE, or SQLite's own `errorInfo[2]`. |
| 8 | Query-string values bypassed the body allow-list | **Fixed:** any query parameter is a 422 (test). |
| 9 | Tombstone stored as `[]` | **Fixed** (same as the Codex finding). |
| 10 | Orphaned docblock on `delete()` | **Fixed.** |
| 11 | `storefront_id` read from a missing attribute | **Fixed:** set explicitly to `''` for tenant-level containers. |
| 12 | The lock-order test did not prove `FOR UPDATE` | **Fixed:** asserted on PostgreSQL (SQLite has no row locks). |
| 13 | Test gaps (facet cascade, `current_version` after a lost race, fork timing) | **Fixed:** facet-deletion cascade added, `current_version` asserted, fork margins widened (2 s hold, 0.5 s arrival, > 1 s wait). |
| 14 | FormRequest 422s had no `code` | **Fixed:** every 422 carries `code: visual_invalid`. |

**A classification in the commerce firewall test (approved by the owner on 2026-10-14, limited to this one model, no general exemption).**
- **What failed:** the first full run failed `StorefrontCommerceFirewallTest › the_presentation_owning_services_name_no_commerce_truth_owner`. That test treats every model not explicitly listed as presentation-side as a possible commerce-truth owner. §3.8-d requires `StorefrontMediaReferenceScanner` to read `CommerceFacetVisual`.
- **What changed:** `CommerceFacetVisual` is now listed as **presentation-side**, with a comment saying why: closed shape and size keys, hex colours, an icon key and a media reference, with no price, offer, stock, tax or shipping value.
- **What did not change:** no commercial rule was loosened, and the firewall's word and key policy is untouched.
- **Decision:** it is a test classification of the new model. If you prefer another approach, it is yours to decide before merge.

**Contract note from fix 1 (approved by the owner on 2026-10-14; recorded in D-17 and §3.8-a).** Two simultaneous creates are now serialized on the facet row, so the loser receives **428** (the "row exists, token null" row) instead of the 409 the §3.8 table listed for concurrent creates. Both outcomes are correct refusals and never a 500. The unique index → 409 remains a net for any writer that bypasses the facet lock, and the deterministic race test proves it. The real pgsql race test asserts 428 and that one create waited for the other.

## Accounting impact

**None.** No financial operation and no journal entry; the table holds presentation data only.

## Tenant / branch isolation

- The new model is `CompanyWide`, scoped by `TenantScope`.
- The owner guard is structural (not just the FK).
- Media is resolved through `TenantScope`.
- Every foreign id is a non-revealing 404 (owner) or `media_not_found` (media).

## Security / authorization

- **Writes:** `commerce.manage`, with no RBAC change (D-04), plus self-service denial and a throttle.
- **Reads:** unchanged (`products.view`).
- **Previews:** signed, short-lived, variants only, referenced media only.
- **No merchant string reaches SQL or markup:** the document goes through the closed-list normalizer; media ids are validated UUIDs.

## Backward compatibility

- `GET facets` only gains three keys per facet and value; every existing key and its order are unchanged (tested).
- `DELETE storefront-media/{id}` keeps its responses, and now also refuses media used by facet visuals.
- No existing table is altered.

## API / DB / migration impact

- One new table and its indexes.
- Two new routes.
- Additive fields in one existing response.
- `migrate:fresh` is exercised on SQLite locally and on both engines in CI.

## Risks / remaining

- **Pre-existing, outside the horizon (backlog):** presentation-document saves do not lock media, so they keep the original save/delete race. The new lock in `delete()` narrows that window.
- **VD-1c next, after the owner's review:**
  - public `meta.facets` visuals;
  - the guarded image route and proxy;
  - the N1–N19 negative tests.

## Git state

- Branch: `feat/vd-1b-facet-visual-storage` from `757a7a3`
- PR / head: recorded on the PR
