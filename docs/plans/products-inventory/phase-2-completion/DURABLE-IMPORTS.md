# Durable Imports

**Status:** PLANNED

## Goal
Replace synchronous scale ceilings with durable, observable, idempotent import jobs. Do not raise the 2,000-row limits as substitute architecture.

## Domain separation
Product Catalog Import = Master Data only. Inventory Opening Import = stock/accounting staging with separate explicit posting. They may share file/job infrastructure but never share domain effects.

## Prerequisites
PR-INV-1, PR-UOM-1, PR-PROD-LIFE-1 and finalized Multiple-UOM workbook contracts. Inventory Opening keeps its existing accounting invariants.

## Pipeline
Upload → immutable file fingerprint → inspect → mapping/options snapshot → whole-file validation → durable batch/job → apply in deterministic chunks → progress → error/result artifact → completed/failed/cancelled state.

## Required properties
- tenant-owned job/file/result records;
- authorization rechecked at apply, especially sensitive cost fields;
- frozen mapping/options so retry does not reinterpret a changed UI state;
- deterministic row identity and idempotent retry/resume;
- live uniqueness/reference revalidation during apply;
- no partial invisible success: applied/failed counts and row-level diagnostics are durable;
- bounded memory; no full-file browser dependency;
- cleanup/retention policy explicit;
- safe cancellation boundary between chunks;
- no stock/GL effects from Product Catalog jobs;
- Inventory Opening remains Draft until its explicit domain posting action.

## Product workbook
Products / Barcodes / Unit Prices. Media handled separately by manifest/package later. Unknown columns/mappings fail predictably according to versioned contract.

## Inventory Opening
Preserve Inspect → Preview → Draft → explicit Post. Large-file job may create/validate Draft data, but never auto-post. Product/Warehouse auto-create remains prohibited unless separately designed.

## Concurrency/idempotency
A retry cannot duplicate Products, barcodes, opening lines or effects. Uniqueness conflicts discovered after preview become explicit apply errors. Posting idempotency remains owned by InventoryOpeningService, not the import worker.

## Operational acceptance
Progress survives browser disconnect; job status is queryable; result/error artifact can be downloaded; retries are deterministic; tenant A cannot access tenant B jobs/files; cost permissions cannot be bypassed by stale preview; large catalog/opening workflows do not require raising synchronous controller limits.