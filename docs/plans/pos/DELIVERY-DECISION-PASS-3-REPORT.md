# DELIVERY-DECISION-PASS-3 — DG-9-HUB and DG-6-TRIGGER

**Task:** DELIVERY-DECISION-PASS-3
**Horizon:** `docs/plans/pos/AWJ_DELIVERY_PLATFORMS_HORIZON_V1.md` (ACTIVE)
**Nature:** evidence / architecture / documentation only. No production code, migration, API, Hub, webhook, connector, pricing change, permission string, commission, settlement, refund, or accounting change.
**Base SHA (`origin/main` at start):** `42c0deb91909755fa1e59cada84fa90f57a897cd`
**That SHA is the squash of PR #1194 (DLV-POS-1).** It was the tip of `origin/main` when this branch was cut. This file does not embed its own commit hash.
**Prior evidence reused, not re-opened:** Decision Pass 1, Decision Pass 2, DLV-FOUNDATION-1, DLV-ACCOUNTING-1, and the merged DLV-POS-1 behavior. DG-1, DG-2, DG-5, DG-8, DG-9-POS, and the accepted narrowing of DG-6 are not re-decided.

Nothing below reopens DG-8-IMPORT or DG-3. Those stay **OPEN**. No Hub, connector, permission string, or accounting code is added by recording these acceptances.

## Owner acceptances (2026-10-03)

Safwan accepted two decisions **as written in this report**. They are Owner Decisions. They are not a merge and not a deploy.

| ID | Status | What was accepted | What was not accepted |
|---|---|---|---|
| **OD-DG-9-HUB** | **ACCEPTED** | §5. `delivery_hub.view` and `delivery_hub.operate`. Financial posting, later, still needs existing `invoices.manage` plus `delivery_hub.view`. No new posting permission. Branch fail-closed. | §9's full state table, §14 order identity, and any implementation. |
| **OD-DG-6-TRIGGER** | **ACCEPTED** | §8 shape. No operational status posts. An explicit command is the only transition. One transaction. Platform clearing has no drawer. Merchant-collected creates no invented tender. | Building or enabling that command. §8 itself says it must not be implemented until DG-8-IMPORT, and must not recognize VAT for a named platform until DG-3. |

Sections that still say **RECOMMENDATION — NOT ACCEPTED** were not accepted. DG-8-IMPORT and DG-3 are not decided here.

---

## 1. What this pass is allowed to resolve

| Question | Classification | Result in this PR |
|---|---|---|
| DG-9-HUB — who may view or operate a Delivery Hub inbox | **ACCEPTED** (OD-DG-9-HUB) | §5 is now the decision. No permission string is added in this PR. |
| DG-6-TRIGGER — when an operational order may become a posted `Invoice` | **ACCEPTED** as the command shape (OD-DG-6-TRIGGER). **EXTERNAL EVIDENCE REQUIRED** before that command may be built or may recognize VAT. | §8 is the decision. DG-8-IMPORT blocks building it. DG-3 blocks enabling VAT recognition. Gate is not an implementation permit. |
| Projection-only Hub with no invoice | Authorization blocker cleared. Still not `ready`. | Not a queue task. Not started. §9 and §14 were not accepted. |
| DLV-HUB-1 (full, including a financial transition) | **BLOCKED** | Trigger shape is accepted. The command is still not implementable. |

---

## 2. Evidence map

Repository facts read on this base. Not a second full delivery investigation.

| Authority | Fact used here |
|---|---|
| `app/Support/Rbac.php` | `owner`/`admin` are `*`. `accountant` gets financial document permissions, including `invoices.manage` and `delivery_notes.*`, but not the later opt-in powers (`pos.audit.*`, `customer_refunds.*`, `commerce.manage`). `staff` is view-only on those documents. `self_service` is only `self_service.access`. There is no `delivery_hub.*` permission. |
| `routes/api.php` checkout | POS sale is `invoices.manage` + application `sales.pos`. DLV-POS-1 did not add a permission. |
| `ApplicationCatalog` `sales.pos` | Optional application gate depending on mandatory `sales.invoicing`. It is not an RBAC permission string. |
| `routes/api.php` delivery notes | Comment on the route group: delivery notes are an operational document. `confirm` uses `delivery_notes.confirm`. Creating a sales-invoice **draft** uses a different permission, `delivery_notes.invoice`. Posting an invoice stays `POST invoices/{id}/post` with `invoices.manage`. |
| `DeliveryNoteService::confirm` | Locks the note, flips status to confirmed, writes an event. It does not call `InvoiceService` or inventory. |
| `DeliveryNoteSalesInvoiceDraftBuilder` | Explicit command. Builds one draft through `InvoiceService::create()`. Idempotency key is unique per tenant+branch. It does not post. |
| `InvoiceService::post` | The canonical post. Locks the draft, rebuilds totals from lines, posts the journal, then `InventoryService::recordSaleCogs` unless a caller passes another COGS resolver. Double-post is rejected. |
| `DeliveryInvoiceContextService::record` | Pins channel/profile/version/collection mode only on an already posted invoice. `platform_collected` is rejected if the invoice is already paid. |
| `payments` / DLV-POS-1 | Platform clearing is `PaymentService` with `delivery_platform_profile_id`, `method=bank`, and **no** `pos_session_id`. Gross invoice stays canonical. Partner stays the POS customer. |
| `delivery_invoice_contexts` migration | `unique(invoice_id)`. `external_order_reference` is explicitly **not** unique and is documented as not an identity. |
| `User::allowedBranchIds` / `canAccessBranch` | `null` means unrestricted inside the tenant. A non-empty assignment is an allow-list. `[]` is never returned. `canAccessWarehouse` is the same shape. |
| `PosInvoiceBranchAccessTest` | A direct id outside the user's branches is denied. Existence of the other branch's document is not treated as authority. |
| Warehouses | `warehouses.is_default` exists and is documented as the warehouse for movements that omit one. That is a silent default. It is not a delivery-store mapping. |
| `CommerceOrder` | Already rejected for the Hub by OD-DG-6. Not reopened. |
| `ReturnService::post` | Posted-document reversal authority for a commercial return. No delivery-platform refund path exists. |
| Quotes route comment | Converting a quote creates a draft invoice, not a posted one. |

---

## 3. DG-9-HUB evidence

The question is who may see operational delivery orders, who may move them before any invoice exists, and who may cause a canonical sale. Those are different privileges.

### What was tested and rejected as the Hub authority

| Candidate | Why it is not the Hub permission |
|---|---|
| No new permission, reuse `invoices.manage` + `sales.pos` | This is the accepted POS **selection** rule (OD-DG-9). It is the wrong reuse for an inbox. `invoices.manage` can create, edit, delete drafts, and post invoices. `sales.pos` turns on the cashier application. A dispatcher who may accept an order would become a full invoice clerk and a POS seller. A cashier who may sell would see and mutate every branch's operational queue if the same permission were used without a new scope. Pass 2 already rejected one permission that covers both selection and Hub actions. |
| `invoices.view` | Read of accounting invoices, not of an operational queue. Granting the inbox to every invoice reader publishes operational orders to roles that were not given an operations job. Hiding the inbox behind `invoices.view` also forces a kitchen role to hold invoice read. |
| `delivery_notes.view` / `manage` / `confirm` / `cancel` | Proven split between operating a document and invoicing it, which is the pattern to copy. The aggregate is the merchant's own delivery note, not a marketplace order. `confirm` does not post, but `manage` still creates that other document. Reusing the string would authorize the wrong records. |
| `delivery_notes.invoice` | This is the financial hand-off for delivery notes, and it only builds a draft. It is evidence that the hand-off is a separate permission. It is not a reusable string for platform orders. |
| `commerce.manage` | Storefront provisioning. Owner/admin via `*`, not an inbox role. |
| `sales.pos` alone | Application flag. It does not name a user action and does not scope a branch queue. |

### What the repository does instead when a privilege is different

Later permissions are not added to `accountant` or `staff` automatically. Examples already on this base: `pos.cash_drawer.open`, `pos.variance.approve`, `customer_refunds.manage`, `supplier_refunds.manage`, `commerce.manage`. The owner grants them on a custom role. Delivery-note invoicing is the closest document split: view, manage, confirm, cancel, and invoice are different middleware gates.

Branch authority is already not a permission string. It is `BranchContext` plus `User::canAccessBranch()`. A user assigned to branch A does not gain branch B by holding a broader document permission. Unrestricted means no branch rows, not "all branches including another tenant".

**Classification:** **PROVEN REUSE** of the view/operate/financial split and of branch allow-lists. **PROVEN NON-REUSE** of `invoices.manage`, `sales.pos`, and `delivery_notes.*` as the Hub capability. **ACCEPTED** as OD-DG-9-HUB for the two new strings. Those strings are not added to `Rbac` in this PR.

---

## 4. DG-9-HUB options

| Option | Meaning | Verdict |
|---|---|---|
| A. Reuse `invoices.manage` + `sales.pos` for the inbox | One less permission | Rejected. It grants accounting and POS authority in order to accept an order. |
| B. Reuse `delivery_notes.*` | Copies a real split, wrong document | Rejected. |
| C. New inbox permissions, and the existing invoice permission only for the financial command | View and operate do not post. Posting still requires `invoices.manage`. | **ACCEPTED as OD-DG-9-HUB.** Not implemented in this PR. |
| D. One new `delivery_hub.manage` that also posts | Smaller matrix, second accounting authority | Rejected. The Hub must not become a posting role. |

---

## 5. DG-9-HUB decision

**OD-DG-9-HUB — ACCEPTED 2026-10-03.** The text below is the decision. It does not add the permission strings in this PR, and it does not start a Hub.

1. Add two permissions, not granted to `accountant`, `staff`, or `self_service` by default. `owner` and `admin` receive them only through existing `*`.
   - `delivery_hub.view` — list and read operational orders in scope.
   - `delivery_hub.operate` — route, accept, reject, cancel before posting, preparing, ready, and operational handoff. No invoice, payment, journal, or stock method may be called under this permission alone.
2. Do not add `delivery_hub.post` or `delivery_hub.invoice`. The financial command in §8, when it is later built, requires the existing `invoices.manage` **in addition to** `delivery_hub.view` on that order. `delivery_hub.operate` is neither necessary nor sufficient to post. A pure operator cannot post. A pure invoice clerk cannot see or move orders they are not allowed to view.
3. `sales.pos` is not required. The Hub path is not `PosService::checkout` and must not open or attach a POS session. DLV-POS-1 remains the only path that sells from a cashier session.
4. Configuration of platform profiles stays on today's admin authority (`company.manage`, plus the existing `sales.pos` application gate on those routes). This decision does not move it.
5. Branch rule, fail closed:
   - The list is the active branch, and only if `canAccessBranch` is true.
   - A direct id for another branch, or for a branch the user cannot access, is not found. It is not mutated and it does not reveal the other branch's payload.
   - A user restricted to branch A cannot see or mutate branch B.
   - An order with no resolved branch is not inserted into a branch inbox and is not posted. Only a user with `delivery_hub.view` and **no** branch restriction may see that unrouted queue. Routing it onto a branch is `delivery_hub.operate` plus access to the destination branch.
6. This does not change DLV-POS-1. Selecting a platform on a sale the user can already post still needs no new permission.

### Answers to the authorization questions

| Question | Accepted decision |
|---|---|
| Who may view? | `delivery_hub.view` inside the branch rule above. |
| Who may accept, reject/cancel before post, prepare, ready, hand off? | `delivery_hub.operate` inside the same branch rule. |
| Who may start the canonical sale? | `invoices.manage` and `delivery_hub.view` on that order, and only through the explicit command in §8. Not `operate` alone. Not `sales.pos`. The command itself is still not implementable; see §8. |
| Reuse or dedicate? | Dedicate the inbox. Reuse `invoices.manage` only for the financial command. |
| Minimum design | Two new strings. No new financial permission. No grant on existing limited roles. |

---

## 6. DG-6-TRIGGER evidence

OD-DG-6 already fixed the pre-post boundary: receive, route, accept, prepare, and cancel-before-post create no revenue, VAT, COGS, stock, cash, bank, or AR clearing. This pass only examines the crossing.

Facts that constrain the crossing:

1. The only method that posts a sale and its COGS is `InvoiceService::post`. POS checkout calls it. It does not ask the Hub, because there is no Hub.
2. Operational cousins do not post on status change. Delivery-note confirm does not invoice. Quote conversion creates a draft. The invoice draft builder does not post.
3. `DeliveryInvoiceContextService::record` requires a posted invoice and, for `platform_collected`, an unpaid one. The context must be written after post and before a clearing receipt. DLV-POS-1 already does that inside one database transaction, then posts the clearing receipt with no cash, no bank journal, and no `pos_session_id`.
4. `external_order_reference` cannot be the idempotency key. The accounting migration says so, and it is not unique.
5. There is no store-id → branch table. A platform profile is company-wide. A branch override changes collection mode and reference policy only. It does not identify an inbound provider store.
6. `InvoiceService::post` recognizes output VAT at post time using the invoice lines. ADR material already cited in Pass 2 refused a default legal invoice clock. DG-3 still forbids treating a software clock as a provider's legal tax point.
7. After a document is posted, reversal of a commercial return is `ReturnService::post`, not a status edit. Customer cash refunds are a further permission (`customer_refunds.manage`) and are out of scope here.

**Classification of the shape:** **PROVEN REUSE** of `InvoiceService::post`, context-then-clearing, and "status is not a posting event". **ACCEPTED** as OD-DG-6-TRIGGER for the explicit command and the merchant-collected "no invented tender" rule. **EXTERNAL EVIDENCE REQUIRED** (DG-8-IMPORT, then DG-3) before that command may be built or enabled.

---

## 7. DG-6-TRIGGER options

| Option | What would post | Risk |
|---|---|---|
| A. Post automatically on accept | `InvoiceService::post` inside accept | A cancel after accept is already a refund. Inventory and VAT move before the merchant has asked for a sale. Rejected. |
| B. Post automatically on ready or handoff | Same, later clock | Still an implicit tax-recognition event. Still rejected as an automatic clock. DG-3 is not satisfied by picking "handoff". |
| C. Explicit command. No operational status posts. | Operator or integrator calls one server action. The action is the only system recognition event. | **ACCEPTED as OD-DG-6-TRIGGER.** Legal timing per platform stays DG-3. Building it stays blocked on DG-8-IMPORT. |
| D. Leave the trigger unspecified and block every Hub, including a projection | — | Rejected. Pass 2 already separated the projection from the trigger. |

---

## 8. DG-6-TRIGGER decision

**OD-DG-6-TRIGGER — ACCEPTED 2026-10-03.** The shape below is the decision. Acceptance does **not** authorize building the command and does **not** close DG-8-IMPORT or DG-3.

### System recognition

- No operational state posts an invoice. Not `received`, `accepted`, `preparing`, `ready`, or handed off.
- Acceptance does **not** post. Cancel-after-accept and before the command stays operational: no reversal, because nothing was posted.
- A future explicit command, in the same style as `POST delivery-notes/{id}/confirm` and `POST invoices/{id}/post`, is the only transition. A `PATCH` of status to "posted" is not that command. The route name is not locked by this document.
- The command is enabled only when the order is already `accepted`, `preparing`, `ready`, or operationally handed off, has a branch, is not cancelled, and is not already linked to an invoice. `received` and `unrouted` cannot post. This window is a system precondition, not a statement that any of those states is the legal tax point.

### Canonical authority inside one transaction

The command, when implemented later, must run in one database transaction:

1. Lock the operational order.
2. Re-check tenant, branch, actor permissions, and the preconditions below.
3. Create and `InvoiceService::post` the invoice. Stock and COGS move only inside that post, through the existing inventory call. The Hub does not call inventory itself.
4. `DeliveryInvoiceContextService::record` with the resolved profile version, collection mode, and the display reference.
5. If the resolved mode is `platform_collected`: one clearing receipt for the invoice total, same contract as DLV-POS-1 (`delivery_platform_profile_id`, no `pos_session_id`, no cash account in the journal, no drawer expectation).
6. If the resolved mode is `merchant_collected`: stop after the invoice and the context. Do **not** create a cash, bank, or drawer tender. Recording the money the courier handed over stays on the existing payment authority, later, with real tender evidence. Fabricating cash here would reopen DG-4.
7. Link the order to that one invoice and mark it financially posted **in the same transaction**. If any step throws, the order must not say posted.

`Invoice.partner_id` stays the canonical customer or walk-in. The platform never becomes the partner (DG-2). Price and tax on that invoice are not decided for imported orders; see §15. Until §15 is accepted, this accepted command must not be implemented.

`PosService::checkout` is not the Hub authority. It requires an open POS session and is the manual cashier path already shipped.

### Preconditions before the command may run

All fail closed. No default branch. No default warehouse when more than one active warehouse exists on the branch. No use of `warehouses.is_default` to break a tie.

| Precondition | Rule |
|---|---|
| Tenant | Order, profile, customer, warehouse, and invoice share the active tenant. Foreign ids do not resolve and do not leak a name. |
| Branch | Already routed, immutable, and `canAccessBranch`. Client `branch_id` does not override it. |
| Warehouse | Explicit `warehouse_id` on the command, active, belonging to that branch, and `canAccessWarehouse`. If the client omits it, derive one only when that branch has exactly one active warehouse. Zero or many: reject. |
| Customer | A real customer or the tenant walk-in. Not the platform profile. |
| Lines | Every line mapped to a tenant product, variant, and UOM the invoice path already accepts. Unmapped line: reject the whole command. No partial invoice. |
| Quantity | Positive, using the existing document quantity rules. |
| Platform | Active profile, active version, external channel slug still matches `DeliveryPlatformCatalog`. Same fail-closed message style as DLV-POS-1. |
| Collection mode | Taken from `DeliveryPlatformConfigService::resolve` for that branch and version. Client `collection_mode` is ignored or rejected, as on POS checkout. |
| Display reference | Stored if the pinned reference policy allows it. It is not the idempotency key. |
| State | See the window above. |
| Idempotency | See §14. |

### What this decision deliberately does not decide

Shipping the command would recognize VAT at `InvoiceService::post`. That is a legal tax point only if the platform's evidence says so. **No platform has that evidence in the repo.** Therefore, even after OD-DG-6-TRIGGER:

- Accepting the command **shape** does not authorize implementing or enabling it.
- **DG-8-IMPORT stays OPEN.** The command must not be implemented until imported-order price authority is an Owner Decision. This acceptance does not choose that price.
- Per platform, the command stays **EXTERNAL EVIDENCE REQUIRED** under DG-3 until Safwan has a source for that platform's tax point, or explicitly accepts a temporary "system recognition only, not a legal tax-point claim" policy for that platform. DG-3 is not decided here.
- This does **not** turn a projection-only Hub into a financial task. A projection still must not call `InvoiceService`.

---

## 9. Operational state machine boundary

**RECOMMENDATION — NOT ACCEPTED**, except for the posting window already named inside accepted §8.

OD-DG-6-TRIGGER accepts only this window: the command may run from `accepted`, `preparing`, `ready`, or operationally handed off, and must not run from `received` or `unrouted`. The table below is still a vocabulary, not a schema, and was not itself accepted. Do not treat it as permission to create the states.

| State | Who sets it | Financial effect |
|---|---|---|
| `unrouted` | Ingestion when store→branch mapping is missing or ambiguous | None. Not in a branch inbox. |
| `received` | Successful route onto one branch | None. Branch becomes set. |
| `accepted` | `delivery_hub.operate` | None. Branch becomes immutable. |
| `preparing` | `delivery_hub.operate` | None. |
| `ready` | `delivery_hub.operate` | None. |
| `handed_off` | `delivery_hub.operate` | None. Operational completion is not a sale. |
| `cancelled_before_post` | `delivery_hub.operate` | None. Terminal for operations. |
| `posted` | Only the financial command in §8 | The invoice path, and only that path, has already succeeded in the same transaction. An operator cannot set this state. |

Provider-native status text, if a future connector sends it, is stored as evidence. It does not drive this table and it does not post.

Branch immutability: a restricted user cannot reroute. Before `accepted`, an unrestricted operator may assign or correct the branch because nothing financial exists. At `accepted` and after, the branch does not change. A wrong branch is cancel-before-post plus a new projection, not an edit.

---

## 10. Financial transition boundary

The Hub is not a second ledger.

```text
connector or manual intake
        → operational order (tenant, then branch once routed)
        → received / accepted / preparing / ready / handed_off / cancelled_before_post
        → explicit command only   [SHAPE ACCEPTED; do not build until DG-8-IMPORT; do not enable VAT until DG-3]
        → InvoiceService::create + InvoiceService::post
        → DeliveryInvoiceContext
        → platform_collected clearing receipt   OR   merchant_collected with no tender
```

Manual POS sales that already have an invoice stay on DLV-POS-1. They do not need a Hub row in order to remain valid. A later projection may mirror them. It must not post them again.

---

## 11. Tenant isolation

Company-wide configuration (platform profile, channel) stays company-wide. Operational orders must be tenant-owned and must not use a company-wide scope that ignores `branch_id`. Lookup by a foreign tenant's order id returns nothing. Error text does not include the other tenant's display name, matching DLV-POS-1.

---

## 12. Branch isolation

See §5.5 and §9. Another branch's order is not readable or mutable. Missing mapping does not fall through to the caller's active branch or to the tenant's first branch.

---

## 13. Warehouse resolution

Warehouse is a posting input, not an inbox attribute required at `received`. The POS device warehouse is not a source, because this path has no POS session. Ambiguous or missing warehouse fails the command. Operational states do not move stock, so they do not need a warehouse to accept or prepare.

---

## 14. Order identity and idempotency

**RECOMMENDATION — NOT ACCEPTED.**

Two different values:

| Value | Role |
|---|---|
| Provider order id | Identity. Required for any order that claims an external origin, including a future connector and a manual/import row that has a real provider id. |
| External reference / display number | What a person reads. Optional according to the existing reference policy. Never the only uniqueness key. |

Uniqueness of the operational row:

`tenant_id + delivery_platform_profile_id + provider_order_id`

Branch is **not** part of that key. The same provider id posted once per branch would be two sales. A second delivery of the same triple conflicts. It does not create a second order.

The financial link is one operational order → one invoice, plus the existing `unique(invoice_id)` on `delivery_invoice_contexts`. A retry of the command with the same identity returns the original invoice, context, payment, journal, and stock result. The same key with a different line, price, customer, warehouse, or profile conflicts. No second invoice.

`PosCheckoutAttempt` is the cashier-session mechanism. Do not overload it for Hub orders. The delivery-note draft builder is the closer pattern (dedicated idempotency row, checksum, conflict on a changed payload). That is a pattern citation, not a schema in this PR.

Manual orders that have no provider id yet are a separate case. They need an AWJ-generated id created once at intake, not a human-typed reference, or a retry can duplicate them. This pass does not design that generator.

---

## 15. Pricing authority status

| Path | Status |
|---|---|
| Manual POS selection | **ACCEPTED** under OD-DG-8. Catalog / customer price list. No channel price. Not reopened. |
| Imported or connector order | **NEW DECISION REQUIRED.** Not chosen here. |

Using the AWJ catalog can disagree with the amount the platform collected. Using the provider's unit price can bypass the POS price list, minimum-price permission, and the catalog tax rate. Both are material. This pass does **not** pick one. The financial command in §8 must not be implemented until this choice is an Owner Decision. The projection-only slice does not price anything, so it does not need this choice.

Proposed gate name, not opened as an acceptance: **DG-8-IMPORT**. It does not weaken OD-DG-8.

---

## 16. Inventory and COGS

Operational states do not create `StockMovement` and do not post COGS. The only Hub-related stock movement, later, is the one `InvoiceService::post` already performs for any posted sale. Printing, preparing, or handing off does not move stock. A failed post rolls stock back with the transaction.

---

## 17. Cancellation before posting

Operational only. No journal, no VAT reversal, no stock reversal, no clearing receipt. Allowed from any non-posted state under `delivery_hub.operate` and the branch rule. After cancel, the financial command is rejected.

---

## 18. Cancellation and refund after posting

Not implemented here. A Hub status must not void a posted invoice. Reversal goes through the existing return / credit-note authority (`ReturnService`) and, where cash actually moves back to a customer, the existing customer-refund permission. Platform-clearing reversal is still **DLV-REFUND-1**, which stays blocked. This pass only records that boundary.

---

## 19. Tax and ZATCA boundary

Unchanged. DG-3 remains an external-evidence gate. This pass does not decide commission VAT, fee VAT, agent versus principal, or a provider's legal tax point. The recommended command would recognize VAT only because `InvoiceService::post` already does, and that recognition stays unauthorized to enable until DG-3 is satisfied for that platform. Projection, routing, and cancel-before-post do not recognize VAT at all.

---

## 20. Security implications

- Inbox permissions do not imply `invoices.manage`, `payments.manage`, `sales.pos`, or cost visibility.
- `invoices.manage` does not imply the ability to list another branch's operational orders.
- Foreign tenant and foreign branch fail closed.
- Client-supplied collection mode, version, GL account, commission, and tax treatment are not authority. The POS checkout rule is the pattern.
- Provider payloads are not trusted for branch, warehouse, price, or tax until the matching Owner Decision exists. Until then they are not posted.
- No secret, token, or webhook authenticity design is in this pass (that remains DG-7 / connector work).

---

## 21. Backward compatibility

No route, permission, schema, or POS behavior changes in this PR. Existing cashier sales, delivery notes, quotes, and invoice posting are untouched. The recommended permissions would be opt-in later, so current `accountant` and `staff` roles would not gain or lose rights if they are added the way `customer_refunds.*` was added.

---

## 22. Remaining Decision Gates

| Gate | After this pass |
|---|---|
| DG-1, DG-2, DG-5, DG-8 (POS), DG-9-POS | Unchanged. Accepted or resolved earlier. |
| DG-6 architecture (Option B, pre-post has no ledger effect) | Unchanged. Accepted. |
| DG-9-HUB | **ACCEPTED 2026-10-03** as OD-DG-9-HUB (§5). Not implemented. |
| DG-6-TRIGGER | **ACCEPTED 2026-10-03** as OD-DG-6-TRIGGER (§8 shape only). Building the command stays blocked on DG-8-IMPORT. Enabling VAT recognition stays DG-3. |
| DG-8-IMPORT | **OPEN / PROPOSED.** Not accepted in this update. Does not reopen OD-DG-8. Blocks building the financial command. Does not by itself block a projection that posts nothing. |
| DG-3 | **OPEN** external evidence. Still blocks commission, settlement, fee tax, and enabling the trigger's VAT recognition. Not decided here. |
| DG-4 | **OPEN.** Close/Z-report. Untouched. The accepted trigger still refuses to attach Hub clearing to a POS session. |
| DG-7 | **OPEN.** Connectors. Untouched. |
| §9 state table, §14 order identity | **NOT ACCEPTED.** Recommendations only. They are why the projection slice is not `ready`. |

---

## 23. Effect on the Horizon queue

- DLV-POS-1 is merged on this base (PR #1194, squash `42c0deb91909755fa1e59cada84fa90f57a897cd`). This pass does not redo its post-merge review and does not deploy.
- OD-DG-9-HUB and OD-DG-6-TRIGGER are recorded as accepted. This PR is still not merged.
- No implementation task is marked `ready`.
- DLV-HUB-1 is not started. The accepted trigger is not a build permit.

---

## 24. DLV-HUB-1 readiness

**BLOCKED.** Not partially ready as a single task.

OD-DG-9-HUB and OD-DG-6-TRIGGER remove the open authorization question and the open "what posts" question. They do not remove DG-8-IMPORT or DG-3. The full task includes a financial transition. That command must not be implemented until imported price authority is accepted, and must not be enabled until DG-3 is satisfied for that platform. Option B being accepted is not readiness.

---

## 25. Smallest slice — status after the two acceptances

**NOT READY. Not a queue row. Not started. Do not implement it from this PR.**

What changed:

- OD-DG-9-HUB clears the authorization blocker. View/operate versus `invoices.manage`, and the branch fail-closed rule, are decided.
- OD-DG-6-TRIGGER confirms that a projection must not post. Accept, prepare, ready, handoff, and cancel-before-post still create no revenue, VAT, COGS, stock, cash, bank, or AR clearing. The slice does not need the financial command, DG-8-IMPORT, or DG-3.

What does **not** change:

- The slice's own contents still include the §9 state table and the §14 identity uniqueness. Those two sections were **not** accepted.
- Promoting the slice to `ready` would silently accept a schema and an order-identity key. That is not done.
- No task named projection-only Hub is added to the queue.

Included only after a later acceptance of §9 and §14, and still not in this PR:

- tenant operational orders;
- `delivery_hub.view` and `delivery_hub.operate` exactly as accepted in §5;
- branch routing and the fail-closed rules in §5 and §12;
- the non-posting states, including cancel-before-post;
- identity uniqueness in §14 for rows that have a provider order id;
- preserved provider status text as inert evidence.

Still excluded:

- any call to `InvoiceService`, `PaymentService`, or inventory;
- the explicit post command, until DG-8-IMPORT and then DG-3;
- price selection for imported lines;
- webhooks, connectors, commission, settlement, refunds;
- a POS session or a drawer total.

---

## Owner Decisions

1. **OD-DG-9-HUB — ACCEPTED 2026-10-03.** §5 stands: `delivery_hub.view` + `delivery_hub.operate`; posting only with existing `invoices.manage` plus view; branch fail-closed. Not implemented here.
2. **OD-DG-6-TRIGGER — ACCEPTED 2026-10-03.** §8 stands: explicit command, not on accept; one transaction; platform clearing without a drawer; merchant-collected with no fabricated tender. Building it is still blocked. Enabling VAT recognition is still blocked.
3. **OD-DG-8-IMPORT** — **still required** before that command is built. Not accepted. POS pricing stays OD-DG-8.
4. **DG-3** — **still required** before the command is enabled for any named platform. Not accepted. Not invented here.

No production deploy. Recording these acceptances does not merge this PR.
