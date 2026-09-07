<?php

namespace Tests\Feature;

use App\Models\BaseModel;
use App\Support\ProductReferenceRegistry;
use ReflectionClass;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  الحارس المعماري لتصنيف مراجع المنتج (PR-PROD-LIFE-1)
 * ═══════════════════════════════════════════════════════════════
 *  العلّة التي يمنعها هذا الحارس **وقعت مرّتين فعلاً**: `DeliveryNoteLine`
 *  و`InventoryOpeningLine` أُضيفا كنموذجين يحملان `product_id`، ولم يُضافا
 *  إلى قائمة حماية دورة الحياة المُعدَّدة يدوياً — فمرّ حذفٌ مدمِّر لمنتجٍ
 *  يشير إليه سند تسليم مؤكَّد أو رصيدٌ افتتاحي، ومرّ تغيير هوية مخزون فوق
 *  مسودة رصيدٍ افتتاحي.
 *
 *  القائمة اليدوية تُغفل حتماً؛ ما يمنع تكرار ذلك هو **فشل البناء**: أي
 *  نموذج جديد يحمل `product_id` بلا تصنيف في `ProductReferenceRegistry`
 *  يُسقط هذا الاختبار مع رسالةٍ تشرح الفئات الخمس وكيف يختار المطوّر بينها.
 *
 *  الفحص هنا ثابتٌ (Reflection + `$fillable`) لا استبطان مخطط في وقت
 *  التشغيل — العقد يطلب صراحةً تجنّب الاستبطان الكامل في الطلبات العادية.
 *
 *  يوازي `BranchIsolationGuardTest` في الأسلوب عمداً: نفس فكرة «تصنيفٌ
 *  صريح وإلا يفشل البناء»، حتى لا يتعلّم المطوّر نمطين مختلفين.
 *
 *  تشغيل: php artisan test --filter=ProductReferenceClassificationGuardTest
 */
class ProductReferenceClassificationGuardTest extends TestCase
{
    /**
     * نماذج تحمل `product_id` لكنه **لا يشير إلى `App\Models\Product`**.
     *
     * `FuelSale::fuel_product_id` مثلاً يشير إلى `FuelProduct`؛ أما
     * `FuelSale::product_id` فيشير إلى المنتج فعلاً ولذلك هو مصنَّف. تبقى
     * هذه القائمة فارغةً ما لم يظهر عمودٌ متشابه الاسم مختلف الهدف.
     *
     * @var array<int, class-string>
     */
    private const NOT_PRODUCT_REFERENCES = [];

    /**
     * كل نموذج أعمال يحمل `product_id` في `$fillable`.
     *
     * @return array<string, class-string>
     */
    private function productBearingModels(): array
    {
        $models = [];
        foreach (glob(app_path('Models/*.php')) as $file) {
            $short = basename($file, '.php');
            $class = 'App\\Models\\'.$short;
            if (! class_exists($class)) {
                continue;
            }

            $ref = new ReflectionClass($class);
            if ($ref->isAbstract() || ! $ref->isSubclassOf(BaseModel::class)) {
                continue;
            }

            $fillable = (new $class)->getFillable();
            if (! in_array('product_id', $fillable, true)) {
                continue;
            }

            if (in_array($class, self::NOT_PRODUCT_REFERENCES, true)) {
                continue;
            }

            $models[$short] = $class;
        }

        return $models;
    }

    /** @test */
    public function every_product_bearing_model_declares_a_lifecycle_classification(): void
    {
        $unclassified = [];

        foreach ($this->productBearingModels() as $short => $class) {
            if (! ProductReferenceRegistry::isClassified($class)) {
                $unclassified[] = $short;
            }
        }

        $this->assertSame([], $unclassified, implode("\n", [
            'نماذج تحمل `product_id` بلا تصنيف في ProductReferenceRegistry: '.implode('، ', $unclassified),
            '',
            'أضف كل نموذج إلى `ProductReferenceRegistry::CLASSIFICATION` بفئةٍ صريحة:',
            '  BUSINESS_HISTORICAL — سطر مستندٍ تجاري/تاريخي (يمنع الحذف)',
            '  INVENTORY_SEMANTIC  — أثرٌ مخزني (يمنع الحذف وتغيير النوع/التتبّع)',
            '  COMMERCIAL_LIVE     — مرجع تجاري حيّ كالتسعير (يمنع الحذف)',
            '  OWNED_CHILD         — تابعٌ مملوك (لا يمنع، ويُنظَّف مع الحذف)',
            '  AUDIT_HISTORY       — سجلّ تدقيق (لا يمنع، ويبقى بعد الحذف)',
            '',
            'التصنيف قرارٌ يُتخذ مرّة، لا فحصٌ يُنسى: القائمة اليدوية أغفلت',
            'DeliveryNoteLine و InventoryOpeningLine من قبل، وهذا الحارس يمنع تكرارها.',
        ]));
    }

    /** التصنيف المعاكس: لا صنفٌ في السجلّ بلا نموذجٍ حقيقي يحمل `product_id`. */
    /** @test */
    public function the_registry_never_classifies_a_model_that_no_longer_exists(): void
    {
        $stale = [];
        foreach (array_keys(ProductReferenceRegistry::all()) as $model) {
            if (! class_exists($model) || ! in_array('product_id', (new $model)->getFillable(), true)) {
                $stale[] = $model;
            }
        }

        $this->assertSame([], $stale, 'تصنيفٌ لنموذج لم يعد يحمل `product_id`: '.implode('، ', $stale));
    }

    /** كل نموذج مصنَّف يحمل فئةً واحدة معروفة على الأقل — لا فئة مكتوبة خطأً. */
    /** @test */
    public function every_classification_uses_only_known_classes(): void
    {
        $known = [
            ProductReferenceRegistry::BUSINESS_HISTORICAL,
            ProductReferenceRegistry::INVENTORY_SEMANTIC,
            ProductReferenceRegistry::COMMERCIAL_LIVE,
            ProductReferenceRegistry::OWNED_CHILD,
            ProductReferenceRegistry::AUDIT_HISTORY,
        ];

        foreach (ProductReferenceRegistry::all() as $model => $entry) {
            $this->assertNotEmpty($entry['classes'], "{$model} بلا فئة.");
            $this->assertNotEmpty($entry['key'], "{$model} بلا مفتاح تقرير.");
            foreach ($entry['classes'] as $class) {
                $this->assertContains($class, $known, "فئة غير معروفة على {$model}: {$class}");
            }
        }
    }

    /**
     * تابعٌ مملوك أو سجلّ تدقيق لا يجوز أن يكون مانعاً في الوقت نفسه —
     * تناقضٌ كهذا كان سيجعل كل منتج غير قابلٍ للحذف بصمت.
     */
    /** @test */
    public function owned_and_audit_classes_are_never_also_blockers(): void
    {
        $blockers = ProductReferenceRegistry::deletionBlockers();

        foreach (ProductReferenceRegistry::all() as $model => $entry) {
            $isOwnedOrAudit = in_array(ProductReferenceRegistry::OWNED_CHILD, $entry['classes'], true)
                || in_array(ProductReferenceRegistry::AUDIT_HISTORY, $entry['classes'], true);

            if ($isOwnedOrAudit) {
                $this->assertArrayNotHasKey($model, $blockers, "{$model} مصنَّف تابعاً/تدقيقاً ومانعاً معاً.");
            }
        }
    }

    /** مفاتيح التقرير فريدة — مفتاحان متطابقان كانا سيبتلعان عدّاً بصمت. */
    /** @test */
    public function report_keys_are_unique_across_the_registry(): void
    {
        $keys = array_map(static fn (array $entry): string => $entry['key'], ProductReferenceRegistry::all());

        $this->assertSame(count($keys), count(array_unique($keys)), 'مفاتيح تقرير مكرّرة في السجلّ.');
    }
}
