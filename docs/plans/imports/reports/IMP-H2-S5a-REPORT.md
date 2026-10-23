# IMP-H2-S5a — Consumer parity characterization (+ a price-only update fix it uncovered)

**Branch:** `claude/imp-h2-s5a-parity-characterization` · **Scope:** a characterization test for the two product-import consumers, plus a **bug fix** for a silent data-loss path the test exposed. No migration, env, accounting/ledger, ZATCA or AI-setting change. S5b (moving both consumers onto one row-level contract) is **not** started here.

## Why S5 is split

H2-S5 as written assumes a shared `ProductImportAdapter` (`validateRow/match/applyRow`) that does not exist: `ProductCatalogImportAdapter` is a *chunk* adapter around `ProductImportService`, while the AI path (`AiActionProductPreviewBuilder::evaluate`, ~200 lines) has its own matching, normalization and rules. Merging them blind would be a large refactor of two write paths. S5a first measures **where they already agree and where they intentionally differ**, so S5b can express each difference as a policy.

## Findings

1. **Agreement (16 scenarios, same data → same verdict in both):** new product; create over an existing SKU/barcode; update with a changed price; update with nothing changed (V2 `skip` ≙ AI `skip`); unknown SKU; SKU and barcode of two different products; malformed / unknown Nebrax id; same SKU twice in the file; money with 3 decimals; min price above sale price; a service that tracks inventory; changing the type of an existing product; unknown category under `match_or_error`.
2. **Intended AI-only rules (pinned as divergences):** on create AI Actions never defaults purchase price / tax / unit and requires a trusted identifier (V2 defaults them and generates a SKU); references are never kept as free text (V2's default `match_or_text` keeps them — under `match_or_error` V2 agrees); AI can match an update by a trusted barcode alone, V2 requires an id/SKU column. These are the policy knobs S5b has to name.
3. **Defect found — a sale-price-only update was silently dropped.** `sale_price` is an accessor over `ProductUnitPrice` (VAR-PRICE-1), so assigning it never marks the model dirty:
   - **V2 import** classified a row whose only change was `sale_price` as `skip` (preview *and* apply: `updated 0, skipped 1`, price unchanged). The same row *with* another changed column did apply the price.
   - **Root cause** is in `ProductLifecycleService::update`, which returned early on `getDirty() === []`, so the pending price was never flushed. It is the common write path of **three** callers, so all were affected: V2 import, **AI Actions execution** (a price-only row reported applied without persisting), and the **product card** (`PUT /api/products/{id}` — the form always sends every field, including `sale_price`; a full payload that changed only the price returned 200 and left the price at its old value). An earlier draft of this report said the card was unaffected; that was wrong (a debug request had failed validation for missing fields) and was corrected after the independent review, with an empirical before/after check on `main`.

## Fix (small, localized)

- `ProductLifecycleService::update`: compares `sale_price` explicitly before assigning; saves when it changed (so the pending price is flushed), **bumps `updated_at`** (the AI Actions `target_changed` version guard compares it — a price-only edit would otherwise be invisible to it), and records the change in the update activity `diff` (`sale_price: [before, after]`, previously never recorded).
- `ProductImportService::isNoOpUpdate`: a payload whose only difference is `sale_price` is no longer a no-op. The extra query runs only for rows that otherwise look unchanged.
- **Preview/plan effect:** such rows move from plan code `s:` to `u:`. A preview issued before deploy and applied after would hit the existing `plan_drift` guard (safe, re-preview). No stored data is rewritten; no Backfill.

## Tests — `ProductImportConsumerParityTest` (19)

16 agreement cases (each asserts V2 **and** AI against the same expected verdict); divergences pinned (create without explicit defaults / without identifier, unknown reference under both policies, update by barcode alone); price-only update applied then a genuine no-op; lifecycle update persists + records a price-only change and records nothing for the same price.
**Negative control:** reverting both fixes makes 3 tests fail (the price-only agreement case, the price-only apply test, the lifecycle test); restored → green.

## Deploy evaluation

Behavior change limited to the previously broken price-only case (strictly a bug fix) — now including the product card, where users will see a price change finally persist (and a new `updated` activity row). No migration/env/ledger. Additive field in the product-activity `diff`. Safe for auto-deploy.

## Independent review (read-only subagent, static) — disposition

| # | Finding | Disposition |
|---|---|---|
| 1 | Report wrongly said the product card is unaffected | **Fixed** (verified empirically; regression test added; report/PR corrected) |
| 2 | A price-only save did not bump `updated_at`, so AI `target_changed` could not see it | **Fixed** (`updated_at` bumped; test) |
| 3 | Unit changed in the same payload as an echoed price: price lands on the new unit's row, diff lacks `sale_price` (pre-existing behaviour) | **Not fixed here — pre-existing, rare; tracked** |
| 4 | `sale_price => null` would cast to 0 | Hypothetical (imports exclude it; card requires integer) |
| – | `save()` with empty dirty fires `saving`/`saved` so the flush runs; no ledger/inventory code touched; no existing test breaks | Confirmed by the reviewer (static read) |

## Disclosures

No Codex review (quota exhausted); independent subagent review recorded in the PR if run. S5b scope (policy names: `require_explicit_defaults`, `require_trusted_identifier`, `references`, `match_by_barcode`) is proposed, not built.
