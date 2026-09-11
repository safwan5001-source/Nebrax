# PAY-V2-2 — Channel Availability Foundation — Implementation Report

## Scope

Implements the minimum shared payment-method availability abstraction required by the approved Payment Methods V2 plan for Commerce sales channels, without changing existing POS behavior.

## Baseline

- Base branch: `main`
- Base SHA: `76f54478cb26d63920cbe15ba54cc89a5dfb1c3e`
- Branch: `feat/pay-v2-2-channel-availability`

## Architecture

- The existing tenant-scoped `PaymentMethod` remains the single payment-method master.
- The existing `available_online` flag remains the backward-compatible fallback when no channel-specific override exists.
- `PaymentMethodChannelAvailability` stores only an explicit enable/disable override for one existing `SalesChannel`.
- No duplicate Store-owned payment-method master is introduced.
- `PaymentMethodChannelAvailabilityService` lives in the repository's existing canonical `App\Services` layer; no new service directory or CI/deploy allow-list exception is introduced.
- POS is deliberately excluded from this resolver. Existing `PosSettings` (`all_active` / `only` / `none`, enabled IDs, server enforcement) remains authoritative and unchanged.
- Inactive payment methods and inactive sales channels are never available even when an override says enabled.
- Model-level tenant-scoped reference guards prevent direct cross-tenant policy writes; the service also rejects cross-tenant objects and missing TenantContext.

## Changed Files

- `database/migrations/2026_09_14_010000_create_payment_method_channel_availabilities_table.php`
- `app/Models/PaymentMethodChannelAvailability.php`
- `app/Services/PaymentMethodChannelAvailabilityService.php`
- `tests/Feature/PaymentMethodChannelAvailabilityTest.php`
- `tests/Feature/PaymentMethodChannelAvailabilityTenantGuardTest.php`
- `docs/plans/payments/AWJ_PAY_V2_2_IMPLEMENTATION_REPORT.md`

## CI Finding and Fix

- Initial CI #4638 stopped before tests because `app/Services/Payments` was not in the repository assembly allow-list.
- The failure was treated as an architecture-placement signal, not worked around by expanding CI/deploy configuration.
- The service was moved to the already-established `app/Services` layer and test imports were updated accordingly.
- No CI/deploy allow-list files were changed.

## Explicit Non-Goals

No gateway/provider configuration, credentials, PaymentIntent, fees/surcharges, VAT/ZATCA changes, journal/accounting changes, POS redesign, Store checkout integration, public API expansion, or unrelated refactoring.

## Verification Required

Run focused channel-availability tests first, then the repository-required SQLite and PostgreSQL CI. Because this touches tenant isolation and future payment-channel selection, both database lanes are required before merge readiness.

## Risks / Follow-up

- This PR is foundation only. A later Store/customer consumer should resolve its trusted tenant and `SalesChannel` server-side, then call this service; it must not accept tenant/channel authority from untrusted client input.
- PAY-V2-3 remains the separate gateway foundation phase.
- `available_online` can be retired or reinterpreted only under a separately approved migration/backward-compatibility plan; this PR intentionally preserves it.

## Merge / Deploy

Do not merge or deploy without explicit owner approval.
