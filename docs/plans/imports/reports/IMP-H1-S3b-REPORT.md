# IMP-H1-S3b — Preview binding for durable import jobs

**Branch:** `claude/imp-h1-s3b-preview-binding` (on top of S3a) · S3c = sync-apply binding + per-unit `plan_drift`; the **requirement** (`preview_required`) is a later one-line activation.

## Problem

Preview and execution were independent requests: nothing tied what the user approved to what was executed (a different file, options or column mapping could be applied), options first arrived at `/apply`, and a retried upload with the same idempotency key but other options was treated as the same request.

## Changes

| Piece | Behaviour |
|---|---|
| `import_previews` (new table, `CompanyWide`) + `ImportPreview` | Server-held, **single-use** record: tenant, branch, user, domain, file SHA-256, archive SHA-256, canonical options, HMAC `preview_hash`, `expires_at` (60 min, `imports.preview_ttl_minutes`), `consumed_at/job_id` |
| `ImportDomainAdapter::canonicalOptions()` ×3 | Closed per-domain keys, typed/defaulted, mapping sorted. **Absent mapping stays absent** (= auto-match); an explicit empty mapping stays `[]` (= nothing mapped) — they mean different things |
| `ImportPreviewService` | `issue()` (on preview), `assertConsumable()` (before any file is stored), `consume()` (conditional `UPDATE … WHERE consumed_at IS NULL AND expires_at > now()` inside the job-creation transaction), `pruneStale()` |
| The 3 sync preview endpoints | Additive `data.binding {id, hash, expires_at}`; existing response fields unchanged |
| `POST /import-jobs` | Optional `preview_id`+`preview_hash` and nested `options[...]`. With a preview: hash must match file+archive+options+branch+domain+tenant and the same user; else 422 with `code` ∈ `preview_invalid` · `preview_expired` · `preview_consumed` · `preview_mismatch`. Options are **frozen on the job at creation** (`apply_options`) |
| `POST /import-jobs/{id}/apply` | A preview-bound job runs its frozen options; an explicitly sent semantic option that differs → 422 `options_frozen` (not silently ignored). `batch_size` stays operational |
| Idempotency identity (rule 12) | Now also compares preview id/hash and canonical options: same key + same file + other options/preview = **not** a retry (422) |
| `imports:prune` | Also removes expired/old-consumed previews |
| Requirement | `imports.preview_required_from` = `null` today ⇒ legacy (hashless) creation still allowed; when set (code change in the activation slice, after this UI is deployed) a missing preview ⇒ 422 `preview_required` |
| Web | The three import pages send the preview's `binding` and the same options at job creation (`createImportJob(..., bound)`); mapping keeps the `ignore` encoding used by preview/apply |

## Safety / deploy evaluation

- **No journal entry**, no domain-service change, AI settings / Railway / accounting / ZATCA untouched.
- **Migration** (`2026_11_24_010000`, runs at boot via the existing `migrate --force`): one **new** table + two nullable columns on `import_jobs` (metadata-only). No backfill; `down()` drops them.
- Behavior change: only for clients that send `preview_id`; the first-party UI does. Old clients keep the legacy contract until the activation slice. A job created before deploy has no preview ⇒ unchanged.
- Preview rows are not files; stale ones are pruned.

## Tests

- `ImportPreviewBindingTest` (21): issue for all domains; bound job + frozen options + consumption; single-use (+ no orphan file); mismatch by file/options/mapping leaves no trace and does not burn the preview; canonical key order/boolean spelling; invalid/foreign-tenant/wrong-hash; other user; expired; branch; `preview_id` without hash; requirement off→on→future; frozen options on apply (reject/accept/none); legacy job still freezes at first apply; idempotent retry; same key different options/no preview; conditional consume; prune; opening domain; hash never exposed.
- `ImportDomainRegistryTest` + canonical options (absent vs empty mapping, drop unknown/operational keys, typing).
- Existing `ImportJob*`, `ProductImport*`, `ProductWorkbook*`, `InventoryOpening*`, `AiActionProduct*`, `BranchIsolationGuard`: 327 passed locally.
- Web: `client.test.ts` (multipart encoding), engine forwards the binding; existing page tests green (64 + 3).

## Not in this slice (explicit)

- **Concurrency test on real PostgreSQL** for simultaneous consumption: the guarantee rests on the conditional `UPDATE` (row-lock re-evaluation); the SQLite-safe test proves the condition (second consume is refused) but not a real race. A forked-process PG test belongs with S3c's `plan_drift` race tests.
- Sync apply endpoints do not require the binding yet (S3c). `preview_required` is not enforced yet.
- Per-unit plan / `plan_drift`: S3c.

## Review

Codex quota exhausted — **not Codex-reviewed**. Independent subagent review: see PR.
