# IMP-H7-S3a — Stock permit lines import (backend): one file = one draft permit

**Branch:** `claude/imp-h7-s3-stock-permits`. **No migration, no new permission, no env change.** **Standard path only (D-09):** no AI action type (`AiActionRegistry` still lists `product_import.v1` only; asserted). The wizard UI is H7-S3b.

## What it adds
- **Domain `stock_permit_import`** (`ImportJobDomain`, `PREVIEW_BOUND_ONLY`, registry) with the gates of `POST stock-permits` — `products.manage` + `inventory.core` (view `products.view`) — and endpoints `stock-permits/import/{template,fields,inspect,preview}` (placed before `stock-permits/{id}`); **no synchronous apply**, execution only through the durable job bound to a single-use preview.
- **One file = one draft permit** (unit `UNIT_FILE`, atomic): the header (type · warehouse · target warehouse · date · reason · notes) is a **frozen run option**, the rows are the lines. Creation goes through `StockPermitService::create` — the direct API's own path — so unit resolution (`UnitConversion`), base quantity and line cost are the service's, not re-derived.
- **Product identity:** Nebrax ID / SKU / barcode (intersecting if several), never the name; inactive, untracked (`track_inventory = false`) and variant-managed products are row errors; an unknown unit is refused (no assumed factor).
- **Header rules mirror the service:** type required with **no default** (receipt adds stock, issue removes it); transfer needs a different target; a target on a non-transfer is refused; date `YYYY-MM-DD`, defaulting to today **resolved at preview** (`canonicalOptions`) so it freezes with the preview fingerprint.
- **Cost (CLAUDE.md rule 6 — a per-run policy, default protective):** a receipt needs a `unit_cost` column and a non-zero cost per row unless **`allow_zero_cost`** is set explicitly for that run (a zero-cost receipt silently lowers the average cost). A cost column on an issue/transfer is a setup error (their cost is the average at posting), never silently ignored.
- **Access:** the warehouse (and target) must be in the actor's scope and active, checked at preview and in every apply chunk; an unknown/deleted actor is refused closed; another tenant's warehouse/products are "outside scope"/not found.
- Repeating the same product and unit is a **warning** (becomes two lines) — a doubled paste would otherwise double a quantity silently.

## Accounting effect
**None at import:** a draft permit only — no journal entry, no stock movement, no balance change (asserted). Posting is the existing, separate `StockPermitService::post`. Verified end-to-end for an imported receipt of 5 × 12.50 SAR:

| Operation | Account | Debit (halalas) | Credit (halalas) |
|---|---|---:|---:|
| Post imported **receipt** (existing flow) | 1140 Inventory | 6,250 | — |
| | 5180 Manual inventory adjustment | — | 6,250 |

Issues/transfers take the average cost at posting (unchanged service behaviour).

## Tests
`StockPermitImportTest` 20 + `StockPermitImportEndpointsTest` 10, on SQLite and PostgreSQL (30 total): contract and template round-trip; preview writes nothing; draft creation with halalas lines and no stock/ledger effect; posting the draft books the table above and moves stock; commercial-unit resolution; header rules; zero-cost policy (three cases); per-row errors and atomic refusal; warehouse access incl. the target; inactive warehouse / deleted actor; tenant isolation; adapter chunk contract; bound-only job; frozen default date; differing options refused; a failing file leaves the job failed with no permit; gates for every endpoint and the job; disabled `inventory.core`; a binding from another tenant refused.
Mutation controls (each fails tests when applied): zero-cost mapping rule off · row errors not blocking apply · warehouse access off · route gates off · default date not frozen · untracked products allowed · permit type defaulted.
Wider filter (`Import|StockPermit|Stocktake|Rbac|Permission|ApplicationCatalog|NavigationParity|Route`): 1027 passed, 1 failed (a Fuel test — local PHP lacks `bcmath`).

## Disclosures / not done
- **No duplicate guard:** a permit has no external reference, so re-uploading the same file creates a second draft (deletable; nothing is posted). No reservation domain was invented.
- **No stock-availability check at import:** issues/transfers are validated against stock at posting, as for manually created permits.
- Row cap 2,000 (the service's guard; the direct API has none).
- UI wizard = H7-S3b.
