<?php

namespace Tests\Feature;

use App\Models\BaseModel;
use App\Tenancy\BelongsToBranch;
use App\Tenancy\BranchScoped;
use App\Tenancy\CompanyWide;
use ReflectionClass;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  الحارس المعماري لعزل الفروع — يمنع تكرار مشكلة «بيانات غير معزولة»
 * ═══════════════════════════════════════════════════════════════
 *  **كل** نموذج أعمال جديد يجب أن يُصنَّف صراحةً في واحدة من ثلاث:
 *
 *   1. `BranchScoped`   — بيانات تشغيلية معزولة بالفرع (الافتراضي المطلوب)
 *   2. `BelongsToBranch`— موسومة بالفرع وتصفيتها صريحة (المحاسبة/المستندات)
 *   3. `CompanyWide`    — مشتركة على مستوى المؤسسة (إقرار واعٍ)
 *
 *  نموذج غير مصنَّف = **فشل البناء**. فلا يمرّ قسمٌ جديد دون قرار عزل واعٍ.
 *  انظر: design-system/foundations/multi-branch-architecture.md
 *
 *  تشغيل: php artisan test --filter=BranchIsolationGuardTest
 */
class BranchIsolationGuardTest extends TestCase
{
    /**
     * دَين معروف: نماذج تشغيلية تنتظر العزل في P3 (تحتاج عمود branch_id).
     *
     * **هذه القائمة سقّاطة (ratchet): تنقص ولا تزيد.** إضافة نموذج جديد إليها
     * ممنوعة — النماذج الجديدة تُصنَّف من أول يوم. اختبارٌ أدناه يحرس ذلك.
     */
    private const PENDING_ISOLATION = [
        'Appointment', 'Asset', 'Contact', 'CostCenter', 'CrmActivity',
        'Employee', 'Partner', 'PayrollRun', 'Product', 'RecurringInvoice',
        'StockMovement',
    ];

    /** كل نماذج الأعمال (ترث BaseModel) بأسمائها القصيرة. */
    private function businessModels(): array
    {
        $models = [];
        foreach (glob(app_path('Models/*.php')) as $file) {
            $short = basename($file, '.php');
            $class = 'App\\Models\\' . $short;
            if (! class_exists($class)) {
                continue;
            }
            $ref = new ReflectionClass($class);
            if ($ref->isAbstract() || ! $ref->isSubclassOf(BaseModel::class)) {
                continue;
            }
            $models[$short] = $class;
        }

        return $models;
    }

    private function usesTrait(string $class, string $trait): bool
    {
        foreach (class_uses_recursive($class) as $used) {
            if ($used === $trait) {
                return true;
            }
        }

        return false;
    }

    /** @test */
    public function every_business_model_declares_a_branch_isolation_stance(): void
    {
        $unclassified = [];

        foreach ($this->businessModels() as $short => $class) {
            $classified = $this->usesTrait($class, BranchScoped::class)
                || $this->usesTrait($class, BelongsToBranch::class)
                || is_subclass_of($class, CompanyWide::class)
                || in_array($short, self::PENDING_ISOLATION, true);

            if (! $classified) {
                $unclassified[] = $short;
            }
        }

        $this->assertSame([], $unclassified, implode("\n", [
            'نماذج غير مصنَّفة لعزل الفروع: ' . implode('، ', $unclassified),
            '',
            'كل نموذج أعمال يجب أن يعلن موقفه صراحةً — اختر واحداً:',
            '  • use BranchScoped;            بيانات تشغيلية معزولة بالفرع (الافتراضي)',
            '  • use BelongsToBranch;         موسومة بالفرع، تصفيتها صريحة (محاسبة/مستندات)',
            '  • implements CompanyWide       مشتركة للمؤسسة كلها (إقرار واعٍ)',
            '',
            'المرجع: design-system/foundations/multi-branch-architecture.md',
        ]));
    }

    /** @test */
    public function the_pending_isolation_backlog_only_shrinks(): void
    {
        // كل اسم في قائمة الانتظار يجب أن يكون نموذجاً قائماً فعلاً —
        // فلا تتضخّم القائمة بأسماء ميتة تُخفي دَيناً غير حقيقي.
        $existing = array_keys($this->businessModels());
        foreach (self::PENDING_ISOLATION as $short) {
            $this->assertContains($short, $existing, "نموذج «{$short}» في قائمة الانتظار لم يعد موجوداً — احذفه منها.");
        }

        // سقف صارم: ١١ نموذجاً وقت كتابة P2. P3 يُنقصها حتى الصفر.
        $this->assertLessThanOrEqual(
            11,
            count(self::PENDING_ISOLATION),
            'قائمة انتظار العزل تنقص ولا تزيد — أي نموذج جديد يُصنَّف فوراً، لا يُضاف هنا.'
        );
    }

    /** @test */
    public function a_model_declared_company_wide_is_never_also_branch_scoped(): void
    {
        foreach ($this->businessModels() as $short => $class) {
            if (is_subclass_of($class, CompanyWide::class)) {
                $this->assertFalse(
                    $this->usesTrait($class, BranchScoped::class),
                    "نموذج «{$short}» معلَن مشتركاً ومعزولاً معاً — تصنيفان متناقضان."
                );
            }
        }
    }
}
