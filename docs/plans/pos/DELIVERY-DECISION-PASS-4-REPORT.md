# DELIVERY-DECISION-PASS-4 — Projection-only Hub: states and identity

**Task:** DELIVERY-DECISION-PASS-4
**Horizon:** `docs/plans/pos/AWJ_DELIVERY_PLATFORMS_HORIZON_V1.md` (ACTIVE)
**Nature:** evidence / architecture / documentation only. No production code, migration, API, Hub, webhook, connector, price rule, permission string, invoice, payment, VAT, COGS, stock movement, POS session, commission, settlement, reconciliation, or refund.
**Base SHA (`origin/main` at start):** `615d634a1ab387b12b5124917ff435c762f1aca3`
**That SHA is the squash of PR #1195 (DELIVERY-DECISION-PASS-3).** It was the tip of `origin/main` when this branch was cut. This file does not embed its own commit hash.

OD-HUB-STATES is an Owner Decision and is **ACCEPTED** as §4. OD-HUB-IDENTITY remains a recommendation and is **NOT ACCEPTED**. The revised §6 is for review. The agent does not accept it.

Not reopened: OD-DG-9-HUB, OD-DG-6-TRIGGER, DG-1, DG-2, DG-5, OD-DG-8 (POS price), OD-DG-9-POS, and the accepted narrowing of DG-6 (pre-post has no ledger effect).

Not decided here: DG-8-IMPORT, DG-3, DG-4, DG-7, connectors, webhooks, commission, settlement, reconciliation, refunds, pricing, accounting, invoice posting, and inventory.

---

## 1. What this pass is for

Pass 3 left the projection-only slice **not ready** because §9 (state table) and §14 (order identity) were not accepted. This pass tightens those two requirements against current repository evidence. It does not implement them. Safwan accepted the state machine. He did not accept the identity recommendation, and the identity text below is a revision for review, not an acceptance.

| Question | Classification | Result |
|---|---|---|
| Operational states, transitions, branch immutability, and who may move each state | **ACCEPTED** | OD-HUB-STATES. §4 as documented. Not a build permit. |
| Identity and intake idempotency, including manual intake with no provider id | **NEW DECISION REQUIRED** | Revised recommendation §6. Not accepted. The provider triple is permanent. Cancel does not release it and does not insert a successor. |
| Projection-only Hub slice | Still blocked on the identity decision | **NOT READY.** Not a queue task. Not started. |

The slice, even after §6 is later accepted, still must not call `InvoiceService`, `PaymentService`, or inventory, and must not open a POS session.

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
| C. Linear projection states, no `posted`, no skips, no backward moves. Reroute only before accept, using `canAccessBranch` on both ends. | Matches OD-DG-9-HUB and the pre-post rule | **ACCEPTED** as OD-HUB-STATES. |

---

## 4. State machine

**ACCEPTED — OD-HUB-STATES.** Safwan accepted the states, the transitions, who may move them, branch immutability, the `reject` mapping, and the repeat-versus-reroute rule. He then corrected the wrong-branch sentence: after `accepted` the branch is not changed; a wrong branch may be cancelled operationally; reopen, recreate, and reassignment after cancel are outside V1 and need a separate explicit decision and command. There is no automatic successor and no new intake of the same provider order id. The rest of this section is unchanged. Accepting it does not accept §6.

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
| `cancelled_before_post` | Operate: cancel or reject. Reject is not its own state. | Frozen as it was. | None. Terminal. |

There is no warehouse on these states. Pass 3 §13 already says warehouse is a posting input. This slice does not move stock, so it does not collect one.

Provider status text, if a later intake carries it, is stored as inert evidence. It does not move this table. Designing a connector is out of scope.

### Allowed transitions

No skips. No backward edge. A repeated command returns the same row and does not create another **only** when it asks for the state the row is already in and does not name a different destination branch. A `received` → `received` command that names another branch is the reroute edge below, not that repeat. Naming the branch the row is already on is a repeat, and the row stays unchanged.

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

### Reject

OD-DG-9-HUB already names `reject` as an operate verb, separately from cancel-before-post. This accepted section does not add a `rejected` state and does not delete that verb.

`reject` writes `cancelled_before_post`. It uses the same terminal, the same branch freeze, and the same absence of a ledger effect as cancel. It is allowed from the same non-terminal states, under the same `delivery_hub.operate` and branch rule as the cancel edges. It is not a financial reversal and not a third permission.

An implementation must not invent a second terminal for reject. Limiting reject to states before `accepted` would be a narrowing of OD-HUB-STATES. This pass does not add that limit.

`delivery_hub.view` never moves a state. `invoices.manage` does not move a state. `sales.pos` is not involved.

Creating the row is an intake, not a view. Intake uses `delivery_hub.operate` rather than a third permission. An intake that lands in `unrouted` is allowed only for an actor who may see that queue (no branch restriction). An actor who is restricted to one branch must name a destination they can access; the row then starts in `received`. That intake rule is part of this accepted section. It does not add an RBAC string in this PR.

### Branch immutability

- Missing or ambiguous store identity does not pick a branch.
- Before `accepted`, the only branch writes are the two edges above.
- At `accepted` and after, including `handed_off` and `cancelled_before_post`, the branch is not edited.
- After `accepted` the branch is not changed. A wrong branch may be cancelled operationally. Reopen, recreate, and reassignment after that cancel are outside V1 and need a separate explicit decision and command. There is no automatic successor and no new intake of the same provider order id.

---

## 5. Identity options

| Option | Uniqueness | Problem |
|---|---|---|
| A. Human `external_order_reference` alone | Whatever the operator typed | The accounting migration already says this value is not an identity. Two orders can share a display number. A retry can duplicate. |
| B. Copy POS: `tenant + branch + key` | Includes branch | Branch is often null at intake, and `NULL` does not collide in the unique indexes this repo runs on. The same provider id could then exist twice. |
| C. Pass 3 §14 forever, including cancelled rows | `tenant + profile + provider_order_id` for every row that has a provider id | A second intake cannot insert. That is now the required V1 rule, not a defect. **Revised recommendation. Not accepted.** |
| D. Same triple for the **live** row only, released by cancel so one successor can be inserted | Branch stays out. Display reference stays out. | Owner refused the release. Cancellation must not create a new row for the same provider id. **Withdrawn. Not recommended.** |

---

## 6. Identity recommendation

**RECOMMENDATION — NOT ACCEPTED.** Safwan refused the previous text, which released the provider id on cancel. This section is the revision for review. The agent does not accept it.

### Two values

| Value | Role |
|---|---|
| `provider_order_id` | Identity when the external system has a stable order id. Not the display number. |
| `external_order_reference` | What a person reads. Optional under the existing reference policy. Never the uniqueness key and never the intake retry key. |

Branch is **not** part of either key. The profile is company-wide, and the branch may be unknown or later corrected. Putting branch in the key would allow a second row.

### Permanent provider identity

When `provider_order_id` is present, V1 uniqueness includes every state, including `cancelled_before_post`:

`tenant_id + delivery_platform_profile_id + provider_order_id`

`cancelled_before_post` does not release that triple. The cancelled row keeps its identity and its history. A later intake with the same triple is the same order. It must not insert a successor. This pass does not design a reopen or recreate command. If one is needed later, it is a separate explicit decision and a separate command, not a result of cancellation.

### Retries

Same checksum rule as POS checkout and the delivery-note draft builder. Do not reuse `PosCheckoutAttempt`, and do not put `branch_id` in the key.

An intake must carry a provider id, an intake UUID, or both. If neither is present, reject it. Do not insert.

1. If an intake UUID is present and a row with `tenant_id + idempotency_key` already exists in any state, including `cancelled_before_post`: the same checksum returns that row; a different checksum conflicts. Stop. The body is not written and no second row is created.
2. If a provider id is present and any row, in any state, already has that permanent triple:
   - the same checksum returns that row, including when it is `cancelled_before_post`;
   - a different checksum conflicts;
   - a new UUID also conflicts.
   Stop. Do not insert. Resending the provider id is not a new order.
3. Otherwise there is no existing row for this UUID and no existing provider triple. Insert one row.

There is no step that inserts a successor because a row was cancelled.

The checksum covers profile, provider id, intake key, normalized display reference, an explicit destination branch if one was sent, and a hash of the inert intake payload. Amounts inside that payload are **not** a price. This pass does not choose DG-8-IMPORT. The projection must not copy them onto an invoice, a price list, a tax rate, or a stock line. Hashing them only detects that a retry differs.

Operator transitions are not a second identity. They do not allocate a new key. Cancelling does not allocate one either.

### Manual or import intake with no provider id

Do not mint the identity from the display reference.

- The client sends an `idempotency_key` that is a UUID, once, on the first intake.
- The server stores that key. It does not derive it from the reference text.
- That UUID is unique for the tenant across every state, including `cancelled_before_post`.
- The same UUID and the same checksum replay that row. The same UUID and a different checksum conflict. Neither inserts a second row.
- The cancelled manual row keeps that UUID. This pass does not define a recreate command, and a different UUID is not an automatic reopen of the cancelled row.
- The row still requires a resolvable `delivery_platform_profile_id`. An unknown platform is rejected. This pass does not invent a profile-less order.
- If both a provider id and an intake UUID are present, the UUID is tested first. An existing UUID returns or conflicts and never falls through into an insert. A new UUID still cannot create a second row when that provider triple already exists in any state (step 2).
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

Even after an acceptance of §6, the projection still excludes:

- `InvoiceService`, `PaymentService`, journals, VAT, COGS, stock movements, and POS sessions;
- the explicit post command (OD-DG-6-TRIGGER's shape stays accepted, and building it stays blocked on DG-8-IMPORT and DG-3);
- price selection for imported lines;
- webhooks, connectors, commission, settlement, reconciliation, and refunds;
- a new permission string in this PR.

`handed_off` must not be treated as posted. Cancel after handoff in this slice is still operational only, because nothing was posted.

---

## 9. Readiness

**Projection-only Hub: NOT READY. Not a queue row. Not started.**

OD-HUB-STATES is accepted. OD-DG-9-HUB and the pre-post accounting rule are already accepted. None of that is sufficient. OD-HUB-IDENTITY is a revised recommendation and is not accepted. Marking the slice `ready` would accept §6 without Safwan. Accepting the state machine does not start an implementation.

Full DLV-HUB-1 stays **BLOCKED**. DG-8-IMPORT and DG-3 are untouched.

---

## Owner Decisions required

1. **OD-HUB-STATES** — **ACCEPTED** as §4 (linear states, no `posted` in the projection, immutability at `accepted`, reroute only before accept via `canAccessBranch` on both branches, a same-state repeat does not apply when the destination branch changes, cancel from every non-terminal state, and `reject` is that same cancel terminal rather than a new state). A wrong branch after accept may be cancelled operationally. It is not a new intake of the same provider order id. Reopen, recreate, and reassignment after cancel are outside V1.
2. **OD-HUB-IDENTITY** — still required. Accept, narrow, or reject the **revised** §6. It is not accepted. The revision is: the provider triple is permanent across every state, including `cancelled_before_post`; cancel does not release `provider_order_id` and does not insert a successor; no reopen or recreate command is designed; branch stays out of the key; `external_order_reference` is display only; manual intake with no provider id uses a client UUID; the same UUID and the same checksum replay; the same UUID and a different checksum conflict; neither a provider id nor a UUID rejects the intake.

No production deploy. This document does not merge itself and does not start an implementation.
