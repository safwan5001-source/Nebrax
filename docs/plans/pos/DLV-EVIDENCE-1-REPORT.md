# DLV-EVIDENCE-1 — Delivery Platforms & Settlement Horizon V1: Evidence Report

**Task:** DLV-EVIDENCE-1 (Evidence Pass only)  
**Horizon:** `docs/plans/pos/AWJ_DELIVERY_PLATFORMS_HORIZON_V1.md` (ACTIVE)  
**Date:** 2026-10-02  
**Base SHA (`origin/main`):** `3429ec39018479671326928ecb732294404f2878` (contains Activation merge `1f5c306e4861859665bbad6b7e10317a434f328f`)  
**Nature of change:** documentation only. No runtime code, schema/migration, accounting behavior, deploy or release. No tests were executed against runtime (none changed); test files below were inspected by name/header/assertions only.

Classification legend: **PROVEN REUSE POINT** · **GAP** · **DECISION GATE** · **EXTERNAL EVIDENCE REQUIRED**.

---

## 1. Exact Base SHA

`3429ec39018479671326928ecb732294404f2878` — `feat(pos): V3 cart line hierarchy and touch quantity (#1170)`.  
Activation PR #1163 (`1f5c306e…`) is an ancestor of this SHA. Note: the activation commit added only the `-BOOTSTRAP.md`; the durable `TASK-QUEUE.md` / `CURRENT-STATE.md` contained **no** DLV entries before this PR (see §16).

## 2. What was inspected

**Docs:** the Horizon plan, Bootstrap, Accounting/UX Decision, `AWJ-HORIZON-SYSTEM.md`, `QUALITY-GATES.md`, `TASK-QUEUE.md` (head/tail), `CURRENT-STATE.md` (head/sections), root `CLAUDE.md` rules.

**Classes / services**
- POS: `PosController::checkout`, `StorePosSaleRequest`, `Accounting\PosService` (checkout, checksum, tenders, payment-method availability), `PosSessionService` (close, `report`, `cashMovement`, `expectedNonCashTenderRows`, `buildCloseReconciliations`), `PosSessionController::report`, `PosReturnService`, `PosSettings::allowsDeferredPayment`, `PosCustomerPriceListResolver`.
- Models: `SalesChannel`, `PaymentMethod`, `PaymentMethodChannelAvailability`, `PaymentGateway`, `PaymentGatewaySettlement(+Item)`, `PosSession`, `PosCheckoutAttempt`, `PosSessionReconciliation`, `Invoice`, `Payment`, `CommerceOrder`, `WebhookEndpoint`, `WebhookDelivery`, `PublicApiIdempotencyKey`, `ZatcaCredential`, `PlatformIntegrationSetting`, `FuelStationIntegrationEvent(+Attempt)`.
- Accounting: `InvoiceService` (post, COGS call), `PaymentService` (gateway-clearing path), `PaymentGatewaySettlementService`, `AccountRoutingService`, `AccountingRoles`, `InventoryService` (`applyIssue/applyReceipt/recordSaleCogs`), `ReturnService`, `CreditNoteService`, `CustomerRefundService` (signatures).
- Commerce: `CommerceBoundary`, `CommercePriceResolver`, `PaymentMethodChannelAvailabilityService`, other `SalesChannel` consumers (grep).
- Infra: `WebhookSignature`, `WebhookDeliveryProcessor`, `FuelStationIntegrationEventService`, `FuelStationDeviceIngressService`, `AuthenticateApiClient`, `EnforceApiIdempotency`, `SetBranch`, `BranchContext`, `ApplicationCatalog` keys.

**Routes:** `pos/*`, `pos-sessions/*`, `pos-devices/*` (`routes/api.php` 689–784), developer webhooks (1539–1548), `routes/api_public.php` webhooks, fuel device ingress (1143+).

**Tables / migrations:** `sales_channels` (2026_09_13_010000), `payment_gateways`, `payment_gateway_settlements(+items)` (2026_09_15/09_21), `payment_methods` (…000077), `pos_session_id` links (…000092), commerce_orders. `invoices` has 34 prior alter-migrations.

**Tests (existence + selected assertions):** `PosCheckoutTest`, `PosCheckoutIdempotencyTest`, `PosSessionTest`, `PosSessionCloseHandoverTest`, `PosReturnTest`, `PosReturnExchangeIdempotencyTest`, `PaymentGatewayFoundationTest`, `PaymentGatewaySettlementAccountingTest` (assertions read), `PaymentGatewayTenantGuardTest`, `PaymentMethodChannelAvailability*Test`, `CommerceModuleBoundaryTest`, `BranchIsolationGuardTest` (header read), `DeveloperWebhookDeliveryTest`, `MobileSalesChannelResolverTest`.

## 3. Current implementation map

| Area | Current state (evidence) |
|---|---|
| POS checkout | `POST pos/checkout` → `PosService::checkout`: one transaction; branch-anchor lock; `PosCheckoutAttempt` unique `idempotency_key` + `request_checksum`; creates a **credit** invoice, posts it, then one `Payment` (received) per tender via `PaymentService`. Remainder stays on AR and is allowed only if `PosSettings::allowsDeferredPayment()` (default true). |
| Checkout request | `StorePosSaleRequest` has **no** channel/source/external-reference field. The checksum (`checkoutRequestChecksum`) hashes partner, session, cart, warehouse, items, tenders, notes only. |
| Invoice | `Invoice` is `BelongsToBranch`; **no** channel/source/external-ref/collector columns. |
| SalesChannel | `sales_channels` (CompanyWide, `unique(tenant_id,slug)`, DB enum `web|mobile|pos|external`, `default_price_list_id`). Type `external` exists with **zero** consumers/creators. Commerce owns the model (ADR-03); consumers filter by type (`web`, `mobile`, `pos`). |
| Payment | `PaymentService` supports `payment_gateway_id` on received payments → debits role `gateway_clearing` instead of cash/bank, credits AR (partner = invoice customer). **POS never passes it.** |
| Platform-ish clearing | `AccountingRoles`: `gateway_clearing` (legacy 1170), `provider_fee_expense` (5510); tenant-configurable via `AccountRoutingService` + `account_role_mappings`. |
| Settlement | `PaymentGatewaySettlementService::post`: items = matched `Payment`s; unique `(tenant, gateway, provider_settlement_ref)`; enforces `gross = net + fee + fee_tax + deductions − credits`; **rejects** `provider_fee_tax > 0` and non-zero deductions/credits; posts one balanced entry via `LedgerService` (Dr bank net, Dr fee, Cr clearing gross); stores clearing/fee/bank account snapshot ids on the settlement. |
| `PaymentGateway` | Closed provider list (`stripe|tap|paytabs|checkout|custom`) + credentials (`secret_key`, `webhook_secret`, `extra_credentials`) — an integration config, not a channel/counterparty. |
| POS close | `PosSessionService::close` builds immutable `PosSessionReconciliation` rows: cash drawer expectation = opening + payments with `method='cash'` + cash movements − cash refunds; **every other posted received payment** (any `settlement_type≠cash`) becomes an expected non-cash tender row via `expectedNonCashTenderRows`. `report()` sums all posted session invoices into `net_sales` with no channel dimension. `PaymentMethod.settlement_type` is `cash|bank`. |
| Returns/refunds | `PosReturnService` (idempotent `PosReturnAttempt`) → `ReturnService` (Dr sales/tax, restock via `inventory_asset` or `inventory_damage_loss` by reason; restock decided by explicit flag or `Settings inventory.restock_sales_returns`); `CreditNoteService`; `CustomerRefundService` (+ reverse). Cash return capped by session cash policy (`cashRefundBlockReason`). |
| Inventory | Issue + COGS occur at `InvoiceService::post` inside the invoice transaction (`applyIssue`, `recordSaleCogs`). Receipt printing/thermal snapshot is presentation only; no inventory write on print. Commerce `Reservation != StockMovement` (CommerceBoundary). |
| Commerce order | `CommerceOrder` (CompanyWide, `sales_channel_id`, status `draft|confirmed` only, unique `commerce_checkout_id`); no external order reference; ADR-01: not an Invoice; CommerceBoundary forbids direct ledger/stock/ZATCA writes. |
| Secrets | App-key `encrypted` / `encrypted:array` casts + `$hidden` (`PaymentGateway`, `WebhookEndpoint`, `ZatcaCredential`, `PlatformIntegrationSetting`). `WebhookEndpoint` has rotate-secret. No vault/KMS; `FuelStationDeviceIngressService` itself states secret-vault/auth depend on a future vendor contract. |
| Webhooks | **Outbound only**: `WebhookSignature` (HMAC-SHA256 over `{ts}.{rawBody}`, `hash_equals`, timestamp tolerance), `WebhookDeliveryProcessor` (`retry_scheduled`/`failed`, `attempts`, `next_attempt_at`). **No inbound provider webhook route exists** (`PaymentGateway.webhook_secret` is stored but consumed by no inbound endpoint). |
| M2M auth | `AuthenticateApiClient`: Sanctum token whose tokenable is `ApiClient`; tenant derived server-side from the client (never header/body); fail-closed generic 401; `EnforceApiIdempotency` + `PublicApiIdempotencyKey` (hashed key, request fingerprint, stored response, expiry). |
| Retry/dead-letter/audit | `FuelStationIntegrationEvent` + append-only `…Attempt` (accepted/processed/failed/rejected, payload checksum replay detection, max-retry setting, manual retry). `PosSessionEvent`/`PosAuditService` for POS audit. |
| Tenant/Branch | `BaseModel` + `TenantScope`; every new model must declare `BranchScoped`/`BelongsToBranch`/`CompanyWide` (`BranchIsolationGuardTest` fails CI otherwise). `BranchContext` is a write dimension (no global branch scope); `SetBranch` validates `X-Branch-Id` as UUID, tenant-scoped, within user's allowed branches. |
| RBAC / app gating | `perm('invoices.manage'|'invoices.view'|'company.manage'|'pos.*')` + `$app('sales.pos')` on all POS routes. `ApplicationCatalog` has no delivery/channel capability key. |
| Pricing | `SalesChannel.default_price_list_id` consumed by `CommercePriceResolver` (partner list takes precedence over channel list). POS uses `PosCustomerPriceListResolver` (partner list, setting-gated) and does **not** read channel pricing. |
| Payment-method × channel | `PaymentMethodChannelAvailabilityService` handles non-POS channels (incl. `external`); explicitly throws for `TYPE_POS` (POS governed by `PosSettings`). |

## 4. Proven reuse points

| # | PROVEN REUSE POINT | Evidence | Use |
|---|---|---|---|
| R1 | `SalesChannel` type `external` is defined, tenant-scoped, CompanyWide, soft-deletable, unique slug per tenant, with `default_price_list_id` validation against tenant | model + migration | Channel identity for delivery platforms (FOUNDATION-1), without a new identity table. |
| R2 | `PaymentService` gateway-clearing path (credit AR, debit `gateway_clearing` role, no cash/bank fabricated) | `PaymentService` L295–340, `PaymentGatewaySettlementAccountingTest` | Gross-preserving platform-collected routing precedent (ACCOUNTING-1). |
| R3 | `PaymentGatewaySettlementService` (many payments per settlement, idempotent by tenant+provider ref, reconciliation equation, fee-tax/deduction refusal, immutable account snapshots, journal via `LedgerService`) | service + tests | Direct template for SETTLEMENT-1/RECON-1; its refusals match locked invariants (no assumed VAT recoverability, no unexplained variance). |
| R4 | `AccountingRoles` + `AccountRoutingService` + `AccountRoleResolver` | code | Semantic role routing; new roles (e.g. platform clearing) follow ACC-2 pattern, no hard-coded codes. |
| R5 | POS idempotency: `PosCheckoutAttempt` + checksum + `PosIdempotencyConflictException` (409), branch-anchor lock | `PosService` | Pattern for POS-1; new fields must be added to the checksum. |
| R6 | Invoice-post inventory/COGS in-transaction authority; print is not an inventory event | `InvoiceService::post`, thermal snapshot | Satisfies locked invariant #9 for POS-originated delivery sales with no change. |
| R7 | Return/restock authority (`ReturnService` restock flag/setting, damage-loss routing), `CreditNoteService`, `CustomerRefundService`, `PosReturnAttempt` idempotency | services | REFUND-1 must call these, not write parallel paths. |
| R8 | `PosSessionReconciliation` immutable close snapshot, `PosSessionEvent` audit | model | CLOSE-1 channel presentation can be additive beside tender rows. |
| R9 | `WebhookSignature` (timestamp+raw-body HMAC, constant-time compare) | support class | Verification primitives pattern (provider-specific scheme still required). |
| R10 | `FuelStationIntegrationEvent`/`Attempt` (checksum replay, append-only attempts, bounded manual retry) and `WebhookDelivery` (`retry_scheduled`/`failed`) | models/services | Dead-letter/recovery patterns for CONNECTOR-CORE-1. |
| R11 | `AuthenticateApiClient` + `EnforceApiIdempotency` (server-derived tenant, fail-closed 401, hashed idempotency keys) | middleware | Trusted tenant derivation + idempotency precedent. |
| R12 | Encrypted-cast secret pattern (`encrypted`, `$hidden`, rotate) | models | Provider credentials storage pattern (see Gate DG-7). |
| R13 | `CommerceBoundary` + `CommerceModuleBoundaryTest` | support/test | Enforces "no direct ledger/stock writes"; delivery code must obey it too. |
| R14 | `BranchIsolationGuardTest`, `BelongsToBranch`/`CompanyWide`, `SetBranch` validation | tenancy | Mandatory classification of every new model; branch override model shape. |
| R15 | `PaymentMethodChannelAvailabilityService` (tenant-same check, fallback semantics) | service | Prior art for per-channel policy rows with safe defaults. |

## 5. Gaps

| # | GAP | Detail |
|---|---|---|
| G1 | No channel/source/external-reference/collector/config-snapshot on `Invoice`, `Payment`, `PosCheckoutAttempt`, or the checkout request/checksum. |
| G2 | No delivery-platform config: collection mode, settlement counterparty, external-ref policy, logo/brand asset reference, branch/store override, versioned configuration. |
| G3 | POS cannot route a tender to clearing (no `payment_gateway_id` path); `PaymentGateway` is credentials-bearing with a closed provider enum and cannot represent a platform/counterparty. Single global `gateway_clearing` role; no per-platform counterparty dimension on the clearing line (`partner_*` absent). |
| G4 | **Close contamination risk:** any posted non-cash received payment becomes an expected physical tender row (`expectedNonCashTenderRows`), so a clearing-backed `Payment` using a `bank`-type method would inflate an expected card/bank tender. Leaving the sale unpaid avoids this but yields no channel visibility. `report()` has no channel breakdown; `net_sales` mixes all channels. |
| G5 | Settlement service rejects fee-tax and deductions/credits (correct for now) but has no typed components (refund, merchant- vs platform-funded promotion, delivery/service adjustment) and no partial/unmatched state — `post` is all-or-nothing. |
| G6 | No commission policy model (effective-dated, base semantics, overrides) and no expected-vs-actual comparison. |
| G7 | No inbound provider webhook endpoint, no provider signature verification, no external store/vendor → tenant/branch trusted mapping table. |
| G8 | No normalized delivery-order projection. `CommerceOrder` has no external reference and only `draft|confirmed`, and is Commerce-owned; it cannot carry normalized Incoming→Completed/Cancelled lifecycle. |
| G9 | No cancellation/refund path for platform-collected sales that avoids cash-drawer refund semantics (`PosReturnService` models cash/credit; cash capped by drawer policy). |
| G10 | POS does not consume `SalesChannel.default_price_list_id`; no channel-price precedence rule for POS (resolver precedence in Commerce is partner list first). |
| G11 | No capability key for delivery in `ApplicationCatalog`; no dedicated permission strings. |
| G12 | No official logo assets/usage permission in repo. |
| G13 | No central secret vault; encryption is app-key based. |
| G14 | No ZATCA-safe rule for invoice customer when a platform is involved (see Gate DG-3). |

## 6. Migration / API implications (analysis only — nothing implemented)

- **Additive only.** No change to existing `invoices`/`payments` rows; legacy sales need no backfill (Decision §12).
- FOUNDATION-1 (proposed): new tables only, e.g. `delivery_platform_profiles` (1:1 to `sales_channels` where `type='external'`; CompanyWide), `delivery_platform_profile_versions` (append-only effective configuration snapshots), optional `delivery_platform_branch_overrides` (`BelongsToBranch`). No change to `sales_channels` columns (R1) unless `ADR-03` review demands a `delivery` subtype — flagged in DG-5.
- Later tasks will need additive columns/tables: channel/external-ref/config-version stamping on the invoice side (POS-1/ACCOUNTING-1), settlement components (SETTLEMENT-1), inbound event + mapping tables (CONNECTOR-CORE-1). `invoices` is hot (34 prior alters); stamping should prefer a side table keyed by `invoice_id` unless Gate DG-2 resolves otherwise.
- API: new `…/delivery-platforms` config endpoints (tenant, RBAC). `POST pos/checkout` additive optional fields only, preserving legacy tenders contract and the 409 idempotency semantics. No breaking public API change identified.
- PostgreSQL: new UUID FKs must be validated as UUID before query (the SetBranch/`22P02` lesson); SQLite+PG CI required.

## 7. Accounting impact map

Current authoritative entries (no change in this task):

| Operation | Entry today |
|---|---|
| Sales invoice post | Dr AR (customer partner) · Cr `sales_revenue` · Cr `tax_output` (+shipping/adjustment) |
| COGS (tracked stock) | Dr `cogs` · Cr `inventory_asset` (same transaction) |
| Standard receipt | Dr cash/bank entity account · Cr AR (partner) |
| Gateway-linked receipt (PAY-V2-5) | Dr `gateway_clearing` · Cr AR (partner) |
| Gateway settlement | Dr bank (net) · Dr `provider_fee_expense` (fee ex-tax) · Cr `gateway_clearing` (gross); fee-tax/deductions/credits refused |
| Sales return | Dr sales/tax (+restock: Dr `inventory_asset`/`inventory_damage_loss`, Cr `cogs`) · Cr AR/refund per policy |

Future (conceptual, **not authorized**; owned by DLV-ACCOUNTING/SETTLEMENT/COMMISSION): platform-collected sale keeps gross sale on the invoice; settlement credits platform receivable/clearing for gross; fee/fee-tax only with valid evidence; variance stays unreconciled. No VAT treatment, recoverability, agency/principal role, or compensation classification is assumed here.

## 8. Tenant / Branch / RBAC / Security map

| Concern | Existing authority | Requirement for DLV |
|---|---|---|
| Tenant | `BaseModel`/`TenantScope`; `TenantContext` singleton | Config rows tenant-scoped; foreign UUIDs indistinguishable from missing (as `SalesChannel` price-list guard). |
| Branch | `BelongsToBranch`/`BranchScoped`/`CompanyWide` + guard test; `BranchContext` write-only | Platform config CompanyWide; per-branch overrides in `BelongsToBranch` rows; Hub/orders branch-authorized. |
| RBAC | `perm()` middleware + role table | Reuse `company.manage` (write) / `invoices.view` (read) in FOUNDATION-1; new permission strings or catalog key require explicit handling (G11). |
| App gating | `$app('sales.pos')` | POS routes remain gated; no new catalog key without decision. |
| Inbound identity | M2M token → server-derived tenant | External IDs never select tenant/branch; need trusted mapping resolved from authenticated credential/signature first (G7, EXTERNAL EVIDENCE). |
| Secrets | encrypted casts | Server-side only; never in POS/browser; no leakage in audit/diagnostics. |
| Idempotency | `PosCheckoutAttempt`, `PublicApiIdempotencyKey`, settlement unique ref | New fields enter the checksum; settlement/import unique per tenant+platform+ref. |
| Audit | `PosSessionEvent`, append-only attempt tables | Config changes and later settlement/import audited append-only. |

## 9. Backward-compatibility constraints

1. Legacy `tenders` (list and `cash/card/transfer/credit` map) and `partner_id`-required contract unchanged.
2. Checkout checksum must stay stable for requests without new fields (otherwise in-flight retries 409).
3. `PosSettings` remains the sole POS payment-method governor (`PaymentMethodChannelAvailabilityService` refuses `TYPE_POS`).
4. Existing close math (`method='cash'` drawer expectation; non-cash rows) must not change for legacy sessions; reconciliation rows are immutable.
5. `SalesChannel` consumers (web/mobile/pos filters) must not start returning delivery channels (`CommerceModuleBoundaryTest`, storefront/mobile resolvers).
6. `gateway_clearing`/settlement behavior unchanged; historical journals never reinterpreted.
7. Every new `BaseModel` classified (guard test); SQLite and PostgreSQL both green.

## 10. External provider evidence still required

**EXTERNAL EVIDENCE REQUIRED** (none blocks FOUNDATION-1):
- HungerStation & Keeta: onboarding status, sandbox credentials, webhook authentication/signature scheme, event/status semantics, retry/idempotency expectations, cancellation/refund payloads, settlement/statement format and finality of financial fields (Keeta ingest-time amounts may be non-final).
- Jahez, Mrsool, The Chefz, Ninja: official API/partner contract (currently only Foodics-ecosystem evidence).
- Official logo assets and usage permission for all six platforms.
- Each merchant–platform contract: agency/collector role, VAT on fees, commission base, settlement cadence.
- ZATCA position per contract (Decision §10); no inference made here.

## 11. Decision Gates

None blocks DLV-FOUNDATION-1 (DG-5, the only gate touching it, is resolved below). The remaining gates are recorded against the downstream task that they block:

| Gate | Question | Blocks |
|---|---|---|
| DG-1 | Platform-collected representation: reuse `gateway_clearing` + `payment_gateway_id` precedent vs new semantic role (e.g. platform clearing per counterparty); whether the invoice is marked paid on platform-collected posting and how the counterparty dimension is carried on the clearing line. | ACCOUNTING-1 |
| DG-2 | Which `partner_id` the POS invoice uses for platform orders (walk-in default vs end customer) and where channel/collector/config-version are stamped (side table vs `invoices` columns). | POS-1 / ACCOUNTING-1 |
| DG-3 | Legal/tax role per platform contract; effect on ZATCA document type (derived from partner VAT) and tax point. Owner/tax decision with evidence. | ACCOUNTING-1, SETTLEMENT-1 |
| DG-4 | Close/Z-report presentation: whether platform-collected sales appear as separate rows without creating an expected physical tender row (requires deciding the payment representation first, see G4). | CLOSE-1 |
| DG-5 | **RESOLVED in this evidence pass.** Reuse of `SalesChannel(type=external)` as delivery channel identity. Evidence: every query that enumerates channels filters by type (`ResolveStorefrontTenant`/`ResolveStorefrontDomain`/`StorefrontProvisioningService`/`EnsureWebSalesChannelCommand`/`RegisterStorefrontDomainCommand` = `web`; `ResolveCommerceChannel`/`MobileSalesChannelResolver` = `mobile`); none lists all channels; `type=external` is defined (ADR-03 §11 anticipates external channels) with zero consumers. Caveats made binding on FOUNDATION-1: (a) slug convention must not collide with reserved `web` (provisioning throws on a non-web occupant), use `delivery-<platform>`; (b) the staff `CommerceOrderService::create` path accepts any channel id, so FOUNDATION-1 adds no Commerce order path for delivery channels and a test asserts delivery channels are never returned by web/mobile resolvers. Reuse is therefore decided, not deferred. | — |
| DG-6 | Inventory consumption event for API-ingested orders with no cashier (invoice at accept / handoff / completion) and cancel/restock rule, consistent with canonical lifecycle. Reuse `CommerceOrder` vs separate delivery-order projection (Commerce contract #8 forbids forcing POS flows through `CommerceOrder`). | HUB-1, REFUND-1, CONNECTOR-CORE-1 |
| DG-7 | Accept app-key encrypted casts as the "canonical tenant-scoped secret mechanism", or require vault/versioned rotation. | CONNECTOR-CORE-1 |
| DG-8 | Channel-price precedence vs partner price list for POS delivery channels (configurable policy per CLAUDE.md rule 6, default preserving current behavior). | POS-1 / later pricing |
| DG-9 | New capability key / permission strings for delivery (ApplicationCatalog + Rbac). | HUB-1 / POS-1 |

## 12. Proposed scope — DLV-FOUNDATION-1

**In scope (additive, config only):**
1. Delivery platform profile bound to a tenant `SalesChannel` of `type=external` (R1; decided, DG-5). Channel slug convention `delivery-<platform>`: platform key (catalog of the six; extensible), display name (ar/en), collection mode (`platform_collected` | `merchant_collected`) as data only, external-order-reference policy (`required|optional|none`, default `optional`), logo asset reference (nullable string, no assets shipped), `is_active`.
2. Append-only configuration **versions** (effective-dated, immutable) so later documents can reference a version id that survives edits.
3. Optional per-branch override rows (`BelongsToBranch`) only where configured, never crossing tenant.
4. Service layer (tenant guard, same-tenant validation, soft-disable not delete when referenced) and tenant-scoped REST CRUD under existing permissions (`company.manage` write, `invoices.view` read).
5. Idempotent catalog seeding/enable action (explicit, no auto-creation for existing tenants).

**Out of scope:** any settlement-counterparty field or model (Partner FK vs other authority is DG-1; it is added only after DG-1 is resolved, and never as a bare external identifier), any invoice/payment/ledger change, POS UI/selector, checkout field, close/Z-report, Hub, commission, settlement, refund, connector/webhook/secret handling, logos, new catalog/permission keys, VAT assumptions.

## 13. Acceptance criteria — DLV-FOUNDATION-1

1. Migrations additive; forward and fresh install pass on SQLite and PostgreSQL; no existing table altered.
2. Platform identity is distinct from invoice customer and from `PaymentMethod` (no payment-method row/enum created).
3. `merchant_collected` default semantics equal today's behavior; `platform_collected` is data only and drives no posting.
4. Every new model classified (`CompanyWide` / `BelongsToBranch`); `BranchIsolationGuardTest` green.
5. A published version is immutable; editing creates a new version; prior version still resolvable.
6. Branch override applies only to the stated branch and tenant; no override ⇒ company default.
7. Existing `SalesChannel` consumers (web/mobile/pos resolvers, storefront, commerce workspace) never return delivery channels in their flows; `CommerceModuleBoundaryTest` green.
8. Unauthorized role ⇒ 403; foreign tenant/branch/channel ids ⇒ non-revealing 404/422; inactive/foreign `default_price_list_id` rules unchanged.
9. Responses expose no secrets (none stored) and no ledger accounts.
10. No change to `POST pos/checkout` contract/checksum, close math, or any journal.
11. Delivery channel slugs follow `delivery-<platform>` and never collide with `web`; no Commerce order path is added for delivery channels.

## 14. Required tests — DLV-FOUNDATION-1

- Unit/feature: profile create/update/disable; version immutability and effective resolution; branch override resolution; policy defaults; soft-disable when referenced.
- Negative: cross-tenant channel/profile/override; cross-branch override; non-`external` channel rejected; unauthorized role; invalid UUID shape; duplicate slug/platform per tenant.
- Isolation/regression: `BranchIsolationGuardTest`, `CommerceModuleBoundaryTest`, `MobileSalesChannelResolverTest`, `PaymentMethodChannelAvailability*Test`, `PosCheckoutTest`, `PosCheckoutIdempotencyTest`, `PosSessionTest`, `PosSessionCloseHandoverTest`, `PaymentGatewaySettlementAccountingTest` unchanged and green; journal-count-unchanged assertion on all new endpoints.
- Migration: forward, fresh, and (where meaningful) rollback on SQLite + PostgreSQL.
- Full `php artisan test` per CLAUDE.md pre-PR protocol (no accounting entries are produced; state this explicitly in the PR).

## 15. Final recommendation

**READY** — DLV-FOUNDATION-1 has no open gate (DG-5 resolved above) and is dependency-ready by evidence **once DLV-EVIDENCE-1 is merged and POST_MERGE_REVIEW: PASS is recorded** (Horizon §5: an unmerged dependency does not unlock its child). It is not started in this PR. The posting/tax/payment-representation gates (DG-1…DG-4, DG-6…DG-9) are real and are explicitly scoped *out* of FOUNDATION-1; they must be resolved with owner decisions/evidence before ACCOUNTING-1, POS-1, HUB-1 and CONNECTOR-CORE-1 are promoted.

## 16. Durable state

`TASK-QUEUE.md` and `CURRENT-STATE.md` receive a Delivery Platforms Horizon V1 section recording only: horizon ACTIVE; DLV-EVIDENCE-1 delivered/in review; DLV-FOUNDATION-1 evidence-ready but locked until EVIDENCE-1 merge + post-merge review; all other tasks unchanged and not ready; gates DG-1…DG-4 and DG-6…DG-9 listed as owed (DG-5 resolved in the report).

## 17. Final evidence metadata

| Field | Value |
|---|---|
| Task | DLV-EVIDENCE-1 |
| Branch | `claude/fervent-tesla-vwm7os` |
| PR | [safwan5001-source/Nebrax#1171](https://github.com/safwan5001-source/Nebrax/pull/1171) |
| Evidence base SHA | `3429ec39018479671326928ecb732294404f2878` (all code evidence frozen at this SHA) |
| Head SHA | The PR head at review time. A report cannot contain its own commit hash; the reviewed head is stated in the PR's final report and `PRE_MERGE_REVIEW` comment, and evidence applies only if the PR diff touches nothing outside the three docs below. |
| Changed files | `docs/plans/pos/DLV-EVIDENCE-1-REPORT.md`, `docs/autonomous-engineering/TASK-QUEUE.md`, `docs/autonomous-engineering/CURRENT-STATE.md` |
| Checks | Docs-only: referenced paths/test classes verified to exist; `git diff --check` clean; no runtime tests run (no code changed). CI status is reported in the PR. |
| Risks / remaining | Evidence is from code/test reading, not runtime execution; DG-1…DG-4, DG-6…DG-9 owner decisions owed before their downstream tasks; provider evidence (§10) unavailable. |
| Next dependency-ready task | DLV-FOUNDATION-1, only after this PR is merged and `POST_MERGE_REVIEW: PASS` is recorded. |
