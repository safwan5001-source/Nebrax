# PAY-V2-3 — Payment Gateway Foundation — Implementation Report

## Summary

Implements the minimum secure Payment Gateway Foundation (Layer C in the approved Payment Methods V2 document). Provider/integration configuration is now a tenant-scoped `PaymentGateway` record. `PaymentMethod` remains the only business-facing payment-method master. PAY-V2-2 channel availability is unchanged. No journal, provider SDK, checkout, or webhook-processing behavior was added.

Status: **IMPLEMENTED ON PR — NOT MERGED — NOT DEPLOYED**

## Architectural decisions

- `PaymentMethod != PaymentGateway`. Gateways are not payment methods and are not a Store-owned method master.
- Canonical layers match PAY-V2-2 and neighboring tenant configuration:
  - model: `App\Models\PaymentGateway` (`BaseModel` + `CompanyWide` + `TenantScope`)
  - service: `App\Services\PaymentGatewayService` (existing `app/Services` layer; no new `app/Services/Payments` directory)
  - API serialization: `App\Http\Resources\PaymentGatewayResource`
  - schema: additive `payment_gateways` table
- Optional same-tenant `payment_method_id` only. No SalesChannel relation and no generic policy engine.
- Provider identity is a closed allow-list (`stripe`, `tap`, `paytabs`, `checkout`, `custom`) so future adapters can be added without stuffing credentials into `payment_methods`.
- Environment is `sandbox|live`. Multiple gateways per tenant are allowed; uniqueness is `(tenant_id, name)`.
- HTTP route registration in `routes/api.php` was **not** added in this PR. PAY-V2-2 also shipped as a service/model foundation without new payment routes. The serialization contract lives on the Resource so a later admin API can reuse it without changing the model.
- Inbound provider webhook *processing* and PaymentIntent/idempotency execution are deferred. The foundation stores an encrypted `webhook_secret` for a future receiver. Existing Public API idempotency remains the intended later checkout pattern; no new idempotency table was invented.

## Security model

- Tenant authority comes only from `TenantContext`. Client-supplied `tenant_id` is rejected when it does not match the active context.
- Direct model `saving` and the service both enforce the active tenant.
- `payment_method_id` is resolved under `TenantScope`; a foreign-tenant UUID cannot be linked.
- RBAC catalog was not expanded. When HTTP routes are added later they should reuse `payments.view` / `payments.manage` beside the existing payment-method routes, not a weaker new permission invented here.
- No `withoutGlobalScope(TenantScope::class)` in this diff.

## Tenant Isolation enforcement

- `TenantScope` on every query.
- Service `requireTenant()` / `assertSameTenant()`.
- Model `saving` rejects missing context, forged `tenant_id`, and cross-tenant `payment_method_id`.
- Tests cover cross-tenant read/update/delete, forged tenant id, forged payment-method link, and missing TenantContext.

## Secrets handling

Canonical repository pattern reused: Eloquent `encrypted` / `encrypted:array` cast (application key), same as `WebhookEndpoint`.

- Columns: `secret_key`, `webhook_secret`, `extra_credentials`.
- Model `$hidden` excludes all three from `toArray()` / `toJson()`.
- `PaymentGatewayResource` never emits raw secrets. It only exposes `has_secret_key`, `has_webhook_secret`, `has_extra_credentials` plus non-secret fields (`publishable_key`, `merchant_reference`).
- `PaymentGatewayService::providerCredentials()` decrypts for a future provider adapter only and is tenant-guarded. It is not used by the Resource.
- Updates that omit secret fields leave existing secrets in place.
- Tests assert the raw database value is not plaintext.

## Changed files

- `database/migrations/2026_09_15_010000_create_payment_gateways_table.php`
- `app/Models/PaymentGateway.php`
- `app/Services/PaymentGatewayService.php`
- `app/Http/Resources/PaymentGatewayResource.php`
- `tests/Feature/PaymentGatewayFoundationTest.php`
- `tests/Feature/PaymentGatewayTenantGuardTest.php`
- `docs/plans/payments/AWJ_PAY_V2_3_IMPLEMENTATION_REPORT.md`

Unchanged by design: `PaymentMethod`, `PaymentMethodResource`, `PaymentMethodChannelAvailabilityService`, `PaymentService`, payment reversal, POS settings, `routes/api.php`, `Rbac`, journals.

## Tests added

`PaymentGatewayFoundationTest`

- create/read without exposing secrets in model serialization, JSON, Resource, or raw DB storage
- Tenant A cannot read/update/delete Tenant B configuration
- cannot link another tenant's PaymentMethod
- missing TenantContext fails
- non-secret updates do not wipe secrets
- PAY-V2-2 `available_online` fallback and `PaymentMethodResource` shape remain unchanged
- create/update/delete produce zero `Payment` / `JournalEntry` / `JournalLine` rows

`PaymentGatewayTenantGuardTest`

- direct model write cannot reference another tenant's PaymentMethod
- direct model write cannot forge `tenant_id`
- direct model write without TenantContext fails

## Focused test results

This Grok environment cannot execute the AWJ PHPUnit suite locally. Verification depends on GitHub Actions SQLite + PostgreSQL jobs for PR #770.

## SQLite CI result

Pending GitHub Actions at report authoring time.

## PostgreSQL CI result

Pending GitHub Actions at report authoring time.

## Build/CI status

PR #770 opened against `main`. CI not claimed green in this report.

## Accounting / security / tenant-isolation impact

- Accounting: none. No journal write path, no PaymentService change, no reversal change.
- Security: secrets encrypted at rest and excluded from serialization.
- Tenant isolation: scoped queries plus service and model write guards.

## Risks / remaining work

1. Admin HTTP routes in canonical `routes/api.php` are not wired yet. This environment cannot safely patch that large file; routes were not moved into a Provider as a workaround.
2. No inbound webhook receiver, signature verification, or provider adapter.
3. No PaymentIntent / checkout orchestration / Store UI.
4. `publishable_key` is treated as non-secret (Stripe-style publishable identifier). Provider-specific public vs secret field maps can be tightened when the first adapter is implemented.
5. Linking is 1 gateway → optional 1 PaymentMethod. Many methods per gateway can be added later if Store checkout needs it.

## Explicit non-goals

- real provider API calls / SDKs
- checkout / PaymentIntent execution
- webhook processing
- capture/refund provider flows
- fees, merchant commissions, customer surcharges
- VAT/ZATCA changes
- journal/accounting changes
- POS redesign
- Store UI
- unrelated refactoring

## Tool-limitation check

Did any tool limitation influence where or how this change was implemented?

- Model, service, resource, migration, and tests: **No.** They sit in the same canonical layers as PAY-V2-2 and `WebhookEndpoint`.
- HTTP route registration: **Yes, deferred — not worked around.** `routes/api.php` is the canonical registration point. This connector has previously destroyed that file with a placeholder when replacing it. Routes were not moved to `TenancyServiceProvider` or a new route file. They remain a follow-up on the canonical file.

## Identifiers

- Repository: `safwan5001-source/Nebrax`
- Branch: `feat/pay-v2-3-payment-gateway-foundation`
- PR: [#770](https://github.com/safwan5001-source/Nebrax/pull/770)
- Base SHA: `b9d6909e739e715cded56bbfb9db69c40068bc58` (`main` at branch creation; includes PAY-V2-2 merge `27db564043171693e114fe854f457fee6f103323`)
- Head SHA at report authoring: `0df7a509da0f26d4b86ba8e0fb316b0ffcdc31c5` (implementation + tests; this docs commit follows)

## Next recommended step

1. Wait for PR #770 SQLite + PostgreSQL CI.
2. If CI is green, review and merge only with Safwan's explicit approval.
3. PAY-V2-4 remains fees accounting design — not gateway adapters.
4. A later narrow PR may register `payment-gateways` CRUD on `routes/api.php` next to `payment-methods`, using `payments.view` / `payments.manage` and `PaymentGatewayResource`.

Do not merge or deploy without owner approval.
