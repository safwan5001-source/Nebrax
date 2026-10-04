# DLV-FINANCIAL-ROLE-CONFIG-1

**Task:** DLV-FINANCIAL-ROLE-CONFIG-1
**Base SHA:** `5f34585b2cd84e41360b9b9fa7f7250cdd0d1c0a`
**Nature:** configuration and a fail-closed evaluator. No imported-order invoice command.

DG-3 is not closed. OD-DG-3-POSTING-GATE stays accepted as merged in PR #1207 (`aea1e9290503da1325be5713654dd98ad4beb5c8`). This file does not embed its own head SHA.

## Schema

The four dimensions are columns on `delivery_platform_profile_versions`, which is already append-only. Existing rows default to `unknown`. There is no branch-override column for them. `delivery_platform_version_overrides` still changes operational `collection_mode` only, and that operational mode is not `collection_role`.

`effective_to` is not stored. The next version's `effective_from` is the end of the previous meaning. A pinned `version_id` does not change.

## Enums

| Field | Values | Default |
|---|---|---|
| `selling_role` | `unknown`, `merchant_seller`, `platform_seller` | `unknown` |
| `invoice_responsibility` | `unknown`, `merchant_issues`, `platform_on_behalf`, `platform_as_supplier` | `unknown` |
| `collection_role` | `unknown`, `platform_collects_for_merchant`, `merchant_collects`, `platform_collects_as_seller` | `unknown` |
| `merchant_vat_status_at_supply` | `unknown`, `registered`, `not_registered` | `unknown` |

`platform_seller` holds both report values `platform_deemed_supplier` and `platform_principal`. Neither may use the restaurant invoice. `split_meal_and_fee` is not a fifth invoice mode: the meal, if it is the merchant's invoice, is `merchant_issues`. The fee is not authorized here. The tenant's current `vat_number` is not read.

## Evidence

`financial_evidence_ref` is a string of at most 500 characters. No contract file is stored. `financial_verified_at` is set by the server when a non-unknown snapshot is written. `created_by` is the existing version actor. A legal change must send `financial_evidence_ref` in that request. An operational-only change copies the previous legal snapshot, including its verification time. An explicit `null` on one of the four role fields is no opinion: create stays `unknown`, and update keeps the current value. It is not a validated value that later fails in the domain.

## Evaluator

`DeliveryFinancialRoleGate` returns `decision` `blocked` or `eligible`, `posting_authorized: false`, and reason codes:

- `selling_role_unknown`, `invoice_responsibility_unknown`, `collection_role_unknown`, `merchant_vat_status_unknown`
- `platform_seller_blocked`, `platform_issues_as_supplier_blocked`, `platform_on_behalf_blocked`
- `platform_collects_as_seller_blocked`, `merchant_not_registered_blocked`
- `configuration_compatible`, `posting_not_authorized`

`eligible` means the stored shape is merchant seller, merchant issues the invoice, collection is for the merchant or by the merchant, and the supply-time VAT status is `registered`. It does not authorize `InvoiceService`. The UI must not say ready for financial posting.

## Permissions and isolation

Writes stay on `company.manage`. Reads stay on `invoices.view`. No new permission. The gate throws if the version tenant is not the active tenant. A branch mismatch does not reveal another tenant's version.

## What stays blocked

Tax point, the invoice command, commission, settlement, reconciliation, refunds, connectors, and webhooks. Manual POS checkout and the operational Hub are unchanged.

PRE_MERGE_REVIEW is stamped on the PR for the exact head after CI. Not merged. Not deployed.
