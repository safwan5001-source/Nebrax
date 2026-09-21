<?php

namespace App\Services\Commerce;

use App\Models\CommerceCart;
use App\Models\CommerceCartItem;
use App\Models\CommerceListing;
use App\Models\CustomerIdentity;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Models\UnitTemplateUnit;
use App\Support\DocumentLineVariantResolver;
use App\Tenancy\BranchScope;
use App\Tenancy\CustomerContext;
use App\Tenancy\StorefrontContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PDOException;
use RuntimeException;

final class CommerceCartService
{
    public const COOKIE_NAME = 'awj_cart_token';

    public const LIFETIME_DAYS = 30;

    public function __construct(private readonly CommercePriceResolver $prices) {}

    /**
     * @param  bool  $allowConsumed  `true` فقط لمسار إتمامٍ يحتاج الوصول إلى Checkout
     *                                سلةٍ استُهلكت بالفعل (إعادة تشغيل Idempotency-Key
     *                                بعد نجاح الشراء) — راجع
     *                                `CommerceCheckoutService::resolveForCompletion()`.
     *                                لا يُستعمَل أبداً لمسارات الإضافة/التعديل/بدء
     *                                Checkout جديد؛ تلك تبقى ترفض `consumed` كأي حالةٍ
     *                                غير `active`.
     * @return array{cart: ?CommerceCart, invalid: bool, rebound: ?string}
     */
    public function findByToken(?string $rawToken, bool $allowConsumed = false): array
    {
        $context = $this->context();
        $customerContext = app(CustomerContext::class);

        if ($rawToken !== null && $rawToken !== '') {
            // (Codex, PR #924, P1, fifth round) Also match the previous
            // generation of the token: rebindToken() keeps one prior hash
            // valid for exactly one more rotation, so a single interleaved
            // touch from another device (e.g. between two of this device's
            // own checkout-preparation requests) doesn't invalidate a token
            // in the same request/response pair it was just issued in.
            $hash = hash('sha256', $rawToken);
            $cart = $this->scopeToContext(CommerceCart::query(), $context)
                ->where(fn ($query) => $query->where('token_hash', $hash)->orWhere('previous_token_hash', $hash))
                ->first();

            if ($cart !== null) {
                // (Codex, PR #924, P1) An owned cart must never resolve for a
                // bearer that isn't that same customer, even with the right
                // token — a guest presenting a claimed/merged cart's token
                // (after logout, or a leaked token) must see it as gone, not
                // read or mutate it. This guards *every* caller of
                // findByToken(), not just resolveCurrent()'s own guest
                // branch — including CommerceCheckoutService, which shares
                // Cart's token unmodified and would otherwise let the same
                // bearer resolve/mutate/complete someone else's checkout.
                if ($this->cartOwnedByCurrentBearer($cart, $customerContext)) {
                    // The presented token already matched — nothing to rebind.
                    return $this->resolveFoundCart($cart, $allowConsumed, $context) + ['rebound' => null];
                }
            }
        }

        // (Codex, PR #924, P1) No token, or it didn't resolve to a cart this
        // bearer may use (absent, garbage, or rotated away by
        // resolveCurrent() when another device touched the same customer's
        // cart). An authenticated customer's own active cart stays reachable
        // by identity, so a stale/rotated token never locks a device out of
        // its own cart or checkout — CommerceCheckoutService needs zero
        // changes to benefit, since it already calls this same method.
        //
        // **Deliberately excluded when `$allowConsumed` is true** (Codex,
        // PR #924, P1, second round): that flag exists only for
        // `resolveForCompletion()`'s idempotency-key replay, which must
        // stay anchored to the *exact* cart/checkout a specific completion
        // request already committed to — never "whichever cart is
        // currently active for this customer". Falling back here would let
        // a stale-token retry of an already-completed request resolve a
        // *different*, newer active cart/checkout and complete it under the
        // original request's idempotency key. A first-time `checkout/complete`
        // presenting a stale token still 404s (pre-existing behavior,
        // unchanged by this task) — the self-heal above already covers
        // every read/update step that normally precedes it.
        if ($customerContext->isEstablished() && ! $allowConsumed) {
            $ownCart = $this->scopeToContext(CommerceCart::query(), $context)
                ->where('customer_identity_id', $customerContext->customerIdentityId())
                ->where('status', CommerceCart::STATUS_ACTIVE)
                ->first();

            if ($ownCart !== null) {
                // (Codex, PR #924, P1, fourth round) Resolving here means the
                // presented token (if any) did NOT match this cart's stored
                // hash — the client is holding a stale value. Every caller of
                // findByToken() reached this way (CommerceCheckoutService's
                // current()/createOrResume(), both allowConsumed: false) must
                // hand the client a token that will actually resolve next
                // time, or it silently drifts forever and finally 404s at
                // checkout/complete (allowConsumed: true, fallback excluded
                // above) even on a first attempt — self-healing server-side
                // without ever telling the client defeats the point.
                //
                // (Codex, PR #924, P1, sixth round) The lookup above is
                // unlocked, so two concurrent requests from the same customer
                // with no matching token (e.g. two devices signing in near-
                // simultaneously) could both read the same starting
                // token_hash and both call rebindToken() from it — the
                // second UPDATE then overwrites the first's new hash while
                // writing the *original* hash into previous_token_hash
                // (since it too started from the same stale row), so the
                // first response's freshly-minted token ends up valid in
                // neither slot. Locking the row and re-reading inside a
                // transaction serializes the pair: the second rebind slides
                // the *first* rebind's already-committed new hash into
                // previous_token_hash instead of the stale original one, so
                // both handed-back tokens keep resolving.
                return DB::transaction(function () use ($ownCart, $allowConsumed, $context): array {
                    $locked = $this->scopeToContext(CommerceCart::query(), $context)
                        ->whereKey($ownCart->id)
                        ->lockForUpdate()
                        ->first();

                    if ($locked === null) {
                        return ['cart' => null, 'invalid' => false, 'rebound' => null];
                    }

                    $found = $this->resolveFoundCart($locked, $allowConsumed, $context);
                    $found['rebound'] = $found['cart'] !== null ? $this->rebindToken($locked) : null;

                    return $found;
                }, 3);
            }
        }

        return ['cart' => null, 'invalid' => $rawToken !== null && $rawToken !== '', 'rebound' => null];
    }

    /** @return array{cart: ?CommerceCart, invalid: bool} */
    private function resolveFoundCart(CommerceCart $cart, bool $allowConsumed, StorefrontContext $context): array
    {
        if ($allowConsumed && $cart->status === CommerceCart::STATUS_CONSUMED) {
            // `consumed` is terminal — it must never be rewritten back to
            // `expired`/`active` by mere passage of time (unlike the `active`
            // branch below, which actively demotes to `expired`). But the
            // Cart's own bearer lifetime (`expires_at`) still governs how
            // long its token stays resolvable at all: past that point, replay
            // fails closed here — no status mutation, just a refusal to
            // resolve — rather than remaining valid indefinitely.
            if ($cart->expires_at->isPast()) {
                return ['cart' => null, 'invalid' => true];
            }

            return ['cart' => $cart, 'invalid' => false];
        }

        if ($cart->status !== CommerceCart::STATUS_ACTIVE) {
            return ['cart' => null, 'invalid' => true];
        }

        if ($cart->expires_at->isPast()) {
            return DB::transaction(function () use ($cart, $context): array {
                $current = $this->scopeToContext(CommerceCart::query(), $context)
                    ->whereKey($cart->id)
                    ->lockForUpdate()
                    ->first();

                if ($current === null || $current->status !== CommerceCart::STATUS_ACTIVE) {
                    return ['cart' => null, 'invalid' => true];
                }

                if (! $current->expires_at->isPast()) {
                    return ['cart' => $current, 'invalid' => false];
                }

                $current->update(['status' => CommerceCart::STATUS_EXPIRED]);

                return ['cart' => null, 'invalid' => true];
            });
        }

        return ['cart' => $cart, 'invalid' => false];
    }

    /**
     * COM-MOBILE-CART-IDENTITY-1 (ADR-07) — the customer-aware counterpart
     * to `findByToken()`. When no `CustomerContext` is established, this is
     * `findByToken()` verbatim (guest behaviour is 100% unchanged). When a
     * customer is authenticated, it resolves — and claims/merges as a
     * side effect — the single cart that customer owns:
     *
     *  - a presented guest cart + no existing customer cart → **claim**:
     *    the guest cart becomes the customer's outright, same token still
     *    resolves it (no rotation needed);
     *  - a presented guest cart + an existing customer cart → **merge**:
     *    every guest line is folded into the customer's cart via `add()`'s
     *    own existing quantity-sum-on-duplicate-line semantics (a line no
     *    longer purchasable is dropped, not merged, so a stale line can
     *    never block sign-in), then the guest cart becomes terminal
     *    (`STATUS_CONSUMED`, never mergeable again — replaying the same
     *    guest token afterward finds nothing to merge: idempotent by
     *    construction, not by a separate replay-key mechanism);
     *  - no presented guest cart, existing customer cart, non-matching or
     *    absent token → the customer's cart is returned with a **freshly
     *    minted, rebound token** (`$rebound`) so the caller can keep using
     *    this session's cart with subsequent requests — this is what makes
     *    multi-device login share one cart (ADR-07 §8) and what lets
     *    `/commerce/v1` checkout keep resolving via its own unmodified
     *    `X-Cart-Token`-based lookups without any changes to
     *    `CommerceCheckoutService`;
     *  - neither exists yet → `cart: null`; the next `add()` call creates
     *    one already tagged with the customer's identity (see `add()`).
     *
     * No price is frozen or copied here — `serialize()`/checkout's own
     * `revalidateAndPrice()` remain the sole pricing/availability authority
     * for the resulting cart, exactly as for a guest cart.
     *
     * @return array{cart: ?CommerceCart, invalid: bool, rebound: ?string, merged: bool}
     */
    public function resolveCurrent(?string $guestToken): array
    {
        $customerContext = app(CustomerContext::class);
        if (! $customerContext->isEstablished()) {
            $lookup = $this->findByToken($guestToken);

            return ['cart' => $lookup['cart'], 'invalid' => $lookup['invalid'], 'rebound' => null, 'merged' => false];
        }

        return DB::transaction(function () use ($guestToken, $customerContext): array {
            $context = $this->context();
            $customerId = $customerContext->customerIdentityId();

            // (Codex, PR #924, P2) Locked first, before any cart query: two
            // devices authenticating concurrently with different guest carts
            // (or one claiming here while another calls add(null, ...), which
            // takes the same lock) must never both observe "no customer cart
            // yet" and both write one — the partial unique index would turn
            // the loser's write into a raw 500 instead of a graceful merge.
            // Serializing on this always-existing row is the same technique
            // add() already uses for the exact same race.
            CustomerIdentity::query()->whereKey($customerId)->lockForUpdate()->first();

            $guestCart = ($guestToken !== null && $guestToken !== '')
                ? $this->scopeToContext(CommerceCart::query(), $context)
                    ->where('token_hash', hash('sha256', $guestToken))
                    ->where('status', CommerceCart::STATUS_ACTIVE)
                    ->whereNull('customer_identity_id')
                    ->where('expires_at', '>', now())
                    ->lockForUpdate()
                    ->first()
                : null;

            $customerCart = $this->scopeToContext(CommerceCart::query(), $context)
                ->where('customer_identity_id', $customerId)
                ->where('status', CommerceCart::STATUS_ACTIVE)
                ->lockForUpdate()
                ->first();

            // (Codex, PR #924, P1) This query only checked `status`, so a
            // cart whose `expires_at` passed but which nothing has yet
            // touched (findByToken()'s own lazy demotion never ran on it)
            // was still treated as the customer's current cart — losing a
            // guest cart's contents into a dead merge target, or blocking a
            // fresh cart from ever being created. Demote it the same way
            // findByToken() already does, then treat it as absent.
            if ($customerCart !== null && $customerCart->expires_at->isPast()) {
                $customerCart->update(['status' => CommerceCart::STATUS_EXPIRED]);
                $customerCart = null;
            }

            if ($guestCart !== null && $customerCart === null) {
                $guestCart->update([
                    'customer_identity_id' => $customerId,
                    'expires_at' => now()->addDays(self::LIFETIME_DAYS),
                ]);

                return ['cart' => $guestCart, 'invalid' => false, 'rebound' => null, 'merged' => false];
            }

            if ($guestCart !== null && $customerCart !== null) {
                foreach ($guestCart->items()->get() as $item) {
                    if ($item->product_id === null) {
                        continue;
                    }

                    try {
                        $this->add($customerCart, $item->product_id, $item->unit_key, $item->quantity, $item->product_variant_id);
                    } catch (CommerceCartLineNotPurchasableException) {
                        // (Codex, PR #924, P2, fifth round) The *only*
                        // droppable failure: this specific line's own
                        // eligibility (product/listing/variant/unit/price)
                        // failed. Deliberately NOT a blanket
                        // `catch (RuntimeException)` — add()'s own return
                        // value calls serialize() internally, which can
                        // throw a plain RuntimeException
                        // (CommerceCartQuantityOverflowException included)
                        // for a *different*, already-in-the-cart line's live
                        // price becoming unrepresentable. That failure has
                        // nothing to do with the line being merged and must
                        // propagate, aborting the whole merge — nothing has
                        // committed yet inside this transaction.
                    }
                }

                $guestCart->update(['status' => CommerceCart::STATUS_CONSUMED]);

                return [
                    'cart' => $customerCart->fresh(),
                    'invalid' => false,
                    'rebound' => $this->rebindToken($customerCart),
                    // (Codex, PR #924, P2) A URL item id from the guest cart
                    // (e.g. a PATCH/DELETE the client built before this
                    // request) is never valid against the post-merge
                    // customer cart — merging created new line rows (or
                    // summed into a pre-existing one) with no 1:1 mapping
                    // back to the guest cart's own item ids. Callers that
                    // target a specific item must check this and refuse the
                    // mutation rather than 404 after already committing the
                    // merge.
                    'merged' => true,
                ];
            }

            if ($customerCart !== null) {
                // Accept either slot as "already usable" — presenting the
                // still-valid previous-generation token must not trigger a
                // needless extra rotation (see rebindToken()'s own docblock).
                $presentedHash = $guestToken !== null && $guestToken !== '' ? hash('sha256', $guestToken) : null;
                $alreadyBound = $presentedHash !== null && (
                    hash_equals($customerCart->token_hash, $presentedHash)
                    || ($customerCart->previous_token_hash !== null && hash_equals($customerCart->previous_token_hash, $presentedHash))
                );

                return [
                    'cart' => $customerCart,
                    'invalid' => false,
                    'rebound' => $alreadyBound ? null : $this->rebindToken($customerCart),
                    'merged' => false,
                ];
            }

            return ['cart' => null, 'invalid' => false, 'rebound' => null, 'merged' => false];
        }, 3);
    }

    private function rebindToken(CommerceCart $cart): string
    {
        $rawToken = $this->newToken();
        // (Codex, PR #924, P1, fifth round) The outgoing token slides into
        // `previous_token_hash` instead of being discarded outright — see
        // the migration's own docblock for why this bounds (without fully
        // eliminating) the multi-device rotation race.
        $cart->update([
            'previous_token_hash' => $cart->token_hash,
            'token_hash' => hash('sha256', $rawToken),
        ]);

        return $rawToken;
    }

    /** @return array{cart: CommerceCart, token: ?string, created: bool, data: array<string, mixed>} */
    public function add(?CommerceCart $knownCart, string $productId, string $unitKey, int $quantity, ?string $variantId = null): array
    {
        $rawToken = null;

        return DB::transaction(function () use ($knownCart, $productId, $unitKey, $quantity, $variantId, &$rawToken): array {
            $context = $this->context();
            $created = false;

            if ($knownCart === null) {
                $customerContext = app(CustomerContext::class);
                $customerId = $customerContext->isEstablished() ? $customerContext->customerIdentityId() : null;
                $existing = null;

                if ($customerId !== null) {
                    // (Codex, PR #924, P1) Two concurrent "no current cart
                    // yet" requests from the same authenticated customer
                    // (e.g. a double-tap, or two devices signing in near-
                    // simultaneously) would otherwise both see no existing
                    // active cart and both CREATE one — splitting/losing
                    // additions across two carts and breaking every ->first()
                    // lookup elsewhere in this service that assumes at most
                    // one. lockForUpdate() on an absent cart row locks
                    // nothing, so serialize on a row that always exists
                    // instead: the customer's own identity row. Only one
                    // concurrent transaction can hold this lock at a time,
                    // so the second one always sees the first's committed
                    // cart below.
                    CustomerIdentity::query()->whereKey($customerId)->lockForUpdate()->first();

                    $existing = $this->scopeToContext(CommerceCart::query(), $context)
                        ->where('customer_identity_id', $customerId)
                        ->where('status', CommerceCart::STATUS_ACTIVE)
                        ->first();

                    if ($existing !== null && $existing->expires_at->isPast()) {
                        $existing->update(['status' => CommerceCart::STATUS_EXPIRED]);
                        $existing = null;
                    }
                }

                if ($existing !== null) {
                    $cart = $existing;
                    // The caller (resolveCurrent()'s "neither exists yet"
                    // branch) has no token to hand back for this cart — mint
                    // one now exactly as resolveCurrent() itself does when
                    // handing a customer's cart to a new device, so the
                    // response can still set X-Cart-Token.
                    $rawToken = $this->rebindToken($cart);
                } else {
                    $rawToken = $this->newToken();
                    $cart = CommerceCart::create([
                        'storefront_id' => $context->hasStorefront() ? $context->storefrontId() : null,
                        'sales_channel_id' => $context->salesChannelId(),
                        // COM-MOBILE-CART-IDENTITY-1: a brand-new cart created
                        // while an authenticated customer's context is
                        // already established is theirs from the start —
                        // null for every guest, exactly as CommerceOrder's
                        // own column works.
                        'customer_identity_id' => $customerId,
                        'token_hash' => hash('sha256', $rawToken),
                        'expires_at' => now()->addDays(self::LIFETIME_DAYS),
                    ]);
                    $created = true;
                }
            } else {
                $cart = $this->lockUsableCart($knownCart->id);
            }

            $candidate = $this->purchasable($productId, $unitKey, $variantId, lockEligibility: true);
            $variant = $candidate['variant'];

            $line = CommerceCartItem::query()
                ->where('cart_id', $cart->id)
                ->where('product_id', $candidate['product']->id)
                ->where('product_variant_id', $variant?->id)
                ->where('unit_key', $candidate['unit_key'])
                ->lockForUpdate()
                ->first();

            $nameSnapshot = $this->nameSnapshot($candidate['product'], $variant);

            if ($line !== null) {
                $quantity = $this->safeQuantityAdd($line->quantity, $quantity);
                $line->update([
                    'quantity' => $quantity,
                    'product_name_snapshot' => $nameSnapshot,
                    'unit_name_snapshot' => $candidate['unit_name'],
                ]);
            } else {
                CommerceCartItem::create([
                    'cart_id' => $cart->id,
                    'product_id' => $candidate['product']->id,
                    'product_variant_id' => $variant?->id,
                    'product_name_snapshot' => $nameSnapshot,
                    'unit_key' => $candidate['unit_key'],
                    'unit_name_snapshot' => $candidate['unit_name'],
                    'quantity' => $quantity,
                ]);
            }

            $cart->update(['expires_at' => now()->addDays(self::LIFETIME_DAYS)]);

            return [
                'cart' => $cart,
                'token' => $rawToken,
                'created' => $created,
                'data' => $this->serialize($cart),
            ];
        }, 3);
    }

    /** @return array<string, mixed> */
    public function update(CommerceCart $knownCart, string $itemId, int $quantity): array
    {
        return DB::transaction(function () use ($knownCart, $itemId, $quantity): array {
            $cart = $this->lockUsableCart($knownCart->id);
            $line = CommerceCartItem::query()
                ->where('cart_id', $cart->id)
                ->whereKey($itemId)
                ->lockForUpdate()
                ->first();

            if ($line === null || $line->product_id === null) {
                throw new CartNotFoundException('عنصر السلة غير متاح للتحديث.');
            }

            $this->purchasable($line->product_id, $line->unit_key, $line->product_variant_id, lockEligibility: true);
            $line->update(['quantity' => $quantity]);
            $cart->update(['expires_at' => now()->addDays(self::LIFETIME_DAYS)]);

            return $this->serialize($cart);
        }, 3);
    }

    /** @return array<string, mixed> */
    public function remove(CommerceCart $knownCart, string $itemId): array
    {
        return DB::transaction(function () use ($knownCart, $itemId): array {
            $cart = $this->lockUsableCart($knownCart->id);
            $line = CommerceCartItem::query()
                ->where('cart_id', $cart->id)
                ->whereKey($itemId)
                ->lockForUpdate()
                ->first();

            if ($line === null) {
                throw new CartNotFoundException('عنصر السلة غير موجود.');
            }

            $line->delete();
            $cart->update(['expires_at' => now()->addDays(self::LIFETIME_DAYS)]);

            return $this->serialize($cart);
        }, 3);
    }

    /** @return array<string, mixed> */
    public function serialize(?CommerceCart $cart): array
    {
        $currency = Tenant::findOrFail($this->context()->tenantId())->currency;
        if ($cart === null) {
            return $this->emptyResponse($currency);
        }

        $items = [];
        $subtotal = 0;
        foreach ($cart->items()->orderBy('created_at')->orderBy('id')->get() as $line) {
            $available = false;
            $productName = $line->product_name_snapshot;
            $unitName = $line->unit_name_snapshot;
            $unitPrice = 0;
            $variantDescriptor = null;

            if ($line->product_id !== null) {
                try {
                    $resolved = $this->purchasable($line->product_id, $line->unit_key, $line->product_variant_id);
                    $available = true;
                    $productName = $resolved['product']->name;
                    $unitName = $resolved['unit_name'];
                    $unitPrice = $resolved['amount'];
                    $variantDescriptor = $resolved['variant'] !== null
                        ? DocumentLineVariantResolver::descriptor($resolved['variant'])
                        : null;
                } catch (PDOException $exception) {
                    throw $exception;
                } catch (RuntimeException) {
                    // Retained unavailable lines are display/removal-only and total zero.
                }
            }

            $lineTotal = $available ? $this->safeMultiply($unitPrice, $line->quantity) : 0;
            $subtotal = $this->safeAdd($subtotal, $lineTotal);
            $items[] = [
                'id' => $line->id,
                'product_id' => $line->product_id,
                'product_variant_id' => $line->product_variant_id,
                'variant_descriptor' => $variantDescriptor,
                'product_name' => $productName,
                'unit_key' => $line->unit_key,
                'unit_name' => $unitName,
                'quantity' => $line->quantity,
                'unit_price' => ['amount_minor' => $unitPrice, 'currency' => $currency],
                'line_total' => ['amount_minor' => $lineTotal, 'currency' => $currency],
                'available' => $available,
            ];
        }

        return [
            'status' => CommerceCart::STATUS_ACTIVE,
            'items' => $items,
            'subtotal' => ['amount_minor' => $subtotal, 'currency' => $currency],
            'currency' => $currency,
            'has_unavailable_items' => collect($items)->contains(fn (array $item): bool => ! $item['available']),
        ];
    }

    /** @return array{product: Product, variant: ?ProductVariant, unit_key: string, unit_name: string, amount: int} */
    private function purchasable(string $productId, string $unitKey, ?string $variantId = null, bool $lockEligibility = false): array
    {
        $context = $this->context();
        $productQuery = Product::query()
            ->withoutGlobalScope(BranchScope::class)
            ->whereKey($productId)
            ->where('is_active', true);
        $listingQuery = CommerceListing::query()
            ->where('product_id', $productId)
            ->where('sales_channel_id', $context->salesChannelId())
            ->where('is_published', true);

        if ($lockEligibility) {
            $productQuery->lockForUpdate();
            $listingQuery->lockForUpdate();
        }

        $product = $productQuery->first();
        $listing = $listingQuery->first(['id']);

        if ($product === null || $listing === null) {
            throw new CommerceCartLineNotPurchasableException('المنتج غير متاح للشراء.');
        }

        // (Codex, PR #924, P2, fifth round) DocumentLineVariantResolver and
        // resolveUnit() below are both shared, general-purpose validators
        // (also used by invoices/POS/purchases) that throw a plain
        // RuntimeException — never redefined here. Converted to the
        // dedicated type instead, so resolveCurrent()'s merge loop can tell
        // "this line's own eligibility failed" (droppable) apart from an
        // unrelated arithmetic failure elsewhere in the cart (never
        // droppable) without touching that shared resolver's contract.
        try {
            // فشلٌ مغلَق واحد لا نسخة ثانية: منتجٌ بسيط يرفض متغيّراً صريحاً،
            // منتجٌ متعدد الخيارات يلزمه متغيّرٌ فعليٌّ نشِط تابعٌ له ولنفس المستأجر
            // (VAR-DOC-1/VAR-POS-1 السلطة نفسها حرفياً).
            $variant = DocumentLineVariantResolver::resolve($product, $variantId, $context->tenantId());
            [$canonicalKey, $unitName, $resolverUnit] = $this->resolveUnit($product, $unitKey);
        } catch (RuntimeException $e) {
            throw new CommerceCartLineNotPurchasableException($e->getMessage());
        }

        $price = $this->prices->resolve(
            $product->id,
            $context->salesChannelId(),
            null,
            $resolverUnit,
            $lockEligibility,
            $variant?->id,
        );
        if (! $price->resolved || $price->amount === null) {
            throw new CommerceCartLineNotPurchasableException('لا يوجد سعر معتمد لهذه الوحدة.');
        }

        return [
            'product' => $product,
            'variant' => $variant,
            'unit_key' => $canonicalKey,
            'unit_name' => $unitName,
            'amount' => $price->amount,
        ];
    }

    /** لقطة اسم السطر: اسم المنتج، وإن وُجد متغيّرٌ فعلي يُلحَق وصفه الحتمي — نفس اصطلاح POS (VAR-POS-1) حرفياً. */
    private function nameSnapshot(Product $product, ?ProductVariant $variant): string
    {
        if ($variant === null) {
            return $product->name;
        }

        $descriptor = DocumentLineVariantResolver::descriptor($variant);

        return $descriptor === null ? $product->name : "{$product->name} — {$descriptor}";
    }

    /** @return array{string, string, ?string} */
    private function resolveUnit(Product $product, string $unitKey): array
    {
        if ($unitKey === 'base') {
            return ['base', (string) $product->unit, null];
        }

        if (! str_starts_with($unitKey, 'unit:')) {
            throw new RuntimeException('مفتاح الوحدة غير صالح.');
        }

        $unitId = substr($unitKey, 5);
        if (! Str::isUuid($unitId) || $product->unit_template_id === null) {
            throw new RuntimeException('مفتاح الوحدة غير صالح.');
        }

        $unit = UnitTemplateUnit::query()
            ->whereKey($unitId)
            ->where('unit_template_id', $product->unit_template_id)
            ->first();
        if ($unit === null) {
            throw new RuntimeException('الوحدة غير متاحة لهذا المنتج.');
        }

        return ['unit:'.$unit->id, $unit->name, $unit->name];
    }

    /**
     * (Codex, PR #924, P1, sixth round) `$knownCart` was resolved by an
     * earlier `findByToken()`/`resolveCurrent()` call — outside, and before,
     * the row lock taken here — so a guest request that passed that
     * ownership check while the cart was still unclaimed can race an
     * authenticated request that claims the *same* cart (which only sets
     * `customer_identity_id`, never `status`) in between. Without
     * rechecking ownership after the lock, the guest's `add()`/`update()`/
     * `remove()` would then mutate a cart that is, by the time it actually
     * writes, someone else's. Claiming and this recheck both take
     * `lockForUpdate()` on the exact same row, so whichever transaction
     * commits first is fully visible to the second by the time it re-reads
     * here — there is no window left to close.
     */
    private function lockUsableCart(string $cartId): CommerceCart
    {
        $context = $this->context();
        $cart = $this->scopeToContext(CommerceCart::query(), $context)
            ->whereKey($cartId)
            ->where('status', CommerceCart::STATUS_ACTIVE)
            ->where('expires_at', '>', now())
            ->lockForUpdate()
            ->first();

        if ($cart === null) {
            throw new CartNotFoundException('السلة غير متاحة.');
        }

        if (! $this->cartOwnedByCurrentBearer($cart, app(CustomerContext::class))) {
            throw new CartNotFoundException('السلة غير متاحة.');
        }

        return $cart;
    }

    /** @return bool — سلةٌ غير مملوكة (ضيف) تُعامَل كمملوكة دائماً؛ الفحص الفعلي فقط لسلةٍ عائدة لعميل. */
    private function cartOwnedByCurrentBearer(CommerceCart $cart, CustomerContext $customerContext): bool
    {
        return $cart->customer_identity_id === null
            || ($customerContext->isEstablished() && $customerContext->customerIdentityId() === $cart->customer_identity_id);
    }

    /**
     * (Codex, PR #924, P1, ninth round) إعادة تحقّق ملكية خفيفة **بلا قفل**
     * قبل تسليم قراءة (`GET`) — نفس الثغرة التي أُصلحت في `lockUsableCart()`
     * لكن للقراءة لا الكتابة: `resolveCurrent()`/`findByToken()` تحقّقتا من
     * الملكية وقت الحلّ، لكن بين ذلك وبين `serialize()` الفعلي قد تلتزم
     * مطالبةٌ متزامنة، فتُبنى الاستجابة على حالةٍ تجاوزها الزمن وتُسلَّم
     * بيانات سلةٍ/Checkout صار عائداً لعميلٍ آخر لحامل توكن ضيفٍ قديم. لا
     * قفل هنا عمداً — قراءةٌ لا تُعدِّل شيئاً فلا حاجة لتسلسلها ضد كاتبٍ
     * آخر، يكفي ألا تُبنى الاستجابة على حالةٍ فات أوانها.
     */
    public function isOwnedByCurrentBearer(string $cartId): bool
    {
        $cart = $this->scopeToContext(CommerceCart::query(), $this->context())->find($cartId);

        return $cart !== null && $this->cartOwnedByCurrentBearer($cart, app(CustomerContext::class));
    }

    /**
     * يقيّد استعلام Cart إلى السياق الموثوق الحالي: مطابقة صريحة لـ`storefront_id`
     * لمسار الويب (كما كان دائماً)، أو `whereNull('storefront_id')` صراحةً
     * لمسار الجوال — `whereNull` لا `where(..., null)` لأن الأخيرة تصير
     * `storefront_id = NULL` في SQL، وهذا شرطٌ لا يتحقق أبداً على أي محرك.
     * `sales_channel_id` مطابقٌ دائماً في كلا المسارين. راجع
     * docs/plans/commerce/PR3_GUEST_CART_ARCHITECTURE_RECONCILIATION.md.
     *
     * @template TModel of CommerceCart
     * @param  \Illuminate\Database\Eloquent\Builder<TModel>  $query
     * @return \Illuminate\Database\Eloquent\Builder<TModel>
     */
    private function scopeToContext($query, StorefrontContext $context)
    {
        $query->where('sales_channel_id', $context->salesChannelId());

        if ($context->hasStorefront()) {
            $query->where('storefront_id', $context->storefrontId());
        } else {
            $query->whereNull('storefront_id');
        }

        return $query;
    }

    /**
     * السياق الموثوق الحالي — يقبل شكلين حصراً:
     *  - سياق ويب: `hasStorefront() === true` (كما كان دائماً، بلا تغيير).
     *  - سياق جوّال: `hasStorefront() === false` **و** القناة المحلولة فعلياً
     *    من نوع `mobile` — تحقّقٌ إيجابي صريح، لا قبولاً ضمنياً لغياب Storefront
     *    كحالة عامة ناقصة. المسار المتوارَث `ResolveStorefrontTenant` (تطويري/
     *    اختباري محض) يُنتج أيضاً `hasStorefront() === false` لكن لقناة `web` —
     *    فغياب Storefront وحده **لا يكفي** دليلاً على أن هذا سياق جوّال حقيقي؛
     *    التحقق من نوع القناة نفسها هو الفيصل.
     */
    private function context(): StorefrontContext
    {
        $context = app(StorefrontContext::class);
        if (! $context->isEstablished()
            || app(TenantContext::class)->id() !== $context->tenantId()
        ) {
            throw new RuntimeException('لا يوجد سياق متجر موثوق.');
        }

        if (! $context->hasStorefront()) {
            $channel = SalesChannel::query()->find($context->salesChannelId());
            if ($channel === null || $channel->type !== SalesChannel::TYPE_MOBILE) {
                throw new RuntimeException('لا يوجد سياق متجر موثوق.');
            }
        }

        return $context;
    }

    private function newToken(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }

    private function safeAdd(int $left, int $right): int
    {
        if ($right < 0 || $left > PHP_INT_MAX - $right) {
            throw new RuntimeException('الكمية أو الإجمالي أكبر من الحد المسموح.');
        }

        return $left + $right;
    }

    private function safeQuantityAdd(int $left, int $right): int
    {
        try {
            $quantity = $this->safeAdd($left, $right);
        } catch (RuntimeException $e) {
            throw new CommerceCartQuantityOverflowException($e->getMessage());
        }

        if ($quantity > 2147483647) {
            throw new CommerceCartQuantityOverflowException('الكمية أكبر من الحد المسموح.');
        }

        return $quantity;
    }

    private function safeMultiply(int $amount, int $quantity): int
    {
        if ($amount < 0 || $quantity < 1 || ($amount > 0 && $quantity > intdiv(PHP_INT_MAX, $amount))) {
            throw new RuntimeException('إجمالي السطر أكبر من الحد المسموح.');
        }

        return $amount * $quantity;
    }

    /** @return array<string, mixed> */
    private function emptyResponse(string $currency): array
    {
        return [
            'status' => null,
            'items' => [],
            'subtotal' => ['amount_minor' => 0, 'currency' => $currency],
            'currency' => $currency,
            'has_unavailable_items' => false,
        ];
    }
}
