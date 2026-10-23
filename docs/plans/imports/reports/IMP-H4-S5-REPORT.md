# IMP-H4-S5 — Standard endpoints + durable job domains for the three H4 adapters

**Plan gap closed:** the Master Horizon lists H4-S1..S3 as adapters and H4-S4 as the AI path, but no slice exposed the standard (deterministic) path to users. H3 did this as S2 (endpoints + job domain). This slice does the same for H4 in one combined PR (the three domains touch the same registry / job-request hunks, so three PRs would only conflict with each other). Stacked on #1666 (S2) and #1667 (S3).

**No migration, env, Railway, ledger, ZATCA, RBAC-catalogue or AI-setting change.** New routes are gated exactly like the direct APIs of the entities they write.

## What it adds
- **Job domains** in `ImportJobDomain` (with gates that are the direct API's, literal): `product_taxonomy` (`products.view/manage`, no app gate), `unit_templates` (`products.view/manage`), `price_list_items` (`invoices.view` / **`company.manage`** — the gate of `POST price-lists/{id}/items`, deliberately *not* the products gate). Adapters registered in `ImportDomainRegistry` (`UNIT_ROW`, `UNIT_ROW`, `UNIT_FILE`).
- **Endpoints** (template · fields · inspect · preview; **no synchronous apply** — rule 10, execution only through the durable job bound to a single-use preview): `/product-taxonomy/import/*?kind=category|brand`, `/unit-templates/import/*`, `/price-lists/import/*` (`price_list_id` required). File routes carry `EnsureImportFilesScanned` (the intake invariant test passes). Preview issues the binding (`ImportPreviewService`) with the row plan for the two row-unit domains and none for the atomic file domain.
- **Job-request options** in `StoreImportJobRequest`/`ApplyImportJobRequest`: `kind` (required for taxonomy, in category|brand), `parent_policy`, `existing_policy`, `price_list_id` (required for price-list jobs; still optional elsewhere), and the new mapping keys.
- **D-08 kept:** unit templates have no AI action type (asserted: the registry still lists `product_import.v1` only).

## Tests
`H4ImportEndpointsTest` (10, SQLite + PostgreSQL): registration + gates + no AI type; no sync apply for any of the three; taxonomy template/fields/inspect/preview write nothing and issue a binding with the canonical options; a bound taxonomy job creates a hierarchy with `create_missing`; taxonomy kind required + per-domain gates (a products viewer is refused, a manager accepted); unit-template preview + bound atomic job; an invalid unit-template file fails the job and writes nothing; price-list list required, current-price preview, bound job writes halalas; **another tenant's price list is refused at preview and at run**; the price-list gate is `company.manage`, not products. Existing `Import*` suites (447) green, including the registry, per-domain authorization and the intake-guard route invariants.

## Disclosures
UI (import wizards for these three) is the next slice; the standard path is API-complete here. A job's apply request defaults `mode=create` when none was frozen — for price-list jobs created through the wizard `mode` is always sent (default `upsert` there). No Codex review (quota exhausted); no independent review for this wiring slice beyond the invariant suites (it adds no new write logic: it reuses the three reviewed adapters and the H3-S2 pattern).

## Codex review (PR #1683) — two P2 findings, both verified and fixed

| Finding | Verdict | Fix |
|---|---|---|
| Preview/inspect read files with the synchronous `MAX_ROWS` (2,000) while the adapters accept `DURABLE_MAX_ROWS`, so a 2,001–20,000-row file can never obtain a binding | **Valid** — and the same gap existed in the already-merged H3-S2 partner endpoints | `inspect`/`previewWithPlan` of the partner, taxonomy and price-list controllers now pass `DURABLE_MAX_ROWS` (unit templates are file-atomic: their adapter limit *is* the 2,000). Test: a 2,100-row brand file inspects and previews with a binding |
| An unbound job keeps `apply_options = null`, and the apply request cannot carry `kind` / `price_list_id` / `type` / policies, so the job fails at apply (or silently drops a creation-time policy) | **Valid** (also for partner `type` and unit-template / parent policies) | Job creation for `partner_master`, `product_taxonomy`, `price_list_items` and `unit_templates` now **requires a preview binding** (`ImportJobDomain::PREVIEW_BOUND_ONLY`, 422 on `preview_id`). The engine freezes options at creation only for bound jobs, so this is the least invasive correct fix and no legacy unbound flow exists for these domains. Six existing tests that created unbound jobs for convenience now create bound ones; the foreign-tenant price-list case is now refused at creation (options must match the preview) instead of at run |

Negative controls: with either fix reverted its new test fails. Local: SQLite 203 passed (Import*/Partner*/H4 endpoints), PostgreSQL 129 passed.
