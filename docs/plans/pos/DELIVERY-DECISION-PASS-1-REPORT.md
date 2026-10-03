# DELIVERY-DECISION-PASS-1 — Decision Packets DG-1 / DG-2 / DG-3

**Horizon:** `docs/plans/pos/AWJ_DELIVERY_PLATFORMS_HORIZON_V1.md` (ACTIVE)
**Inputs:** `docs/plans/pos/DLV-EVIDENCE-1-REPORT.md`, `docs/plans/pos/AWJ_POS_DELIVERY_PLATFORMS_ACCOUNTING_UX_DECISION.md`, `docs/plans/pos/DLV-FOUNDATION-1-IMPLEMENTATION-REPORT.md`, current `InvoiceService`/`PaymentService`/`LedgerService`/`PaymentGatewaySettlementService`/`AccountingRoles`/ZATCA document-type derivation.
**Nature of change:** documentation only. No runtime code, schema, migration or posting. No merge, no deploy.
**Base SHA (`origin/main`):** `5e80830033aed602833afd091b28857f92d9f068` (contains DLV-FOUNDATION-1 merge, same SHA).

This pass does **not** close DG-1/DG-2/DG-3 on the owner's behalf. Each packet ends with **Owner Decision Required** — an explicit question needing Safwan's answer. Nothing here is implemented.

---

## OWNER DECISIONS RECORDED (2026-10-03)

Safwan reviewed this packet and recorded the following decisions. **Nothing is implemented by this update** — it is the durable record of what was decided, so ACCOUNTING-1/POS-1 can be scoped against a closed decision instead of an open option set. Each decision is repeated verbatim (summarized where noted) under its own gate below.

- **DG-1 — RESOLVED.** Option A (dedicated `platform_receivable_clearing` role, sibling in concept to `gateway_clearing`). No GL account per platform. No `Partner`-as-platform for convenience. No `JournalLine` platform dimension in V1. Per-platform reporting via subledger/document data, not separate GL accounts.
- **DG-2 — RESOLVED** for the current manual POS delivery flow. Tenant's existing default/walk-in POS customer. Delivery platform never becomes `Invoice.partner_id`. Trusted end-customer identity from provider APIs is deferred to a separately designed/evidenced task. Immutable delivery context in a dedicated side table (not widened `invoices`), pinning at minimum: invoice, sales_channel, delivery_platform_profile, delivery_platform_profile_version, external_order_reference, collection_mode. External provider IDs are never authority. Invoice Customer / Sales Channel / Settlement Counterparty stay strictly separate.
- **DG-3 — PARTIALLY RESOLVED / EXTERNAL EVIDENCE GATE.** Legal/tax role remains UNKNOWN for all six platforms until platform-specific official contract/terms evidence is obtained; one platform's treatment is never inferred from another's. ACCOUNTING-1 is authorized **only** for the tax-role-independent/simple-collector foundation DG-1+DG-2 establish (normal gross invoice, platform clearing of AR, no fabricated cash/bank). **Not authorized by this decision:** platform commission VAT recovery, `fee_tax` posting, platform-specific tax-point assumptions, agent/principal tax treatment, or any settlement tax treatment requiring contract evidence. This is the **currently authorized simple-collector foundation**, not a claim that DG-1/DG-2 behavior is universally correct for every provider regardless of contract — if a provider's contract later establishes a materially different legal role, that provider's integration stops at its own gate and its invoice/customer/tax treatment is reviewed before activation.

See the recomputed **Dependency Matrix** at the end of this report for what these decisions do and do not unlock.

---

## DG-1 — Platform-collected accounting representation

### Question
When a delivery-platform sale is platform-collected, how does AWJ represent the receivable/clearing side without fabricating cash/bank, while preserving gross sale, canonical `LedgerService`/`PaymentService` authority, and a clean path to settlement?

### Current repository evidence
- `InvoiceService::post()` always posts: Dr AR (role `accounts_receivable`, partner = `Invoice.partner_id`) · Cr `sales_revenue` · Cr `tax_output` (+ shipping/adjustment), then COGS in the same transaction. This is unconditional and untouched by FOUNDATION-1.
- `PaymentService::post()` for a received payment already branches on `usesGatewayClearing()` (`direction === 'received' && filled($payment->payment_gateway_id)`): if true, it debits role `gateway_clearing` instead of a cash/bank account; it always credits `accounts_receivable` (partner = invoice's partner). No cash/bank row is fabricated either way.
- `gateway_clearing` and `provider_fee_expense` are configurable roles (`AccountingRoles`, legacy codes 1170/5510), resolved once per tenant via `AccountRoleResolver`/`AccountRoutingService`. **One role ⇒ one GL account per tenant**, shared across every `PaymentGateway` row; the specific gateway is distinguished at the *document* level (`Payment.payment_gateway_id`, `PaymentGatewaySettlement.payment_gateway_id`), not by a per-gateway GL account or a journal-line partner dimension.
- `PaymentGatewaySettlementService::post()`: many `Payment`s matched into one settlement (unique per tenant+gateway+ref), reconciliation equation `gross = net + fee_ex_tax + fee_tax + deductions − credits` enforced before posting, `fee_tax > 0` explicitly refused pending a tax-routing decision, one balanced entry (Dr bank net, Dr fee, Cr `gateway_clearing` gross).
- `LedgerService::post()` lines accept an optional polymorphic `partner_type`/`partner_id` dimension (used today only for AR/AP lines, `Partner::class`). No "platform" or "collector" entity type exists on `Partner` (`type` is `customer|supplier|both`).
- `Payment` has `payment_gateway_id` (nullable, received-only) but no analogous field for a non-payment-processor collector. `PaymentGateway` is credentials-bearing, closed-provider-enum, and FK's to `PaymentMethod` — structurally a payment-processor integration, not a sales-channel collector.
- Invariant #1 (Horizon doc) and CLAUDE.md both forbid making a delivery platform a `PaymentMethod`. `PaymentGateway` is a distinct model from `PaymentMethod`, but its shape (`payment_method_id` FK, provider enum) is payment-processor-specific, not a generic "collector" abstraction.

### Existing AWJ authority / reuse points
- **R1:** the `gateway_clearing` Dr-clearing / Cr-AR pattern in `PaymentService` is the direct precedent for "consideration collected by a third party, invoice stays paid against AR, no cash/bank fabricated."
- **R2:** `PaymentGatewaySettlementService`'s many-to-one settlement, reconciliation equation, and fee-tax refusal are the direct precedent for a future `PlatformSettlement`.
- **R3:** one shared role account per concern (`gateway_clearing`), with the specific counterparty recorded on the *document*, not duplicated as GL accounts or forced onto the journal line — avoids a chart-of-accounts explosion across 6+ platforms × tenants.

### Options (evidence-grounded, not a recommendation to build)

**Option A — New sibling role, same shape as `gateway_clearing`.**
Add a configurable role (e.g. `platform_receivable_clearing`) and a `Payment.delivery_platform_profile_id` nullable FK (sibling to `payment_gateway_id`), with its own `usesPlatformClearing()` branch in `PaymentService` mirroring `usesGatewayClearing()`. The specific platform is recorded on the `Payment` and later on a `PlatformSettlement`, not on the GL account or the journal-line partner dimension (mirrors R3 exactly).
- *Pro:* smallest diff from a proven pattern; no chart-of-accounts growth per platform; reuses `AccountRoutingService`'s existing admin surface shape.
- *Con:* conflates "platform clearing" conceptually with "gateway clearing" if tenants expect them separated for reconciliation/reporting; the new `Payment.delivery_platform_profile_id` column parallels but does not share code with `payment_gateway_id`, so `resolvePaymentGatewayId`-equivalent logic is duplicated unless deliberately generalized.

**Option B — Distinct clearing role per settlement domain, with a partner-dimension carried on the clearing line.**
Keep one `platform_receivable_clearing` role, but additionally stamp the clearing line's `partner_type`/`partner_id` with a *new* entity representing the platform (not `Partner`, to avoid conflating it with the invoice customer or a real supplier/customer — Partner already carries VAT/ZATCA-identity weight). This still does not require a GL account per platform.
- *Pro:* makes per-platform subledger reporting possible directly from `JournalLine` without joining through `Payment`/`Settlement`.
- *Con:* introduces a second polymorphic partner-like concept nobody reviewed; **not proven safe** — no existing AWJ pattern does this for `gateway_clearing` today, so it would be new, not reused, machinery. Higher risk of contradicting the "ZATCA/accounting authority preserved" invariant if done hastily.

**Option C — Reuse `Partner` (type `supplier`, `both`, or a new `platform` value) as the counterparty.**
Model each enabled delivery platform's settlement counterparty as a `Partner` row, and use the *existing* AP/AR partner-dimension machinery unmodified.
- *Pro:* zero new polymorphic concept; `Partner` already carries the fields (VAT number, etc.) that ZATCA and `PaymentService` already know how to read.
- *Con:** directly risks invariant #2 ("do not conflate Invoice Customer / Sales Channel / Settlement Counterparty") if implemented carelessly, since `Partner` is also the Invoice Customer's model. Must guarantee structurally (not just by convention) that an invoice's `partner_id` (customer) and a settlement's counterparty `Partner` can never be the same row, and that no code path lets a platform `Partner` become `Invoice.partner_id`. This is a real design constraint on this option, not proof it is unsafe — but it is why DG-2 must be resolved alongside DG-1, not after it.

None of A/B/C is ruled in or out here. This is scope for ACCOUNTING-1, not this task.

### Worked accounting example (no VAT treatment assumed)
Gross sale = 100 SAR, fully platform-collected. Settlement: commission 20 ex-tax, fee-tax unspecified (see DG-3), net bank deposit 77 (i.e. deductions/credits = 3, arbitrary illustrative remainder — **not** a VAT claim).

```
1) Invoice post (unchanged, today's InvoiceService):
   Dr Accounts Receivable (partner = invoice customer)     100
   Cr Sales Revenue                                         X
   Cr Tax Output                                             Y        (X+Y = 100)

2) Platform-collected "payment" (Option A/B shape; role name illustrative):
   Dr Platform Receivable/Clearing                         100
   Cr Accounts Receivable (same partner)                   100
   → invoice now shows is_paid/payment_status = paid against AR, with ZERO cash/bank movement.
      This is the same mechanical effect PaymentService already produces today via
      usesGatewayClearing(), applied to a new role instead of gateway_clearing.

3) Settlement (mirrors PaymentGatewaySettlementService's reconciliation equation):
   Dr Bank (net)                                             77
   Dr Platform Fee Expense (ex-tax)                          20
   [Dr Recoverable Input VAT ... only if DG-3 evidence supports it — NOT assumed]
   Cr Platform Receivable/Clearing                          100
   (gross 100 = net 77 + fee 20 + unexplained 3 → the 3 must stay visible/unreconciled,
    exactly as PaymentGatewaySettlementService::assertReconciled already enforces today;
    it must NOT auto-post to misc. expense, per the Horizon's own locked invariant.)
```

Step 2 is the step that needs DG-1's decision: *which role, which document field names the platform, and whether a partner-dimension is stamped.* Step 1 and step 3's *shape* are already proven by existing code; only the concrete role/account and the settlement document's own schema are new (and that is ACCOUNTING-1/SETTLEMENT-1 scope, not this packet's).

### Accounting consequences
- Steps 1 and 3's mechanics are already proven safe by existing tests (`PaymentGatewaySettlementAccountingTest`). Step 2 is the only genuinely new posting shape, and it is structurally identical to the already-shipped `gateway_clearing` path — low incremental risk *if* Option A is chosen; materially new risk if B or C is chosen without further review.
- Whichever option is chosen, the invoice's AR entry, COGS entry, and ZATCA document type are **unaffected** — DG-1 only changes what happens after the invoice is posted, never the invoice posting itself.

### Security/Tenant consequences
- A new role is tenant-configurable like every existing role (`AccountRoleMapping`), defaulting safely (no behavior for tenants that never configure a platform). No new cross-tenant surface beyond what `AccountRoleResolver` already guards.
- If Option B or C introduces a partner-like dimension, it must pass the same tenant-ownership assertions `PaymentGatewaySettlementService::assertSameTenant()` already applies to `gateway_clearing`, `provider_fee_expense`, and the bank account.

### Backward compatibility
- All three options are additive: no existing `Payment`, `Invoice`, or journal row needs backfill or reinterpretation. Tenants that never enable a delivery platform see zero behavioral change (consistent with DLV-FOUNDATION-1's own backward-compatibility test suite).

### Tax/ZATCA consequences
- None at step 1/2 (ZATCA document type and invoice VAT are already fixed at invoice-post time, unconditional on payment method — see DG-2/DG-3). Step 3's `fee_tax` handling is explicitly out of scope here (DG-3); `PaymentGatewaySettlementService` already refuses a nonzero `fee_tax` absent an approved routing policy, and any delivery-platform settlement service should inherit that same refusal until DG-3 is resolved.

### Risks
- Choosing Option B or C without a dedicated follow-up review could silently violate invariant #2 (customer/channel/counterparty conflation) or invent an unreviewed polymorphic concept.
- Reusing `payment_gateway_id`/`PaymentGateway` directly (not listed as an option above, and **explicitly not recommended**) would blur "payment gateway" and "delivery platform" despite the Horizon's own wording that a delivery platform is a Sales Channel + External Order Source + (sometimes) Settlement Counterparty, not a processor integration.

### External evidence
None required for DG-1 itself (it is an internal architecture question). DG-3's external evidence (fee-tax treatment, agent/principal role) materially affects step 3 above but not step 1/2's shape.

### Unknowns
- Whether tenants need per-platform GL visibility (favors Option B/C) or whether per-platform visibility via the settlement document alone is sufficient (favors Option A) is a **product** question, not something the repository can answer.

### Recommendation (not a decision)
Option A most directly extends a shipped, tested pattern with the least new surface, and defers the harder "platform as counterparty" modeling question to ACCOUNTING-1 once DG-2 decides where/whether a counterparty identity is even recorded at all before settlement exists. This is a recommendation for ACCOUNTING-1's starting point, not a closed decision.

### Exact owner decision required
> **Safwan:** confirm whether platform-collected consideration should (a) reuse a `gateway_clearing`-shaped sibling role per Option A, (b) carry a per-platform dimension on the clearing journal line per Option B, or (c) use `Partner` as the settlement counterparty per Option C — and whether per-platform GL-level reporting is a requirement now or can wait for the settlement document itself to carry that detail.

### Owner decision (RESOLVED 2026-10-03)
> **Option A.** Dedicated `platform_receivable_clearing` role, sibling in concept to `gateway_clearing`, exactly as described above. Binding constraints for ACCOUNTING-1's implementation:
> - preserve gross invoice/sale (step 1 above, unchanged);
> - clear invoice AR without fabricating cash/bank (step 2 above, via the new role);
> - record platform identity on the authoritative delivery/payment/settlement document (the `Payment` row and, later, the settlement document — **not** the GL account, **not** the journal line);
> - do **not** create a separate GL account per platform;
> - do **not** use `Partner` as the platform merely for convenience (Option C is closed);
> - do **not** require a platform dimension on `JournalLine` in V1 (Option B's per-line dimension is closed for V1).
>
> Per-platform reporting is required through subledger/document data (`Payment.delivery_platform_profile_id` and the eventual settlement document), not through separate GL accounts or journal-line dimensions. This closes Options B and C for V1; Option A is the implementation path for ACCOUNTING-1.

---

## DG-2 — Invoice customer + immutable snapshot location

### Question
Which `partner_id` does a POS delivery-platform sale's invoice carry, and where does AWJ record the immutable delivery context (channel, platform profile, configuration version, external reference, collection mode) without conflating it with Invoice Customer or Settlement Counterparty?

### Current repository evidence
- `PosController::checkout()` / `StorePosSaleRequest` require `partner_id` as a **mandatory** field today; `PosService::checkout()` validates the partner exists and is POS-eligible (`assertCustomerEligibleForPos`) before any invoice is created. There is no "no customer" path in the current contract.
- `PosSettings::isEligibleCustomer()` / `SalesConfigController::findEligiblePosCustomer()` is the existing mechanism for a tenant-configured **default/walk-in customer** — proven, tested, already used by cash-sale POS flows today.
- `Invoice` is `BelongsToBranch`; it has no channel/source/external-reference/config-version columns today (confirmed in DLV-EVIDENCE-1 §3, unchanged by FOUNDATION-1).
- `DeliveryPlatformProfile`/`DeliveryPlatformProfileVersion`/`DeliveryPlatformVersionOverride` (FOUNDATION-1, merged) already provide exactly the versioned, branch-aware configuration a snapshot needs to reference: `resolve($profile, $branchId, $versionId, $at)` returns `profile_id, platform_key, sales_channel_id, version_id, version_number, effective_from, collection_mode, external_reference_policy, branch_override_applied` — i.e. **everything this packet's required snapshot fields ask for already exists as a stable, immutable, resolvable structure**, except the external order reference itself (which is per-order, not per-configuration) and any settlement-counterparty dimension (DG-1-gated).
- `invoices` carries 34 prior alter-migrations (DLV-EVIDENCE-1 §3) — a hot table where every new column is permanent surface.
- Precedent for "resolved config stamped at creation time, never re-derived": `InvoiceService`'s thermal-receipt template revision is loaded and frozen onto the invoice at creation; `zatca_document_type`, once set, is never re-derived from a later VAT-number change (`zatcaDocumentType($data, $partnerId, $current)` returns `$current` if already one of the two valid values).

### Options

**1. `partner_id` choice**
   - **(a) Always the tenant's configured default/walk-in customer**, exactly like today's unattributed cash sales, via the existing `PosSettings`/`findEligiblePosCustomer` mechanism — zero new customer-identity logic.
   - **(b) The actual end customer when known** (e.g. a future API order carries a named customer) — requires a customer-resolution/creation path that does not exist for delivery orders today and is out of this packet's evidence.
   - **(c) A tenant-configurable choice between (a) and (b)**, consistent with CLAUDE.md's "policy is configured, not forced" architectural rule (rule 6) — every prior "which default" decision in this codebase (payment-method bootstrapping, POS default customer) has been built as a configurable policy with a behavior-preserving default, not a single hard-coded behavior.

   No option here changes `Invoice.partner_id`'s *meaning*: it remains strictly "the legal invoice customer," never the platform.

**2. Snapshot location**
   - **(a) New columns directly on `invoices`.** Cheapest to query, but permanent growth on an already-hot table, and (per CLAUDE.md's numbering/ICV precedent) this repo's convention is to keep tangential-but-adjacent concerns in **side tables** rather than widen core documents when the concern has its own lifecycle (see `InventoryOpening` vs. `Product`, `ZatcaIcvScope` vs. `invoices.zatca_icv` itself already being an exception CLAUDE.md calls out as *not* to imitate elsewhere).
   - **(b) A dedicated immutable side table** (e.g. `invoice_delivery_contexts` or similar — naming is implementation scope, not this packet's), `(invoice_id unique, sales_channel_id, delivery_platform_profile_id, delivery_platform_profile_version_id, external_order_reference, collection_mode)`, created once at invoice-creation time and never updated — directly mirroring `PosCheckoutAttempt`'s and `InventoryOpening`'s existing "additive side table, append-only" shape.
   - **(c) Reuse of an existing authority.** None exists: `CommerceOrder` is explicitly barred from this purpose (Commerce contract #8: "do not force ERP/POS flows through CommerceOrder"), and `SalesChannel` alone cannot carry a per-order external reference or a specific configuration-version pin.

   Option (b) is the only one that satisfies "immutable configuration references survive later edits" (Horizon §3 invariant) without widening `invoices` — because the row, once written, is never updated, and it points at a `delivery_platform_profile_version_id` that is *itself* already immutable (FOUNDATION-1).

### Accounting consequences
- None directly: the snapshot is informational/audit context, not a posting input. It must **never** be read by `LedgerService`/`AccountRoleResolver` to pick a posting path based on anything other than what `Payment`/`Invoice` already carry (collection mode informs *whether* a platform-clearing payment is created, per DG-1 — but the snapshot itself does not post).

### Security/Tenant consequences
- The snapshot FKs (`invoice_id`, `delivery_platform_profile_id`, `delivery_platform_profile_version_id`) must each be validated same-tenant at write time, exactly as `DeliveryPlatformConfigService` already does for the profile/version/override chain. External order reference must remain a free-text field with **no** authority (Horizon invariant #12 / CLAUDE.md "external IDs are not authority") — it is captured, never trusted for tenant/branch/customer resolution.

### Backward compatibility
- A new side table is purely additive; no existing invoice needs one. POS checkout's existing idempotency checksum (`checkoutRequestChecksum`) would need to incorporate the new optional fields (channel/version/external-ref) once POS-1 is scoped — noted here as a dependency, not solved here.

### Tax/ZATCA consequences
- None, provided `partner_id` stays the legal customer and the snapshot is never consulted by `zatcaDocumentType()`. This preserves the existing ZATCA derivation (VAT-number-driven, immutable once set) untouched.

### Risks
- If a future implementer is tempted to stamp the platform as `Invoice.partner_id` "for convenience," that directly violates invariant #2 and corrupts ZATCA document-type derivation (a platform is extremely unlikely to share the end customer's VAT registration). This packet's evidence is explicit that no current code path does this, and none should.

### External evidence
Not applicable to DG-2 (purely an internal data-model question).

### Unknowns
- Whether any evidenced provider contract (HungerStation/Keeta) supplies a real end-customer identity on inbound orders is unknown without the provider evidence named in DLV-EVIDENCE-1 §10 — relevant only to option 1(b)/1(c), not to the POS-manual flow this packet can fully reason about today.

### Recommendation (not a decision)
1(a) with 1(c) as a documented future extension point, plus 2(b) (dedicated immutable side table keyed by configuration version). This is the option set most consistent with today's proven `PosSettings` default-customer mechanism and the repo's own side-table convention for append-only, version-pinned context.

### Exact owner decision required
> **Safwan:** confirm (1) whether POS delivery sales should always use the tenant's existing default/walk-in customer today, with per-tenant choice of a real end customer deferred to a later task; and (2) confirm the snapshot lives in a new dedicated immutable side table (not new `invoices` columns) keyed to a specific `delivery_platform_profile_version_id`.

### Owner decision (RESOLVED 2026-10-03)
> **(1) `partner_id`:** for the current manual POS delivery flow, use the tenant's existing configured default/walk-in POS customer (Option 1(a)). The delivery platform must never become `Invoice.partner_id` merely because it collected the money. A future trusted end-customer identity sourced from provider APIs (Options 1(b)/1(c)) is deferred and must be separately designed and evidenced before it is built — it is not authorized by this decision.
>
> **(2) Snapshot location:** a dedicated immutable side table (Option 2(b)), not new `invoices` columns. The immutable context must pin at least: invoice, sales_channel, delivery_platform_profile, delivery_platform_profile_version, external_order_reference, collection_mode. External provider IDs are never authority (unchanged from the packet's evidence). Invoice Customer, Sales Channel, and Settlement Counterparty remain strictly separate — the snapshot records the channel/profile/version/reference/collection-mode context, never a counterparty identity (that remains DG-1/ACCOUNTING-1 scope, recorded on the `Payment`/settlement document, not here).

---

## DG-3 — Tax / ZATCA role (legal/tax decision gate — no inference)

### Question
What is each delivery platform's legal/tax role (agent-in-own-name vs. agent-in-principal's-name vs. simple payment collector), and what does that imply for ZATCA document identity, tax point, and recoverability of platform fee VAT?

### A) Repository-proven facts
- ZATCA document type (`standard` vs `simplified`) is derived **solely** from the invoice partner's `vat_number` matching `^\d{15}$` (`InvoiceService::zatcaDocumentType()`), and once set is never re-derived. It does not consider sales channel, payment method, or collector at all today.
- The invoice's taxable consideration (`sales_revenue`, `tax_output`) is computed from invoice line items alone (`applyItemsAndTotals`), independent of how/by whom the sale is later collected.
- `PaymentGatewaySettlementService::post()` **hard-refuses** any `provider_fee_tax > 0` with an explicit `DomainException` naming the reason ("not authorized until an approved input-tax routing policy exists") — this is the existing, tested precedent for "do not guess VAT recoverability," directly reusable verbatim for a delivery-platform settlement service.
- No code anywhere in this repository encodes agent/principal/collector role logic for any third party (payment gateway or otherwise) — ZATCA phase-2 signing (`ZatcaSigningCredentialResolver`, etc.) operates on the tenant's own credential/UUID/ICV chain and has no concept of a third-party principal.

### B) External official evidence
Per `AWJ_POS_DELIVERY_PLATFORMS_ACCOUNTING_UX_DECISION.md §2/§10/§15` (already gathered when that document was authored, re-cited here, not re-verified in this pass — this task did not perform new external fetches):
- ZATCA agency guideline distinguishes agents acting in the principal's name from agents acting in their own name (`zatca.gov.sa/.../Agents Guideline.pdf`).
- HungerStation and Keeta: `VERIFIED_PUBLIC_API` for POS/order integration capability; **no evidence in either source of a stated legal/tax role** (agent-in-own-name vs. collector) for VAT purposes.
- Jahez/Mrsool/The Chefz: `VERIFIED_PARTNER_INTEGRATION` (via Foodics), `PUBLIC_CONTRACT_UNVERIFIED` — no AWJ-held contract naming a tax role.
- Ninja: `ECOSYSTEM_INTEGRATION_VERIFIED`, `NATIVE_CONTRACT_UNVERIFIED` — weakest evidence tier of the six.
- **No merchant-platform contract for any of the six platforms has been obtained or read by AWJ as of this pass.** The accounting-decision document's citations are to ZATCA's general guidance, not to a specific executed contract with any of the six named platforms.

This Decision Pass performed **no new external fetch**; it reuses only what `AWJ_POS_DELIVERY_PLATFORMS_ACCOUNTING_UX_DECISION.md` already cites, dated 2026-10-02 in that document. No URL in this pass is newly re-verified; treat the citations above as inherited, not re-confirmed on today's date.

### C) Owner/tax decision required (every item below is currently UNKNOWN; none may be guessed)
1. **Per-platform legal role** (agent-in-own-name / agent-in-principal's-name / simple collector) — requires the actual signed merchant agreement per platform. **No such contract has been read.** Default posture per this pass: **UNKNOWN for all six platforms** until a contract is produced.
2. **Effect on ZATCA document identity/customer** — if any platform's contract establishes it as transacting in its own name with the end customer, AWJ's invoice-customer identity for that channel may need to differ from today's "always the end customer/default customer" assumption. This packet does **not** decide that; DG-2's recommendation (default/walk-in customer) stands only for the simple-collector case and must be revisited if contract evidence shows otherwise for any specific platform.
3. **Tax point** — whether the taxable event is recognized at order acceptance, fulfillment, or platform settlement is a contract/ZATCA-guidance question, not inferable from code.
4. **Platform fee VAT recoverability** — requires a valid tax invoice/credit note from the platform for its commission; `PaymentGatewaySettlementService`'s existing refusal of nonzero `fee_tax` without an approved routing policy is the only safe default until such evidence exists per platform.
5. **Per-platform variance, not a single AWJ-wide answer** — the evidence above shows HungerStation/Keeta, the Foodics-mediated trio, and Ninja sit at three different evidence tiers; a uniform tax-role assumption across all six is explicitly unsupported by the record.

**No contract has been obtained for any of the six platforms during this pass.** Every item in this section is `OWNER_GATE` per the Horizon's own rule ("No evidence = owner_gate / blocked, not guessed implementation").

### Accounting consequences
Steps 1–2 of DG-1's worked example are **unaffected** by DG-3 (invoice posting and the platform-clearing debit/credit do not depend on tax role). Step 3 (settlement fee/fee-tax posting) is fully gated by DG-3: no `fee_tax` may post for any platform until that platform's specific evidence resolves item 4 above.

### Security/Tenant consequences
None beyond what DG-1/DG-2 already name; this is a pure tax-classification question, not a security boundary.

### Backward compatibility
None affected — no historical journal is reinterpreted by this packet, consistent with invariant "historical journals are never reinterpreted."

### Risks
Implementing any commission/settlement posting that assumes recoverable VAT, a specific tax point, or a specific legal role for any of the six platforms, without a contract, risks a ZATCA compliance defect that would surface only at phase-2 integration time — explicitly called out in DLV-EVIDENCE-1 as a "damage appears at integration time, not configuration time" risk class (mirroring the existing `ZatcaIcvScope` lesson).

### External evidence still required
A signed/executed merchant agreement (or official partner-program terms naming the tax role) for each of the six platforms individually. None currently held by AWJ for any of the six.

### Unknowns
All of section C above.

### Recommendation (not a decision — this is an owner/tax gate by the Horizon's own rule)
Treat DG-3 as blocking any **settlement** posting (SETTLEMENT-1) for every platform until that specific platform's contract is read; it does **not** block DG-1's steps 1–2 (invoice + platform-clearing payment), which are tax-role-independent.

### Exact owner decision required
> **Safwan:** produce (or confirm AWJ does not yet hold) a signed merchant agreement or official tax-role statement for each of the six platforms. Until produced, confirm that ACCOUNTING-1 may proceed with DG-1 steps 1–2 (gross-preserving invoice + clearing payment, tax-role-independent) while SETTLEMENT-1/COMMISSION-1 (fee/fee-tax posting) remain blocked per-platform pending that evidence.

### Owner decision (PARTIALLY RESOLVED / EXTERNAL EVIDENCE GATE — 2026-10-03)
> For all six platforms, legal/tax role remains **UNKNOWN** until platform-specific official contract/terms evidence is obtained. One platform's tax treatment is never inferred from another's — each of the six is evaluated independently when its evidence arrives.
>
> **Authorized now:** ACCOUNTING-1 may proceed, but **only** for the tax-role-independent/simple-collector foundation DG-1 and DG-2 establish — normal gross invoice, platform clearing of AR, no fabricated cash/bank (DG-1's steps 1–2).
>
> **Not authorized by this decision** (for any platform, pending its own contract evidence): platform commission VAT recovery; `fee_tax` posting; platform-specific tax-point assumptions; agent/principal tax treatment; any settlement tax treatment requiring contract evidence. These remain blocked on SETTLEMENT-1/COMMISSION-1 per platform, exactly as the packet's own recommendation already stated.
>
> **Important — scope of this authorization:** this does not state that DG-1/DG-2 behavior is universally correct for every provider regardless of contract. It is the currently authorized simple-collector foundation only. If a provider's contract later establishes a materially different legal role (e.g. that provider transacts with the end customer in its own name), that provider's integration must stop at its own gate, and its invoice/customer/tax treatment must be reviewed before activation — the foundation built for the simple-collector case is not assumed to carry over unreviewed.

---

## Dependency Matrix (recomputed after the 2026-10-03 owner decisions)

| Task | Depends on | Status after owner decisions | Why |
|---|---|---|---|
| **DLV-ACCOUNTING-1** | FOUNDATION-1 (done) + DG-1 (resolved) + DG-2 (resolved) + DG-3 (bounded) | **READY — bounded scope only** | DG-1 closes the posting shape (Option A, `platform_receivable_clearing`), DG-2 closes the customer/snapshot question (default/walk-in customer + dedicated immutable side table), and DG-3 explicitly authorizes exactly this bounded scope (gross invoice + AR clearing, no fabricated cash/bank) as the tax-role-independent simple-collector foundation. **Scope is bounded**: no `fee_tax`, no commission VAT recovery, no tax-point assumption, no per-platform GL account, no `JournalLine` platform dimension, no `Partner`-as-platform. Those remain out of ACCOUNTING-1 by the owner's own decision and stay with SETTLEMENT-1/COMMISSION-1, each still blocked. **Not started by this pass** — DELIVERY-DECISION-PASS-1 recorded the decision only; implementation is a separate authorized task. |
| **DLV-POS-1** | FOUNDATION-1 (done) + DG-2 (resolved) + DG-8, DG-9 (untouched) | **BLOCKED** (narrowed) | DG-2 is now resolved and no longer blocks POS-1. DG-8 (channel-price precedence vs. partner price list) and DG-9 (dedicated capability key/permission strings) are **untouched by this owner-decision pass** — it covered DG-1/DG-2/DG-3 only. POS-1 remains blocked until DG-8 and/or DG-9 are themselves resolved or explicitly scoped out of a first POS-1 slice. |
| **DLV-HUB-1** | FOUNDATION-1 (done) + DG-6, DG-9 | **BLOCKED** (unchanged) | DG-6 (inventory-consumption event for API-ingested orders, `CommerceOrder` vs. separate projection) and DG-9 (capability key/permissions) are untouched by this pass — out of its scope (DG-1/2/3 only). |
| **DLV-SETTLEMENT-1** | ACCOUNTING-1 (now ready, bounded) + COMMISSION-1 + DG-3 (per-platform, unresolved) | **BLOCKED** | DG-3's owner decision explicitly withholds authorization for fee/fee-tax/commission posting per platform until that platform's own contract evidence exists. Remains blocked regardless of ACCOUNTING-1's bounded readiness. |

**Net effect of this owner-decision update:** **DLV-ACCOUNTING-1 is now dependency-ready**, strictly bounded to the tax-role-independent simple-collector foundation named in the DG-3 decision — implementation is a separate, not-yet-started task. **DLV-POS-1 remains BLOCKED**, narrowed from three blocking gates to two (DG-8, DG-9), neither touched by this pass. DLV-HUB-1 and DLV-SETTLEMENT-1 are unchanged. DG-5 remains resolved (from DLV-EVIDENCE-1); DG-1/DG-2 are now resolved/RESOLVED, DG-3 is PARTIALLY RESOLVED (external evidence gate, per-platform); DG-4, DG-6, DG-7, DG-8, DG-9 are unchanged and remain open.
