# CUST-H5-3 — Durable Saved Revision History — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-H5 — Undo / Redo, Recovery & Change Confidence |
| **Slice** | **H5-3** — additive server-side history of successful Version saves |
| **Branch** | `claude/cust-h5-3` |
| **Authority** | `CUST-H5-EVIDENCE-ARCHITECTURE-EXECUTION-PLAN.md` §4 (recovery contract), §6 (boundaries), §7 (evidence gate), §8 (H5-3 scope), §10 (STOP conditions) |
| **Scope** | Backend only: one **additive** table + model, one recorder, two read-only endpoints. **No change** to the Version save/publish/schedule contracts, the Version-level `revision`, public (storefront) APIs, accounting, or any existing column. No web change in this slice (H5-4 owns the recovery UI). |

## §7 evidence gate — measured, and the decision it supports

| Measurement | Value |
|---|---|
| Default normalized document (PHP normalizer, schema v3) | **1,522 bytes** (largest part: `pages` 509 B) |
| Hard cap enforced on every save (`MAX_DOCUMENT_BYTES`) | **1.5 MiB** (1,572,864 B) |
| Documents reference media by id (CUST-HV), never embed bytes | confirmed — snapshots are small JSON |
| Retention chosen | **latest 30 per Version, and ≤ 16 MiB per Version (whichever binds first); the newest is never dropped** |
| Worst case per Version at the cap | 16 MiB (a pathological 1.5 MiB-per-save history is cut after ~10 snapshots) |
| Typical per Version | 30 × tens of KB ≈ a few MB at most |

Full immutable JSON snapshots are therefore operationally suitable: **no delta/patch chain is needed**, so §10 STOP condition 9 does not apply. Both bounds are constants on the recorder, finite and documented.

## Canonical convention (frozen here)

`StorefrontPresentationRevisionRecorder` is the single source of truth:

1. **Post-save snapshot.** After every successful content save, the normalized stored document is recorded under the **new** Version revision.
2. **Lazy baseline.** If the Version has no history rows yet (created before this feature, or never saved), the document **as it was before this save** is recorded first under its previous revision — so "yesterday's saved draft before I changed it" is recoverable from the first save onwards. Create/import paths are untouched.
3. **No gaps, no duplicates.** Unique `(version_id, version_revision)`; a repeated call for the same revision is a no-op. A save that does not change the document (same canonical SHA-256) records nothing — it carries no information. Revision bumps that change no content (rename, schedule) record nothing.
4. **Bounded retention** as above, pruned in the same transaction; pruning is a scoped bulk delete of that Version's own snapshot rows only — it can never touch the Version row, the publication head, or any Published snapshot.
5. **Atomic with the save.** Recorded **inside the existing save transaction**, after the Version write, under the established Storefront → head → Version lock order. A failed/stale/oversized/forbidden save records nothing; a failed recording rolls the save back.

Hooked into **both** writers of a Version document: the Version API save, and the legacy `PUT …/presentation` path that also writes the compatibility working Version — so older clients cannot create gaps.

## What was built

| Piece | File |
|---|---|
| Table `storefront_presentation_version_revisions` (uuid pk, `tenant_id`, `storefront_id`, `version_id` FKs with cascade, `version_revision`, `schema_version`, `config` json, `config_hash`, `size_bytes`, `created_at`; unique per `(version_id, version_revision)`; tenant/store/version index) | `database/migrations/2026_11_07_010000_…` |
| Model — `CompanyWide`, **immutable** (`updating`/`deleting` throw), ownership validated structurally on `creating` | `app/Models/StorefrontPresentationVersionRevision.php` |
| Recorder (convention, hash, retention) | `app/Services/Commerce/StorefrontPresentationRevisionRecorder.php` |
| Save integration + list/show reads | `StorefrontPresentationVersionService`, `StorefrontPresentationService` (legacy path) |
| Endpoints (read-only, `commerce.manage`, no new permission): `GET …/versions/{version}/revisions` (metadata, newest first, `is_current` marker, **no document**), `GET …/revisions/{revision}` (one snapshot with its document **normalized under the current schema**; forward schema → 409) | controller + `routes/api.php` |
| Route inventory guard updated | `CommerceModuleBoundaryTest` |

## Contracts honoured

| Contract | How |
|---|---|
| Version-level `revision` is the sole concurrency authority | Untouched. History rows only *record* it; Restore (H5-4) will save against the **current** revision. |
| Published immutable; nothing here can mutate it | The feature only inserts/prunes its own rows. Publishing records nothing; saving the active Version is still 409 and records nothing (tested). |
| Tenant isolation | Rows carry `tenant_id` derived from the locked Version row; model guard re-checks ownership; every read resolves storefront → version → revision under the tenant scope; foreign tenant / storefront / version / revision ⇒ 404 (tested across all combinations). |
| No public exposure | Only workspace routes behind `auth` + `commerce.manage`; no public/storefront route; the route inventory test enforces the allow-list. Unauthenticated ⇒ 401, `staff` ⇒ 403. |
| Stale 409 / no blind merge | Unchanged; a 409 save records nothing. |
| Backward compatibility | Additive table; existing endpoints' payloads unchanged; optional trailing constructor params keep existing construction valid. |
| No accounting effect | None. No journal entry is produced or altered. |

## Tests and evidence

**New `StorefrontPresentationVersionRevisionHistoryTest` — 20 tests (220 assertions)**, green on **SQLite and PostgreSQL 16**: lazy baseline + post-save snapshot; one snapshot per later save, baseline not repeated; no-op save records no duplicate but bumps revision; idempotent repeat; stale 409 / oversized / active-Published save record nothing; model immutability (update + delete); cascade on Version delete; retention by count (35 saves ⇒ 30 rows, current kept, baseline dropped) and by bytes (9 × 2.5 MB ⇒ ≤ 16 MiB, newest kept); list is newest-first, metadata-only, marks the current snapshot; show returns the normalized historical document with no side effect; cross-version / cross-storefront / cross-tenant 404s; 401/403; read-only (405 on write verbs); forward-schema 409; legacy PUT recorded without gaps.

Also green on PostgreSQL: `StorefrontPresentationVersionApiTest` and `StorefrontPresentationLegacyCompatibilityForkTest` (71 tests total with the new suite).

**Real concurrency on PostgreSQL 16** (parallel PHP processes against one Version through the HTTP kernel; not a CI test — Laravel's test transactions cannot exercise true parallelism):

| Scenario | Result |
|---|---|
| 8 processes save the same expected revision at once | exactly **1 × 200, 7 × 409**; history = baseline + that one save; Version revision = 2 |
| 6 processes × 5 successful saves each, retrying on 409 (30 successes, 58 conflicts) | final revision **31**; history **30 rows, revisions 2…31 contiguous, 0 gaps, 30 distinct documents, 0 duplicates** (cap reached; baseline correctly pruned; newest kept) |

## Accounting entries

Not applicable — this slice records presentation documents only. No financial operation, ledger write or journal line is created or modified.

## Limitations (stated) / deferred to H5-4

- **Media revalidation and Restore** are H5-4: this slice exposes the historical document (normalized) read-only; the restore flow must re-check tenant ownership/readiness of every referenced media id and surface actionable missing-media errors — H5-3 deliberately does not resurrect or validate media.
- Versions that predate this feature have no history until their next save (the lazy baseline then captures the pre-save state).
- No actor attribution column (no stable, privacy-safe convention for this domain; plan §4.2).
- Retention is count/bytes only (no age policy) — finite and documented.

## Invariants / STOP check

Tenant Isolation, authN/authZ, Draft vs Published, Version-level concurrency, media ownership, commerce firewall, backward compatibility: **intact**. No §10 STOP condition triggered (no revision-granularity change, no CRDT/merge, no Tenant uncertainty, no Published mutation, no destructive/breaking DB change, no public API change, no accounting change, no media resurrection, full snapshots suitable, no new infrastructure).

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-H5 sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
