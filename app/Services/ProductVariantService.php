<?php

namespace App\Services;

use App\Models\PriceListItem;
use App\Models\Product;
use App\Models\ProductActivity;
use App\Models\ProductOption;
use App\Models\ProductOptionValue;
use App\Models\ProductVariant;
use App\Models\SkuRegistryEntry;
use Illuminate\Database\QueryException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  VAR-CORE-1 — خدمة خيارات/قيم/متغيّرات المنتج
 * ═══════════════════════════════════════════════════════════════
 *  هذا المسار لا يمسّ مخزوناً ولا تسعيراً ولا وسائط ولا قيداً محاسبياً. يضبط
 *  هوية «التركيبة القابلة للبيع» فقط: خيار ← قيمة ← متغيّر.
 *
 *  **هوية التركيبة خادميّة حتماً:** `combination_key` معرّفات قيمٍ مرتّبة
 *  أبجدياً — لا تسلسل عرضٍ ولا نصّ مترجَم. القيد الفريد
 *  `(product_id, combination_key)` في قاعدة البيانات هو الضامن الحقيقي تحت
 *  التزامن؛ فحص الخدمة المسبق تجربة مستخدمٍ أفضل فقط، لا الحارس الوحيد.
 *
 *  **SKU المنتج والمتغيّر فضاءٌ واحد:** كلاهما يمرّ عبر
 *  `SkuRegistryEntry::claim()` (قيدٌ فريد `(tenant_id, sku)`)، فلا يتصادم
 *  منتجٌ ومتغيّرٌ آخر أبداً — بنفس منطق `BarcodeRegistryEntry` تماماً.
 */
class ProductVariantService
{
    /**
     * سقفٌ دفاعي ضد انفجار Cartesian — مذكورٌ صراحةً في عقد الواجهة كحدٍّ
     * تنفيذي لا قاعدة عمل، قابلٌ للمراجعة لاحقاً بأدلة أداء حقيقية.
     */
    private const MAX_COMBINATIONS = 500;

    public function __construct(private readonly ProductLifecycleService $lifecycle)
    {
    }

    // ───────────────────────── خيارات ─────────────────────────

    /** @param array<string, mixed> $data */
    public function createOption(Product $product, array $data, ?string $userId): ProductOption
    {
        return DB::transaction(function () use ($product, $data, $userId) {
            $product = Product::lockForUpdate()->findOrFail($product->id);
            $name = trim((string) $data['name']);
            $key = ProductOption::normalizeKey($name);

            if ($product->options()->where('name_key', $key)->exists()) {
                throw new RuntimeException('يوجد خيارٌ بهذا الاسم على هذا المنتج بالفعل.');
            }

            $sortOrder = $data['sort_order'] ?? (((int) $product->options()->max('sort_order')) + 1);

            try {
                $option = ProductOption::create([
                    'product_id' => $product->id,
                    'name' => $name,
                    'name_en' => $data['name_en'] ?? null,
                    'name_key' => $key,
                    'sort_order' => $sortOrder,
                    'is_active' => $data['is_active'] ?? true,
                ]);
            } catch (QueryException $e) {
                if ($this->isUniqueViolation($e)) {
                    throw new RuntimeException('يوجد خيارٌ بهذا الاسم على هذا المنتج بالفعل.');
                }

                throw $e;
            }

            $this->recordActivity($product, 'variant_option_created', ['option' => [null, $option->name]], $userId);

            return $option;
        });
    }

    /** @param array<string, mixed> $data */
    public function updateOption(ProductOption $option, array $data, ?string $userId): ProductOption
    {
        return DB::transaction(function () use ($option, $data, $userId) {
            $option = ProductOption::lockForUpdate()->findOrFail($option->id);
            $product = $option->product;
            $diff = [];

            if (array_key_exists('name', $data)) {
                $name = trim((string) $data['name']);
                $key = ProductOption::normalizeKey($name);

                $collides = $product->options()->where('name_key', $key)->where('id', '!=', $option->id)->exists();
                if ($collides) {
                    throw new RuntimeException('يوجد خيارٌ بهذا الاسم على هذا المنتج بالفعل.');
                }

                if ($name !== $option->name) {
                    $diff['name'] = [$option->name, $name];
                }
                $option->name = $name;
                $option->name_key = $key;
            }

            if (array_key_exists('name_en', $data) && $data['name_en'] !== $option->name_en) {
                $diff['name_en'] = [$option->name_en, $data['name_en']];
                $option->name_en = $data['name_en'];
            }

            if (array_key_exists('sort_order', $data)) {
                $option->sort_order = (int) $data['sort_order'];
            }

            if (array_key_exists('is_active', $data) && (bool) $data['is_active'] !== $option->is_active) {
                $diff['is_active'] = [$option->is_active, (bool) $data['is_active']];
                $option->is_active = (bool) $data['is_active'];
            }

            if ($option->isDirty()) {
                $option->save();
            }
            if ($diff !== []) {
                $this->recordActivity($product, 'variant_option_updated', $diff, $userId);
            }

            return $option;
        });
    }

    /**
     * حذفٌ حقيقي مسموحٌ فقط لخيارٍ لا تستعمل أيٌّ من قيمه أي متغيّر. تعطيله
     * (`is_active=false`) هو المسار الآمن لخيارٍ مستعمَل — لا حذف تدريجي.
     */
    public function deleteOption(ProductOption $option, ?string $userId): void
    {
        DB::transaction(function () use ($option, $userId) {
            $option = ProductOption::lockForUpdate()->findOrFail($option->id);
            $usedCount = DB::table('product_variant_option_values')->where('product_option_id', $option->id)->count();

            if ($usedCount > 0) {
                throw new RuntimeException("لا يمكن حذف هذا الخيار لأنه مستعمَل في {$usedCount} متغيّراً. عطّله بدلاً من ذلك، أو احذف المتغيّرات المرتبطة أولاً.");
            }

            $product = $option->product;
            $name = $option->name;
            $option->values()->delete();
            $option->delete();

            $this->recordActivity($product, 'variant_option_deleted', ['option' => [$name, null]], $userId);
        });
    }

    // ───────────────────────── قيم الخيارات ─────────────────────────

    /** @param array<string, mixed> $data */
    public function addOptionValue(ProductOption $option, array $data, ?string $userId): ProductOptionValue
    {
        return DB::transaction(function () use ($option, $data, $userId) {
            $option = ProductOption::lockForUpdate()->findOrFail($option->id);
            $value = trim((string) $data['value']);
            $key = ProductOptionValue::normalizeKey($value);

            if ($option->values()->where('value_key', $key)->exists()) {
                throw new RuntimeException('توجد قيمة بهذا الاسم لهذا الخيار بالفعل.');
            }

            $sortOrder = $data['sort_order'] ?? (((int) $option->values()->max('sort_order')) + 1);

            try {
                $optionValue = ProductOptionValue::create([
                    'product_option_id' => $option->id,
                    'value' => $value,
                    'value_en' => $data['value_en'] ?? null,
                    'value_key' => $key,
                    'sort_order' => $sortOrder,
                    'is_active' => $data['is_active'] ?? true,
                ]);
            } catch (QueryException $e) {
                if ($this->isUniqueViolation($e)) {
                    throw new RuntimeException('توجد قيمة بهذا الاسم لهذا الخيار بالفعل.');
                }

                throw $e;
            }

            $this->recordActivity($option->product, 'variant_option_value_created', ['value' => [null, $optionValue->value]], $userId);

            return $optionValue;
        });
    }

    /** @param array<string, mixed> $data */
    public function updateOptionValue(ProductOptionValue $value, array $data, ?string $userId): ProductOptionValue
    {
        return DB::transaction(function () use ($value, $data, $userId) {
            $value = ProductOptionValue::lockForUpdate()->findOrFail($value->id);
            $option = $value->option;
            $diff = [];

            if (array_key_exists('value', $data)) {
                $new = trim((string) $data['value']);
                $key = ProductOptionValue::normalizeKey($new);

                $collides = $option->values()->where('value_key', $key)->where('id', '!=', $value->id)->exists();
                if ($collides) {
                    throw new RuntimeException('توجد قيمة بهذا الاسم لهذا الخيار بالفعل.');
                }

                if ($new !== $value->value) {
                    $diff['value'] = [$value->value, $new];
                }
                $value->value = $new;
                $value->value_key = $key;
            }

            if (array_key_exists('value_en', $data) && $data['value_en'] !== $value->value_en) {
                $diff['value_en'] = [$value->value_en, $data['value_en']];
                $value->value_en = $data['value_en'];
            }

            if (array_key_exists('sort_order', $data)) {
                $value->sort_order = (int) $data['sort_order'];
            }

            if (array_key_exists('is_active', $data) && (bool) $data['is_active'] !== $value->is_active) {
                $diff['is_active'] = [$value->is_active, (bool) $data['is_active']];
                $value->is_active = (bool) $data['is_active'];
            }

            if ($value->isDirty()) {
                $value->save();
            }
            if ($diff !== []) {
                $this->recordActivity($option->product, 'variant_option_value_updated', $diff, $userId);
            }

            return $value;
        });
    }

    /** حذفٌ حقيقي مسموحٌ فقط لقيمةٍ لا يستعملها أي متغيّر. */
    public function deleteOptionValue(ProductOptionValue $value, ?string $userId): void
    {
        DB::transaction(function () use ($value, $userId) {
            $value = ProductOptionValue::lockForUpdate()->findOrFail($value->id);
            $usedCount = DB::table('product_variant_option_values')->where('product_option_value_id', $value->id)->count();

            if ($usedCount > 0) {
                throw new RuntimeException("لا يمكن حذف هذه القيمة لأنها مستعملة في {$usedCount} متغيّراً. عطّلها بدلاً من ذلك.");
            }

            $option = $value->option;
            $label = $value->value;
            $value->delete();

            $this->recordActivity($option->product, 'variant_option_value_deleted', ['value' => [$label, null]], $userId);
        });
    }

    // ───────────────────────── حالة المنتج (بسيط ⇄ متعدد الخيارات) ─────────────────────────

    /**
     * التحويل الآمن: يُرفض مغلقاً إن وُجد أثرٌ تشغيلي/مخزني حقيقي — لا تخمين
     * لكيفية توزيعه على المتغيّرات الجديدة أبداً.
     */
    public function enableVariantManagement(Product $product, ?string $userId): Product
    {
        return DB::transaction(function () use ($product, $userId) {
            $product = Product::lockForUpdate()->findOrFail($product->id);

            if ($product->isVariantManaged()) {
                return $product;
            }

            if ($this->hasOperationalFootprint($product)) {
                throw new RuntimeException(
                    'لا يمكن تحويل هذا المنتج إلى منتج متعدد الخيارات الآن. '.
                    'يوجد رصيدٌ مخزني أو حركةٌ قائمة تحتاج إلى توزيع صريح على المتغيّرات. '.
                    'سيُدعم هذا المسار عبر عملية تحويل مخزون مخصّصة لاحقاً.'
                );
            }

            // منتجٌ متعدد الخيارات مرئيٌّ من كل الفروع دائماً (لا مفهوم فرعٍ
            // للمتغيّرات في VAR-CORE-1) — فرمزه يجب أن ينضمّ إلى الفضاء
            // الموحّد الآن، لا عند أول تعديل لاحق لرمزه. تغيير `variant_state`
            // وحده لا يُدَخِّن `sku` (`isDirty('sku')` في `booted()` لا يلتقط
            // هذا التحوّل)، فالمطالبة هنا صريحة قبل الحفظ — إن تصادمت مع رمز
            // منتجٍ آخر يفشل التحويل كاملاً (المعاملة تتراجع)، لا أن يترك
            // المنتج متعدد الخيارات برمزٍ لم يُحجز فعلياً.
            if (! blank($product->sku)) {
                SkuRegistryEntry::claim($product->sku, 'product', productId: $product->id);
            }

            $product->variant_state = 'variant_managed';
            $product->save();

            $this->recordActivity($product, 'variant_management_enabled', ['variant_state' => ['simple', 'variant_managed']], $userId);

            return $product;
        });
    }

    /** التراجع مسدودٌ ما دام للمنتج أي متغيّر — ولو معطَّلاً. */
    public function disableVariantManagement(Product $product, ?string $userId): Product
    {
        return DB::transaction(function () use ($product, $userId) {
            $product = Product::lockForUpdate()->findOrFail($product->id);

            if (! $product->isVariantManaged()) {
                return $product;
            }

            if ($product->variants()->exists()) {
                throw new RuntimeException('لا يمكن التراجع عن إدارة المتغيّرات ما دام للمنتج متغيّرٌ واحد على الأقل. احذف كل المتغيّرات أولاً.');
            }

            $product->variant_state = 'simple';
            $product->save();

            // عكس ما فعله enableVariantManagement(): إن عاد المنتج فرعياً
            // معزولاً بحسب الفرع/الإعداد الحاليين، يُحرَّر انضمامه الصريح إلى
            // الفضاء الموحّد — وإلا بقي صفٌّ يتيمٌ يحجز رمزاً لن يستفيد منه
            // هذا المنتج بعد الآن، ويمنع غيره من استعماله في فرعٍ آخر بلا سبب.
            if (! blank($product->sku) && ! $product->claimsSkuNamespace()) {
                SkuRegistryEntry::releaseOwnedByProduct($product->sku, $product->id);
            }

            $this->recordActivity($product, 'variant_management_disabled', ['variant_state' => ['variant_managed', 'simple']], $userId);

            return $product;
        });
    }

    private function hasOperationalFootprint(Product $product): bool
    {
        return $product->quantity_on_hand !== 0 || $this->lifecycle->hasInventoryFootprint($product);
    }

    // ───────────────────────── مصفوفة التركيبات المقترَحة ─────────────────────────

    /**
     * الجداء الديكارتي الكامل لقيم خيارات المنتج الفعّالة، مع علامة وجودٍ
     * مسبق لكل تركيبة — اقتراحٌ للمراجعة، لا إنشاءً صامتاً.
     *
     * @return array{options: array, total_possible: int, combinations: array}
     */
    public function combinationsMatrix(Product $product): array
    {
        $options = $product->options()
            ->where('is_active', true)
            ->with(['values' => fn ($q) => $q->where('is_active', true)])
            ->orderBy('sort_order')
            ->get();

        $optionSummaries = $options->map(fn (ProductOption $o) => [
            'id' => $o->id,
            'name' => $o->name,
            'name_en' => $o->name_en,
            'values' => $o->values->map(fn (ProductOptionValue $v) => [
                'id' => $v->id, 'value' => $v->value, 'value_en' => $v->value_en,
            ])->values()->all(),
        ])->values()->all();

        if ($options->isEmpty() || $options->contains(fn (ProductOption $o) => $o->values->isEmpty())) {
            return ['options' => $optionSummaries, 'total_possible' => 0, 'combinations' => []];
        }

        $lists = $options->map(fn (ProductOption $o) => $o->values->all())->all();
        $total = array_product(array_map('count', $lists));

        if ($total > self::MAX_COMBINATIONS) {
            throw new RuntimeException(
                "عدد التركيبات المحتملة ({$total}) كبير جداً لعرضه دفعة واحدة. ".
                'قلّل عدد القيم أو أنشئ المتغيّرات على دفعات (الحد الأقصى '.self::MAX_COMBINATIONS.').'
            );
        }

        $existing = ProductVariant::where('product_id', $product->id)->pluck('id', 'combination_key');

        $combinations = [];
        foreach ($this->cartesian($lists) as $combo) {
            /** @var list<ProductOptionValue> $combo */
            $ids = array_map(fn (ProductOptionValue $v) => $v->id, $combo);
            $key = $this->combinationKey($ids);

            $combinations[] = [
                'combination_key' => $key,
                'option_values' => array_map(fn (ProductOptionValue $v) => [
                    'option_id' => $v->product_option_id,
                    'value_id' => $v->id,
                    'value' => $v->value,
                    'value_en' => $v->value_en,
                ], $combo),
                'exists' => $existing->has($key),
                'variant_id' => $existing->get($key),
            ];
        }

        return ['options' => $optionSummaries, 'total_possible' => $total, 'combinations' => $combinations];
    }

    /** @param list<list<mixed>> $lists */
    private function cartesian(array $lists): \Generator
    {
        if ($lists === []) {
            yield [];

            return;
        }

        $first = array_shift($lists);
        foreach ($this->cartesian($lists) as $rest) {
            foreach ($first as $item) {
                yield array_merge([$item], $rest);
            }
        }
    }

    // ───────────────────────── إنشاء المتغيّرات ─────────────────────────

    /**
     * @param  list<list<string>>  $combinations  كل عنصر قائمة معرّفات قيم خيارٍ واحدة لكل خيار فعّال.
     * @return array{created: list<ProductVariant>, duplicates: list<string>, failed: list<array{combination: list<string>, message: string}>}
     */
    public function createVariants(Product $product, array $combinations, ?string $userId): array
    {
        if (! $product->isVariantManaged()) {
            throw new RuntimeException('يجب تفعيل إدارة المتغيّرات لهذا المنتج أولاً.');
        }

        if (count($combinations) > self::MAX_COMBINATIONS) {
            throw new RuntimeException('عدد التركيبات المطلوب إنشاؤها يتجاوز الحد المسموح دفعة واحدة ('.self::MAX_COMBINATIONS.').');
        }

        $created = [];
        $duplicates = [];
        $failed = [];

        foreach ($combinations as $optionValueIds) {
            try {
                $result = $this->createSingleVariant($product, array_values($optionValueIds), $userId);
                if ($result['status'] === 'created') {
                    $created[] = $result['variant'];
                } else {
                    $duplicates[] = $result['combination_key'];
                }
            } catch (RuntimeException $e) {
                $failed[] = ['combination' => array_values($optionValueIds), 'message' => $e->getMessage()];
            }
        }

        return ['created' => $created, 'duplicates' => $duplicates, 'failed' => $failed];
    }

    /**
     * متغيّرٌ واحدٌ من قيم خيارات معطاة، بـ SKU صريح اختياري (وإلا يُشتقّ من
     * SKU المنتج + رموز القيم). كل استدعاء معاملةٌ مستقلّة — سباقٌ على نفس
     * التركيبة يخسر فيه أحد الطرفين بقيد `(product_id, combination_key)`
     * الفريد، لا استثناءً غير معالَج.
     *
     * @param  list<string>  $optionValueIds
     * @return array{status: 'created'|'duplicate', variant?: ProductVariant, combination_key: string}
     */
    public function createSingleVariant(Product $product, array $optionValueIds, ?string $userId, ?string $sku = null): array
    {
        return DB::transaction(function () use ($product, $optionValueIds, $userId, $sku) {
            $values = $this->resolveAndValidateValues($product, $optionValueIds);
            $key = $this->combinationKey($optionValueIds);

            if (ProductVariant::where('product_id', $product->id)->where('combination_key', $key)->exists()) {
                return ['status' => 'duplicate', 'combination_key' => $key];
            }

            $ordered = $this->orderValuesForDisplay($values);
            $explicitSku = $sku !== null ? trim($sku) : null;
            $candidate = $explicitSku ?: $this->candidateSku($product, $ordered, 0);

            try {
                $variant = $this->insertVariant($product, $candidate, $key, $userId);
            } catch (QueryException $e) {
                if ($this->isUniqueViolation($e)) {
                    return ['status' => 'duplicate', 'combination_key' => $key];
                }

                throw $e;
            } catch (RuntimeException $e) {
                if ($explicitSku !== null) {
                    throw $e;
                }

                // محاولة أخيرة بلاحقة إضافية مشتقّة من هوية التركيبة نفسها —
                // لا حلقة إعادة محاولة غير محدودة، وTransaction متداخلة
                // (savepoint) فلا يُفسد فشل المحاولة الأولى المعاملة الخارجية.
                $fallback = $this->candidateSku($product, $ordered, 1);

                try {
                    $variant = $this->insertVariant($product, $fallback, $key, $userId);
                } catch (QueryException $e2) {
                    if ($this->isUniqueViolation($e2)) {
                        return ['status' => 'duplicate', 'combination_key' => $key];
                    }

                    throw $e2;
                }
            }

            $pivotRows = [];
            $now = now();
            foreach ($values as $value) {
                $pivotRows[] = [
                    'id' => (string) Str::uuid(),
                    'tenant_id' => $product->tenant_id,
                    'product_variant_id' => $variant->id,
                    'product_option_id' => $value->product_option_id,
                    'product_option_value_id' => $value->id,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }
            DB::table('product_variant_option_values')->insert($pivotRows);

            $this->recordActivity($product, 'variant_created', ['sku' => [null, $variant->sku], 'combination_key' => [null, $key]], $userId);

            return ['status' => 'created', 'variant' => $variant->fresh()];
        });
    }

    /**
     * إدراجٌ في معاملة متداخلة (savepoint فعلياً تحت PostgreSQL) — فشل
     * محاولة SKU الأولى (تصادمٌ في `SkuRegistryEntry`) لا يُفسد المعاملة
     * الخارجية بأكملها، فتُتاح محاولة ثانية بلاحقة مختلفة.
     */
    private function insertVariant(Product $product, string $sku, string $key, ?string $userId): ProductVariant
    {
        return DB::transaction(fn () => ProductVariant::create([
            'product_id' => $product->id,
            'sku' => $sku,
            'combination_key' => $key,
            'created_by' => $userId,
        ]));
    }

    public function updateVariant(ProductVariant $variant, array $data, ?string $userId): ProductVariant
    {
        return DB::transaction(function () use ($variant, $data, $userId) {
            $variant = ProductVariant::lockForUpdate()->findOrFail($variant->id);
            $diff = [];

            if (array_key_exists('sku', $data)) {
                $sku = trim((string) $data['sku']);
                if ($sku === '') {
                    throw new RuntimeException('رمز المنتج (SKU) للمتغيّر مطلوب.');
                }
                if ($sku !== $variant->sku) {
                    $diff['sku'] = [$variant->sku, $sku];
                    $variant->sku = $sku;
                }
            }

            if (array_key_exists('is_active', $data) && (bool) $data['is_active'] !== $variant->is_active) {
                $diff['is_active'] = [$variant->is_active, (bool) $data['is_active']];
                $variant->is_active = (bool) $data['is_active'];
            }

            if ($variant->isDirty()) {
                $variant->save();
            }
            if ($diff !== []) {
                $this->recordActivity($variant->product, 'variant_updated', $diff, $userId);
            }

            return $variant;
        });
    }

    /**
     * حذفٌ حقيقي — لا مرجعٍ تاريخي/مخزني يشير إلى متغيّرٍ اليوم
     * (VAR-DOC-1/VAR-INV-1 مستقبلاً)؛ يمرّ عبر نقطة واحدة كي تُضاف حماية
     * لاحقاً بلا تفريق منطقٍ بين الطلبات. التعطيل (`is_active=false`) هو
     * المسار المفضَّل دائماً لمتغيّرٍ استُعمل فعلياً.
     */
    public function deleteVariant(ProductVariant $variant, ?string $userId): void
    {
        DB::transaction(function () use ($variant, $userId) {
            $variant = ProductVariant::lockForUpdate()->findOrFail($variant->id);
            $product = $variant->product;
            $sku = $variant->sku;

            // VAR-INV-1: وجود صفّ هويّة مخزونٍ لهذا المتغيّر دليل أثرٍ مخزني
            // حقيقي (الإنشاء كسولٌ — لا صفّ بلا استعمالٍ فعلي، @see
            // App\Models\InventoryState). كميته الحالية صفرٌ لا يكفي: متغيّرٌ
            // استُلمت له بضاعة ثم صُرفت بالكامل له تاريخٌ محاسبي لا يجوز محوه
            // بحذف الهويّة (VAR_ARCH_1 §7.3 — «الصفر ضروري لا كافٍ»).
            if ($variant->inventoryState()->exists()) {
                throw new RuntimeException('لا يمكن حذف هذا المتغيّر لأن له تاريخاً مخزنياً (استلام/صرف). عطّله بدلاً من ذلك.');
            }

            // VAR-PRICE-1: سعرٌ صريح أو عنصر قائمة أسعار قائم لهذا المتغيّر
            // تهيئةٌ تجارية حيّة (COMMERCIAL_LIVE) — حذف المتغيّر صامتاً كان
            // سيُسقطها عبر cascadeOnDelete بلا تراجع.
            if ($variant->unitPrices()->exists() || PriceListItem::where('product_variant_id', $variant->id)->exists()) {
                throw new RuntimeException('لا يمكن حذف هذا المتغيّر لأن له سعراً صريحاً قائماً. عطّله بدلاً من ذلك.');
            }

            DB::table('product_variant_option_values')->where('product_variant_id', $variant->id)->delete();
            $variant->delete();
            SkuRegistryEntry::release($sku);

            $this->recordActivity($product, 'variant_deleted', ['sku' => [$sku, null]], $userId);
        });
    }

    // ───────────────────────── مساعدات داخلية ─────────────────────────

    /**
     * يتحقق من: كل قيمة تخصّ المستأجر الحالي فعلياً (النطاق العام يُسقط أي
     * قيمة من مستأجرٍ آخر صامتاً، فيظهر ذلك كعددٍ ناقص)، وتخصّ هذا المنتج
     * بالذات لا منتجاً آخر لنفس المستأجر، وقيمة واحدة بالضبط من كل خيارٍ
     * فعّال — لا قيمتان من الخيار نفسه، ولا خيارٌ فعّال بلا قيمة.
     *
     * @param  list<string>  $optionValueIds
     * @return Collection<int, ProductOptionValue>
     */
    private function resolveAndValidateValues(Product $product, array $optionValueIds): Collection
    {
        $ids = array_values(array_unique($optionValueIds));
        if ($ids === []) {
            throw new RuntimeException('يجب اختيار قيمة واحدة على الأقل من كل خيار.');
        }

        $values = ProductOptionValue::whereIn('id', $ids)->with('option')->get();
        if ($values->count() !== count($ids)) {
            throw new RuntimeException('إحدى القيم المختارة غير موجودة أو لا تخصّ هذه المؤسسة.');
        }

        $activeOptionIds = $product->options()->where('is_active', true)->pluck('id')->all();
        $seenOptions = [];

        foreach ($values as $value) {
            $option = $value->option;
            if ($option === null || $option->product_id !== $product->id) {
                throw new RuntimeException('لا يمكن استعمال قيمة خيارٍ لا تخصّ هذا المنتج.');
            }
            // معاينة التركيبات تعرض القيم/الخيارات الفعّالة فقط، لكن معرّفاً
            // مُرسَلاً مباشرةً عبر الـ API يتجاوز تلك الواجهة — فالتحقّق هنا
            // وحده هو السلطة الفعلية. قيمةٌ أو خيارٌ معطَّل يبقى قابلاً للحلّ
            // تاريخياً (لا يُحذف)، لكنه ليس مؤهَّلاً لتركيبة *جديدة* أبداً.
            if (! $option->is_active) {
                throw new RuntimeException('لا يمكن استعمال خيارٍ معطَّل لإنشاء متغيّرٍ جديد.');
            }
            if (! $value->is_active) {
                throw new RuntimeException('لا يمكن استعمال قيمةٍ معطَّلة لإنشاء متغيّرٍ جديد.');
            }
            if (isset($seenOptions[$option->id])) {
                throw new RuntimeException('لا يمكن اختيار قيمتين من الخيار نفسه لمتغيّرٍ واحد.');
            }
            $seenOptions[$option->id] = true;
        }

        $missing = array_diff($activeOptionIds, array_keys($seenOptions));
        if ($missing !== []) {
            throw new RuntimeException('يجب اختيار قيمة واحدة من كل خيار فعّال في هذا المنتج.');
        }

        return $values;
    }

    /** @param list<string> $valueIds */
    private function combinationKey(array $valueIds): string
    {
        $ids = array_values(array_unique($valueIds));
        sort($ids, SORT_STRING);

        return implode(',', $ids);
    }

    /**
     * @param  Collection<int, ProductOptionValue>  $values
     * @return list<ProductOptionValue>
     */
    private function orderValuesForDisplay(Collection $values): array
    {
        return $values
            ->sortBy(fn (ProductOptionValue $v) => [$v->option->sort_order ?? 0, $v->sort_order])
            ->values()
            ->all();
    }

    /** @param list<ProductOptionValue> $orderedValues */
    private function candidateSku(Product $product, array $orderedValues, int $attempt): string
    {
        $base = $this->baseSkuFor($product);
        $fragments = array_map(fn (ProductOptionValue $v) => $this->skuFragment($v), $orderedValues);
        $sku = $base.'-'.implode('-', $fragments);

        if ($attempt > 0) {
            $sku .= '-'.($attempt + 1);
        }

        return $sku;
    }

    private function baseSkuFor(Product $product): string
    {
        if (! blank($product->sku)) {
            return $product->sku;
        }

        return 'P'.strtoupper(substr(str_replace('-', '', $product->id), 0, 8));
    }

    /**
     * رمزٌ مختصر من القيمة — يحاول الإنجليزية أولاً، ويسقط على تجزئة حتمية
     * قصيرة من معرّف القيمة إن كان النص عربياً بلا مرادف إنجليزي (لا تفريغ
     * الأحرف العربية على مسافة/شرطة، فتُفرَّغ السلسلة وتتصادم كل القيم).
     */
    private function skuFragment(ProductOptionValue $value): string
    {
        $source = $value->value_en ?: $value->value;
        $slug = strtoupper((string) preg_replace('/[^A-Za-z0-9]+/', '', $source));

        if ($slug !== '') {
            return substr($slug, 0, 8);
        }

        return strtoupper(str_pad(dechex(crc32($value->id)), 6, '0', STR_PAD_LEFT));
    }

    private function isUniqueViolation(QueryException $e): bool
    {
        $sqlState = (string) ($e->errorInfo[0] ?? '');
        $driverCode = (int) ($e->errorInfo[1] ?? 0);

        return $sqlState === '23505' || $driverCode === 19 || str_contains(strtolower($e->getMessage()), 'unique');
    }

    /** @param array<string, mixed> $diff */
    private function recordActivity(Product $product, string $action, array $diff, ?string $userId): void
    {
        ProductActivity::create([
            'tenant_id' => $product->tenant_id,
            'product_id' => $product->id,
            'action' => $action,
            'diff' => $diff,
            'user_id' => $userId,
        ]);
    }
}
