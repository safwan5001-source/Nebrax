<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * حارس سطح الكتابة العام. يثبت أنّ الـ Public API لم يكتسب إلا المسارات المقصودة
 * صراحةً — فلا يتسلّل سطح تعديل/حذف/ترحيل غير مقصود.
 *
 * PR-5 حصر السطح في ثلاث POST (أطراف/منتجات/فواتير) بلا أيّ فعلٍ مُعدِّل. PR-7
 * وسّعه **عمدًا وبحدود** بإدارة اشتراكات الـ Webhooks: يُضيف POST للإنشاء وتدوير
 * السرّ، و**PATCH/DELETE على مسار الاشتراك وحده**. يحرس هذا الاختبار هذين الحدّين:
 * أفعال التعديل لا تظهر إلا على `api/v1/webhooks/{id}`، وقائمة POST هي المقصودة تحديدًا.
 *
 * تشغيل: php artisan test --filter=PublicApiWriteSurfaceTest
 */
class PublicApiWriteSurfaceTest extends TestCase
{
    /** المسار الوحيد المسموح له بأفعال التعديل (إدارة اشتراك Webhook). */
    private const WEBHOOK_ITEM_URI = 'api/v1/webhooks/{id}';

    /** مجموعة POST العامة المقصودة بالضبط. */
    private const INTENDED_POST_URIS = [
        'api/v1/invoices',
        'api/v1/partners',
        'api/v1/products',
        'api/v1/webhooks',
        'api/v1/webhooks/{id}/rotate-secret',
    ];

    /** @return array<int, \Illuminate\Routing\Route> */
    private function v1Routes(): array
    {
        return array_values(array_filter(
            Route::getRoutes()->getRoutes(),
            static fn ($route): bool => str_starts_with($route->uri(), 'api/v1'),
        ));
    }

    /** @test */
    public function modifying_verbs_are_confined_to_webhook_management(): void
    {
        // PUT لا يُستعمل إطلاقًا؛ PATCH/DELETE على مسار الاشتراك وحده.
        foreach ($this->v1Routes() as $route) {
            $this->assertNotContains('PUT', $route->methods(), "المسار {$route->uri()} يكشف PUT محظورًا.");

            $modifying = array_intersect($route->methods(), ['PATCH', 'DELETE']);
            if ($modifying !== []) {
                $this->assertSame(
                    self::WEBHOOK_ITEM_URI,
                    $route->uri(),
                    "فعل تعديل غير مقصود على {$route->uri()} — مسموحٌ فقط على " . self::WEBHOOK_ITEM_URI . '.',
                );
            }
        }
    }

    /** @test */
    public function the_only_post_routes_are_the_intended_writes(): void
    {
        $postUris = [];
        foreach ($this->v1Routes() as $route) {
            if (in_array('POST', $route->methods(), true)) {
                $postUris[] = $route->uri();
            }
        }
        sort($postUris);

        $expected = self::INTENDED_POST_URIS;
        sort($expected);

        $this->assertSame(
            $expected,
            $postUris,
            'مسارات POST العامة يجب أن تكون بالضبط: الأطراف والمنتجات والفواتير وإنشاء/تدوير الـ Webhook.',
        );
    }
}
