# DLV-CONNECTOR-CORE-1 — Operational connector ingestion

**Status:** IMPLEMENTED — review fixes pushed on the same PR. Not merged. No deploy. PRE_MERGE_REVIEW is not asserted by this file; it is PASS only after both CI jobs on the commit SHA are green and the five review threads are resolved.
**Base:** `origin/main` at the time of the branch (`d787dfb56739464a5ff36f97fe883fc2838a18bd` unless the PR records a newer base).
**Scope:** Operational ingestion and security only. No imported financial posting.

## Why this task was dependency-ready

`DLV-CLOSE-1` is merged (PR #1236, `afe223cb654154fa55234ff2e360233bbc933ec3`) and is an ancestor of current `origin/main`. The Delivery Hub projection (`DeliveryHubOrder` / `DeliveryHubOrderService`) already accepts operational orders with permanent identity:

`tenant_id + delivery_platform_profile_id + provider_order_id`

and the accepted client/event UUID path when there is no provider order id. Cancellation does not delete the row, so the provider order id stays reserved.

PASS-8 explicitly allows `DLV-CONNECTOR-CORE-1` only as a projection/intake security task. It does not authorize imported financial behavior, and this implementation does not add any. DG-3 evidence, policy derivation, VAT projection, accounting representability, provider readiness, and the financial-transition command stay open and untouched.

The credential store reuses the encrypted cast already shipped on `WebhookEndpoint` and `PaymentGateway`. Signature verification reuses `WebhookSignature` (HMAC-SHA256 over `{timestamp}.{rawBody}`, header `X-AWJ-Signature: t={ts},v1={hex}`). That is an AWJ ingestion contract for a future adapter. It is not a claim about HungerStation, Keeta, Jahez, Mrsool, Ninja, or The Chefz.

DG-7 (external vault versus app-key encryption) is not closed and no vault is introduced. A new secret architecture would have stopped this task. The accepted in-repo pattern was sufficient, so the gated vault choice stays excluded.

## Operational boundary

```
signed adapter/caller
  → POST /api/delivery-connectors/{account}/events
  → trusted account mapping
  → HMAC + timestamp window
  → replay / conflict decision
  → DeliveryHubOrderService intake or transition
  → Delivery Hub projection
```

The endpoint is outside the session middleware. A bearer token is ignored for tenant selection.

No connector path calls `InvoiceService`, `PaymentService`, `LedgerService`, or `InventoryService`. Tests assert invoice, payment, journal, stock movement, delivery-invoice context, and commerce-order counts stay unchanged.

Hub states stay non-financial. No Hub state posts accounting.

## Tenant resolution

Authority is the `delivery_connector_accounts` row, loaded by its own id before any tenant-owned query. `tenant_id` on that row is written only from `TenantContext` at configuration time and cannot be forged on save.

A `tenant_id` inside the signed body is never used to select a tenant. If it is present and differs from the account tenant, ingestion fails closed (`mapping_mismatch`). The same rule applies to `external_store_id` and to an asserted `branch_id`.

Missing account id and invalid signature return the same `invalid_signature` response. No Hub row is written.

The store mapping is globally unique on `(platform_key, external_store_id)`. A second tenant cannot claim a store id already mapped for that platform key (`mapping_ambiguous`). The mapping columns are immutable after create. Disable does not release the store id.

A duplicate insert is rejected inside a savepoint. On PostgreSQL a unique violation aborts the surrounding transaction unless it is rolled back to that savepoint. `RefreshDatabase` wraps each test in one transaction, so the rejection must not poison the next request.

## Branch routing

Destination branch is the branch stored on the account, or null for the accepted unrouted state. It is not taken from the payload, the clock, the cashier, or an open POS session.

A branch-restricted user cannot create an unrouted account (`branch_required`) and cannot view, rotate, or disable an account whose branch they cannot access, including unrouted accounts. Hub visibility is unchanged: restricted users do not see unrouted or foreign-branch orders.

## Credential and security model

- Secret is generated on the server (`dsec_` + 32 random bytes).
- Stored with the `encrypted` cast. The plaintext is not returned by later reads.
- Returned once, on create and on rotate, then only `secret_prefix` (same non-secret display rule as webhooks).
- `secret_version` increments on rotate. Attempts record the version, not the secret.
- Tenant-scoped. Another tenant receives 404 on show/rotate.
- Status is only `configured` or `disabled`. There is no Connected, Live, or Synced status.
- Creating an account does not activate a catalog platform and does not insert HungerStation, Keeta, Jahez, Mrsool, Ninja, or The Chefz profiles by itself. Tests that need a profile use the existing manual platform API.
- Permissions `delivery_connector.view` and `delivery_connector.manage` are owner/admin via `*`. They are not on accountant or staff. They are not a posting permission.
- Ingestion logs do not include the secret or the signature header. The service does not write application logs of the raw body.

## Authentication abstraction

Provider-neutral AWJ HMAC only:

- header `X-AWJ-Signature: t={unix},v1={hex}`
- signed input `{timestamp}.{rawBody}` via `WebhookSignature`
- tolerance 300 seconds for a new event
- `hash_equals` comparison
- rotate invalidates the previous secret immediately

An already stored event id still replays after the timestamp window, because the durable attempt is the replay record. A new event with an expired timestamp is rejected and does not consume the event id.

No OAuth, no provider-specific signature, and no production credential is implemented.

## Idempotency and replay

Attempt identity is `(delivery_connector_account_id, event_id)`.

- Same event id + same raw checksum: return the stored outcome. No second Hub order.
- Same event id + different raw body: `409 payload_conflict`. The original attempt is kept.
- Same provider order id + same authoritative content (`provider_order_id`, `external_order_reference`, `intake_payload`) + new event id: same Hub order. A forward Hub action may apply. A backward action does not.
- Same provider order id + different authoritative content: `409 payload_conflict`. No second order and no content mutation.
- No provider order id: Hub `idempotency_key` is the event UUID. A new UUID is a different operational order. It does not retarget an existing provider order id.
- Cancel transitions to `cancelled_before_post` and leaves `provider_order_id` in place. A later event for that id hits the same row.
- Concurrent inserts on the same event id: the loser replays when the raw checksum matches, otherwise conflicts. The Hub unique key still prevents a duplicate provider order.

Authoritative checksum intentionally excludes `hub_action` and `provider_status`, so an operational action can be delivered without pretending the order body changed. `provider_status` on the Hub row stays at the first intake. Later events do not overwrite it, because this task does not invent an ordering clock from `occurred_at` (that field is retained only inside the encrypted raw body and is not a tax point).

Out-of-order Hub actions use the existing transition table. An illegal edge throws, the attempt is stored as `state_not_applied` with HTTP 200, and the row state is unchanged. HTTP 200 is used only after that attempt row is saved, so a retry will not create another order. A failed database write rolls back and is not acknowledged.

Transient configuration failures (inactive actor, inactive profile, inactive or inaccessible branch) return an error and do not consume `event_id`, so a later retry can succeed. Contradictory mapping claims are stored and stay failed.

## Hub integration

`DeliveryHubOrderService::intake` and `::transition` are the only projection writes. CommerceOrder is not created. There is no second delivery-order model.

The actor is the user who configured the account (`configured_by`), and only if that user is still active and allowed to see the destination branch. The provider does not choose the actor.

## Raw payload boundary

`delivery_connector_attempts.operational_raw_body` stores the raw JSON encrypted, plus `raw_checksum` and the optional authoritative checksum. This is for replay, conflict detection, and later operational debugging.

It is not the PASS-8 evidence snapshot. There is no legal event, supplier, VAT classification, supersession chain, policy version, or tax-point timestamp. `occurred_at` is not interpreted. `DG-3-EVIDENCE-SNAPSHOT` stays open.

## Accounting and inventory

Negative guarantees covered by `DeliveryConnectorCoreTest`:

- no Invoice
- no Payment
- no JournalEntry
- no StockMovement
- no `DeliveryInvoiceContext` (the platform-collected clearing path is not entered)
- no CommerceOrder

No platform receivable clearing, revenue, VAT, AR, COGS, settlement, commission, reconciliation, or refund accounting is created.

## Backward compatibility

Existing manual Hub intake, manual POS delivery checkout, POS close/Z-report, ordinary POS, and outbound webhook subscriptions are not modified. New routes and two additive tables only. No public Commerce or OpenAPI contract is changed.

POS checkout tests in this sandbox fail before any connector code, on the existing ZATCA C14N step, because `xmllint` is not installed. That failure also happens for an ordinary cash sale with no delivery platform. CI installs `libxml2-utils` and remains the proof for that suite.

## Tests

SQLite, `php artisan test --filter=DeliveryConnectorCoreTest`:

- 11 passed, 174 assertions

Covered:

1. mapped store ingestion, encrypted secret, no financial rows, no provider profile auto-enable
2. missing account fails closed
3. foreign tenant claim fails closed; other tenant cannot read or rotate the secret; a foreign bearer does not select the tenant
4. foreign branch claim fails closed; branch-restricted user cannot see the order, the unrouted order, or the connector; cannot rotate or disable it
5. invalid signature and expired timestamp
6. replay of the same event, including after the timestamp window
7. same order + same payload is idempotent; different payload conflicts; a new UUID cannot fork an existing provider order id
8. out-of-order `accept` does not regress `preparing`
9. cancellation does not release `provider_order_id`
10. rotate and disable do not duplicate the order or enable a provider
11. manual Hub intake and staff denial are unchanged

Also passed on SQLite (70 tests, 752 assertions):

- `DeliveryHubProjectionTest`
- `BranchIsolationGuardTest`
- `WebhookSignatureTest`
- `DeliveryPlatformApiTest`
- `DeliveryFinancialRoleGateTest`
- `DeliveryPlatformProfileDomainTest`

## SQLite / PostgreSQL

SQLite: the tests above were executed.

PostgreSQL: not executed in this sandbox. `pg_ctl` refuses to run as root, and the sandbox rejects `setuid` / `setgid` / `su` / `runuser`, so a local server could not be started. The migrations use the same Laravel schema vocabulary as the existing Hub and webhook tables (`foreignUuid`, `string`, unique indexes, nullable timestamps). CI's `pgsql` matrix job is the PostgreSQL proof and must be green on the exact head before merge.

## Reviews

### Implementer self-review

- Tenant comes from the account row, not the body.
- Signature is checked before tenant-owned lookups and before the disabled short-circuit reveals a stored event.
- Branch-restricted operators cannot manage another branch's credential.
- Secrets are encrypted and hidden. Attempt bodies are encrypted and hidden.
- Replay and conflict paths do not insert a second Hub order.
- Backward Hub actions do not change state.
- No accounting or inventory service is referenced.

### Reviewer review

- Global store uniqueness can tell a second tenant that a store id is already mapped (`409`). That oracle is required to fail closed on ambiguity and does not return the other tenant's secret or account id.
- `configured_by` couples ingestion to a user account. If that user is inactive, ingestion fails closed without burning the event id. There is no synthetic system user; adding one would be a new actor model.
- There is no operator dead-letter UI. Durable attempt rows are the recovery record. A manual replay console is out of scope.
- `state_not_applied` is HTTP 200 only after the attempt insert, so the caller stops retrying a regression without a second order.

### AWJ Guardian review

| Risk | Result |
|---|---|
| Provider-controlled tenant selection | Rejected. Body `tenant_id` cannot select the tenant. |
| Cross-tenant credential use | Show/rotate/list are tenant-scoped. Signature secret is per account. |
| Cross-branch ingestion | Destination is the mapped branch only. Foreign `branch_id` conflicts. Restricted users cannot see or manage the other branch. |
| Plaintext secret logging | No log of secret or signature header. Ciphertext at rest. |
| Replay bypass | Event id + raw checksum. Expired timestamp does not bypass a new event. |
| Duplicate Hub orders | Hub unique key plus attempt unique key. |
| State regression | Existing Hub edges. Illegal edge is stored as not applied. |
| UUID bypass of provider order id | New event UUID hits the provider-order unique key. |
| Accounting side effects | None. Counts asserted. |
| Inventory side effects | None. Counts asserted. |
| Accidental DG-3 evidence | Raw body is operational and encrypted. No tax-point schema. |
| Accidental provider enablement | No catalog status beyond `configured`/`disabled`. No provider connector. |

Unresolved P1/P2 in this scope: none.

## Remaining gates

Still open, and not closed by this PR:

- DG-3 tax-point evidence and the five PASS-8 implementation gates (`DG-3-EVIDENCE-SNAPSHOT`, `DG-3-POLICY-DERIVATION`, `DG-3-VAT-PROJECTION`, `DG-3-ACCOUNTING-REPRESENTABILITY`, `DG-3-FINANCIAL-TRANSITION`)
- DG-3-PROVIDER-READINESS
- DG-7 external vault, if a later task rejects app-key encryption
- DG-6-TRIGGER imported invoice command
- native provider tasks

## Provider readiness

| Provider | State |
|---|---|
| HungerStation | not enabled |
| Keeta | not enabled |
| Jahez | not enabled |
| Mrsool | not enabled |
| Ninja | not enabled |
| The Chefz | not enabled |

No Connected / Live / Synced status is written.

## Review fixes (same PR, after `3b40442`)

Codex left five open findings on `3b40442` (2 P1, 3 P2). All five are fixed in this commit. No new architecture, vault, provider adapter, or financial path was added.

| Finding | Fix |
|---|---|
| P1 secret rotation race | After `lockForUpdate`, the signature is verified again against `$locked->secret`. A secret that rotated after the unlocked read is rejected as `invalid_signature` and does not write an attempt or a Hub order. The attempt's `secret_version` is the locked row's version. |
| P1 application state | After `TenantContext` is set, and again inside the locked transaction before any write, `TenantApplicationService::statusFor('sales.pos')` must be `enabled`. `disabled` and `suspended` return `403 application_inactive` and do not consume `event_id`. This is the same capability the management routes already guard with `EnsureApplicationActive`. |
| P2 large JSON integers | Integer tokens outside the int64 range are preserved as `DeliveryConnectorJsonNumber` literals before decoding. They are not coerced to float. The authoritative checksum emits the literal unquoted, so it does not collapse with a JSON string of the same digits. The same wrapper later covers every JSON number. |
| P2 object versus list | Decoding keeps JSON objects as `stdClass` and JSON arrays as lists. The canonical encoder writes `{}` and `[]` differently, including nested values. Object key order is still sorted, so reordering keys is not a conflict. |
| P2 concurrent rotations | `rotateSecret` reloads the account with `lockForUpdate` inside a transaction before incrementing `secret_version`. Two callers that both observed version 1 commit versions 2 and 3. Only the latest secret verifies. |
| P1 subscription status (follow-up on the fix commit) | After the tenant context is set, and again inside the locked transaction, `PlanGate::subscriptionActive()` must pass. An expired trial/subscription returns `403 subscription_inactive` and does not consume `event_id`. Same gate as `EnsureActiveSubscription` on the management and Hub routes. |
| P2 numeric object keys (follow-up) | Object keys are ordered with `ksort(..., SORT_STRING)`. `"01"` and `"1"` are not treated as equal, so opposite insertion orders share one authoritative checksum. |
| P2 decimal literals (follow-up) | Every JSON number token is canonicalized as its original literal, not as an IEEE float. `1.0000000000000001`, `1.0`, `1`, `1e2`, and `100` stay distinct. A float that still survives decoding rejects the envelope. |
| P2 manual Hub numeric type (follow-up) | `plainValue()` returns a PHP integer, or a float when `json_encode(..., JSON_PRESERVE_ZERO_FRACTION)` reproduces the literal. A connector number `5000` adopts a manual numeric payload, `1.0` adopts a manual `1.0`, and both conflict with the same digits in a string. Lossy literals stay strings so they do not collapse. |
| P2 duplicate JSON members (follow-up) | Duplicate object keys, including escaped duplicates and nested objects, are rejected as `invalid_payload` before `json_decode()` keeps only the last value. |
| P2 manual object shape (follow-up on `35541a3`) | When a Hub order has no connector baseline, an object that would become a PHP list (`{}`, `{"0":"a"}`, or a nested empty object) is `payload_conflict`. No authoritative checksum is stored. Objects and lists Hub can represent, including `{"keep":"yes"}` and `["a"]`, still adopt. |
| P2 payload limit before HMAC (follow-up on `35541a3`) | `strlen($rawBody) > MAX_RAW_BYTES` (65536) returns `422 invalid_payload` before the account row is loaded and before `WebhookSignature::verify`. A body at the limit still reaches signature verification. |
| P1 cross-branch order reuse (follow-up on `1465de0`) | An existing Hub order is used only when its `branch_id` equals the connector mapping, including both null. A different branch returns `422 branch_unavailable` before baseline adoption or `hub_action`, and the attempt is not attached to the other order. |
| P2 deleted configurator (follow-up on `35541a3`) | Not implemented. See Decision Packet `DLV-CONNECTOR-OWNERSHIP-1`. |

The Hub row still stores a plain PHP array, so an empty object becomes an empty list in the Hub hash. Connector-to-connector comparison uses the authoritative checksum, which keeps `{}` and `[]` apart. Manual adoption no longer treats a collapsing object as that list: the event is `payload_conflict` and the Hub row is not given a connector baseline. Authoritative checksums keep every JSON number token as its original literal. Hub adoption uses a PHP integer, or a float when `json_encode` with `JSON_PRESERVE_ZERO_FRACTION` reproduces the literal; every other literal stays a string. Hub's own payload hash still uses default `json_encode`, so `1` and `1.0` compare equal there, the same as two manual orders. The connector checksum still distinguishes those tokens once a connector baseline exists.

### Tests added

`DeliveryConnectorCoreTest` now covers:

1. Rotation committed between the unlocked read and the row lock: old secret is `invalid_signature`, no attempt, no Hub row, no financial rows; the new secret ingests once and the attempt records version 2.
2. `sales.pos` `disabled` and `suspended`: no Hub row and no attempt; re-enable does not treat the rejected event as burned; a later suspend blocks a new event without forking the existing order.
3. `{}` versus `[]`, nested `{"items":{}}` versus `{"items":[]}`, integers `9223372036854775808` versus `9223372036854775809` and versus the same digits in a string, and the negative pair past int64. Same literal replays onto the same Hub order. Key reorder is not a conflict. One Hub row per provider order id. Financial and commerce counts unchanged.
4. Two stale version-1 models rotate to versions 2 and 3. Secrets differ. Only version 3 verifies. The attempt records version 3. On PostgreSQL the test also asserts `FOR UPDATE` in the query log. SQLite has no row lock; the same-connection reload is what that driver can prove.
5. Expired trial and subscription: `subscription_inactive`, no attempt, no Hub row; restoring the trial lets the same event id succeed.
6. `{"01":"a","1":"b"}` and `{"1":"b","01":"a"}` share one Hub order.
7. `1.0000000000000001`, `1.0`, `1`, `1e2`, and `100` stay distinct. The second shape is `payload_conflict`.
8. A manual numeric `amount` of `5000` is adopted by the connector number `5000`. A manual string `"5000"` conflicts with that number. A raw manual `1.0` is adopted by the connector literal `1.0` and conflicts with the string `"1.0"`. Duplicate members `{"n":1,"n":2}`, `{"a":1,"\u0061":2}`, nested `{"o":{"a":1,"a":2}}`, and a duplicate inside an array are `invalid_payload` and do not create a Hub row.
9. Manual adoption of `{"keep":"yes"}` and `["a"]` succeeds. Manual `[]` versus connector `{}`, manual `["a"]` versus `{"0":"a"}`, and manual `{"a":[]}` versus `{"a":{}}` are `payload_conflict`. Those attempts store no authoritative checksum. One Hub row remains for each provider order.
10. A body of `MAX_RAW_BYTES + 1` with a syntactically valid but wrong signature is `422 invalid_payload` and writes no attempt. A body of exactly `MAX_RAW_BYTES` with the same wrong signature is `401 invalid_signature`, proving the limit is applied before HMAC and the boundary still verifies.
11. A second connector on another branch cannot cancel or adopt `provider_order_id` already stored on the first branch. The attempt has no Hub order id and no authoritative checksum. The original connector can still cancel its own order.

### Local execution

SQLite, `php artisan test --filter=DeliveryConnectorCoreTest`:

- 22 passed, 389 assertions (includes subscription expiry, canonical numbers and shapes, manual adoption, duplicate members, the payload-size gate, and cross-branch rejection)

SQLite, related suites (`DeliveryHubProjectionTest`, `BranchIsolationGuardTest`, `WebhookSignatureTest`, `DeliveryPlatformApiTest`, `DeliveryFinancialRoleGateTest`, `DeliveryPlatformProfileDomainTest`):

- 70 passed, 752 assertions, re-run with the shape and size fixes. Those suites do not touch connector ingestion.

PostgreSQL was not started in this sandbox. `useradd` succeeded, but `chown`, `su`, `runuser`, and `setuid` are rejected, so `pg_ctl` cannot drop root. The CI `pgsql` job on this commit is the PostgreSQL proof. Do not treat it as passed until that job is green on the exact head.

### Implementer self-review (fix pass)

- Retired credential cannot pass the locked re-check, including when the unlocked read still holds the old secret.
- Application write gate runs only after the tenant is the account tenant, and again after the row lock, before attempt or Hub writes.
- Canonical checksum distinguishes object/list and oversized integers without accepting a numeric string as the same integer.
- Rotation versions come from the locked row, not the caller's stale attribute.
- No invoice, payment, journal, stock, commerce, or provider-enablement call was added.
- Representable connector numbers stay integers or exact floats in the Hub comparison. Duplicate object members never reach `json_decode()`.
- A collapsing object is refused only on the baseline-null adoption path. Connector-to-connector `{}` versus `[]` is still the authoritative checksum.
- Oversized bodies return before the encrypted account is loaded.

### Reviewer review (fix pass)

- A valid signature on a disabled connector still returns `connector_disabled` before the application check, so the existing disable contract is unchanged.
- Rejection for an inactive application does not insert an attempt, so the event id can succeed after re-enable.
- The global store-uniqueness oracle and the encrypted secret cast are unchanged.
- SQLite cannot prove a cross-connection lock wait. The stale-version result is asserted on both drivers; `FOR UPDATE` is asserted when the driver is PostgreSQL.
- A list the Hub can store still adopts. Only objects that `array_is_list` would erase are conflicts, and they do not become the connector baseline.
- The size check uses the raw byte length, not `Content-Length`. A body at 65536 bytes is still authenticated.
- A connector mapped to branch B cannot attach an attempt, adopt, or apply `hub_action` to an order already stored on branch A. The same connector still can.

### AWJ Guardian review (fix pass)

| Risk | Result |
|---|---|
| Accepting a rotated-out secret | Rejected after the row lock. No attempt row. |
| Ingestion while `sales.pos` is suspended or disabled | Rejected. No Hub write. |
| Checksum collapse of distinct integers or `{}`/`[]` | Rejected as `payload_conflict`. One Hub row. |
| Two rotations sharing one version | Locked reload assigns 2 then 3. Only the committed secret verifies. |
| Expired subscription still ingesting | Rejected. No attempt and no Hub write. |
| Decimal, exponent, or oversized literals collapsing | Original literals stay distinct in the authoritative checksum. |
| Manual number rejected, or a numeric string adopted | PHP integer and exact float types are preserved for the Hub comparison. |
| Duplicate object members kept as the last value | Rejected as `invalid_payload` before decode. No Hub row. |
| Manual adoption of `{}` or `{"0":"a"}` | `payload_conflict`. No authoritative checksum. Hub row unchanged. |
| Oversized body hashed before the limit | Rejected before account load and HMAC. No attempt. |
| Cross-branch reuse of a provider order | `branch_unavailable` before adoption or `hub_action`. The other order is not linked or moved. |
| Financial or inventory side effect | Counts unchanged in the new tests. |
| Provider enablement or DG-3 evidence | Not introduced. |
| Deleted configurator permanently blocks the mapping | Open. Decision Packet below. Not fixed in this diff. |

Unresolved P1/P2 that this diff fixes stay open on GitHub until CI on this SHA is green and the threads are resolved. The ownership finding stays open on purpose.

## Decision Packet — DLV-CONNECTOR-OWNERSHIP-1

Status: **blocked**. No code change.

Codex P2 on `35541a3` (`PRRT_kwDOS52FT86rGOhy`): after an administrator soft-deletes the user in `configured_by`, `actor()` returns null, every later signed event is `422 actor_unavailable`, and the unique `(platform_key, external_store_id)` mapping cannot be recreated. The connector API can rotate or disable the secret, not reassign it.

Evidence already in the core:

- `User` uses `SoftDeletes`. `UserController::destroy` deletes any other user, including another owner. There is no restore route.
- `actor()` uses the default user query, so a soft-deleted configurator is invisible. The failure is intentional for a missing actor and does not burn `event_id`.
- `DeliveryConnectorAccountService::create` turns a unique violation into `mapping_ambiguous`.

The two remedies in the finding are product decisions, not a local defect fix:

| Option | What it decides | Why it is out of scope here |
|---|---|---|
| A. Reassignment API | Who may change `configured_by`, which branch scope the new user must have, and whether the secret stays | New management contract and audit rule |
| B. Durable operational principal | Hub `created_by` and branch checks stop being a human user | New identity type |
| C. Restore the deleted user | Ingestion waits until that login exists again | User restore is already deferred in `UserController` ("تُعالَج لاحقاً") |

A silent fallback to "any active owner" would also pick an actor and a branch scope. That is option B by another name and was not chosen.

This packet does not authorize an adapter, a financial write, or a schema change. The thread stays unresolved. **PRE_MERGE_REVIEW: PASS is not available while it is open.**

## Next candidate

No financial delivery task is ready. After this PR merges, the next honest candidate is an evidence-only `DLV-PROVIDER-READINESS-1` packet. If the official contract and test path are absent, that packet must stay blocked and must not invent an adapter.

**Merge != Deploy.** Do not merge until review and exact-head CI are green. No production release is authorized.
