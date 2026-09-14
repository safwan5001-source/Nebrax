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
        'App\\Models\\Reservation',
        'App\\Models\\PaymentIntent',
        // 'App\\Models\\SalesChannel' أُزيل هنا: PR-COM-2A بناه فعلاً، وهذا
        // بالضبط ما يفسّره التوثيق أعلاه — الوعد كان بعدم إدخاله *قبل أوانه*،
        // لا منعه للأبد. Class name الفعلي (App\Models\SalesChannel) مطابقٌ
        // حرفياً لهذا الاسم المزال؛ لا نموذج آخر أُضيف باسمٍ مختلف يتطلّب تحديثاً هنا.
        // 'App\\Models\\CommerceListing' أُزيل هنا بنفس السبب: PR-COM-3 بناه
        // فعلاً ضمن نطاقه المعتمد (Master Plan §PHASE 3).
        // 'App\\Models\\CommerceOrder' أُزيل هنا بنفس السبب: PR-COM-5A بناه
        // فعلاً ضمن نطاقه المعتمد (Master Plan §PHASE 5) — بلا أثر محاسبي أو
        // مخزني عند التأكيد (ADR-01 §2/§6)، مثبتاً بحارسٍ صريح في
        // CommerceOrderServiceTest، لا بهذا الملف.
    ];

    /**
     * مسارات Commerce Workspace المعتمدة حتى COM-WS-3. الوعد الأصلي كان
     * بعدم إدخال مسارات *قبل أوانها*؛ تبقى هذه القائمة البيضاء حارساً ضد
     * أي مسار Commerce إضافي غير معتمد.
     *
     * GET وPUT لمسار publication يشتركان في URI واحد، لذلك يحرس الاختبار
     * الـURI المعتمد مرة واحدة كما يظهر في Route collection هنا.
     *
     * @var list<string>
     */
    private const ALLOWED_COMMERCE_API_ROUTES = [
        'api/commerce/workspace/products/{id}/publication',
        'api/commerce/workspace/storefronts',
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
            $uri = $route->uri();
            if (str_contains(strtolower($uri), 'commerce')) {
                $commerceRoutes[] = $uri;
            }
        }

        $commerceRoutes = array_values(array_unique($commerceRoutes));
        sort($commerceRoutes);

        $this->assertSame(
            self::ALLOWED_COMMERCE_API_ROUTES,
            $commerceRoutes,
            'لا يُسمح بمسارات Commerce API خارج القائمة المعتمدة — وُجد: ' . implode('، ', $commerceRoutes)
        );
    }

    // `no_commerce_migration_is_introduced_yet()` أُزيلت هنا (كانت تفحص أي
    // ملفّ ترحيل تحوي تسميته «commerce»). وعدها — بنصّ توثيق الصنف أعلاه —
    // كان محدوداً بـ«قبل PR-COM-1A» أصلاً، لا للأبد؛ ظلّت خضراء بعده صدفةً
    // فقط لأن COM-1B/2A/2B لم تُسمِّ جداولها الحرفية بكلمة «commerce»
    // (`inventory_reservations`، `sales_channels`، `fulfillment_policies`).
    // PR-COM-3 يضيف `commerce_listings` — ترحيلاً حقيقياً متوقَّعاً تماماً في
    // نطاقه المعتمد (Master Plan §PHASE 3) — فيصطدم بفحصٍ نصّي عام لم يعد
    // يحرس شيئاً حقيقياً بعد انتهاء نافذته.
    //
    // قائمة ALLOWED_COMMERCE_API_ROUTES أعلاه تُحدَّث فقط عندما يعتمد نطاق
    // Commerce جديد مساراته صراحةً، وتبقى تمنع أي تسرب لمسارات غير مقصودة.
}
