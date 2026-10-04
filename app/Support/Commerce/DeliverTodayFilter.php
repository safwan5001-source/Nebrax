<?php

namespace App\Support\Commerce;

use App\Models\Product;
use App\Services\Commerce\CommerceDeliveryPromiseService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * FLOWERS-H8b / ADR-20 — مرشّح «التسليم اليوم» لقوائم المنتجات العامة. **مشتقٌّ لا مخزَّن**: مجموعة المرشّحين (بعد
 * بوابة النشر والبحث والتصنيف والمجموعة) تُقيَّم بوعد التسليم المشتق نفسه (`CommerceDeliveryPromiseService`) على دفعات
 * ثابتة الاستعلامات، فيتغيّر الناتج تلقائياً بتغيّر أي مدخل. لا تصفية SQL موازية لقواعد المخزون/الجدولة.
 *
 * الحد: المرشّحون ≤ `MAX_CANDIDATES` — فوقه يُرفض الطلب صراحةً (فشلٌ مغلق، لا اقتطاعٌ صامت يُخفي منتجاتٍ مؤهلة).
 * كتالوجات أكبر تحتاج فهرساً مسبق الحساب (مؤجَّل صراحةً في ADR-20).
 */
class DeliverTodayFilter
{
    public const MAX_CANDIDATES = 5000;

    private const CHUNK = 500;

    public function __construct(private readonly CommerceDeliveryPromiseService $promises) {}

    protected function maxCandidates(): int
    {
        return self::MAX_CANDIDATES;
    }

    /** قواعد التحقق الإضافية للمتحكّمين (`city`/`region` يعلنهما كل متحكّم). */
    public static function rules(): array
    {
        // قيم الاستعلام النصّية الموثَّقة صراحةً: Laravel `boolean` يرفض "true"/"false" التي يُنتجها عقد OpenAPI المنطقي.
        return ['deliver_today' => ['sometimes', 'nullable', Rule::in(['1', '0', 'true', 'false', 1, 0, true, false])]];
    }

    public static function requested(array $filters): bool
    {
        return filter_var($filters['deliver_today'] ?? false, FILTER_VALIDATE_BOOLEAN);
    }

    /**
     * يقيّد الاستعلام بالمنتجات التي وعدها «اليوم». يُستدعى قبل الترتيب والتقسيم وقبل أخذ نسخة العدّ التفريقي.
     * الجدولة المعطّلة ⇒ لا منتج يُوعَد اليوم ⇒ نتيجة فارغة (فشلٌ مغلق).
     */
    public function apply(Builder $query, string $salesChannelId, ?string $city, ?string $region): void
    {
        // حدٌّ قبل التحميل (`max + 1`): تجاوز السقف يُكتشف دون جلب المجموعة كلها فلا يُرهق العامل.
        $candidates = (clone $query)->setEagerLoads([])->reorder()->limit($this->maxCandidates() + 1)->get(['products.id', 'products.variant_state']);
        if ($candidates->count() > $this->maxCandidates()) {
            throw ValidationException::withMessages(['deliver_today' => 'نطاق البحث أوسع من أن يُقيَّم «التسليم اليوم» — ضيّق البحث أو التصنيف.']);
        }

        $sameDay = [];
        foreach ($candidates->chunk(self::CHUNK) as $chunk) {
            /** @var \Illuminate\Support\Collection<int, Product> $chunk */
            $promises = $this->promises->forProducts($salesChannelId, $chunk, $city, $region);
            foreach ($promises ?? [] as $id => $promise) {
                if ($promise['same_day']) {
                    $sameDay[] = $id;
                }
            }
        }

        $sameDay === [] ? $query->whereRaw('0 = 1') : $query->whereIn('products.id', $sameDay);
    }
}
