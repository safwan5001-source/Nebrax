# Phase 2 — Claude Code Planning-to-Implementation Handoff Rules

**Important:** these are not executable feature prompts yet. They define how a future Claude Code implementation prompt must be generated after prerequisite hardening is merged and the feature is decomposed against current `main`.

## Common handoff contract

Claude Code must read the feature plan, current audit baseline, Dependency Map, Acceptance Matrix, relevant completed Implementation Reports and current code only where needed. It must not revive superseded assumptions from old branches. Every feature is split into small reviewable PRs; no mega-PR.

Every final executable prompt must include: exact scope/out-of-scope, current Base SHA, relevant existing services/models/controllers/UI, approved schema/API decisions, migration/data policy, accounting/security/UOM/concurrency invariants, targeted tests, wider regression tests, Build/CI commands, stop conditions, and mandatory final MD Implementation Report. No Merge/Deploy.

## Multiple UOM/Barcode
Do not start until PR-UOM-1 and PR-PROD-LIFE-1 reports are reviewed. Decompose backend master-data contract, Product UX, POS UOM selection, workbook round-trip and tests so atomic barcode namespace remains single source of truth.

## Durable Imports
Do not start until workbook contract and cost policy are stable. Decompose job infrastructure separately from Product Catalog domain apply and Inventory Opening domain apply. Worker infrastructure must not own accounting posting.

## Inventory Workspace
Decompose server-side query API, DataTable UX, export/drilldown and later Reserved/Available additions. Do not expose cost inference or inaccessible warehouses.

## Serial/Lot/Expiry
Require an approved tracking data model and transaction integration matrix before code. Decompose foundation, receipts/transfers/issues/sales/returns, stocktake, UX/reporting. Do not alter valuation implicitly.

## Reservations
Require canonical reservation lifecycle and overcommit policy decision. Decompose reservation domain first, then source integrations, then workspace/POS visibility. Reservation alone never moves stock/GL.

## Stock Requests
Decompose request/approval domain separately from fulfillment adapter into Stock Permit. Partial/idempotent fulfillment required.

## Low Stock
Decompose warehouse planning settings, query/signal service, Low Stock Center, transfer/purchase suggestions. No automatic PO in initial scope.

## Movement Drilldown
Create central source resolver/authorization contract before UI links. New sources register rather than add scattered conditionals.

## Mandatory report
Each Claude Code PR returns MD with completed work, changed files, migrations/API/schema, tests/results, Build/CI, security/accounting/UOM/concurrency evidence, risks/remaining, deviations, Branch/PR/Base SHA/Head SHA, next step. ChatGPT reviews the report before any subsequent PR or merge decision.