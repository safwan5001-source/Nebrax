# DELIVERY-DECISION-PASS-4 — Projection-only Hub: states and identity

**Task:** DELIVERY-DECISION-PASS-4
**Horizon:** `docs/plans/pos/AWJ_DELIVERY_PLATFORMS_HORIZON_V1.md` (ACTIVE)
**Nature:** evidence / architecture / documentation only. No production code, migration, API, Hub, webhook, connector, price rule, permission string, invoice, payment, VAT, COGS, stock movement, POS session, commission, settlement, reconciliation, or refund.
**Base SHA (`origin/main` at start):** `615d634a1ab387b12b5124917ff435c762f1aca3`
**That SHA is the squash of PR #1195 (DELIVERY-DECISION-PASS-3).** It was the tip of `origin/main` when this branch was cut. This file does not embed its own commit hash.

Nothing in this report is an Owner Decision. Each new recommendation is labeled **RECOMMENDATION — NOT ACCEPTED**.

Not reopened: OD-DG-9-HUB, OD-DG-6-TRIGGER, DG-1, DG-2, DG-5, OD-DG-8 (POS price), OD-DG-9-POS, and the accepted narrowing of DG-6 (pre-post has no ledger effect).

Not decided here: DG-8-IMPORT, DG-3, DG-4, DG-7, connectors, webhooks, commission, settlement, reconciliation, refunds, pricing, accounting, invoice posting, and inventory.

---

## 1. What this pass is for

Pass 3 left the projection-only slice **not ready** because §9 (state table) and §14 (order identity) were not accepted. This pass tightens those two requirements against current repository evidence. It does not implement them and does not accept them.

| Question | Classification | Result |
|---|---|---|
| Operational states, transitions, branch immutability, and who may move each state | **NEW DECISION REQUIRED** | Recommendation §4. Not accepted. |
| Identity and intake idempotency, including manual intake with no provider id | **NEW DECISION REQUIRED** | Recommendation §6. Not accepted. One deliberate change from Pass 3 §14: a cancelled row does not keep the provider id locked forever. |
| Projection-only Hub slice | Still blocked on those two owner decisions | **NOT READY.** Not a queue task. Not started. |

The slice, if those decisions are later accepted, still must not call `InvoiceService`, `PaymentService`, or inventory, and must not open a POS session.

---

## 2. Evidence map

Read on this base. Not a second delivery investigation.

| Authority | Fact used |
|---|---|
| OD-DG-9-HUB §5 | `delivery_hub.view` reads. `delivery_hub.operate` routes, accepts, rejects, cancels before post, marks preparing, ready, and hands off. Neither permission posts. Unrouted orders are visible only to a user with view and **no** branch restriction. Routing requires operate plus `canAccessBranch` on the destination. Another branch's id is not found. |
| OD-DG-6-TRIGGER §8 | The only financial transition is an explicit command, and it is not part of this slice. `received` and `unrouted` cannot post. `accepted`, `preparing`, `ready`, and handed off are the only window in which that future command may run. This pass does not build the command. |
| OD-DG-6 (Pass 2) | Receive, route, accept, prepare, and cancel-before-post create no revenue, VAT, COGS, stock, cash, bank, or AR clearing. |
| `DeliveryPlatformProfile` | `CompanyWide`, same as `SalesChannel`. A profile is not owned by one branch. A branch override changes collection mode and reference policy only. There is no store-id → branch table. |
| `delivery_invoice_contexts` migration | `unique(invoice_id)`. The comment states `external_order_reference` is **not** unique and is not an identity. |
| `pos_checkout_attempts` | Unique on `tenant_id + branch_id + idempotency_key`, plus a checksum. Same key and same checksum replay; a different checksum conflicts. The branch is already known because the sale is inside one session. |
| Delivery-note invoice draft builds | Unique on `tenant_id + branch_id + idempotency_key`. The notes already belong to a branch. The builder creates a draft only. |
| `User::allowedBranchIds()` | `null` means unrestricted inside the tenant. A non-empty list is an allow-list. `[]` is never returned. |
| Pass 3 §9 and §14 | Explicitly **not accepted**, except the posting window already inside OD-DG-6-TRIGGER. |

PostgreSQL and SQLite both treat `NULL` as distinct inside a unique index. A key that includes `branch_id` would therefore allow two rows with the same provider id when the branch is null, and would also allow the same provider id on branch A and branch B. That is why the POS/draft pattern (branch inside the key) is not copied.

---

## 3. State-machine options

| Option | Meaning | Verdict |
|---|---|---|
| A. Free status field. Any operate user may set any name. | Smallest code | Rejected. It cannot express immutability or who may route. |
| B. Pass 3 §9 table, including a `posted` state, and reroute only by an unrestricted user | Already written | `posted` is the financial command. It does not belong on a projection that must not post. "Unrestricted only" is stricter than `canAccessBranch` and blocks a user who is assigned to both branches. |
| C. Linear projection states, no `posted`, no skips, no backward moves. Reroute only before accept, using `canAccessBranch` on both ends. | Matches OD-DG-9-HUB and the pre-post rule | **Recommended. Not accepted.** |

---

## 4. State-machine recommendation

**RECOMMENDATION — NOT ACCEPTED.**

This slice has no `posted` state and no transition into one. `handed_off` is operational completion only. It is not a sale.

### States

| State | How it is entered | Branch | Financial effect |
|---|---|---|---|
| `unrouted` | Intake when no explicit destination was supplied, or the destination is ambiguous | None. Not in a branch inbox. | None. |
| `received` | Route onto one branch | Set. Still correctable. | None. |
| `accepted` | Operate | **Immutable.** | None. |
| `preparing` | Operate | Immutable. | None. |
| `ready` | Operate | Immutable. | None. |
| `handed_off` | Operate | Immutable. | None. Not an invoice. |
| `cancelled_before_post` | Operate | Frozen as it was. | None. Terminal. |

There is no warehouse on these states. Pass 3 §13 already says warehouse is a posting input. This slice does not move stock, so it does not collect one.

Provider status text, if a later intake carries it, is stored as inert evidence. It does not move this table. Designing a connector is out of scope.

### Allowed transitions

No skips. No backward edge. A repeated command that asks for the state the row is already in returns that same row and does not create another.

| From | To | Who | Rule |
|---|---|---|---|
| `unrouted` | `received` | `delivery_hub.operate` | `canAccessBranch(destination)`. The destination is explicit. It is not "whatever branch the request happens to be in", and it is not the tenant's first branch. |
| `unrouted` | `cancelled_before_post` | `delivery_hub.operate` | The actor must be allowed to see the unrouted queue: view is not enough to cancel, and a branch-restricted user cannot see this queue (OD-DG-9-HUB). |
| `received` | `received` (other branch) | `delivery_hub.operate` | `canAccessBranch(current)` and `canAccessBranch(destination)`. This replaces Pass 3's "unrestricted only" reroute. A user restricted to one branch cannot move it. |
| `received` | `accepted` | `delivery_hub.operate` | `canAccessBranch(order.branch)`. After this, the branch does not change. |
| `received` | `cancelled_before_post` | `delivery_hub.operate` | `canAccessBranch(order.branch)`. |
| `accepted` | `preparing` | `delivery_hub.operate` | `canAccessBranch`. No reroute. |
| `preparing` | `ready` | `delivery_hub.operate` | `canAccessBranch`. |
| `ready` | `handed_off` | `delivery_hub.operate` | `canAccessBranch`. |
| `accepted`, `preparing`, `ready`, `handed_off` | `cancelled_before_post` | `delivery_hub.operate` | `canAccessBranch`. Allowed because this slice has not posted anything. |
| `cancelled_before_post` | — | — | No exit. |
| `handed_off` | anything except cancel | — | No exit. |

Any other edge is rejected. The row stays unchanged. A direct id outside the actor's branch scope is not found and its body is not returned.

`delivery_hub.view` never moves a state. `invoices.manage` does not move a state. `sales.pos` is not involved.

Creating the row is an intake, not a view. The recommendation is that intake uses `delivery_hub.operate` rather than a third permission. An intake that lands in `unrouted` is allowed only for an actor who may see that queue (no branch restriction). An actor who is restricted to one branch must name a destination they can access; the row then starts in `received`. That is part of this same unaccepted recommendation, not a new RBAC string in this PR.

### Branch immutability

- Missing or ambiguous store identity does not pick a branch.
- Before `accepted`, the only branch writes are the two edges above.
- At `accepted` and after, including `handed_off` and `cancelled_before_post`, the branch is not edited.
- A wrong branch after accept is cancel, then a **new** intake of the same provider id (see §6). It is not an in-place edit.

---

## 5. Identity options

| Option | Uniqueness | Problem |
|---|---|---|
| A. Human `external_order_reference` alone | Whatever the operator typed | The accounting migration already says this value is not an identity. Two orders can share a display number. A retry can duplicate. |
| B. Copy POS: `tenant + branch + key` | Includes branch | Branch is often null at intake, and `NULL` does not collide in the unique indexes this repo runs on. The same provider id could then exist twice. |
| C. Pass 3 §14 forever, including cancelled rows | `tenant + profile + provider_order_id` for every row | One live row. But cancel-then-new-projection, which §9 described, could never insert the successor. |
| D. Same triple for the **live** row only, plus a separate UUID intake key when there is no provider id | Branch stays out. Display reference stays out. | **Recommended. Not accepted.** |

---

## 6. Identity recommendation

**RECOMMENDATION — NOT ACCEPTED.**

### Two values

| Value | Role |
|---|---|
| `provider_order_id` | Identity when the external system has a stable order id. Not the display number. |
| `external_order_reference` | What a person reads. Optional under the existing reference policy. Never the uniqueness key and never the intake retry key. |

Branch is **not** part of either key. The profile is company-wide, and the branch may be unknown or later corrected. Putting branch in the key would allow a second live row.

### Live-row uniqueness

For a row that is not `cancelled_before_post`:

`tenant_id + delivery_platform_profile_id + provider_order_id`

when `provider_order_id` is present.

A second live row with that triple is rejected. It does not create another order.

A cancelled row keeps its history but **releases** that triple so a later intake can create one successor. This is the modification of Pass 3 §14. Without it, "cancel and start a new projection" is impossible.

### Retries

Same conflict rule as POS checkout and the delivery-note draft builder. Do not reuse `PosCheckoutAttempt`, and do not put `branch_id` in the key.

An intake must carry a provider id, an intake UUID, or both. If neither is present, reject it. Do not insert.

1. If an intake UUID is present and a row with `tenant_id + idempotency_key` already exists in any state: the same checksum returns that row; a different checksum conflicts. Stop. The body is not written and no second row is created. This includes a cancelled row, so the original request cannot mint a successor.
2. If a provider id is present and a **live** row already has that triple:
   - no new UUID (the request has no UUID, or the UUID is the one already stored on that live row): the same checksum returns it; a different checksum conflicts;
   - a new UUID: conflict. A different request must not replay the live row and must not insert another one.
   Stop.
3. If a provider id is present, no live row has that triple, and one or more **cancelled** rows do:
   - no UUID: the same checksum returns the earliest cancelled row with that checksum; a checksum that matches none conflicts. Do not insert. Resending the original provider id is a retry, not a successor;
   - a new UUID: this is the one allowed successor. Insert one live row. The cancelled rows keep their own UUIDs.
4. Otherwise there is no existing row for this UUID and no existing provider triple. Insert one row.

A successor therefore always needs a new UUID, and it can exist only because the cancelled row released the live triple. The original UUID stays unique across every state.

The checksum covers profile, provider id, intake key, normalized display reference, an explicit destination branch if one was sent, and a hash of the inert intake payload. Amounts inside that payload are **not** a price. This pass does not choose DG-8-IMPORT. The projection must not copy them onto an invoice, a price list, a tax rate, or a stock line. Hashing them only detects that a retry differs.

Operator transitions are not a second identity. They do not allocate a new key.

### Manual or import intake with no provider id

Do not mint the identity from the display reference.

- The client sends an `idempotency_key` that is a UUID, once, on the first intake.
- The server stores that key. It does not derive it from the reference text.
- That UUID is unique for the tenant across every state, including `cancelled_before_post`.
- The same UUID replays the same row, or conflicts if the checksum differs. It never inserts a second row. A successor after cancel needs a **new** UUID.
- The row still requires a resolvable `delivery_platform_profile_id`. An unknown platform is rejected. This pass does not invent a profile-less order.
- If both a provider id and an intake UUID are present, the UUID is tested first. An existing UUID returns or conflicts and never falls through into an insert. A new UUID still cannot create a second live row for a provider id that already has one (step 2).
- V1 does not attach a provider id onto a row that was created without one. That would be a second identity rule and is not recommended here.

Foreign tenant ids do not resolve. The error does not include another tenant's display name.

---

## 7. Tenant and branch isolation

- The operational row is tenant-owned. It is not `CompanyWide`.
- A foreign tenant's provider id or UUID returns nothing.
- Branch list and direct read follow OD-DG-9-HUB. This pass does not widen it.
- Unrouted rows stay out of every branch inbox.
- Reroute cannot target a branch the actor cannot access, and cannot start from a branch the actor cannot access.
- No transition writes `branch_id` of a row the actor cannot see.

---

## 8. What stays outside this slice

Even after an acceptance of §4 and §6, the projection still excludes:

- `InvoiceService`, `PaymentService`, journals, VAT, COGS, stock movements, and POS sessions;
- the explicit post command (OD-DG-6-TRIGGER's shape stays accepted, and building it stays blocked on DG-8-IMPORT and DG-3);
- price selection for imported lines;
- webhooks, connectors, commission, settlement, reconciliation, and refunds;
- a new permission string in this PR.

`handed_off` must not be treated as posted. Cancel after handoff in this slice is still operational only, because nothing was posted.

---

## 9. Readiness

**Projection-only Hub: NOT READY. Not a queue row. Not started.**

OD-DG-9-HUB and the pre-post accounting rule are already accepted. They are not sufficient. The state graph and the identity key are still Owner Decisions. Marking the slice `ready` would accept §4 and §6 without Safwan.

Full DLV-HUB-1 stays **BLOCKED**. DG-8-IMPORT and DG-3 are untouched.

---

## Owner Decisions required

1. **OD-HUB-STATES** — accept, narrow, or reject §4 (linear states, no `posted` in the projection, immutability at `accepted`, reroute only before accept via `canAccessBranch` on both branches, cancel from every non-terminal state).
2. **OD-HUB-IDENTITY** — accept, narrow, or reject §6 (live uniqueness without branch and without the display reference; cancelled rows release the provider id; a successor requires a new UUID and resending the original request does not insert; manual intake uses a client UUID, not the reference).

No production deploy. This document does not merge itself and does not start an implementation.
