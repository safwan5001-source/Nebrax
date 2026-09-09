# Commerce Trusted Partner Selection — Security Boundary

**Status:** Binding follow-up constraint from PR-COM-6A / PR #749.

## Purpose

PR-COM-6A introduces `CommerceOrderService::create(..., bool $trustedPartnerSelection = false)` to remove the unsafe assumption that absence of `CustomerContext` implies a trusted staff/internal caller.

The default is deliberately fail-safe: `false`.

## Locked rule

`trustedPartnerSelection` is a **server-side trust signal**, not authorization data supplied by a client.

It MUST NEVER be derived from, copied from, or controlled by any HTTP request body, query parameter, header, cookie, route parameter, public/mobile payload, guest checkout input, or other caller-controlled data.

A public/guest Commerce path MUST leave `trustedPartnerSelection` at `false`. In that state, caller-supplied `partner_id` is not read as ownership authority and the resolved Partner remains `null` unless an authenticated `CustomerContext` supplies a linked Partner.

For an authenticated customer, `CustomerContext` remains the sole authority for customer identity and linked Partner regardless of the flag.

A future staff/internal Commerce path MAY pass `trustedPartnerSelection: true` only after the server has independently established a trusted staff/internal principal and the required authorization (for example, the applicable staff guard/RBAC permission). Merely lacking `CustomerContext` is never sufficient evidence of trust.

## Mandatory review point for COM-7 / public API

When Commerce HTTP/public/mobile/checkout routes are introduced, review every call to `CommerceOrderService::create()` and verify that no request-controlled value can reach `trustedPartnerSelection`.

Forbidden pattern (conceptual):

```php
$service->create($data, $items, trustedPartnerSelection: $request->boolean('trusted'));
```

The public/guest path must use the safe default (`false`) or an equivalent server-controlled constant. Any staff path that sets `true` must be protected by explicit server-side principal and authorization checks before calling the service.

## Scope

This note does not implement COM-6B ownership authorization or COM-6C snapshots. It records the security invariant that later Commerce API/checkout work must preserve.
