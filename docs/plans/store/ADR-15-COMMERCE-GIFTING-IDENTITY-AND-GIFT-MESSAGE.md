# ADR-15 — Commerce Gifting Identity & Gift Message (FLOWERS-GIFTING-IDENTITY-1)

**Status:** Accepted for implementation within `AWJ_FLOWERS_HORIZON_1_AUTONOMOUS_EXECUTION.md` slice H3
**Date:** 2026-10-03
**Scope:** shared Commerce checkout/order context — not Flowers-only

---

## 1. Context

**AWJ REPOSITORY EVIDENCE**

- `CommerceCheckout` carries `contact_*` (the purchaser/contact) and `delivery_*` (address). It has **no** recipient or sender concept.
- At completion `CommerceOrderService::createFromCheckout()` writes the immutable `CommerceOrderSnapshot` with `shipping_recipient_name = contact_name` and `shipping_phone = contact_phone` — i.e. today the *delivery recipient is silently the purchaser*. The snapshot already has the right columns; only their source is conflated.
- `CommerceOrderSnapshot` is frozen once the order is confirmed (model-level guard). `CommerceOrder` is not an `Invoice` (ADR-01); `Partner` is the ERP customer master and is never created by checkout.
- Completion is idempotent and runs in one transaction with the order, payment intent and cart consumption.

**EXTERNAL EVIDENCE** (`FNP_DEEP_EVIDENCE_1_REPORT.md`): sender, recipient/address, scheduling and payment are separate concerns in the observed gifting checkout; the purchaser and the person named on the card can differ.

## 2. Decision (AWJ DECISION)

Four identities stay separate:

| Concept | Owner | Notes |
|---|---|---|
| **Purchaser / contact** | existing `CommerceCheckout.contact_*` → `CommerceOrderSnapshot.contact_*` | unchanged; the only party tied to `CustomerIdentity`/billing |
| **Delivery recipient** | new checkout gift row → **existing** `CommerceOrderSnapshot.shipping_recipient_name/phone` | reuse the snapshot columns; when no gift, behaviour is byte-identical to today (recipient = purchaser) |
| **Gift sender display identity** | new `commerce_order_gifts.sender_display_name` + `hide_sender` | presentation on the card only; **never** an accounting/customer identity |
| **Gift message** | new `commerce_order_gifts.message` | bounded, sanitized plain text; immutable after the order is confirmed |

Saved recipients (account address-book of people) are **not** introduced here (H13) and a delivery recipient **never** becomes an ERP `Partner`.

### 2.1 Data model (additive)

- `commerce_gift_settings` — per **sales channel** (`unique(sales_channel_id)`, so web and mobile configure independently). Typed columns, no JSON: `is_enabled` (default **false**), `message_max_length` (default 250, 1–500), `allow_hide_sender` (default true), `recipient_phone_required` (default true). Policy is configured, not forced (CLAUDE.md rule 6).
- `commerce_checkout_gifts` — 1:1 with an open checkout: `recipient_name`, `recipient_phone`, `sender_display_name`, `hide_sender`, `message`. Cleared by `is_gift=false`.
- `commerce_order_gifts` — 1:1 immutable snapshot copied inside the completion transaction (same guard pattern as `CommerceOrderSnapshot`: no create/update/delete once the order is confirmed; `commerce_order_id` never re-linkable).

All three are tenant-owned, `CompanyWide`, with structural tenant guards on save.

### 2.2 API (server authority)

- `PATCH checkout/gift` on `store/v1` and `commerce/v1` (same trust chain as the other checkout mutations). Body: `is_gift`, `recipient_name`, `recipient_phone`, `sender_name`, `hide_sender`, `message`. Unknown keys are rejected. Gift payload is refused (422) while the channel's gift setting is disabled; `is_gift=false` is always allowed (clears).
- Checkout serialization exposes `gift` and `gift_options` (limits the shopper UI needs); order serialization exposes `gift` to the order's owner and to fulfillment admin reads.
- `complete()` re-validates: gift enabled, recipient present (phone when required), message within limit → otherwise `CheckoutReviewRequiredException` (`gift_incomplete` / `gift_unavailable`). The order snapshot takes `shipping_recipient_*` from the recipient (when the policy makes the recipient phone optional and none is given, `shipping_phone` falls back to the purchaser's phone so the courier always has a number), and the order gift row is written in the same transaction. Completion idempotency and replay semantics are unchanged.

### 2.3 Message hygiene

Plain text only, never interpreted as HTML by any consumer. Server normalizes CRLF→LF, trims, strips C0 control characters (keeping `\n`), DEL and Unicode bidi override/isolate characters (display-spoofing), caps newlines (≤ 6) and length by **characters** (`mb_strlen`) against the channel limit. Emoji sequences (ZWJ) are preserved.

## 3. Rejected / Not adopted

- Treating the gift sender as the accounting customer or creating a `Partner` for the recipient.
- New recipient columns on `commerce_checkouts` / duplicating `commerce_order_snapshots` columns — the snapshot already models the recipient.
- A free-form JSON `metadata` on checkout/order.
- Enabling gifts by default or hard-coding the max length (policy is per channel).

## 4. Consequences

- Generic stores: gift settings absent ⇒ disabled ⇒ checkout and orders are unchanged; completion output gains `gift: null`.
- No ledger, VAT, ZATCA, inventory or price effect. Order numbering/totals untouched.
- Merchant admin sees the gift context through the order read API (fulfillment visibility); a dedicated order screen is out of scope here.

## 5. Unknown / deferred

Saved recipients and re-order (H13), no-address gifting, recipient notification, card style products, message editing after confirmation (frozen by design).
