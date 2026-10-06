<?php

namespace App\Services\Commerce;

use App\Http\Resources\StorefrontProductResource;
use App\Models\CommerceListing;
use App\Models\CommerceCartItem;
use App\Models\CommerceProductAddon;
use App\Models\CommerceProductPersonalizationField;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Services\ProductMediaGalleryService;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use RuntimeException;

/**
 * FLOWERS-H6 / ADR-18 — إضافات مدعومة بمنتجات حقيقية.
 *
 * علاقة صريحة أب⇒إضافة؛ السعر والمخزون والنشر من مساراتها الأصلية حصراً (هنا لا شيء من
 * ذلك). العميل يرسل معرّفات منتجات وكميات لكل أب فقط، ولا يحمل أي حقل سعر.
 */
final class ProductAddonService
{
    public const MAX_ADDONS = 8;

    /** @return list<array<string, mixed>> كل العلاقات (إدارية) */
    public function definitions(Product $product): array
    {
        $this->assertProductTenant($product);

        return CommerceProductAddon::query()
            ->where('product_id', $product->id)
            ->with(['addonProduct:id,name,name_en,sku,is_active'])
            ->orderBy('sort_order')
            ->get()
            ->map(fn (CommerceProductAddon $a) => [
                'addon_product_id' => $a->addon_product_id,
                'addon_variant_id' => $a->addon_variant_id,
                'name' => $a->addonProduct?->name,
                'name_en' => $a->addonProduct?->name_en,
                'sku' => $a->addonProduct?->sku,
                'product_is_active' => (bool) $a->addonProduct?->is_active,
                'max_quantity' => $a->max_quantity,
                'is_active' => $a->is_active,
            ])
            ->values()
            ->all();
    }

    /**
     * بصمة العلاقات الحالية (المنتج الهدف والمتغيّر والكمية والتفعيل)، دون حقول القراءة المشتقّة من المنتج الهدف (الاسم/نشاطه)
     * فلا يُرفض حفظٌ مشروع لأن اسم منتج إضافة تغيّر. يقرؤها العميل ويعيدها (`expected_revision`) فيُرفض الاستبدال القديم داخل القفل.
     *
     * @param  list<array<string, mixed>>  $definitions
     */
    public function revisionFor(array $definitions): string
    {
        $relations = array_map(fn (array $d) => [
            'addon_product_id' => $d['addon_product_id'],
            'addon_variant_id' => $d['addon_variant_id'],
            'max_quantity' => $d['max_quantity'],
            'is_active' => $d['is_active'],
        ], $definitions);

        return sha1((string) json_encode($relations));
    }

    /**
     * @param  list<array{addon_product_id: string, addon_variant_id?: ?string, max_quantity?: int, is_active?: bool}>  $addons
     * @return list<array<string, mixed>>
     */
    public function replace(Product $product, array $addons, ?string $expectedRevision = null): array
    {
        $this->assertProductTenant($product);

        if (count($addons) > self::MAX_ADDONS) {
            throw new DomainException('عدد الإضافات يتجاوز الحد المسموح للمنتج.');
        }
        $ids = array_column($addons, 'addon_product_id');
        if (count($ids) !== count(array_unique($ids))) {
            throw new DomainException('لا يمكن تكرار منتج الإضافة نفسه.');
        }
        if (in_array($product->id, $ids, true)) {
            throw new DomainException('لا يمكن ربط المنتج بنفسه كإضافة.');
        }

        return DB::transaction(function () use ($product, $addons, $ids, $expectedRevision) {
            // قفلٌ واحد لاتحاد (الأب + منتجات الإضافة) بترتيب المعرّف الشامل: مديران يضبطان علاقتين متبادلتين
            // (أ→ب وب→أ) يطلبان الأقفال بنفس الترتيب فلا دورة انتظار ولا deadlock. BranchScope وحده يُرفع؛
            // TenantScope وSoftDeletes يبقيان، فمنتجٌ حُذف بين تحميل المتحكّم وهذا القفل (الأب أو الهدف) لا يُقفل
            // فيُرفض: الأب بـ404 بدل نجاحٍ فارغ أو 500 من قيد المفتاح الأجنبي، والهدف برسالة «غير موجود».
            // تعطيلٌ أو حذفٌ متزامن لمنتج إضافة إما ينتهي قبل قراءتنا فنرفضه، أو ينتظر التزامنا فيرى العلاقة ويُنظّفها.
            $locked = Product::withoutGlobalScope(BranchScope::class)
                ->whereIn('id', array_values(array_unique([$product->id, ...$ids])))
                ->orderBy('id')
                ->lockForUpdate()
                ->get()
                ->keyBy('id');
            if (! $locked->has($product->id)) {
                throw (new ModelNotFoundException)->setModel(Product::class, [$product->id]);
            }

            if ($expectedRevision !== null && ! hash_equals($this->revisionFor($this->definitions($product)), $expectedRevision)) {
                throw new StaleRevisionException('تغيّرت الإضافات على الخادم منذ قرأتها. حدّث الصفحة وراجعها ثم أعد المحاولة.');
            }

            // الأهداف تُحلّ بعد القفل عبر Product::query() (TenantScope + نطاق الفرع للمستخدم الإداري).
            $found = Product::query()->whereIn('id', $ids)->get()->keyBy('id');
            $needsInput = $this->productsRequiringPersonalization($ids);
            foreach ($addons as $addon) {
                $target = $found[$addon['addon_product_id']] ?? null;
                if ($target === null) {
                    throw new DomainException('أحد منتجات الإضافة غير موجود لهذا المستأجر.');
                }
                if (! $target->is_active) {
                    throw new DomainException("منتج الإضافة «{$target->name}» غير نشط.");
                }
                if (isset($needsInput[$target->id])) {
                    throw new DomainException("منتج الإضافة «{$target->name}» يتطلب إدخال تخصيص إلزامي لا يمكن جمعه كإضافة.");
                }
                $variantId = $addon['addon_variant_id'] ?? null;
                if ($target->isVariantManaged() && $variantId === null) {
                    throw new DomainException("منتج الإضافة «{$target->name}» متعدد الخيارات — حدّد المتغيّر.");
                }
                if (! $target->isVariantManaged() && $variantId !== null) {
                    throw new DomainException("منتج الإضافة «{$target->name}» بلا متغيّرات.");
                }
                if ($variantId !== null && ! ProductVariant::query()->whereKey($variantId)->where('product_id', $target->id)->where('is_active', true)->exists()) {
                    throw new DomainException('متغيّر الإضافة غير صالح.');
                }
            }

            CommerceProductAddon::query()->where('product_id', $product->id)->delete();
            foreach (array_values($addons) as $position => $addon) {
                CommerceProductAddon::create([
                    'product_id' => $product->id,
                    'addon_product_id' => $addon['addon_product_id'],
                    'addon_variant_id' => $addon['addon_variant_id'] ?? null,
                    'max_quantity' => (int) ($addon['max_quantity'] ?? 1),
                    'sort_order' => $position,
                    'is_active' => (bool) ($addon['is_active'] ?? true),
                ]);
            }

            return $this->definitions($product);
        });
    }

    /**
     * H6 عام: الإضافات **النشطة** القابلة للبيع على القناة (منتج نشط + عرض منشور) مع سعر
     * `CommercePriceResolver` وتوفّر مشتق. لا تكلفة ولا مخزون خام.
     *
     * @return list<array<string, mixed>>
     */
    public function publicAddons(string $productId, string $channelId, string $currency, ?string $tenantSlug, ?object $warehouse = null, bool $commerceMedia = false): array
    {
        $relations = CommerceProductAddon::query()->where('product_id', $productId)->where('is_active', true)->orderBy('sort_order')->get();
        if ($relations->isEmpty()) {
            return [];
        }

        $prices = app(CommercePriceResolver::class);
        $availability = app(AvailableToSellService::class);
        $gallery = app(ProductMediaGalleryService::class);

        $products = Product::query()->withoutGlobalScope(BranchScope::class)
            ->where('is_active', true)
            ->whereIn('id', $relations->pluck('addon_product_id'))
            ->whereIn('id', CommerceListing::query()->where('sales_channel_id', $channelId)->where('is_published', true)->select('product_id'))
            ->get()->keyBy('id');

        $needsInput = $this->productsRequiringPersonalization($relations->pluck('addon_product_id')->all());
        $variants = ProductVariant::query()
            ->whereIn('id', $relations->pluck('addon_variant_id')->filter())
            ->where('is_active', true)
            ->get()->keyBy('id');

        $out = [];
        foreach ($relations as $relation) {
            $addon = $products[$relation->addon_product_id] ?? null;
            // إضافة تطلب تخصيصاً إلزامياً (أُضيف لها بعد ضبط العلاقة): لا يمكن جمع مُدخَلها كسطر تابع،
            // فيُخفى بدل عرضٍ يفشل عند الإتمام.
            if ($addon === null || isset($needsInput[$addon->id])) {
                continue;
            }
            // متغيّرٌ عُطِّل أو حُذف بعد ضبط العلاقة (FK يصفّر العمود): الإضافة غير قابلة للبيع فتُحذف
            // من العرض بدل أن يرمي حلّ السعر استثناءً فيفشل تفصيل المنتج الأب كله.
            if (! $this->variantStateSellable($addon, $relation->addon_variant_id, $variants->get($relation->addon_variant_id))) {
                continue;
            }

            $price = $prices->resolve($addon->id, $channelId, null, null, false, $relation->addon_variant_id);
            if (! $price->resolved || $price->amount === null) {
                continue;
            }

            $variant = $relation->addon_variant_id !== null ? $variants->get($relation->addon_variant_id) : null;
            $inStock = $warehouse !== null
                ? $availability->forWarehouse($addon->id, $warehouse->id, $relation->addon_variant_id)->availableToSell > 0
                : null;
            $media = $commerceMedia
                ? StorefrontProductResource::commerceMediaPayload($gallery->resolveGallery($addon, $variant))
                : StorefrontProductResource::mediaPayload($gallery->resolveGallery($addon, $variant), $tenantSlug);

            $out[] = [
                'product_id' => $addon->id,
                'product_variant_id' => $relation->addon_variant_id,
                'name' => $addon->name,
                'name_en' => $addon->name_en,
                'price' => ['amount_minor' => $price->amount, 'currency' => $currency],
                'in_stock' => $inStock,
                'max_quantity' => $relation->max_quantity,
                'thumbnail_url' => $media[0]['url'] ?? null,
            ];
        }

        return $out;
    }

    /**
     * يتحقق من اختيار العميل مقابل علاقات الأب **النشطة** ويعيد قائمة مطبَّعة، أو يرفع 422.
     * الاختيار: [{product_id, product_variant_id?, quantity?}] — لا حقل سعر.
     *
     * @param  list<array<string, mixed>>|null  $selection
     * @return list<array{addon_product_id: string, addon_variant_id: ?string, per_parent_quantity: int}>
     */
    public function normalizeSelection(Product $parent, ?array $selection): array
    {
        if ($selection === null || $selection === []) {
            return [];
        }
        if (! array_is_list($selection)) {
            throw ValidationException::withMessages(['addons' => 'صيغة الإضافات غير صالحة.']);
        }
        if (count($selection) > self::MAX_ADDONS) {
            throw ValidationException::withMessages(['addons' => 'عدد الإضافات المحددة يتجاوز الحد المسموح.']);
        }

        $relations = CommerceProductAddon::query()->where('product_id', $parent->id)->where('is_active', true)->get()->keyBy('addon_product_id');
        $out = [];
        foreach ($selection as $row) {
            $productId = (string) ($row['product_id'] ?? '');
            $relation = $relations[$productId] ?? null;
            if ($relation === null) {
                throw ValidationException::withMessages(['addons' => 'إضافة غير متاحة لهذا المنتج.']);
            }
            if (isset($out[$productId])) {
                throw ValidationException::withMessages(['addons' => 'لا يمكن تكرار الإضافة نفسها.']);
            }

            if ($this->productsRequiringPersonalization([$productId]) !== []) {
                throw ValidationException::withMessages(['addons' => 'إضافة غير متاحة لهذا المنتج.']);
            }
            $variantId = $row['product_variant_id'] ?? null;
            $relationVariant = $relation->addon_variant_id !== null
                ? ProductVariant::query()->whereKey($relation->addon_variant_id)->where('is_active', true)->first()
                : null;
            if (! $this->variantStateSellable(Product::query()->find($productId), $relation->addon_variant_id, $relationVariant)) {
                throw ValidationException::withMessages(['addons' => 'إضافة غير متاحة لهذا المنتج.']);
            }
            if (($relation->addon_variant_id ?? null) !== ($variantId ?: null)) {
                throw ValidationException::withMessages(['addons' => 'متغيّر الإضافة لا يطابق المعرَّف للمنتج.']);
            }

            $quantity = (int) ($row['quantity'] ?? 1);
            if ($quantity < 1 || $quantity > $relation->max_quantity) {
                throw ValidationException::withMessages(['addons' => "كمية الإضافة يجب أن تكون بين 1 و{$relation->max_quantity}."]);
            }

            $out[$productId] = ['addon_product_id' => $productId, 'addon_variant_id' => $relation->addon_variant_id, 'per_parent_quantity' => $quantity];
        }

        return array_values($out);
    }

    /**
     * حالة متغيّر العلاقة سليمة: منتجٌ متعدد المتغيّرات يحتاج متغيّراً نشطاً موجوداً، ومنتجٌ بسيط
     * لا يحمل متغيّراً. (لا استثناء ولا تخمين: تُستعمل قبل أي حلّ سعر أو توفّر.)
     */
    /**
     * منتجات (من المعرّفات) لها حقل تخصيص إلزامي نشط — لا تصلح كإضافة لأن سطر الإضافة لا يحمل مُدخَلاً.
     *
     * @param  list<string>  $productIds
     * @return array<string, true> مفتاحه معرّف المنتج
     */
    private function productsRequiringPersonalization(array $productIds): array
    {
        if ($productIds === []) {
            return [];
        }

        return CommerceProductPersonalizationField::query()
            ->whereIn('product_id', $productIds)
            ->where('is_active', true)
            ->where('is_required', true)
            ->pluck('product_id')
            ->mapWithKeys(fn ($id) => [$id => true])
            ->all();
    }

    private function variantStateSellable(?Product $addon, ?string $variantId, ?ProductVariant $variant): bool
    {
        if ($addon === null) {
            return false;
        }
        if ($addon->isVariantManaged()) {
            return $variantId !== null && $variant !== null && $variant->product_id === $addon->id;
        }

        return $variantId === null;
    }

    /**
     * هل ما زالت علاقة سطر الإضافة بأبيه قائمة؟ تُقرأ مقابل `commerce_product_addons` **الحالية** (قد يعدّلها
     * التاجر بعد الإضافة للسلة): علاقة نشطة بنفس المتغيّر، كمية لكل أب ضمن الحد، وكمية الابن = لكل أب × كمية
     * الأب. مصدر واحد يستعمله الإتمام (يرفض بـ`addon_unavailable`) وعرض السلة (يعلّم السطر غير متاح)، فلا
     * يظهر في السلة سطرٌ متاحٌ يرفضه الإتمام.
     */
    public function relationHolds(CommerceCartItem $child, ?CommerceCartItem $parent): bool
    {
        if ($parent === null || $parent->product_id === null) {
            return false;
        }

        $relation = CommerceProductAddon::query()
            ->where('product_id', $parent->product_id)
            ->where('addon_product_id', $child->product_id)
            ->where('is_active', true)
            ->first();
        if ($relation === null || ($relation->addon_variant_id ?? null) !== ($child->product_variant_id ?? null)) {
            return false;
        }

        $perParent = (int) ($child->per_parent_quantity ?? 0);

        return $perParent >= 1
            && $perParent <= $relation->max_quantity
            && $child->quantity === $perParent * $parent->quantity;
    }

    /**
     * يقفل صفوف الأب وكل منتجات الاختيار معاً بترتيب المعرّف الشامل — نفس ترتيب `replace()` — قبل أي فحص
     * أهلية في مسار السلة. من دونه يقفل السلة الأبَ ثم الإضافةَ بترتيب اختيار العميل، فيدور deadlock مع
     * `replace()` حين يسبق معرّفُ الإضافة معرّفَ الأب. لا يفعل شيئاً بلا إضافات. (BranchScope يُرفع كما
     * في `purchasable()`؛ TenantScope وSoftDeletes باقيان.)
     *
     * @param  list<array<string, mixed>>|null  $selection  صفوف الاختيار الخام (product_id)
     */
    public function lockForCart(string $parentProductId, ?array $selection): void
    {
        if ($selection === null || $selection === []) {
            return;
        }

        $ids = [$parentProductId];
        foreach ($selection as $row) {
            if (is_array($row) && is_string($row['product_id'] ?? null) && $row['product_id'] !== '') {
                $ids[] = $row['product_id'];
            }
        }

        Product::withoutGlobalScope(BranchScope::class)
            ->whereIn('id', array_values(array_unique($ids)))
            ->orderBy('id')
            ->lockForUpdate()
            ->pluck('id');
    }

    /**
     * يرفض أي مفتاح غير `product_id`/`product_variant_id`/`quantity` داخل صفوف الاختيار — أهمّها
     * أي حقل سعر: العميل لا يحمل سعراً على الإطلاق، والسعر من الخادم حصراً.
     */
    public static function rejectUnknownSelectionKeys(mixed $selection): void
    {
        if (! is_array($selection)) {
            return;
        }
        foreach ($selection as $row) {
            if (is_array($row) && array_diff(array_keys($row), ['product_id', 'product_variant_id', 'quantity']) !== []) {
                throw ValidationException::withMessages(['addons' => 'حقول غير مسموحة في الإضافات.']);
            }
        }
    }

    private function assertProductTenant(Product $product): void
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null || $product->tenant_id !== $tenantId) {
            throw new RuntimeException('المنتج غير موجود لهذا المستأجر.');
        }
    }
}
