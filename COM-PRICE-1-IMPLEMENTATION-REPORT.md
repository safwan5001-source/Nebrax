# COM-PRICE-1 Implementation Report

## Status

Implemented on the dedicated branch and statically verified. The runnable Laravel
test harness could not be provisioned in this environment because `xmllint` is
missing and Packagist access is blocked (HTTP proxy 403), so focused and regression
PHPUnit execution remains for CI.

## What was implemented

- Added an optional `SalesChannel.default_price_list_id` relationship to the
  existing tenant-owned `PriceList` model.
- Added model-level assignment validation which retains `TenantScope`, accepts
  assignment only when the channel belongs to the active tenant and the selected
  list is active in that tenant, and permits explicitly clearing the assignment.
- Extended `CommercePriceResolver` to select an active channel default list only
  when no applicable Partner list was selected.
- Extended PriceList deletion protection to require clearing channel assignments
  before deletion.
- Added focused resolver and negative tenancy/lifecycle tests.
- No SalesChannel administration endpoint currently exists. Persistence/model
  support is therefore the minimal safe administration surface; no new UI or broad
  API architecture was introduced.

## Exact pricing precedence after implementation

1. An applicable active Partner/customer PriceList selected by the existing POS
   customer-list policy.
2. Otherwise, the current SalesChannel's active, same-tenant default PriceList.
3. If the selected list has an explicit item for the requested product and unit,
   that integer minor-unit amount is returned.
4. Otherwise, for the base unit only, `Product.sale_price` is returned.
5. Otherwise, an alternative UOM is unresolved and not purchasable in that price
   context.

An applicable Partner list remains selected ahead of the channel list even when it
has no matching item, preserving the established Partner-list behavior before the
base-unit fallback.

## Database/migration changes

- Added nullable UUID `sales_channels.default_price_list_id`.
- Added a foreign key to `price_lists.id` with restricted deletion.
- The migration uses Laravel schema operations used elsewhere in the repository and
  is designed for both PostgreSQL and SQLite.

## Files changed

- `app/Models/SalesChannel.php`
- `app/Models/PriceList.php`
- `app/Services/Commerce/CommercePriceResolver.php`
- `app/Services/PriceListService.php`
- `database/migrations/2026_09_22_010000_add_default_price_list_to_sales_channels.php`
- `tests/Feature/CommercePriceResolverTest.php`
- `COM-PRICE-1-IMPLEMENTATION-REPORT.md`

## Tenant Isolation protections

- Assignment lookup deliberately retains `TenantScope`; a known foreign UUID is
  rejected rather than queried outside the active tenant.
- Assignment rejects an explicit channel tenant which differs from active
  `TenantContext`.
- Inactive, missing, deleted, and cross-tenant lists cannot be newly assigned.
- Resolution loads the channel through `TenantScope` and loads its configured list
  through the scoped relationship.
- A non-null configured relationship which cannot be resolved fails closed instead
  of falling through to `Product.sale_price`.
- Negative tests cover cross-tenant/inactive assignment and a deliberately corrupted
  cross-tenant stored reference at resolution time.

## Alternative-UOM pricing behavior

Alternative units resolve only through an explicit `PriceListItem` for that exact
unit on the selected applicable list. No conversion factor, base-unit price, client
amount, or inferred/copy price participates. A missing item or inactive channel list
returns unresolved for an alternative UOM.

## Tests executed and exact results

- `git diff --check` — passed with no output.
- `php -l` on every changed PHP source, migration, and test file — 6 files passed
  with “No syntax errors detected”.
- `bash setup.sh` — not run to completion: stopped at the prerequisite check because
  `xmllint` is not installed.
- `PATH="/tmp/nebrax-bin:$PATH" bash setup.sh` with a temporary external prerequisite
  shim — provisioning stopped before tests because Composer could not download
  `https://repo.packagist.org/packages.json` (`curl error 56`, CONNECT tunnel HTTP
  403). No repository file was modified by the shim.
- Focused CommercePriceResolver, PriceList, Commerce, and POS PHPUnit suites — not
  executable locally because the Laravel harness and dependencies could not be
  provisioned.

## Build/CI status

Local PHP syntax and patch-integrity checks pass. Full build and PHPUnit status are
pending CI after the PR is opened; no local full-suite claim is made.

## Risks

- Runtime PHPUnit coverage has been authored but not executed in this environment.
- The repository uses application/model guards for tenant ownership on comparable
  relationships; the foreign key itself proves reference existence and deletion
  behavior, while the scoped model guard proves same-tenant assignment.

## Anything remaining

- Run focused CommercePriceResolver tests, then PriceList/Commerce/POS regressions on
  a provisioned Laravel test harness.
- Inspect relevant CI failures only if CI reports any.
- No UI/API administration work remains in this scope because no existing safe
  SalesChannel mutation endpoint was found to extend.

## Branch

`feat/com-price-1-channel-pricing`

## PR number/link if created

Pending at report preparation; recorded in the delivery response after PR creation.

## Base SHA

`8038c95b7a6f8bf38de4e6b4dab4787117f826bd`

## Head SHA

Implementation commit: `1e8a96a785bd52af81605713ccbea74e41a6287e`.
The final branch head also contains this report and is recorded in the delivery
response/PR metadata (a commit cannot embed its own content-derived SHA).

## Recommended next step

Let CI execute the focused and relevant regression suites, inspect only a relevant
failing job/log if necessary, and obtain Safwan's explicit approval before any merge
or deployment.
