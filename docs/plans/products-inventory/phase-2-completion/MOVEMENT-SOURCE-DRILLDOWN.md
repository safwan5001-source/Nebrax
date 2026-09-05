# Inventory Movement Source Drilldown

**Status:** PLANNED

## Goal
Make each inventory movement operationally explainable from the Inventory Workspace while preserving authorization and cost redaction.

## Contract
Movement source_type/source_id remains durable domain provenance. A resolver maps supported source classes to safe labels/routes/resources. Unknown/legacy source remains displayable as movement without unsafe generic model loading.

## Security
TenantScope first; then source-specific branch/warehouse authorization. Cost fields use PR-INV-1 policy. A movement visible in an allowed warehouse must not automatically reveal an otherwise inaccessible source document.

## Supported domains
Inventory Opening, invoice/sale, purchase receipt, sales/purchase returns, Stock Permit, Stocktake and future tracked/reservation-related stock-moving sources as applicable. Reservation itself is not a movement source because it does not move stock.

## UX
From movement row: source type/number/date, safe status/context and explicit Open Source action when authorized. No duplicated document editor inside inventory history.

## Extensibility
New stock-moving domain must register source resolution and lifecycle classification as part of DoD. Avoid switch statements scattered across controllers/resources.

## Acceptance
Every known source resolves deterministically; inaccessible source returns safe non-leaking behavior; unknown source does not crash; no drilldown action changes stock/GL; cost redaction is preserved.