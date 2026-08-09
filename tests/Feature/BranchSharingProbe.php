<?php

namespace Tests\Feature;

use App\Models\Appointment;
use App\Tenancy\BranchShareable;
use App\Tenancy\BranchSharing;
use Closure;

/**
 * نموذج فحص لآلية «العزل المشروط» — يعمل على جدول المواعيد القائم (`Appointment`
 * معزول بالفرع منذ P3-أ)، فتُختبر الأوضاع الثلاثة بـ SQL حقيقي على sqlite وpgsql
 * **دون تصنيف أي نموذج إنتاجي** — وهذا جوهر كون ج-١ صفرَ خطر.
 *
 * ليس ملف اختبار (لا ينتهي بـ Test.php) فلا يلتقطه PHPUnit كحالة اختبار،
 * ولا يمسّه حارس العزل (يمسح `app/Models` وحده).
 */
class BranchSharingProbe extends Appointment implements BranchShareable
{
    protected $table = 'appointments';

    /** المفتاح الذي يحكم هذا النموذج أثناء الفحص. */
    public static string $key = 'share_products';

    /** true = مشاركة **جزئية**: المواعيد الملغاة وحدها تُستثنى من العزل. */
    public static bool $partial = false;

    /** يُعيد الفحص لحالته الأولى بين الاختبارات. */
    public static function reset(): void
    {
        static::$key = 'share_products';
        static::$partial = false;
    }

    public function branchSharingExemption(BranchSharing $sharing): bool|Closure
    {
        if (! $sharing->shared(static::$key)) {
            return false; // المفتاح مطفأ ⇒ عزل كامل
        }

        return static::$partial
            ? fn ($q) => $q->where('appointments.status', 'cancelled')
            : true;
    }
}
