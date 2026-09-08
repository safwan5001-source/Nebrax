<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreUnitTemplateRequest;
use App\Http\Resources\UnitTemplateResource;
use App\Models\PriceListItem;
use App\Models\Product;
use App\Models\ProductBarcode;
use App\Models\UnitTemplate;
use App\Models\UnitTemplateUnit;
use App\Services\ProductLifecycleService;
use App\Tenancy\BranchScope;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * قوالب الوحدات — وحدة أساس ووحدات بديلة بمعاملات صحيحة.
 *
 * **لا يولّد قيداً**، لكنه ليس بلا أثر محاسبي: المعامل يضرب الكمية الداخلة إلى
 * المخزون فيصيب أو يخطئ متوسط التكلفة. لذلك التعديل هنا **لا يعيد تفسير مستند
 * مرحَّل**: السطر ينسخ (الاسم، المعامل) وقت الإنشاء ولا يشير إلى القالب.
 *
 * **PR-UOM-1:** تعديلٌ دلالي (وحدة الأساس، أو معامل/اسم وحدة بديلة قائمة)
 * يُرفض بالكامل إن كان لأي منتجٍ يستعمل هذا القالب أثرٌ مخزني قائم، أو مرجعٌ
 * حيّ (باركود بديل/بند قائمة أسعار) يستعمل الاسم المتأثَّر — Fail Closed لا
 * إعادة تفسير صامتة. إضافة وحدة بديلة جديدة بلا تعارض تبقى آمنة دائماً.
 */
class UnitTemplateController extends ApiController
{
    public function __construct(protected ProductLifecycleService $lifecycle) {}

    public function index(): JsonResponse
    {
        return UnitTemplateResource::collection(
            UnitTemplate::with('units')->withCount('products')->orderBy('name')->get()
        )->response();
    }

    public function store(StoreUnitTemplateRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertNameFree($data['name']);

        $template = $this->domain(fn () => DB::transaction(function () use ($data) {
            $template = UnitTemplate::create([
                'name' => $data['name'],
                'base_unit' => $data['base_unit'],
                'is_active' => $data['is_active'] ?? true,
            ]);
            $this->syncUnits($template, $data);

            return $template;
        }));

        return (new UnitTemplateResource($template->load('units')))->response()->setStatusCode(201);
    }

    public function update(StoreUnitTemplateRequest $request, string $id): JsonResponse
    {
        $template = UnitTemplate::with('units')->findOrFail($id);
        $data = $request->validated();
        $this->assertNameFree($data['name'], $template->id);

        $this->domain(fn () => DB::transaction(function () use ($template, $data) {
            $this->assertSemanticEditIsSafe($template, $data);
            $baseChanged = $data['base_unit'] !== $template->base_unit;

            $template->update([
                'name' => $data['name'],
                'base_unit' => $data['base_unit'],
                'is_active' => $data['is_active'] ?? $template->is_active,
            ]);

            // الوحدات تُستبدَل كاملةً: القائمة المرسَلة هي الحالة المطلوبة.
            // المستندات المرحَّلة لا تتأثّر — نسخت معاملها وقت إنشائها.
            $template->units()->delete();
            $this->syncUnits($template, $data);

            if ($baseChanged) {
                // العقد ١: Product.unit === UnitTemplate.base_unit — دائماً لا
                // وقت الحفظ فقط. الوصول هنا يعني أن التعديل ثبت أمانه أعلاه
                // (لا أثر مخزني ولا مرجع حيّ)، فلا مانع من المزامنة. تحديثٌ
                // مجمّع لا يُطلق `Product::saved` — مقصودٌ: العمود المتأثر هنا
                // `unit` لا `barcode`، فلا علاقة لفضاء الباركود بهذا المسار.
                BranchScope::reference(Product::class)
                    ->where('unit_template_id', $template->id)
                    ->update(['unit' => $data['base_unit']]);
            }
        }));

        return (new UnitTemplateResource($template->fresh('units')))->response();
    }

    /**
     * تصنيف التعديل: تغيير وحدة الأساس، أو حذف/إعادة تسمية/تغيير معامل وحدة
     * بديلة قائمة (تمثيلٌ كامل الاستبدال — غيابٌ عن القائمة الجديدة = حذف)
     * تعديلٌ **دلالي**؛ إضافة اسمٍ جديد بمعامل صريح وحدها إضافةٌ آمنة دائماً.
     *
     * التعديل الدلالي يُرفض بالكامل (لا جزئياً) إن كان لأي منتجٍ يستعمل هذا
     * القالب أثرٌ مخزني (`ProductLifecycleService::hasInventoryFootprint`)،
     * أو مرجعٌ حيّ يستعمل الاسم المتأثَّر (باركود بديل أو بند قائمة أسعار).
     */
    private function assertSemanticEditIsSafe(UnitTemplate $template, array $data): void
    {
        $oldUnits = $template->units->keyBy('name');
        $newUnits = collect($data['units'] ?? [])->keyBy(fn ($u) => trim($u['name']));

        $baseChanged = $data['base_unit'] !== $template->base_unit;
        $removedNames = $oldUnits->keys()->diff($newUnits->keys())->values()->all();
        $factorChangedNames = [];
        foreach ($newUnits as $name => $payload) {
            if ($oldUnits->has($name) && (int) $oldUnits[$name]->factor !== (int) $payload['factor']) {
                $factorChangedNames[] = $name;
            }
        }

        if (! $baseChanged && $removedNames === [] && $factorChangedNames === []) {
            return; // إضافاتٌ فقط — آمنة دائماً.
        }

        // كل المنتجات المستعمِلة للقالب بلا تصفية الفرع النشط: مشاركة القالب
        // أوسع من فرعٍ واحد، وأثرٌ مخزني في فرعٍ آخر يجب ألا يُفلت من الفحص.
        $products = BranchScope::reference(Product::class)
            ->where('unit_template_id', $template->id)
            ->get();

        if ($products->isEmpty()) {
            return; // قالبٌ بلا منتج يستعمله — لا أثر ممكن أصلاً.
        }

        foreach ($products as $product) {
            if ($this->lifecycle->hasInventoryFootprint($product)) {
                abort(422, 'لا يمكن تعديل وحدة الأساس أو معامل/اسم وحدة قائمة بعد وجود أثر مخزني على منتج يستعمل هذا القالب. أضف وحدة جديدة بدلاً من ذلك.');
            }
        }

        $affectedNames = array_values(array_unique(array_merge(
            $removedNames,
            $factorChangedNames,
            $baseChanged ? [$template->base_unit] : []
        )));

        if ($affectedNames === []) {
            return;
        }

        $productIds = $products->pluck('id');
        $hasStaleBarcode = ProductBarcode::whereIn('product_id', $productIds)
            ->whereIn('unit_name', $affectedNames)->exists();
        $hasStalePriceListItem = PriceListItem::whereIn('product_id', $productIds)
            ->whereIn('unit_name', $affectedNames)->exists();

        // PR-UOM2-1: وحدتا البيع/الشراء الافتراضيتان مرجعان حيّان كذلك —
        // اسمان نصّيان على `products` يشيران إلى وحدةٍ في هذا القالب. لو
        // بقيا خارج هذا الحارس لصار حذف وحدةٍ أو إعادة تسميتها يترك المنتج
        // مقترحاً وحدةً لم تعد موجودة، وهو بالضبط «المرجع البائت الصامت»
        // الذي بُني هذا الحارس لمنعه. الفحص في الذاكرة على `$products`
        // المحمَّلة سلفاً — بلا استعلامٍ إضافي ولا تصفية فرع.
        $hasStaleDefaultUnit = $products->contains(
            fn (Product $product) => in_array($product->default_sales_unit, $affectedNames, true)
                || in_array($product->default_purchase_unit, $affectedNames, true)
        );

        if ($hasStaleBarcode || $hasStalePriceListItem || $hasStaleDefaultUnit) {
            abort(422, 'لا يمكن تغيير وحدة الأساس أو حذف/تعديل وحدةٍ تستعملها مراجع حيّة (باركود بديل أو بند قائمة أسعار أو وحدة بيع/شراء افتراضية) — عدّل تلك المراجع أولاً.');
        }
    }

    /** القالب المستعمَل لا يُحذف — منتجٌ بلا قالب يفقد وحداته بلا سبب مفهوم. */
    public function destroy(string $id): JsonResponse
    {
        $template = UnitTemplate::withCount('products')->findOrFail($id);

        if ($template->products_count > 0) {
            abort(422, "لا يمكن حذف القالب: مرتبط بـ {$template->products_count} منتجاً.");
        }

        $template->units()->delete();
        $template->delete();

        return response()->json(['message' => 'deleted']);
    }

    /**
     * يكتب الوحدات البديلة. **وحدة باسم الأساس تُرفض**: معاملان لوحدة واحدة
     * يجعلان `factorFor` تُرجع ١ أبداً بينما تعرض الشاشة غيره — تناقضٌ صامت
     * ينتهي بكمية خاطئة في المخزون.
     */
    private function syncUnits(UnitTemplate $template, array $data): void
    {
        $seen = [];

        foreach ($data['units'] ?? [] as $unit) {
            $name = trim($unit['name']);

            if ($name === $template->base_unit) {
                abort(422, 'لا تُضاف وحدة الأساس ضمن الوحدات البديلة — معاملها ١ ضمناً.');
            }
            if (isset($seen[$name])) {
                abort(422, "الوحدة «{$name}» مكرّرة في القالب.");
            }
            $seen[$name] = true;

            UnitTemplateUnit::create([
                'unit_template_id' => $template->id,
                'name' => $name,
                'factor' => (int) $unit['factor'],
            ]);
        }
    }

    private function assertNameFree(string $name, ?string $exceptId = null): void
    {
        $query = BranchScope::reference(UnitTemplate::class)->where('name', $name);

        if ($exceptId !== null) {
            $query->where('id', '!=', $exceptId);
        }

        if ($query->exists()) {
            abort(422, 'يوجد قالب وحدات بهذا الاسم.');
        }
    }
}
