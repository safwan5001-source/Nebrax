<?php

namespace App\Services\Commerce;

use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\Storefront;
use App\Models\StorefrontOffer;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * CUST-H4-6 — إدارة مرشّحات العروض للتاجر (CRUD). **تنسيق وجدولة فقط**: لا
 * يقرأ سعراً ولا يكتبه — أهلية «خصم حقيقي» تُحسم وقت القراءة عند
 * `StorefrontOfferResolver` لا هنا.
 *
 * السلطة: المستأجر من `TenantContext` وحده؛ المتجر يُحلّ عبر `ownedStorefront()`
 * (أجنبي/غير موجود ⇒ `null` ⇒ 404 غير كاشف)، وكل عرضٍ يُبحث عنه ضمن متجرٍ
 * بعينه — عرضٌ يخص متجراً آخر لنفس المستأجر لا يُرى.
 */
final class StorefrontOfferService
{
    public const MAX_POSITION = 9999;

    /** نفس نمط `StorefrontPresentationVersionService::ownedStorefront()`. */
    public function ownedStorefront(string $storefrontId): ?Storefront
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            return null;
        }

        $storefront = Storefront::query()->find($storefrontId);

        return $storefront !== null && $storefront->tenant_id === $tenantId ? $storefront : null;
    }

    public function find(Storefront $storefront, string $offerId): ?StorefrontOffer
    {
        return StorefrontOffer::query()
            ->where('storefront_id', $storefront->id)
            ->whereKey($offerId)
            ->first();
    }

    /**
     * @param  array{product_id: string, starts_at?: ?string, ends_at?: ?string, is_active?: bool, position?: int}  $data
     *
     * @throws ValidationException منتج غير مؤهَّل / نافذة غير صالحة / سقف التهيئة.
     * @throws StorefrontOfferConflictException المنتج مُهيَّأ مسبقاً على هذا المتجر.
     */
    public function create(Storefront $storefront, array $data): StorefrontOffer
    {
        $startsAt = $this->parseInstant($data['starts_at'] ?? null);
        $endsAt = $this->parseInstant($data['ends_at'] ?? null);
        $this->assertWindow($startsAt, $endsAt);
        $this->assertEligibleProduct($storefront, $data['product_id']);

        return DB::transaction(function () use ($storefront, $data, $startsAt, $endsAt) {
            // يُسلسل الإنشاء المتزامن للمتجر نفسه فيصحّ فحص السقف (no-op على SQLite).
            Storefront::query()->whereKey($storefront->id)->lockForUpdate()->first();

            $count = StorefrontOffer::query()->where('storefront_id', $storefront->id)->count();
            if ($count >= StorefrontOfferResolver::MAX_OFFERS_PER_STOREFRONT) {
                throw ValidationException::withMessages([
                    'product_id' => ['بلغ المتجر الحد الأقصى من العروض المهيَّأة ('.StorefrontOfferResolver::MAX_OFFERS_PER_STOREFRONT.').'],
                ]);
            }

            $this->assertNotDuplicate($storefront, $data['product_id']);

            $position = $data['position'] ?? $this->nextPosition($storefront);

            try {
                return StorefrontOffer::query()->create([
                    'storefront_id' => $storefront->id,
                    'product_id' => $data['product_id'],
                    'starts_at' => $startsAt,
                    'ends_at' => $endsAt,
                    'is_active' => $data['is_active'] ?? true,
                    'position' => $position,
                ]);
            } catch (UniqueConstraintViolationException) {
                throw new StorefrontOfferConflictException('هذا المنتج مُهيَّأ مسبقاً كعرض على هذا المتجر.');
            }
        });
    }

    /**
     * تحديث جزئي: مفتاحٌ غائب لا يتغيّر، و`null` صريحٌ في `starts_at`/`ends_at`
     * يمسح الحد. أهلية المنتج تُفحص **فقط** عند تغيير `product_id` — فيبقى
     * بإمكان التاجر تعطيل أو جدولة أو حذف عرضٍ خرج منتجه من النشر لاحقاً.
     *
     * @param  array<string, mixed>  $data
     * @return StorefrontOffer|null `null` ⇒ عرضٌ غير موجود لهذا المتجر (404).
     */
    public function update(Storefront $storefront, string $offerId, array $data): ?StorefrontOffer
    {
        return DB::transaction(function () use ($storefront, $offerId, $data) {
            $offer = StorefrontOffer::query()
                ->where('storefront_id', $storefront->id)
                ->whereKey($offerId)
                ->lockForUpdate()
                ->first();
            if ($offer === null) {
                return null;
            }

            $startsAt = array_key_exists('starts_at', $data) ? $this->parseInstant($data['starts_at']) : $offer->starts_at;
            $endsAt = array_key_exists('ends_at', $data) ? $this->parseInstant($data['ends_at']) : $offer->ends_at;
            $this->assertWindow($startsAt, $endsAt);

            if (array_key_exists('product_id', $data) && $data['product_id'] !== $offer->product_id) {
                $this->assertEligibleProduct($storefront, $data['product_id']);
                $this->assertNotDuplicate($storefront, $data['product_id']);
                $offer->product_id = $data['product_id'];
            }

            $offer->starts_at = $startsAt;
            $offer->ends_at = $endsAt;
            if (array_key_exists('is_active', $data)) {
                $offer->is_active = (bool) $data['is_active'];
            }
            if (array_key_exists('position', $data)) {
                $offer->position = (int) $data['position'];
            }

            try {
                $offer->save();
            } catch (UniqueConstraintViolationException) {
                throw new StorefrontOfferConflictException('هذا المنتج مُهيَّأ مسبقاً كعرض على هذا المتجر.');
            }

            return $offer;
        });
    }

    public function delete(Storefront $storefront, string $offerId): bool
    {
        $offer = $this->find($storefront, $offerId);
        if ($offer === null) {
            return false;
        }

        $offer->delete();

        return true;
    }

    /**
     * رسالةٌ موحّدة لكل سبب (أجنبي، غير موجود، غير نشط، غير منشور على قناة هذا
     * المتجر) فلا يتسرّب وجود منتجٍ خارج نطاق المستأجر. المنتج متعدد الخيارات
     * يُرفض بوضوح لأنه حتمي: لا يظهر علناً مهما كان تسعيره (انظر المُحلِّل).
     */
    private function assertEligibleProduct(Storefront $storefront, string $productId): void
    {
        $product = Product::query()
            ->withoutGlobalScope(BranchScope::class)
            ->where('is_active', true)
            ->whereIn('id', CommerceListing::query()
                ->where('sales_channel_id', $storefront->sales_channel_id)
                ->where('is_published', true)
                ->select('product_id'))
            ->find($productId);

        if ($product === null) {
            throw ValidationException::withMessages([
                'product_id' => ['المنتج غير متاح لهذا المتجر: يجب أن يكون نشطاً ومنشوراً على قناته.'],
            ]);
        }

        if ($product->isVariantManaged()) {
            throw ValidationException::withMessages([
                'product_id' => ['المنتجات متعددة الخيارات غير مدعومة في العروض بعد.'],
            ]);
        }
    }

    private function assertNotDuplicate(Storefront $storefront, string $productId): void
    {
        $exists = StorefrontOffer::query()
            ->where('storefront_id', $storefront->id)
            ->where('product_id', $productId)
            ->exists();

        if ($exists) {
            throw new StorefrontOfferConflictException('هذا المنتج مُهيَّأ مسبقاً كعرض على هذا المتجر.');
        }
    }

    private function assertWindow(?CarbonInterface $startsAt, ?CarbonInterface $endsAt): void
    {
        if ($startsAt !== null && $endsAt !== null && ! $startsAt->lt($endsAt)) {
            throw ValidationException::withMessages([
                'ends_at' => ['نهاية العرض يجب أن تلي بدايته.'],
            ]);
        }
    }

    private function nextPosition(Storefront $storefront): int
    {
        $max = StorefrontOffer::query()->where('storefront_id', $storefront->id)->max('position');

        return $max === null ? 0 : min((int) $max + 1, self::MAX_POSITION);
    }

    /** UTC دائماً — لا توقيت محلي للمستأجر. */
    private function parseInstant(mixed $value): ?CarbonImmutable
    {
        return $value === null || $value === '' ? null : CarbonImmutable::parse((string) $value)->utc();
    }
}
