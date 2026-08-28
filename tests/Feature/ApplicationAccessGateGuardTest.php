<?php

namespace Tests\Feature;

use App\Http\Middleware\EnsureApplicationActive;
use App\Http\Middleware\EnsureCommercialApplicationAccess;
use App\Support\ApplicationCatalog;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  حارس بوابات الوصول — لا إعلانَ كتالوج يكذب على المسارات
 * ═══════════════════════════════════════════════════════════════
 *
 * يقرأ الظهور الملاحي إعلان `access` من الكتالوج ليقرّر هل يستشير الاستحقاق
 * التجاري لقدرةٍ ما. فلو حُرست قدرة تجارياً على مساراتها وبقي إعلانها
 * `operational`، بقي رابطها في الشريط وردّت مساراتها 403 — وهي بالضبط الفجوة
 * التي أُصلحت. والعكس أسوأ: إعلانٌ تجاري لقدرةٍ لا يحرسها استحقاق يُخفي رابط
 * وحدةٍ تعمل فعلاً.
 *
 * ولأن الـ middleware هو السجل الوحيد لما يُنفَّذ فعلاً، يوازن هذا الحارس
 * الإعلان بالمسجَّل على مجموعة المسارات ويُفشل الـ CI عند أي انحراف — بدل
 * انتظار تقرير من مستأجر.
 */
class ApplicationAccessGateGuardTest extends TestCase
{
    /**
     * @return array{operational:list<string>,commercial:list<string>}
     */
    private function guardedKeys(): array
    {
        $operational = [];
        $commercial = [];

        foreach (Route::getRoutes() as $route) {
            foreach ($route->gatherMiddleware() as $middleware) {
                if (! is_string($middleware) || ! str_contains($middleware, ':')) {
                    continue;
                }

                [$class, $parameters] = explode(':', $middleware, 2);
                $key = explode(',', $parameters)[0];

                if ($class === EnsureApplicationActive::class) {
                    $operational[$key] = true;
                }

                if ($class === EnsureCommercialApplicationAccess::class) {
                    $commercial[$key] = true;
                }
            }
        }

        return [
            'operational' => array_keys($operational),
            'commercial' => array_keys($commercial),
        ];
    }

    /** @test */
    public function every_guarded_capability_key_exists_in_the_catalog(): void
    {
        $guarded = $this->guardedKeys();

        foreach ([...$guarded['operational'], ...$guarded['commercial']] as $key) {
            $this->assertTrue(
                ApplicationCatalog::exists($key),
                "المسار محروس بمفتاح غير موجود في الكتالوج: {$key}",
            );
        }
    }

    /** @test */
    public function no_capability_is_guarded_by_both_gates(): void
    {
        $guarded = $this->guardedKeys();

        $this->assertSame(
            [],
            array_values(array_intersect($guarded['operational'], $guarded['commercial'])),
            'قدرة محروسة ببوابتين مختلفتين — البوابة الفعلية تصبح رهن ترتيب المسار.',
        );
    }

    /** @test */
    public function the_declared_access_gate_matches_the_middleware_actually_registered(): void
    {
        $guarded = $this->guardedKeys();

        foreach ($guarded['operational'] as $key) {
            $this->assertSame(
                ApplicationCatalog::ACCESS_OPERATIONAL,
                ApplicationCatalog::accessGateFor($key),
                "{$key}: تحرسه `EnsureApplicationActive` فيجب أن يُعلن `operational` في الكتالوج.",
            );
        }

        foreach ($guarded['commercial'] as $key) {
            $this->assertSame(
                ApplicationCatalog::ACCESS_COMMERCIAL,
                ApplicationCatalog::accessGateFor($key),
                "{$key}: تحرسه `EnsureCommercialApplicationAccess` فيجب أن يُعلن `commercial` في الكتالوج.",
            );
        }
    }

    /** @test */
    public function a_commercial_declaration_is_backed_by_at_least_one_guarded_route(): void
    {
        $commercial = $this->guardedKeys()['commercial'];

        foreach (ApplicationCatalog::all() as $key => $application) {
            if ($application['access'] !== ApplicationCatalog::ACCESS_COMMERCIAL) {
                continue;
            }

            $this->assertContains(
                $key,
                $commercial,
                "{$key}: أُعلن تجارياً بلا أي مسار يحرسه تجارياً — الإعلان يُخفي رابطاً بلا إنفاذ يقابله.",
            );
        }
    }

    /** @test */
    public function the_catalog_contract_stays_valid_with_the_access_gate_declared(): void
    {
        $this->assertSame([], ApplicationCatalog::validationErrors());
    }
}
