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
