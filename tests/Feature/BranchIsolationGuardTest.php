<?php

namespace Tests\Feature;

use App\Models\BaseModel;
use App\Tenancy\BelongsToBranch;
use App\Tenancy\BranchScoped;
use App\Tenancy\BranchShareable;
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
     * دَين العزل — **فارغة منذ P3-ج-٣: كل نموذج أعمال مصنَّف صراحةً.**
     *
     * كانت سقّاطة (ratchet) تنقص ولا تزيد: ١١ ← ٧ ← ٤ ← ٢ ← ٠. تبقى هنا فارغةً
     * لا محذوفة، لأن السقف صفر هو ما يمنع عودة الدَّين: أي نموذج جديد لا خيار
     * أمامه إلا التصنيف.
     *
     * @var array<int, string>
     */
    private const PENDING_ISOLATION = [];

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

        // ١١ ← ٧ (P3-أ) ← ٤ (P3-ب) ← ٢ (P3-ج-٢) ← **٠** (P3-ج-٣). السقف لا يرتفع بعدها أبداً.
        $this->assertSame(
            [],
            self::PENDING_ISOLATION,
            'الدَّين أُغلق — لا يُضاف نموذج إلى قائمة الانتظار بعد اليوم؛ كل جديد يُصنَّف فوراً.'
        );
    }

    /**
     * العزل المشروط لا معنى له بلا عزل: نموذج يعلن مفتاح مشاركة **يجب** أن يكون
     * `BranchScoped`، وإلا كان الإعفاء إعفاءً من لا شيء — واجهة ميتة تُوهم بالحماية.
     *
     * @test
     */
    public function a_shareable_model_is_always_branch_scoped(): void
    {
        $violations = [];

        foreach ($this->businessModels() as $short => $class) {
            if (is_subclass_of($class, BranchShareable::class) && ! $this->usesTrait($class, BranchScoped::class)) {
                $violations[] = $short;
            }
        }

        // تأكيد واحد دائم — يمرّ بقائمة فارغة قبل تصنيف أي نموذج (P3-ج-١)،
        // ويبدأ بالحراسة فعلياً مع أول نموذج مشمول (P3-ج-٢).
        $this->assertSame([], $violations, implode('، ', $violations) . ' — تعلن مفتاح مشاركة بلا عزل، فالإعفاء بلا معنى.');
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
