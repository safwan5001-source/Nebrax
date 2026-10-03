# DLV-HUB-PROJECTION-1 — Implementation Report

STATUS: in review, not merged
DATE: 2026-10-03

## Outcome

Operational Delivery Hub projection only. A tenant-owned row, the accepted §4 state machine, and the accepted permanent §6 identity. No invoice, payment, journal, VAT, revenue, COGS, stock movement, POS session, or financial transition.

## Repository evidence / root cause

Base is the squash of PR #1196, `13808e15cfea2ded9e64bcfd4c838971f7581b3b`. OD-HUB-STATES, OD-HUB-IDENTITY, and OD-DG-9-HUB are accepted. `DeliveryPlatformProfile` is company-wide. `external_order_reference` is not an identity. Branch allow-lists use `null` for unrestricted. PostgreSQL and SQLite do not treat NULL as equal in a unique index, so branch stays out of the provider key and a nullable provider id does not collapse manual rows.

## Approach chosen

One table `delivery_hub_orders`. One service. Two permissions added to `Rbac::PERMISSIONS` only: `delivery_hub.view` and `delivery_hub.operate`. They are not granted to accountant, staff, or self_service. Owner and admin already have `*`. Intake and transitions are `operate`. Reads are `view`. No `sales.pos` gate. Database unique indexes back the provider triple and the tenant UUID. A unique violation retries inside a new transaction and then replays or conflicts. `reject` writes `cancelled_before_post`.

## Why this approach fits AWJ

It reuses tenant scope, branch allow-lists, and the existing 404 fail-closed habit. It does not open a second ledger and does not start DLV-HUB-1.

## Changed files

- `database/migrations/2026_10_29_010000_create_delivery_hub_orders_table.php`
- `app/Models/DeliveryHubOrder.php`
- `app/Services/DeliveryHub/DeliveryHubOrderService.php`
- `app/Services/DeliveryHub/DeliveryHubConflictException.php`
- `app/Services/DeliveryHub/DeliveryHubNotFoundException.php`
- `app/Http/Controllers/Api/DeliveryHubOrderController.php`
- `app/Http/Controllers/Api/ApiController.php` (maps hub 404 and 409)
- `app/Http/Requests/StoreDeliveryHubOrderRequest.php`
- `app/Http/Requests/TransitionDeliveryHubOrderRequest.php`
- `app/Http/Resources/DeliveryHubOrderResource.php`
- `app/Support/Rbac.php`
- `routes/api.php`
- `tests/Feature/DeliveryHubProjectionTest.php`
- `docs/autonomous-engineering/TASK-QUEUE.md`
- `docs/autonomous-engineering/CURRENT-STATE.md`

## Tests and exact results

Focused test: `tests/Feature/DeliveryHubProjectionTest.php`. PHP is not available in this workspace. SQLite, PostgreSQL, and broader CI are recorded from GitHub Actions on the final head, not from a local run.

## Build / lint / typecheck

No web or package change. CI is the PHP verification.

## CI

Recorded in the PR comment for the final head. This file does not embed that commit hash.

## Pre-merge review

- PRE_MERGE_REVIEW: recorded as a PR comment after CI on the final head
- Reviewed Head SHA: the PR comment, not this file
- Findings / resolution: see the PR comment

## Merge

- Merge status: not merged
- Merge SHA: none

## Post-merge review

- POST_MERGE_REVIEW: not started
- Reviewed Merge SHA: none

## Known limitations

An actor who can see the unrouted queue is unrestricted inside the tenant, so they can access every branch. A branch-restricted actor cannot see that queue, so the destination check on unrouted routing is an unknown or foreign branch id, not a same-tenant restricted operator. Reopen, recreate, and reassignment after cancel are not implemented. Full DLV-HUB-1 stays blocked on DG-8-IMPORT and DG-3.

No production deploy.
