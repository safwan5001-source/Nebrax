# Public/Mobile Commerce API V1 — PR-3 (Guest Cart): Phase 0 Stop Report

**Status: STOPPED before implementation, per explicit task instruction.** No application code, tests,
migrations, or schema changes were made. This document records the Phase 0 evidence pass and the
conflict it found, for a decision before any implementation proceeds.

Branch created (empty of changes beyond this report): `commerce-api-v1/pr3-guest-cart`
Base: `main` @ `3833ec5b8d2491efb74d6b2b7a1087edba9a182b` (confirmed latest after PR #830 merge)

---

## 1. Task instruction that triggered the stop

> بعد Phase 0: إذا وجدت تعارضًا جوهريًا بين الوثيقة والكود الحالي أو احتجت migration/schema change
> غير منصوص عليه، توقف وبلّغني قبل التنفيذ.

Phase 0 found exactly such a conflict. This report is that notification.

## 2. What Phase 0 confirmed working (no conflict)

- **Store-token vs. guest-token separation is already answered by the architecture doc**, not
  something to invent: `docs/plans/commerce/PUBLIC_MOBILE_COMMERCE_API_V1_ARCHITECTURE.md` §"Cart"
  and the Web-vs-Mobile trust table are explicit — the `ApiClient`/Sanctum bearer token from PR-1
  proves *tenant + mobile channel* identity only; cart *possession* needs a **separate, new, opaque
  guest bearer token**, analogous in purpose to `/store/v1`'s `awj_cart_token` cookie (hashed at
  rest, sha256, raw never stored) but transport-appropriate for a native client (bearer, not a
  cookie). This is not a new auth layer — it is the same two-tier shape the doc already prescribes,
  and no evidence contradicts it.
- `CommerceCartService`'s pricing/availability/publication logic (`purchasable()`) is channel-id
  driven throughout — no `SalesChannel::TYPE_WEB` assumption anywhere in it, matching the same
  pattern already proven safe for PR-2's catalog reuse.
- COM-CART-2 concurrency safety (`lockForUpdate()`, 3-attempt transactions, expiry-renewal-on-touch,
  `CartNotFoundException` for stale/missing carts) is all inside `CommerceCartService` itself and
  is channel-agnostic — nothing here blocks mobile reuse.

## 3. The conflict

### 3.1 `CommerceCartService::context()` hard-requires a `Storefront`

```php
// app/Services/Commerce/CommerceCartService.php:357-368
private function context(): StorefrontContext
{
    $context = app(StorefrontContext::class);
    if (! $context->isEstablished()
        || ! $context->hasStorefront()               // <-- unconditional
        || app(TenantContext::class)->id() !== $context->tenantId()
    ) {
        throw new RuntimeException('لا يوجد سياق متجر موثوق.');
    }
    return $context;
}
```

Called from **every** public method (`findByToken`, `add`, `update`, `remove`, `serialize`) —
there is no code path that tolerates `hasStorefront() === false`.

### 3.2 `MobileSalesChannelResolver` deliberately never sets a `storefrontId`

From its own docblock (merged, unmodified since PR-1's Mobile Sales Channel Foundation):

> لا `Storefront` لقناة الجوال أبداً (`Storefront::booted()` يرفضها بنيوياً) — `storefrontId`
> يبقى غير مضبوط عمداً

So `StorefrontContext::hasStorefront()` is **always `false`** for any request resolved through
`/commerce/v1`'s `ResolveCommerceChannel` → `MobileSalesChannelResolver` chain. Every call into
`CommerceCartService` from a mobile request would throw `RuntimeException('لا يوجد سياق متجر
موثوق.')` unconditionally — not an edge case, a guaranteed failure on every request.

### 3.3 The block goes deeper than the service — into the schema itself

```php
// database/migrations/2026_09_23_010000_create_commerce_carts_table.php:14
$table->foreignUuid('storefront_id')->constrained('storefronts')->restrictOnDelete();
// no ->nullable()
```

`commerce_carts.storefront_id` is a **mandatory, NOT NULL** foreign key to `storefronts`. Even if
`context()`'s check were relaxed, `CommerceCartService::add()` still calls
`$context->storefrontId()` directly (line 89) to populate this column — and `StorefrontContext::
storefrontId()` itself throws `LogicException` when unset, by its own explicit contract. And even
past that: there is **no legal value** to put in this column for a mobile cart, because a mobile
`SalesChannel` structurally can never own a `Storefront` row — `Storefront::booted()` hard-rejects
any non-`web` channel by design, an invariant already established (not incidental) in this
codebase's Commerce architecture.

### 3.4 Why this contradicts the architecture doc's stated assumption

The doc (§ "Web vs Mobile trust/auth model" table) states:

> same hashing-at-rest (`sha256` → stored hash, raw never stored) and scoping
> (`storefront`-equivalent `+ sales_channel_id`) as `CommerceCartService` already does for web —
> **no change to `CommerceCartService` itself**, only to how the token reaches it

This assumption does not hold against the current code: `CommerceCartService` cannot be reused
"as-is" for mobile — not just the token-delivery mechanism, but the service's own internal
`Storefront` requirement (both in application logic and in the `commerce_carts` schema) would need
to change for any mobile cart row to ever be created.

## 4. Options (none implemented)

| # | Option | What it requires | Risk |
|---|---|---|---|
| **A** | Make `commerce_carts.storefront_id` nullable (migration) + relax `CommerceCartService::context()` to accept tenant+channel without a `Storefront`, gating every `storefrontId()` read behind `hasStorefront()` | 1 migration, a scoped code change to a service `/store/v1` also depends on | Real, but bounded — nullable FK + conditional branch can coexist with zero behavior change to the web path if done carefully and proven by tests. Closest to the doc's intent and to "reuse `CommerceCartService` in full." |
| **B** | Build a parallel, mobile-specific cart write path that doesn't call `CommerceCartService` directly | No schema/service change | Directly contradicts the explicit instruction "أعد استخدام CommerceCartService... ممنوع نسخ business logic الموجود... إذا كان يمكن إعادة استخدام الخدمة الحالية بأمان" |
| **C** | Give mobile `SalesChannel`s a synthetic/placeholder `Storefront` row | No `CommerceCartService` code change | Directly violates `Storefront::booted()`'s deliberate, already-reviewed invariant (non-`web` channels are structurally barred from owning a `Storefront`) — not a decision to make silently inside a Cart PR |

**Option A is the smallest option consistent with the doc's intent and the task's explicit reuse
requirement**, but it is a real migration + a change to a service shared with `/store/v1`, which is
exactly the category of change the task instructed me to stop for rather than assume.

## 5. What is needed to proceed

A decision from the repository owner on which option (most likely A) to take, and explicit
authorization for the migration + `CommerceCartService::context()` change that Option A implies,
since PR-3's task brief otherwise forbids "schema/migrations غير الضرورية" and "أي تغيير سلوكي في
`/store/v1`" without that authorization being given first.

No further action has been taken on PR-3 pending that decision.
