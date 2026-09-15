# Public/Mobile Commerce API V1 — PR-3 Guest Cart: Architecture Reconciliation

**Status:** Architecture review only. No application code, migrations, schema changes, or tests were
added. No Merge, no Deploy. This document is the requested reconciliation between the newest
approved documentation, the current implementation, and downstream Checkout, before authorizing
any Cart schema change.

Branch: `commerce-api-v1/pr3-guest-cart` (still holds only the Phase 0 stop report — no code).
Base: `main` @ `3833ec5b8d2491efb74d6b2b7a1087edba9a182b`.

---

# Executive Decision

**Recommended: Option A** — `CommerceCart` (and, later, `CommerceCheckout`) identity becomes
`tenant_id + sales_channel_id`, with `storefront_id` made **nullable**: present and required
whenever the request is resolved through the web `Storefront` path, `NULL` whenever it is resolved
through the mobile path.

**Why, briefly:** this is not a new idea invented for PR-3 — it is the exact same shape the
codebase **already adopted, in production, for `CommerceOrder`** (`commerce_orders.storefront_id`
is nullable today, with the migration's own comment giving the identical reasoning: "trusted
orders with no storefront source stay `NULL` forever"). `SalesChannel` — not `Storefront` — is the
abstraction the foundational Commerce ADRs (ADR-03, ADR-05) always treated as the cross-channel
join point spanning Web, Mobile, POS, and External. `Storefront` was deliberately introduced later
(COM-7-P2, 2026-09-11) as a **web-specific hosted-store concept** — its own approving decision
document states this in as many words. Option A does not fight that decision; it completes it, by
recognizing that Cart/Checkout's *true* identity was always tenant+channel, with Storefront as an
*additional*, web-only disambiguating dimension — not the root.

---

# Evidence

## Documentation, in chronological (authority) order

| Date | Document | What it establishes |
|---|---|---|
| 2026-09-09 | `docs/plans/store/ADR-03-CHANNEL-WAREHOUSE-FULFILLMENT-SOURCE.md` | Names `«متجرنا» Mobile` as a peer example of `Sales Channel` alongside `AWJ Web Store`, `AWJ POS`, `Salla`, `Zid` **from the ADR's very first illustration** (§1). Never mentions `Storefront`. Treats `SalesChannel` as the one cross-channel abstraction joining Web/Mobile/POS/External to fulfillment. |
| 2026-09-09 | `docs/plans/store/ADR-05-CUSTOMER-MOBILE-IDENTITY-BOUNDARY.md` | §5: "Sales Channel describes where a commercial interaction originated; it does not define a separate customer identity... A customer who uses web and mobile for the same tenant should not require unrelated customer profiles merely because the channel differs." §18: "«متجرنا» is a client/channel" — consumes Commerce *as a mobile sales channel*. Never mentions `Storefront` either. |
| 2026-09-11 | `docs/plans/store/AWJ_COM_7_P2_STOREFRONT_DOMAIN_RESOLUTION_DECISION.md` | §1 (the decision itself): "AWJ will model a hosted commerce storefront as a first-class, tenant-owned entity **separate from `SalesChannel`**... `SalesChannel` remains the commercial origin/channel of a sale. **It must not be overloaded with hosted-store concerns such as domains, branding, SEO, locale or theme configuration.**" §2's required invariant: "The referenced `SalesChannel.type` must be `web`." **This is the explicit, approved origin of `Storefront::booted()`'s hard rejection of non-web channels** — not an implementation accident. |
| 2026-09-13 | `docs/plans/commerce/AWJ_CART_V1_ARCHITECTURE.md` | §3: makes `storefront_id` a **required** Cart field, with an explicit, real reason: "two storefronts can represent distinct customer surfaces even when they share a tenant or channel." This is not hypothetical — `storefronts.sales_channel_id` carries **no unique constraint** in the schema (confirmed directly), so two web `Storefront` rows genuinely can share one `sales_channel_id` today. This document was written when only the web/`Storefront` resolution path (COM-7-P2) existed — it reasoned correctly about the web case and did not anticipate a channel type that structurally has no `Storefront` at all. |
| 2026-09-14 | `docs/plans/commerce/AWJ_CHECKOUT_V1_ARCHITECTURE.md` | §"binding": "Every Checkout is bound server-side to the same resolved storefront context as its Cart: ... `storefront_id`." Inherits the same assumption as Cart, for the same reason (written before Mobile existed as a resolvable channel). |
| 2026-09-15 (landed on `main` 2026-09-15/16 via PR #830) | `docs/plans/commerce/PUBLIC_MOBILE_COMMERCE_API_V1_ARCHITECTURE.md` | States (§"Cart"): "Reuses `CommerceCartService` in full... **no change to `CommerceCartService` itself**, only to how the token reaches it." **This is the assumption Phase 0 found to be factually false against current code** — not because the intent is wrong, but because it did not account for the mandatory-`Storefront` coupling baked into Cart's 2026-09-13 schema and service. |

**No newer document overrides any of the above.** A repo-wide search for other ADRs/decision docs
touching `CommerceCart`, `CommerceCheckout`, `SalesChannel`, `Storefront`, `StorefrontContext`, cart
tokens, or checkout ownership found nothing dated after `PUBLIC_MOBILE_COMMERCE_API_V1_ARCHITECTURE.md`
that revisits this question.

## Code

| File | Finding |
|---|---|
| `app/Services/Commerce/CommerceCartService.php:357-368` | `context()` throws unless `StorefrontContext::hasStorefront() === true`. Called from every public method. |
| `app/Services/Commerce/CommerceCheckoutService.php:676-686` | **Byte-identical** `context()` method — same hard requirement, same exception message. |
| `database/migrations/2026_09_23_010000_create_commerce_carts_table.php:14` | `commerce_carts.storefront_id` — `foreignUuid(...)->constrained('storefronts')->restrictOnDelete()`, **no `.nullable()`**. |
| `database/migrations/2026_09_24_010000_create_commerce_checkouts_table.php:33` | `commerce_checkouts.storefront_id` — same shape, also **not nullable**. |
| `database/migrations/2026_09_25_010000_add_checkout_linkage_to_commerce_orders.php:31-33` | `commerce_orders.storefront_id` — **`.nullable()`**, with the migration's own docblock stating: "الطلبات القديمة (staff/trusted) لا مصدر متجرٍ لها إطلاقاً، فتبقى `null` للأبد" (trusted/legacy orders have no storefront source at all, they stay `NULL` forever). **This is the exact precedent Option A follows** — already live in production schema. |
| `app/Models/Storefront.php` `booted()` | Hard-rejects `sales_channel_id` referencing any non-`web` `SalesChannel` — matches COM-7-P2's explicit, approved invariant. Untouched by this review; Option A does not need to change it. |
| `app/Services/Commerce/MobileSalesChannelResolver.php` | Sets `TenantContext` + `StorefrontContext` with **no** `storefrontId` — by design, matching `Storefront::booted()`'s invariant (a mobile `SalesChannel` structurally cannot own a `Storefront`). Unmodified since PR-1 (Mobile Sales Channel Foundation); this review does not touch it. |
| `database/migrations/2026_09_20_010000_create_storefronts_table.php:29` | `storefronts.sales_channel_id` has **no unique constraint** — confirms the Cart doc's "two storefronts, one channel" scenario is schema-legal today, not merely theoretical. |

---

# Current Conflict

PR-3 cannot proceed "as-is" reusing `CommerceCartService` unmodified, because:

1. `MobileSalesChannelResolver` (already merged, PR-1, unmodified — correctly, per its own invariant) never sets a `storefrontId`.
2. `CommerceCartService::context()` unconditionally requires `hasStorefront() === true`.
3. `commerce_carts.storefront_id` is a mandatory `NOT NULL` foreign key with no legal value a mobile
   request could ever supply, because a mobile `SalesChannel` can never own a `Storefront` row
   (an approved, deliberate invariant this review does not propose changing).

Every one of `findByToken()`, `add()`, `update()`, `remove()`, and `serialize()` would throw
`RuntimeException('لا يوجد سياق متجر موثوق.')` unconditionally for every mobile request. This is
not an edge case to patch around — it is a structural mismatch between the Cart aggregate's 2026-09-13
identity design (written when only the web path existed) and the mobile channel resolution model
approved one day earlier in the same overall architecture stream (PR-1, 2026-09-15).

---

# Cart Impact

If Option A is authorized, the **future** (not-yet-implemented) change to `CommerceCartService` is
bounded to:

1. `context()`: accept **either** shape — `isEstablished() && hasStorefront()` (today's web case,
   unchanged) **or** `isEstablished() && !hasStorefront()` (the new mobile case) — both under the
   existing `TenantContext` cross-check. Reject only the case that is neither (unestablished context),
   exactly as today.
2. Every call site that reads `$context->storefrontId()` unconditionally (3 in `CommerceCartService`:
   `findByToken()`, `add()`, `lockUsableCart()`) must branch: `$storefrontId = $context->hasStorefront()
   ? $context->storefrontId() : null;` and pass that nullable value through.
3. **Important, easy-to-miss implementation detail for whoever implements PR-3**: the Cart lookup
   query currently does `->where('storefront_id', $context->storefrontId())`. When `$storefrontId`
   is `null`, a naive `->where('storefront_id', null)` compiles to `storefront_id = NULL`, which is
   **always false** in both PostgreSQL and SQLite (`NULL` is never `=` anything, including itself).
   The mobile branch must use `->whereNull('storefront_id')` explicitly; the web branch keeps
   `->where('storefront_id', $storefrontId)`. This single detail, if missed, would silently make
   every mobile Cart lookup fail-closed as "not found" — not a security bug, but a correctness bug
   worth flagging precisely now so PR-3's implementer does not have to rediscover it.
4. `serialize()`, `purchasable()`, and the eligibility/pricing calls already key off
   `$context->salesChannelId()`/`$context->tenantId()` only — **no change needed there**; this
   confirms PR-2's earlier finding (pricing/publication were never `Storefront`-coupled) extends to
   Cart's pricing path too.

No change to the Cart token model, cookie semantics for web, response contract, concurrency
(`lockForUpdate()`, 3-attempt transactions), expiry/renewal, or eligibility rules — all of that is
already channel-agnostic and doc-confirmed correct in `AWJ_CART_V1_ARCHITECTURE.md` §7, §11, §17.

---

# Checkout Impact

**Yes — `CommerceCheckoutService` has the byte-identical problem**, confirmed directly in code
(`app/Services/Commerce/CommerceCheckoutService.php:676-686`, same `context()` body, same exception
message) and in `commerce_checkouts.storefront_id` (same `NOT NULL` FK shape as Cart's). At least
10 call sites in that service read `$context->storefrontId()` unconditionally.

This is **not being fixed now**, per this task's explicit instruction. It is flagged precisely so
PR-4 does not rediscover it from scratch: PR-4 (Checkout) will need the **same** two-part change
(nullable `commerce_checkouts.storefront_id` + the same `context()`/call-site relaxation), following
the identical pattern this document recommends for Cart. `commerce_orders.storefront_id` is
**already** nullable and needs no further schema change — it is the one entity in this chain
already ready to receive a storefront-less (mobile) order once Checkout is fixed.

**Practical implication for sequencing:** if Option A is authorized for Cart now, the Checkout PR
should apply the *same* migration/service pattern rather than re-deriving it — this reduces PR-4's
own architecture-reconciliation overhead to near zero, since the precedent will already exist twice
(`CommerceOrder`, `CommerceCart`) by the time PR-4 starts.

---

# Tenant Isolation & Security

Option A does not weaken any existing isolation guarantee; it adds one new, correctly-scoped
dimension for a case that has no isolation gap today:

- **Tenant isolation**: `tenant_id` remains mandatory, unchanged, on every Cart/Checkout row and
  every query. Untouched by this proposal.
- **Channel isolation**: `sales_channel_id` remains mandatory, unchanged. A mobile cart is already
  fully isolated from a web cart today because they resolve to different `sales_channel_id` values
  (a tenant's mobile channel and web channel are always distinct `SalesChannel` rows) — this holds
  regardless of the `storefront_id` question.
- **Web storefront isolation** (the reason `storefront_id` exists at all): **fully preserved**,
  because the web resolution path (`ResolveStorefrontDomain`) is untouched and continues to always
  populate `storefrontId`. The web branch of the relaxed `context()`/lookup logic behaves *exactly*
  as today — same required equality check, same fail-closed behavior on mismatch.
- **Guest-token possession boundary**: unchanged in kind — a token is still scoped to the full
  resolved identity (`tenant_id` + `sales_channel_id`, plus `storefront_id` when present) and a
  mismatch on any dimension still fails closed with the same generic, non-revealing response
  `AWJ_CART_V1_ARCHITECTURE.md` §7/§19 already mandates. A mobile token can never satisfy a web
  cart's lookup (its context never has a `storefront_id` to match) and a web token can never satisfy
  a mobile cart's lookup (its context always has one, but the mobile row's `storefront_id` is
  `NULL`, and `NULL` never equals a real UUID) — cross-boundary confusion is structurally impossible
  in both directions, not just policed by convention.
- **No new attack surface**: the client still never supplies `tenant_id`/`sales_channel_id`/
  `storefront_id`; all three continue to come exclusively from server-resolved context, exactly as
  `ResolveCommerceChannel`/`MobileSalesChannelResolver` (mobile) and `ResolveStorefrontDomain` (web)
  already guarantee.

---

# Database Impact

**Future migration** (not applied by this review):

- `commerce_carts.storefront_id`: drop the `NOT NULL` constraint, keep `->constrained('storefronts')->restrictOnDelete()` — mirrors `commerce_orders`' existing, already-tested pattern exactly. SQLite and PostgreSQL both support a nullable foreign-key column with `RESTRICT`-on-delete behavior identically; no engine-specific divergence.
- The existing composite index `commerce_carts_context_index` on `(tenant_id, storefront_id, sales_channel_id, status, expires_at)` continues to work correctly with `storefront_id` nullable — both engines index `NULL` as a normal (if less selective) key value in a standard B-tree composite index; no partial-index trick is required for correctness, only for query-plan efficiency, which is out of this review's scope.
- **No change needed** to `commerce_cart_items`, `sales_channels`, `storefronts`, or any other table.
- **No change needed** to `commerce_orders` — already nullable (see Evidence).
- Later (PR-4, not now): the identical nullable-column treatment for `commerce_checkouts.storefront_id`.

**What this review explicitly does NOT authorize:** no migration file was created; no `up()`/`down()`
was written; no model change was made to `CommerceCart`, `CommerceCartItem`, `CommerceCheckout`,
`CommerceCartService`, or `CommerceCheckoutService`.

---

# Backward Compatibility

`/store/v1` is provably unaffected:

- `ResolveStorefrontDomain` is not proposed to change at all — the web resolution path continues to
  populate `TenantContext` + full `StorefrontContext` (including `storefrontId`) exactly as today.
- `RequireStorefrontMutationGateway` is not proposed to change — it gates on the gateway secret,
  entirely orthogonal to this identity question.
- Web Cart token/cookie semantics (`awj_cart_token`, HttpOnly/Secure/SameSite=Lax, 30-day lifetime,
  sha256 hash-at-rest) are not proposed to change.
- Existing web carts continue to resolve identically: their `storefront_id` is already populated
  and non-null, and the relaxed `context()` logic's web branch performs the exact same check as
  today for any request whose `hasStorefront() === true`.
- No existing `commerce_carts` row needs any data migration — making a column nullable does not
  touch existing non-null values.
- No cross-store, cross-channel, or cross-tenant token adoption is introduced by this proposal (see
  Tenant Isolation & Security, above).

---

# Documentation Drift

Documents that will need an update **after** a decision is made (none edited by this review, per
its constraints):

- **`docs/plans/commerce/AWJ_CART_V1_ARCHITECTURE.md` §3** — the `storefront_id` row states
  "Required." This becomes stale the moment Option A is authorized; it should be revised to
  "Required for web-resolved Carts; `NULL` for mobile-resolved Carts," with a forward reference to
  this reconciliation document and to the `commerce_orders` precedent.
- **`docs/plans/commerce/AWJ_CART_V1_ARCHITECTURE.md` §7** ("Tenant/Storefront/SalesChannel
  binding") — currently describes only the web/hostname-resolved binding sequence. Needs a second,
  parallel sequence for the mobile/bearer-token-resolved binding once PR-3 actually implements it.
- **`docs/plans/commerce/AWJ_CART_V1_ARCHITECTURE.md` §20** (constraints/indexes table) — the FK row
  for `cart.storefront_id` says "restrict or controlled delete" without addressing nullability; should
  be updated to state nullable-for-mobile explicitly once approved.
- **`docs/plans/commerce/AWJ_CHECKOUT_V1_ARCHITECTURE.md`** §"binding" (storefront_id listed as an
  unconditional binding field) — should get the same forward-looking caveat once PR-4 is scoped,
  even though PR-4 itself is out of this task's boundary.
- **`docs/plans/commerce/PUBLIC_MOBILE_COMMERCE_API_V1_ARCHITECTURE.md`** — the specific sentence "no
  change to `CommerceCartService` itself, only to how the token reaches it" is the one factually
  superseded claim in that document; it should be corrected to reference this reconciliation and the
  bounded `context()`/schema change once implemented, rather than silently left contradicting the
  actual PR-3 diff.

None of these edits were made now, per this task's explicit constraint ("لا تعدّل الوثائق الآن").

---

# Recommended Implementation Boundary

**In PR-3, once authorized:**
- The migration: `commerce_carts.storefront_id` → nullable (the single schema change).
- `CommerceCartService::context()` relaxed to accept the mobile shape, with the `whereNull()`
  branching detail called out above applied correctly at all 3 affected call sites.
- `/commerce/v1/cart` + `/commerce/v1/cart/items` (POST/PATCH/DELETE) endpoints, reusing
  `CommerceCartService` exactly as `/store/v1`'s controller does, with a new mobile guest-token
  mechanism (opaque bearer, sha256-hashed at rest, scoped to `tenant_id + sales_channel_id`, no
  `storefront_id` dimension) per `PUBLIC_MOBILE_COMMERCE_API_V1_ARCHITECTURE.md`'s existing guest-token
  design — that part of the doc was not found to be in conflict with anything in this review.
- Full test matrix per the original PR-3 task brief (tenant isolation, cross-tenant token, wrong
  channel, inactive/unpublished product, pricing per channel, quantity validation, concurrency,
  `/store/v1` regression), extended with an explicit assertion that a mobile Cart row's
  `storefront_id` is `NULL` in the database and that this never satisfies or is satisfied by a web
  Cart lookup.

**Stays out of PR-3, deferred to PR-4 or its own PR:**
- Any change to `CommerceCheckoutService`, `commerce_checkouts.storefront_id`, or Checkout
  endpoints under `/commerce/v1` — Checkout has the identical conflict but is explicitly out of
  PR-3's scope per the task brief, and this review does not fix it now.
- Any documentation rewrite (see Documentation Drift) — a separate, explicitly scoped docs task
  once the owner approves this decision.
- Any change to `Storefront::booted()`'s non-web rejection invariant — not needed by Option A and
  not recommended by this review.

---

# Final Go / No-Go

**GO — safe to authorize PR-3 with the following exact bounded schema/service changes.**

Suggested authorization text the owner can copy verbatim into the next task:

> نفّذ الآن PR-3 (Guest Cart) بالتغيير المحدود التالي فقط، المعتمد في
> `docs/plans/commerce/PR3_GUEST_CART_ARCHITECTURE_RECONCILIATION.md`:
>
> 1. Migration واحدة: اجعل `commerce_carts.storefront_id` nullable (يبقى
>    `constrained('storefronts')->restrictOnDelete()`) — بنفس النمط المطبَّق فعلاً على
>    `commerce_orders.storefront_id`. لا تغييرات أخرى في الـschema.
> 2. عدّل `CommerceCartService::context()` ليقبل سياق الجوال (`isEstablished() &&
>    !hasStorefront()`) إضافة لسياق الويب الحالي دون تغييره، واضبط الاستعلامات الثلاثة التي
>    تقرأ `storefrontId()` مباشرة لتستخدم `whereNull('storefront_id')` صراحة في فرع الجوال (لا
>    `where('storefront_id', null)`).
> 3. نفّذ `GET/POST/PATCH/DELETE /commerce/v1/cart[/items...]` وفق العقد الموجود في
>    `PUBLIC_MOBILE_COMMERCE_API_V1_ARCHITECTURE.md`، بتوكن ضيف opaque منفصل عن ApiClient
>    bearer token (tenant_id + sales_channel_id فقط، بلا storefront_id).
> 4. لا تلمس `CommerceCheckoutService` ولا `commerce_checkouts` ولا `Storefront::booted()` ولا
>    `ResolveStorefrontDomain` ولا `RequireStorefrontMutationGateway`.
> 5. اختبارات صريحة تثبت: صفّ Cart جوّال بـ`storefront_id IS NULL`، عدم تقاطعه أبداً مع أي Cart
>    ويب، وأن `/store/v1` بلا أي تغيير سلوكي.
>
> ZERO FAILURES مطلوب على SQLite وPostgreSQL. لا Merge ولا Deploy حتى موافقتي الصريحة.
