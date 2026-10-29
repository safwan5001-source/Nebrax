# IMP-H8-S2a — Saved column-mapping presets (backend)

**Branch:** `claude/imp-h8-s2a-mapping-presets`. **One additive migration** (`2026_12_14_010000_create_import_mapping_presets_table`), no change to any existing table, no backfill, no permission/env/ZATCA change. **No journal entries and no stock effect** — a preset is a stored mapping of file-column headers to field keys; it carries no file, no rows and no run policy.

## Design
- **Table `import_mapping_presets`:** `tenant_id`, `domain`, `name`, `name_key` (normalized), `columns` JSON (`{header, header_key, field|null}` in the saved file's column order), `created_by`. Unique `(tenant_id, domain, name_key)`; model `CompanyWide` (the plan's classification, `BranchIsolationGuardTest` green). `down()` refuses once rows exist.
- **Saved by header text, not column index.** An index changes between two files from the same supplier; the header does not. Matching uses `ImportHeaderMatcher::normalize` (Arabic folding, case, spacing, diacritics), the same normalizer the auto-mapper uses.
- **API** (`import-mapping-presets`): `GET ?domain=` · `POST` · `DELETE {id}` · `POST {id}/match {headers[]}` → `{mapping: {index: field|null}, matched, unmatched}`. `match` is server-side so the client never re-implements the normalizer. A saved header is consumed once per match: two file columns with the same header never bind one field twice.
- **Authorization follows the domain, not a union:** every route asserts `ImportJobAccess::assertManage($domain)` — the manage permission **and** application of that import domain (e.g. `stock_permit_import` needs `products.manage` + `inventory.core`). A partners clerk can manage `partner_master` presets and gets 403 on the stock-permit domain; a disabled application blocks its domain's presets only.
- **AWJ decisions / rule 6:** run policies (zero-cost, blank handling, duplicate signals…) are **not** saved in a preset — they are per-run business choices and must not be silently re-applied from a stored file. Field keys are not validated against each domain's contract at save time (each domain has its own fields class); the preview request already validates every key with `Rule::in`, so an unknown key is refused there. The key format is constrained (`^[a-z][a-z0-9_]{0,63}$`).
- **Limits:** name ≤ 80 chars, ≤ 200 columns, header ≤ 200 chars, **50 presets per (tenant, domain)**.
- **Concurrency:** name check + limit check + insert run in one transaction under a PostgreSQL advisory lock per (tenant, domain). A unique violation is never caught inside a PG transaction (it poisons it); the unique index stays as the last-resort net, and losers get the normal Arabic refusal (`RuntimeException` → 422), not a database error.

## Tests
- `ImportMappingPresetTest` 11 (SQLite + PostgreSQL): CRUD, Arabic-normalized uniqueness per domain (same name allowed across domains/tenants), invalid names/columns, ignored columns stored as no field, the 50 limit and freeing a slot, `match` by normalized header (order-independent), no double binding, **domain gates (no union)**, disabled application, tenant isolation (list/delete/match → empty/404), unauthenticated.
- `ImportMappingPresetConcurrencyPostgresTest` 2 (real `pcntl_fork`): six racing saves of one normalized name → exactly one preset, losers get `RuntimeException`; twelve racers for the last slot → exactly one succeeds, total stays 50. `pcntl` missing on PostgreSQL is a failure, not a skip.
- Mutation controls (SQLite suite), each fails tests when applied: list ungated · name check removed · limit removed · `match` not consuming saved headers · delete ungated · matching by position. PostgreSQL: removing the advisory lock fails the name-race test every time.

**Disclosed test limit:** the limit-race test caught removal of the lock in about one run of three (it needs the racers to interleave between the count and the insert); the deterministic guard is the name-race test. With the lock all runs pass.

## Not done / follow-ups
- **H8-S2b:** the UI — a shared presets bar in the wizards (apply a preset after inspect, save the current mapping, delete), integrated wizard by wizard.
- Renaming a preset is not offered (delete and save again); no preset sharing across domains by design.
