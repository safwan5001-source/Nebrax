<?php

namespace App\Services\Commerce;

use App\Models\CommerceCart;
use App\Models\CommerceCartItem;
use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\UnitTemplateUnit;
use App\Tenancy\BranchScope;
use App\Tenancy\StorefrontContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

final class CommerceCartService
{
    public const COOKIE_NAME = 'awj_cart_token';

    public const LIFETIME_DAYS = 30;

    public function __construct(private readonly CommercePriceResolver $prices) {}

    /** @return array{cart: ?CommerceCart, invalid: bool} */
    public function findByToken(?string $rawToken): array
    {
        if ($rawToken === null || $rawToken === '') {
            return ['cart' => null, 'invalid' => false];
        }

        $context = $this->context();
        $cart = CommerceCart::query()
            ->where('token_hash', hash('sha256', $rawToken))
            ->where('storefront_id', $context->storefrontId())
            ->where('sales_channel_id', $context->salesChannelId())
            ->first();

        if ($cart === null) {
            return ['cart' => null, 'invalid' => true];
        }

        if ($cart->status !== CommerceCart::STATUS_ACTIVE || $cart->expires_at->isPast()) {
            if ($cart->status === CommerceCart::STATUS_ACTIVE) {
                $cart->update(['status' => CommerceCart::STATUS_EXPIRED]);
            }

            return ['cart' => null, 'invalid' => true];
        }

        return ['cart' => $cart, 'invalid' => false];
    }

    /** @return array{cart: CommerceCart, token: ?string, created: bool, data: array<string, mixed>} */
    public function add(?CommerceCart $knownCart, string $productId, string $unitKey, int $quantity): array
    {
        $candidate = $this->purchasable($productId, $unitKey);
        $rawToken = null;

        return DB::transaction(function () use ($knownCart, $candidate, $quantity, &$rawToken): array {
            $context = $this->context();
            $created = false;

            if ($knownCart === null) {
                $rawToken = $this->newToken();
                $cart = CommerceCart::create([
                    'storefront_id' => $context->storefrontId(),
                    'sales_channel_id' => $context->salesChannelId(),
                    'token_hash' => hash('sha256', $rawToken),
                    'expires_at' => now()->addDays(self::LIFETIME_DAYS),
                ]);
                $created = true;
            } else {
                $cart = $this->lockUsableCart($knownCart->id);
            }

            $line = CommerceCartItem::query()
                ->where('cart_id', $cart->id)
                ->where('product_id', $candidate['product']->id)
                ->where('unit_key', $candidate['unit_key'])
                ->lockForUpdate()
                ->first();

            if ($line !== null) {
                $quantity = $this->safeQuantityAdd($line->quantity, $quantity);
                $line->update([
                    'quantity' => $quantity,
                    'product_name_snapshot' => $candidate['product']->name,
                    'unit_name_snapshot' => $candidate['unit_name'],
                ]);
            } else {
                CommerceCartItem::create([
                    'cart_id' => $cart->id,
                    'product_id' => $candidate['product']->id,
                    'product_name_snapshot' => $candidate['product']->name,
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

            $this->purchasable($line->product_id, $line->unit_key);
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
            $unitName = $line->unit_name_snapshot;
            $unitPrice = 0;

            if ($line->product_id !== null) {
                try {
                    $resolved = $this->purchasable($line->product_id, $line->unit_key);
                    $available = true;
                    $unitName = $resolved['unit_name'];
                    $unitPrice = $resolved['amount'];
                } catch (RuntimeException) {
                    // Retained unavailable lines are display/removal-only and total zero.
                }
            }

            $lineTotal = $available ? $this->safeMultiply($unitPrice, $line->quantity) : 0;
            $subtotal = $this->safeAdd($subtotal, $lineTotal);
            $items[] = [
                'id' => $line->id,
                'product_id' => $line->product_id,
                'product_name' => $line->product_name_snapshot,
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

    /** @return array{product: Product, unit_key: string, unit_name: string, amount: int} */
    private function purchasable(string $productId, string $unitKey): array
    {
        $context = $this->context();
        $product = Product::query()
            ->withoutGlobalScope(BranchScope::class)
            ->whereKey($productId)
            ->where('is_active', true)
            ->first();

        if ($product === null || ! CommerceListing::query()
            ->where('product_id', $product->id)
            ->where('sales_channel_id', $context->salesChannelId())
            ->where('is_published', true)
            ->exists()
        ) {
            throw new RuntimeException('المنتج غير متاح للشراء.');
        }

        [$canonicalKey, $unitName, $resolverUnit] = $this->resolveUnit($product, $unitKey);
        $price = $this->prices->resolve($product->id, $context->salesChannelId(), null, $resolverUnit);
        if (! $price->resolved || $price->amount === null) {
            throw new RuntimeException('لا يوجد سعر معتمد لهذه الوحدة.');
        }

        return [
            'product' => $product,
            'unit_key' => $canonicalKey,
            'unit_name' => $unitName,
            'amount' => $price->amount,
        ];
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

    private function lockUsableCart(string $cartId): CommerceCart
    {
        $context = $this->context();
        $cart = CommerceCart::query()
            ->whereKey($cartId)
            ->where('storefront_id', $context->storefrontId())
            ->where('sales_channel_id', $context->salesChannelId())
            ->where('status', CommerceCart::STATUS_ACTIVE)
            ->where('expires_at', '>', now())
            ->lockForUpdate()
            ->first();

        if ($cart === null) {
            throw new CartNotFoundException('السلة غير متاحة.');
        }

        return $cart;
    }

    private function context(): StorefrontContext
    {
        $context = app(StorefrontContext::class);
        if (! $context->isEstablished()
            || ! $context->hasStorefront()
            || app(TenantContext::class)->id() !== $context->tenantId()
        ) {
            throw new RuntimeException('لا يوجد سياق متجر موثوق.');
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
        $quantity = $this->safeAdd($left, $right);
        if ($quantity > 2147483647) {
            throw new RuntimeException('الكمية أكبر من الحد المسموح.');
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
