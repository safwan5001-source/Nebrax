<?php

namespace App\Services;

use App\Models\BarcodeRegistryEntry;
use App\Models\InventoryStockAlert;
use App\Models\Product;
use App\Models\ProductActivity;
use App\Services\DocumentCenter\DocumentStorageService;
use App\Support\ProductReferenceRegistry;
use App\Tenancy\BranchScope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

/**
 * قواعد دورة حياة بطاقة المنتج أو الخدمة.
 *
 * هذا المسار لا يمسّ كمية المنتج أو متوسط تكلفته أو أي قيد. فهو يضبط الكتالوج
 * فقط، ويبقي الحركات والمستندات القائمة مراجع تاريخية قابلة للقراءة.
 */
class ProductLifecycleService
{
    public function __construct(private readonly DocumentStorageService $documentStorage)
    {
    }

    /**
     * سجلات تمنع حذف المنتج؛ الحذف الناعم لبند مستخدم يجعل إعادة استعمال SKU أو
     * الباركود تضلل المستخدم وتترك مرجعاً تاريخياً باسم كتالوجي جديد.
     *
     * التعداد يأتي كاملاً من `ProductReferenceRegistry` لا من قائمة مكتوبة هنا:
     * القائمة اليدوية السابقة أغفلت `DeliveryNoteLine` و`InventoryOpeningLine`،
     * وستُغفل التالي حتماً. المفاتيح المُعادة هي نفسها حرفياً حفاظاً على التوافق.
     *
     * @return array<string, int>
     */
    public function referenceCounts(Product $product): array
    {
        $counts = [];
        foreach (ProductReferenceRegistry::deletionBlockers() as $model => $key) {
            $counts[$key] = $this->referenceQuery($model, $product)->count();
        }

        return $counts;
    }

    /**
     * استعلام مرجعٍ واحد — **بلا عزل فرع، وبعزل مستأجرٍ صارم**.
     *
     * `BranchScope::reference()` هو الاصطلاح القائم في المشروع لاستعلام «حلّ
     * مرجع»: يُسقط عزل الفرع وحده ويُبقي `TenantScope` كما هو. وهو ضرورة لا
     * تجميل هنا — مرجعٌ حقيقي في فرعٍ آخر يجب أن يمنع الحذف؛ لو أخفاه الفرع
     * النشط لصار الحذف مسموحاً بحسب ما يصادف المستخدم أن يتصفّحه، وهو بالضبط
     * ما يحذّر منه العقد. النماذج المصنَّفة اليوم كلها `CompanyWide` أو موسومة
     * بلا Scope، فالأثر الفعلي لا شيء — لكن تحوّل أي منها إلى `BranchScoped`
     * لاحقاً كان سيفتح الثغرة صامتاً، وهنا يبقى مغلقاً بالبناء.
     *
     * @param  class-string<Model>  $model
     */
    private function referenceQuery(string $model, Product $product): Builder
    {
        return BranchScope::reference($model)->where('product_id', $product->id);
    }

    public function create(Product $product, ?string $userId): void
    {
        $this->record($product, 'created', [
            'name'              => [null, $product->name],
            'sku'               => [null, $product->sku],
            'type'              => [null, $product->type],
            'track_inventory'   => [null, $product->track_inventory],
            'is_active'         => [null, $product->is_active],
        ], $userId);
    }

    public function update(Product $product, array $data, ?string $userId): Product
    {
        return DB::transaction(function () use ($product, $data, $userId): Product {
            $product = Product::lockForUpdate()->findOrFail($product->id);
            $this->assertInventoryIdentityCanChange($product, $data);

            $product->fill($data);
            $dirty = $product->getDirty();
            if ($dirty === []) {
                return $product;
            }

            $diff = [];
            foreach ($dirty as $field => $value) {
                $diff[$field] = [$product->getOriginal($field), $value];
            }
            $statusChanged = array_key_exists('is_active', $diff);

            $product->save();
            $this->record($product, $statusChanged ? 'status_changed' : 'updated', $diff, $userId);

            return $product;
        });
    }

    public function delete(Product $product, ?string $userId): void
    {
        $media = [];
        DB::transaction(function () use ($product, $userId, &$media): void {
            // القفل يُسلسِل عمليات دورة الحياة على المنتج نفسه (حذفٌ مع حذف،
            // وحذفٌ مع تعديل) — فلا تمرّ عمليتان متزامنتان على نفس البطاقة.
            $product = Product::lockForUpdate()->findOrFail($product->id);
            $this->assertNoBlockingReferences($product);

            $this->record($product, 'deleted', [
                'is_active' => [$product->is_active, false],
            ], $userId);
            // لا تبقى باركودات أو صور لمنتج حُذف فعلياً بلا مراجع. نحفظ
            // قائمة الملفات قبل حذف الصفوف، ثم ننظف التخزين بعد نجاح المعاملة.
            $media = $product->media()->get(['disk', 'path'])->all();
            // فضاء الباركود الموحّد أولاً: حذف العلاقة أدناه استعلامٌ مجمّع
            // لا يُطلق حدث Eloquent لكل صفّ، فتحرير التسجيل هنا صراحةً هو
            // الوحيد. مسارٌ لا يُكمِل أصلاً إلا بلا مراجع تاريخية — تحريره
            // آمنٌ دائماً هنا.
            BarcodeRegistryEntry::releaseAllForProduct($product->id);
            $product->alternateBarcodes()->delete();
            $product->media()->delete();
            // تابعٌ مملوك مصنَّف في السجلّ ولا علاقة Eloquent له على المنتج؛
            // بقاؤه كان سيترك حالة تنبيهٍ معلَّقة لبطاقةٍ لم تعد قائمة. (عملياً
            // لا يُرصد تنبيه بلا رصيد أو حركة، وكلاهما مانعٌ للحذف — فهذا
            // شبكة أمانٍ لا مسارٌ متوقَّع.)
            $this->referenceQuery(InventoryStockAlert::class, $product)->delete();
            $product->delete();

            // إعادة الفحص بعد الحذف وقبل الـcommit: تحت READ COMMITTED (افتراض
            // PostgreSQL) يرى الاستعلام الجديد ما التزمت به معاملةٌ أخرى بعد
            // فحصنا الأول، فتُلتقط مرجعيةٌ وُلدت أثناء المعاملة ويُلغى الحذف
            // كاملاً. هذا **تضييق** للنافذة لا إغلاقٌ مطلق لها: كاتبٌ التزم بعد
            // هذه اللحظة وقبل الـcommit يبقى خارج المدى، وإغلاقه التام يقتضي أن
            // يقفل كل مُنشئ مرجعٍ صفَّ المنتج — إعادة تصميمٍ للمستندات يمنعها
            // العقد صراحةً. لا يُدَّعى هنا أن تعداد التطبيق ضمانة تزامن.
            $this->assertNoBlockingReferences($product);
        });

        foreach ($media as $item) {
            if ($item->disk === 'document') {
                try {
                    $this->documentStorage->delete($this->documentStorage->profile(), $item->path);
                } catch (RuntimeException $exception) {
                    report($exception);
                }

                continue;
            }

            Storage::disk($item->disk)->delete($item->path);
        }
    }

    /** @return array<int, ProductActivity> */
    public function activity(Product $product): array
    {
        return ProductActivity::where('product_id', $product->id)
            ->with('user:id,name')
            ->latest('created_at')
            ->get()
            ->all();
    }

    /**
     * أثرٌ مخزني حقيقي على منتج — مرجع مركزي واحد يستهلكه أي مسارٍ يحتاج
     * إثبات وجود «footprint» قبل قرار لا يجوز التراجع عنه (تغيير نوع
     * المنتج/تتبّعه هنا، ومنع تعديل وحدة قياسٍ يستعملها القالب في
     * `UnitTemplateController`).
     *
     * التعداد من `ProductReferenceRegistry::inventorySemantic()` حصراً، فيشمل
     * الآن `InventoryOpeningLine` — الفجوة التي وثّقها عقد PR-PROD-LIFE-1:
     * مستند رصيدٍ افتتاحي بحالة مسودة يعلن كميةً وتكلفةً لهذا المنتج، فتغيير
     * `type`/`track_inventory` بعده يعيد تفسير ما سيُرحَّل لا ما رُحِّل فقط.
     */
    public function hasInventoryFootprint(Product $product): bool
    {
        foreach (ProductReferenceRegistry::inventorySemantic() as $model => $key) {
            if ($this->referenceQuery($model, $product)->exists()) {
                return true;
            }
        }

        return false;
    }

    /**
     * يمنع الحذف المدمِّر عند وجود أي مرجع مصنَّف مانعاً. رسالةٌ واحدة لكلا
     * موضعَي الفحص (قبل الحذف وبعده) فلا يختلف النصّ باختلاف لحظة الاكتشاف.
     */
    private function assertNoBlockingReferences(Product $product): void
    {
        $used = array_filter($this->referenceCounts($product), static fn (int $count): bool => $count > 0);
        if ($used === []) {
            return;
        }

        $total = array_sum($used);

        throw new RuntimeException("لا يمكن حذف المنتج لأنه مرتبط بـ {$total} سجلّاً. عطّله بدلاً من ذلك حفاظاً على حركاته ومستنداته.");
    }

    /** @param array<string, mixed> $data */
    private function assertInventoryIdentityCanChange(Product $product, array $data): void
    {
        $changesType = array_key_exists('type', $data) && $data['type'] !== $product->type;
        $changesTracking = array_key_exists('track_inventory', $data)
            && (bool) $data['track_inventory'] !== (bool) $product->track_inventory;
        if (! $changesType && ! $changesTracking) {
            return;
        }

        if ($this->hasInventoryFootprint($product)) {
            throw new RuntimeException('لا يمكن تغيير نوع المنتج أو تتبع مخزونه بعد وجود حركة أو رصيد مخزني. أنشئ منتجاً جديداً بدلاً من إعادة تفسير السجل التاريخي.');
        }
    }

    /** @param array<string, mixed> $diff */
    private function record(Product $product, string $action, array $diff, ?string $userId): void
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
