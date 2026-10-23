# IMP-H4-S1 — Product taxonomy import: categories (hierarchy) + brands — field contract, service and durable-engine adapter

**Branch:** `claude/imp-h4-s1-taxonomy-import` · **No migration, env, route, permission, accounting/ledger, ZATCA or AI-setting change.** The adapter is **not registered** in `ImportDomainRegistry`/`ImportJobDomain` (registration, sync inspect/preview endpoints and the `product_taxonomy` domain gates are **H4-S2'/UI slice**, exactly as H3 did), so no request can reach it yet. Standard (deterministic) path only — the AI action type (H4-S4) stays behind IMP-X-01.

## What it adds

- `ProductTaxonomyImportFields` — one registry, two kinds fixed by the entry point (never read from the file):
  - **category:** `nebrax_id` (match only), `name` (required), `parent_path` (`A > B > C`, separators `>` `›` `»`), `description`, `color` (`#RRGGBB`, the same regex the controller enforces), `is_active`.
  - **brand:** `nebrax_id` (match only), `name` (required), `is_active`.
  - **Never in the contract:** category image (a media file, not a text column), `parent_id`, tenant/branch, anything product-side (price, stock, product links). A legacy numeric `id` column is *not* auto-mapped to the Nebrax UUID (tested).
- `ProductTaxonomyImportService` — `template`, `inspect`, `preview`/`previewWithPlan`, windowed `apply`, writing through `ProductCategory::create` / `Brand::create` / model `update` (the controllers' own write paths; same rules re-implemented, controllers not touched). No ledger, no stock, no product is touched (asserted).
  - **Identity (AWJ decision):** Nebrax ID first. Otherwise a category's identity is its **path** (parent chain + name — unique among siblings by the controller's own rule, so the path is an unambiguous natural key, unlike a product name) and a brand's identity is its **name** (unique tenant-wide by the controller's rule). Uniqueness is checked against the **whole organisation** (all branches, via `BranchScope::reference`) exactly like the controllers; a node that exists only in a branch the user cannot see blocks creation and cannot be updated (`exists_not_visible`); a parent that is not visible is refused (`parent_not_visible`) as the controller's `assertTenantOwned` would.
  - **Modes** `create | update | upsert`; **blank policy** `ignore | clear` (only description/colour clearable; `is_active` warns).
  - **Parent policy** (CLAUDE.md rule 6 — configurable, protective default) `error` *(default)*: the parent must exist or be defined by an earlier row; `create_missing`: absent ancestors are created active with no description, counted in the preview (`implicit_parents`, per-row `creates_parents`) and the result (`implicit_parents_created`). Brands are flat: the policy is pinned to `error`.
  - **No rename and no move** of an existing node through import (`identity_locked` if a Nebrax-ID row's name/parent differs): rename needs sibling re-uniqueness, a move needs the controller's cycle check, and both are better as an explicit screen action. Update touches description / colour / status only. (Parked: rename/move policy.)
  - **Creation only → no cycles possible.** Names containing a path separator are refused (they could not be addressed by `parent_path`); depth ≤ 8 levels; empty path levels refused; wide rows refused (same guard as products/partners).
  - **In-file duplicates** (same path/name or same Nebrax ID) fail the whole file at the first chunk before any write; later chunks re-analyse the whole file but write only their window.
  - **Implicit-then-explicit parent:** a row that defines a parent *after* a child already created it (under `create_missing`) is classified `update` of that node (`upsert`) or an "existing" error (`create`) — the same outcome in whole-file preview and in windowed execution. **Plan codes use a hash of the path**, not the id, because the same node is virtual in the preview and real once an earlier chunk created it (tested across windows with `expected_plan`).
  - **Concurrency (rule 11):** neither table has a unique index, so uniqueness is an application check. The whole analysis + write runs inside the chunk transaction after a PostgreSQL transaction-scoped advisory lock keyed by tenant (no tenant-anchor lock; no-op on SQLite). The direct `POST /product-categories` / `/brands` stay lock-free as today — a race between them and an import is accepted (same stance as partners).
- `ProductTaxonomyImportAdapter` (`product_taxonomy`, `UNIT_ROW`, `DURABLE_MAX_ROWS`): canonical options (`kind`, `mode`, `blank_policy`, `parent_policy`, `mapping`), plan-drift expectation from a bound preview, repair-claim hook, failures export (no sensitive columns).
- `ProductImportValueNormalizer::boolean` made `public` (no behaviour change; identical to the change already merged with H3-S1).

## Tests

- `ProductTaxonomyImportTest` (35, SQLite + PostgreSQL): contract (no media/parent_id/price fields, Arabic header mapping, legacy `id` not mapped), templates importable as-is, option validation, ordered hierarchical create, missing-parent policy both ways, shared implicit parents never duplicated, same name under different parents vs sibling clash, in-file duplicate fails the file before any write, malformed cells (colour, separator in name, empty level, depth, bad boolean, too long), update by path touches only description/colour/status, blank policy, upsert mix, **no rename/move by Nebrax ID**, unknown/malformed id, implicit-then-explicit parent (upsert/create), **branch isolation** (other isolated branch blocks the name, cannot be updated or used as a parent — categories and brands), brands (create/update/dedupe, no rename, in-file duplicate), **no product or journal side effects**, windows, plan stable across windows, plan drift, atomic abort on a bad row, wide row, adapter options and chunk.
- `ProductTaxonomyImportConcurrencyPostgresTest` (2, real PostgreSQL + `pcntl_fork`): four racing imports of the same 30 brands create each brand once (one wins, the rest fail with a named row failure); four racing imports of the same three-level path with `create_missing` create each level exactly once. **Negative control:** with the advisory lock removed both fail; restored → green. Validated on a local PostgreSQL 16, not only in CI.

## Known limits (disclosed)

- Case-sensitive exact name comparison, identical to the controllers (`Oils` and `oils` coexist); no Unicode normalisation beyond trimming.
- Cross-branch visibility depends on the `share_products` setting exactly as the controllers; implicit parents are created in the *current* branch.
- Category images, rename/move, and product linkage are out of scope (parked).
- No endpoints/UI until the next slices; no screenshots (no UI here).

## Independent review (read-only subagent) — disposition

No data-corrupting, tenant-isolation or preview/apply-disagreement defect found (virtual-vs-real nodes across windows, update of a node created earlier in the same window, rows that error never mutating the tree, soft-deleted rows, branch visibility, lock placement all checked). Findings and what was done:

| # | Finding | Disposition |
|---|---|---|
| 1 | The same node targeted once by `nebrax_id` and once by name in one file was not linked (second row judged against pre-write state → contradictory instruction silently dropped) | **Fixed** (`duplicate_in_file` within the analysed window) + test. *Limit:* across different windows of an unbound run the two forms are still not linked; a bound preview (whole-file) shows the error, so approval is blocked |
| 2 | Existing category names containing `>`/`›`/`»` (the screen allows them) cannot be addressed by `parent_path`; a path through them forked a lookalike tree | **Fixed**: when parent resolution fails/needs creation and any such name exists, the row is refused (`ambiguous_separator_name`) + test |
| 3 | A name of `0` showed as empty in the preview | **Fixed** + test |
| 4 | The advisory lock only serialises imports against each other; the screen's create endpoints are lock-free | **Accepted, documented** (same stance as partners; fix belongs in the controllers) |
| T | Weak tests: vacuous atomic test, no cross-tenant id test, preview-only branch tests, vacuous sibling assertion, window test without `expected_plan` | **Strengthened**: injected mid-write failure rolls back, foreign-tenant ids for both kinds, branch tests now exercise `apply`, sibling test applies, windows run with `expected_plan` |

No Codex review (quota exhausted).
