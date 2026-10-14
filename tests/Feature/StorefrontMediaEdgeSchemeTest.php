<?php

namespace Tests\Feature;

use App\Support\EdgeScheme;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * AWJ-HORIZON-MEDIA-STORAGE S4 — الروابط الموقَّعة لمكتبة وسائط المُخصِّص خلف حافة TLS.
 * الخادم يرى الطلب `http` فتُولَّد الروابط `http://` وتحجبها المتصفحات في صفحة https. يُستبدل المخطّط بعد التوقيع
 * فقط حين تؤكّد الحافة https؛ والتحقق من التوقيع يبقى على ما يراه التطبيق (http) فلا يتغيّر.
 *
 * تشغيل: php artisan test --filter=StorefrontMediaEdgeSchemeTest
 */
class StorefrontMediaEdgeSchemeTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use StorefrontMediaTestSupport;

    private const BASE = '/api/commerce/workspace/storefront-media';

    /** @test */
    public function the_helper_only_upgrades_when_the_edge_confirms_https(): void
    {
        $url = 'http://api.example.test/x?signature=abc';

        $this->assertSame($url, EdgeScheme::forBrowser($url), 'no forwarded header: unchanged');

        request()->headers->set('X-Forwarded-Proto', 'http');
        $this->assertSame($url, EdgeScheme::forBrowser($url));

        request()->headers->set('X-Forwarded-Proto', 'https');
        $this->assertSame('https://api.example.test/x?signature=abc', EdgeScheme::forBrowser($url));

        request()->headers->set('X-Forwarded-Proto', 'https,http');
        $this->assertSame('https://api.example.test/x?signature=abc', EdgeScheme::forBrowser($url), 'first hop wins');

        $this->assertSame('https://already.test/x', EdgeScheme::forBrowser('https://already.test/x'));
    }

    /** @test */
    public function library_urls_are_https_behind_the_edge_http_otherwise_and_still_validate(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfm-edge');
        $media = $this->withToken($auth['token'])
            ->post(self::BASE, ['files' => [$this->upload($this->jpegBytes(1600, 900))]], ['Accept' => 'application/json'])
            ->json('data.0.media');

        // بلا حافة (تطوير/شبكة خاصة): كما كان.
        $plain = $this->withToken($auth['token'])->getJson(self::BASE)->json('data.0');
        $this->assertStringStartsWith('http://', $plain['thumbnail_url']);

        // خلف الحافة: https في الاستجابة (تُعرَض في صفحة https).
        $edge = $this->withToken($auth['token'])->withHeader('X-Forwarded-Proto', 'https')->getJson(self::BASE)->json('data.0');
        $this->assertStringStartsWith('https://', $edge['thumbnail_url']);
        $this->assertStringStartsWith('https://', $edge['preview_url']);

        // المتصفح يطلب https عبر الحافة والتطبيق يستقبله http بالمسار والاستعلام نفسيهما ⇒ التوقيع صحيح.
        $asApp = 'http://'.substr($edge['thumbnail_url'], strlen('https://'));
        $this->get($asApp)->assertOk();

        // التوقيع المعبَث به يُرفض كما كان.
        $this->get($asApp.'0')->assertStatus(403);
    }
}
