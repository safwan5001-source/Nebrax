<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * PR-5: حارس سطح الكتابة العام. يثبت أنّ الـ Public API لم يكتسب إلا مسارات POST
 * الثلاثة المقصودة، وأنّه **لا** PUT/PATCH/DELETE ولا أيّ فعلٍ مُعدِّل آخر تحت
 * `api/v1` — فلا يتسلّل سطح تعديل/حذف/ترحيل غير مقصود.
 * تشغيل: php artisan test --filter=PublicApiWriteSurfaceTest
 */
class PublicApiWriteSurfaceTest extends TestCase
{
    /** @return array<int, \Illuminate\Routing\Route> */
    private function v1Routes(): array
    {
        return array_values(array_filter(
            Route::getRoutes()->getRoutes(),
            static fn ($route): bool => str_starts_with($route->uri(), 'api/v1'),
        ));
    }

    /** @test */
    public function no_v1_route_exposes_a_put_patch_or_delete_verb(): void
    {
        foreach ($this->v1Routes() as $route) {
            $forbidden = array_intersect($route->methods(), ['PUT', 'PATCH', 'DELETE']);
            $this->assertSame([], array_values($forbidden), "المسار {$route->uri()} يكشف فعلًا مُعدِّلًا محظورًا.");
        }
    }

    /** @test */
    public function the_only_post_routes_are_the_three_intended_writes(): void
    {
        $postUris = [];
        foreach ($this->v1Routes() as $route) {
            if (in_array('POST', $route->methods(), true)) {
                $postUris[] = $route->uri();
            }
        }
        sort($postUris);

        $this->assertSame(
            ['api/v1/invoices', 'api/v1/partners', 'api/v1/products'],
            $postUris,
            'مسارات POST العامة يجب أن تكون بالضبط: الأطراف والمنتجات والفواتير.',
        );
    }
}
