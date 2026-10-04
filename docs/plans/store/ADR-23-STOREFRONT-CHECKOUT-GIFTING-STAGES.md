# ADR-23 — Gifting in the storefront cart and checkout (FLOWERS-CHECKOUT-UX-1)

**Status:** Accepted for implementation within `AWJ_FLOWERS_HORIZON_1_AUTONOMOUS_EXECUTION.md` slice H12
**Date:** 2026-10-04
**Scope:** storefront cart, checkout, order confirmation (`storefront/`) — renders contracts that already exist; no backend change

## 1. Context

**AWJ REPOSITORY EVIDENCE**

- The cart already serializes `personalization` (ADR-16) on a line and represents each add-on (ADR-18) as its own line with `addon_of` and `per_parent_quantity`; the API refuses to change or remove an add-on line on its own ("an add-on is removed by removing its parent"). Orders expose the same on their lines (`personalization`, `line_id`, `addon_of`).
- The checkout API has `PATCH checkout/gift` and `gift_options` (ADR-15) and `PATCH checkout/schedule` with the public `GET delivery-schedule` (ADR-19). Completion revalidates both and answers `409 review_required` with `gift_incomplete` / `gift_unavailable` / `schedule_required` / `schedule_unavailable` (and `addon_unavailable`). A schedule is validated against the checkout's *stored* method and destination; scheduling is required only for a method that has a window.
- The AWJ checkout (`AwjCheckoutFlow`) is a staged flow — contact → address → delivery → payment → review → confirmation — where each stage owns one endpoint and the review reads back what the server stored. The gift policy and scheduling are per-channel policies that are off by default.

**EXTERNAL EVIDENCE** (`FNP_FLOWERS_GIFTS_EVIDENCE_PASS_2_CHECKOUT_OPERATIONS.md`): gifting checkouts separate the purchaser, the recipient and address, the delivery date/window and the card message; their step order is not canonical.

## 2. Decision (AWJ DECISION)

1. **Two optional stages, present only when offered.** `schedule` (date and window) and `gift` (recipient, displayed sender, card message) join the stage list only when the channel offers them; a store with neither walks the original six stages unchanged (guarded by the pre-existing checkout tests, which are unmodified in behaviour). Scheduling is read once up front (channel-level) so the step counter does not change mid-flow; a completion refusal is authoritative and adds the stage if the up-front read missed it.
2. **Sequence: contact → address → delivery → date & time → gift → payment → review.** The date depends on the destination and method already chosen and is the larger decision; the gift is optional and independent of both. We do not copy another retailer's step order.
3. **Never a dead end.** The schedule stage blocks Continue only while loading, or when the channel requires a window and none can be chosen (with an explicit message); an optional schedule never blocks; a failed read offers a retry and leaves Continue open (the server decides at completion). The gift stage requires only what the store's own policy requires (recipient name; phone when `recipient_phone_required`), and its limits (message length, whether the sender may be hidden) come from `gift_options`, not constants.
4. **The server stays authoritative.** Only windows the API lists are offered; "today / tomorrow" are worded from the API's timezone; nothing is reserved at selection (the stage says the store confirms it); an unselectable stored choice is shown as such and the shopper chooses again. The gift message is plain text, normalized again server-side. Saving writes to the stage's own endpoint; clearing is explicit (`date/slot_id: null`, `is_gift: false`).
5. **Lines.** Personalization answers print under the line name; add-ons are grouped under their own parent (the API lists lines by creation time, so the mappers group them) and shown nested and read-only everywhere a line is shown — cart page, drawer, checkout summary, confirmation. The bag badge and item count do not include add-ons ("a bouquet and its chocolates" is one thing in the bag).
6. **Confirmation** states the *requested* date and window and the gift; it does not promise fulfilment or show a tracking state (there is none).

## 3. Rejected / Not adopted

- Always showing gift and schedule stages (a generic store would gain two dead steps).
- Letting the browser compute availability, a "same day" label or a timezone.
- Editable add-on lines with their own quantity or remove control (the API refuses).
- Reserving capacity at selection time (reservation ≠ checkout; ADR-19).
- Recipient address book / saved recipients (H13).

## 4. Consequences

- A store without the policies is unchanged end to end; the three optional wire fields are absent on an older API and map to "no gift / gifting off / no schedule".
- No ledger, VAT, ZATCA, inventory or price behaviour changes; no journal entries.

## 5. Unknown / deferred

- Recipient-aware address entry (a separate delivery address from the purchaser's) beyond the existing address stage; saved recipients and re-order (H13); no-address gifting and recipient notification (evidence-gated).
