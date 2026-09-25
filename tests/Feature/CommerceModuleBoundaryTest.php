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
        // COM-MOBILE-PAYMENTS-1 — إدارة داخلية لالتزامات دفع Commerce (ADR-09).
        'api/commerce/payment-intents',
        'api/commerce/payment-intents/{id}/cancel',
        'api/commerce/payment-intents/{id}/collect',
        // COM-CATALOG-2 — مساحة عمل نشر التصنيفات (قراءة + استبدال مجموعة النشر).
        'api/commerce/workspace/categories/publication',
        'api/commerce/workspace/categories/{id}/publication',
        // COM-CATALOG-1 — قائمة مساحة عمل نشر المنتجات (قراءة فقط فوق COM-WS-3).
        'api/commerce/workspace/products/publication',
        'api/commerce/workspace/products/{id}/publication',
        // COM-MOBILE-SHIPPING-1 — مناطق شحن مُهيَّأة من التاجر (ADR-10).
        'api/commerce/workspace/shipping-zones',
        'api/commerce/workspace/shipping-zones/{id}',
        'api/commerce/workspace/storefronts',
        'api/commerce/workspace/storefronts/{id}',
        'api/commerce/workspace/storefronts/{id}/activate',
        'api/commerce/workspace/storefronts/{id}/deactivate',
        'api/commerce/workspace/storefronts/{id}/domains',
        'api/commerce/workspace/storefronts/{id}/domains/{domainId}',
        'api/commerce/workspace/storefronts/{id}/domains/{domainId}/activate-edge',
        'api/commerce/workspace/storefronts/{id}/domains/{domainId}/make-primary',
        'api/commerce/workspace/storefronts/{id}/domains/{domainId}/refresh-edge',
        'api/commerce/workspace/storefronts/{id}/domains/{domainId}/verify',
        'api/commerce/workspace/storefronts/{id}/presentation',
        'api/commerce/workspace/storefronts/{id}/presentation/publish',
        // COM-MOBILE-ADDRESSES-1 — دفتر عناوين العميل الموثَّق (X-Customer-Token).
        'commerce/v1/addresses',
        'commerce/v1/addresses/{id}',
        // COM-MOBILE-AUTH-1 — مصادقة عميل /commerce/v1 (هاتف+OTP وبريد+كلمة مرور).
        'commerce/v1/auth/login',
        'commerce/v1/auth/logout',
        'commerce/v1/auth/otp/request',
        'commerce/v1/auth/otp/verify',
        'commerce/v1/auth/register',
        'commerce/v1/cart',
        'commerce/v1/cart/items',
        'commerce/v1/cart/items/{item}',
        'commerce/v1/categories',
        'commerce/v1/categories/{id}',
        'commerce/v1/checkout',
        'commerce/v1/checkout/address',
        'commerce/v1/checkout/complete',
        'commerce/v1/checkout/contact',
        'commerce/v1/checkout/delivery',
        // COM-MOBILE-PAYMENTS-1 — اختيار طريقة الدفع.
        'commerce/v1/checkout/payment',
        // APP-BUILDER-19 — أحدث تجربة App Builder منشورة (حلقة الجلب/التخزين المؤقت).
        'commerce/v1/experience',
        // COM-MOBILE-AUTH-1 — ملف العميل الموثَّق (X-Customer-Token).
        'commerce/v1/me',
        // COM-MOBILE-ORDER-HISTORY-1 — سجلّ طلبات العميل الموثَّق الخاص به.
        'commerce/v1/me/orders',
        'commerce/v1/me/orders/{id}',
        // COM-MOBILE-MEDIA-1 — مسار وسائط منتج محروس لحدّ ثقة /commerce/v1.
        'commerce/v1/media/{id}',
        'commerce/v1/orders/{id}',
        // COM-MOBILE-PAYMENTS-1 — طرق الدفع المتاحة فعلياً للقناة (ADR-09 §3).
        'commerce/v1/payment-methods',
        'commerce/v1/products',
        'commerce/v1/products/{id}',
        'commerce/v1/storefront',
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
