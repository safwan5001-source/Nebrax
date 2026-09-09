<?php

namespace Tests\Feature;

use App\Support\CommerceBoundary;
use Illuminate\Support\Facades\Route;
use ReflectionClass;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  حارس حدّ وحدة Commerce — PR-COM-0
 * ═══════════════════════════════════════════════════════════════
 *
 * PR-COM-0 لا يبني سلوكاً تجارياً؛ هذا الحارس يثبت أن العقد الوحيد
 * (`CommerceBoundary`) موجود ومستقر، وأن لا نموذج عمل ولا مسار API ولا
 * ترحيل قاعدة بيانات خاص بـ Commerce تسرّب قبل PR-COM-1A. لا يفحص محتوى
 * الملفات نصياً (grep) — كل تأكيد هنا بنيوي: تحميل الصنف، انعكاس (reflection)،
 * أو استجواب السجل الحي (`Route::getRoutes()`، أسماء ملفات الترحيل).
 *
 * تشغيل: php artisan test --filter=CommerceModuleBoundaryTest
 */
class CommerceModuleBoundaryTest extends TestCase
{
    /**
     * أسماء نماذج Commerce الممنوعة في هذه المرحلة تحديداً (قسم 5 من وثيقة
     * PR-COM-0). ليست قائمة عامة لكل صنف Commerce ممكن — هذا الاختبار يحرس
     * وعد PR-COM-0 بعدم إدخالها الآن، لا يمنع بناءها لاحقاً في PR-COM-1A+.
     *
     * @var list<string>
     */
    private const NOT_YET_MODELS = [
        'App\\Models\\CommerceOrder',
        'App\\Models\\Reservation',
        'App\\Models\\PaymentIntent',
        // 'App\\Models\\SalesChannel' أُزيل هنا: PR-COM-2A بناه فعلاً، وهذا
        // بالضبط ما يفسّره التوثيق أعلاه — الوعد كان بعدم إدخاله *قبل أوانه*،
        // لا منعه للأبد. Class name الفعلي (App\Models\SalesChannel) مطابقٌ
        // حرفياً لهذا الاسم المزال؛ لا نموذج آخر أُضيف باسمٍ مختلف يتطلّب تحديثاً هنا.
        'App\\Models\\CommerceListing',
    ];

    /** @test */
    public function the_commerce_boundary_contract_autoloads_and_is_stable(): void
    {
        $this->assertTrue(class_exists(CommerceBoundary::class), 'App\\Support\\CommerceBoundary غير موجود أو لا يُحمَّل عبر PSR-4.');

        $ref = new ReflectionClass(CommerceBoundary::class);
        $this->assertTrue($ref->isFinal(), 'CommerceBoundary يجب أن يكون final — عقد ثابت لا يُورَّث.');

        $forbidden = CommerceBoundary::FORBIDDEN_DIRECT_WRITES;
        $authorities = CommerceBoundary::APPROVED_AUTHORITIES;

        $this->assertNotEmpty($forbidden, 'قائمة الكتابات الممنوعة فارغة — العقد بلا معنى.');
        $this->assertSame(
            count($forbidden),
            count($authorities),
            'كل هدف كتابة ممنوع يجب أن يقابله سلطة معتمدة واحدة بنفس الترتيب.'
        );

        foreach ($authorities as $authority) {
            $this->assertTrue(
                class_exists($authority),
                "السلطة المعتمدة «{$authority}» غير موجودة — العقد يشير إلى خدمة لا وجود لها."
            );
        }
    }

    /** @test */
    public function no_commerce_business_model_is_introduced_yet(): void
    {
        foreach (self::NOT_YET_MODELS as $class) {
            $this->assertFalse(
                class_exists($class),
                "«{$class}» موجود بالفعل — PR-COM-0 يمنع إدخال نماذج عمل Commerce؛ هذا من نطاق PR-COM-1A وما بعدها."
            );
        }
    }

    /** @test */
    public function no_commerce_api_route_is_registered_yet(): void
    {
        $commerceRoutes = [];

        foreach (Route::getRoutes() as $route) {
            if (str_contains(strtolower($route->uri()), 'commerce')) {
                $commerceRoutes[] = $route->uri();
            }
        }

        $this->assertSame(
            [],
            $commerceRoutes,
            'PR-COM-0 لا يضيف أي مسار API — وُجد: ' . implode('، ', $commerceRoutes)
        );
    }

    /** @test */
    public function no_commerce_migration_is_introduced_yet(): void
    {
        $migrationFiles = glob(database_path('migrations/*.php')) ?: [];
        $commerceMigrations = array_values(array_filter(
            $migrationFiles,
            fn (string $file): bool => str_contains(strtolower(basename($file)), 'commerce')
        ));

        $this->assertSame(
            [],
            $commerceMigrations,
            'PR-COM-0 لا يضيف أي ترحيل قاعدة بيانات — وُجد: ' . implode('، ', $commerceMigrations)
        );
    }
}
