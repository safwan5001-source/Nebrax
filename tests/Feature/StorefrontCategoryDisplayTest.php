<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * AWJ-STORE-CAT-DESIGN-01 — `design.display` لقسم التصنيفات على مستوى الوثيقة والـAPI:
 * التوافق الرجعي (الغياب = المظهر الكلاسيكي حرفياً)، المسار الكامل مسودة ← إعادة فتح ← نشر ← واجهة المتجر العامة،
 * عدم تسرّب المسودة إلى المنشور، وعزل المستأجرين. عقد المجموعة نفسه تغطّيه `StorefrontSectionDesignTest` عبر الـfixture المشترك.
 *
 * تشغيل: php artisan test --filter=StorefrontCategoryDisplayTest
 */
class StorefrontCategoryDisplayTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function path(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/presentation';
    }

    /** @return array{storefront: Storefront} */
    private function seedPublicStore(string $tenantId, string $hostname): array
    {
        app(TenantContext::class)->set($tenantId);

        $channel = SalesChannel::query()->where('slug', 'web')->first()
            ?? SalesChannel::create([
                'slug' => 'web',
                'name' => 'ويب',
                'type' => SalesChannel::TYPE_WEB,
                'is_active' => true,
            ]);
        $storefront = Storefront::create([
            'slug' => 'main',
            'name' => 'المتجر الرئيسي',
            'sales_channel_id' => $channel->id,
            'is_active' => true,
            'default_locale' => 'ar',
        ]);
        StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => $hostname,
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_primary' => true,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        return compact('storefront');
    }

    /** @return array<string, mixed> */
    private function display(string $layout = 'grid'): array
    {
        return [
            'layout' => $layout,
            'columns' => ['mobile' => 2, 'tablet' => 3, 'desktop' => 6],
            'card' => ['style' => 'border', 'radius' => 16, 'padding' => 12],
            'image' => ['shape' => 'rect', 'aspect' => '4:3', 'fit' => 'cover'],
            'name' => ['placement' => 'below', 'align' => 'center', 'size' => 14, 'lines' => 2],
        ];
    }

    /** @param  array<string, mixed>|null  $design */
    private function config(?array $design): array
    {
        $section = ['id' => 'categories', 'type' => 'categories', 'visible' => true];
        if ($design !== null) {
            $section['design'] = $design;
        }

        return ['version' => 2, 'homepage' => ['sections' => [
            ['id' => 'hero', 'type' => 'hero', 'visible' => true],
            $section,
        ]]];
    }

    /** @test */
    public function a_categories_section_without_display_normalizes_byte_for_byte_as_before(): void
    {
        $n = new StorefrontPresentationNormalizer;
        $legacy = $n->normalize($this->config(['spacing' => ['top' => 'md'], 'radius' => 'lg']));
        $categories = $legacy['homepage']['sections'][1];
        $this->assertSame(['spacing' => ['top' => 'md'], 'radius' => 'lg'], $categories['design']);
        $this->assertArrayNotHasKey('display', $categories['design']);

        // لا شيء في الوثيقة الافتراضية ولا في وثيقة بلا تصميم يتغيّر.
        foreach ($n->normalize([])['homepage']['sections'] as $section) {
            $this->assertArrayNotHasKey('design', $section);
        }
        $plain = $n->normalize($this->config(null));
        $this->assertArrayNotHasKey('design', $plain['homepage']['sections'][1]);
    }

    /** @test */
    public function a_display_layout_is_kept_on_categories_idempotently_and_dropped_elsewhere(): void
    {
        $n = new StorefrontPresentationNormalizer;
        $config = $n->normalize(['version' => 2, 'homepage' => ['sections' => [
            ['id' => 'categories', 'type' => 'categories', 'visible' => true, 'design' => ['display' => $this->display('circles')]],
            ['id' => 'new', 'type' => 'newArrivals', 'visible' => true, 'design' => ['display' => $this->display(), 'spacing' => ['top' => 'sm']]],
        ]]]);

        $this->assertSame($this->display('circles'), $config['homepage']['sections'][0]['design']['display']);
        // نوعٌ لا يعلن المجموعة لا يحتفظ بها أبداً.
        $this->assertSame(['spacing' => ['top' => 'sm']], $config['homepage']['sections'][1]['design']);
        $this->assertSame($config, $n->normalize($config));
    }

    /** @test */
    public function the_display_keys_survive_the_commerce_firewall_that_runs_over_the_whole_document(): void
    {
        $n = new StorefrontPresentationNormalizer;
        $full = [
            'layout' => 'image_tiles',
            'columns' => ['mobile' => 2, 'tablet' => 3, 'desktop' => 4],
            'gap' => ['mobile' => 8, 'tablet' => 12, 'desktop' => 16],
            'itemWidth' => ['mobile' => 120],
            'card' => ['style' => 'shadow', 'background' => 'muted', 'borderColor' => 'strong', 'borderWidth' => 2, 'radius' => 20, 'padding' => 10, 'hover' => 'subtle'],
            'image' => ['show' => false, 'shape' => 'square', 'aspect' => '1:1', 'fit' => 'contain', 'position' => 'end', 'height' => ['desktop' => 200]],
            'name' => ['show' => false, 'placement' => 'overlay', 'align' => 'end', 'size' => 20, 'weight' => 700, 'color' => 'primary', 'lines' => 'natural', 'background' => 'scrim'],
        ];
        $config = $n->normalize($this->config(['display' => $full]));

        $this->assertSame($full, $config['homepage']['sections'][1]['design']['display']);
    }

    /** @test */
    public function saving_never_422s_on_hostile_display_content_and_normalizes_it(): void
    {
        $auth = $this->registerTenant('cat-display-422', 'owner@cat-display-422.test');
        $seeded = $this->seedPublicStore($auth['tenant_id'], 'cat-display-422.example.com');

        $hostile = ['layout' => 'grid', 'columns' => ['mobile' => 99, 'tablet' => 'x'], 'card' => ['radius' => 9999, 'style' => '<script>'], 'name' => ['size' => 1.5, 'color' => '#ff0000'], 'unknown' => 1];
        $res = $this->withToken($auth['token'])
            ->putJson($this->path($seeded['storefront']->id), ['config' => $this->config(['display' => $hostile]), 'draft_revision' => 0])
            ->assertOk();

        $this->assertSame(
            ['layout' => 'grid', 'columns' => ['mobile' => 4], 'card' => ['radius' => 32]],
            $res->json('data.draft.homepage.sections.1.design.display'),
        );
    }

    /** @test */
    public function draft_save_reopen_and_publish_never_leak_an_unpublished_display_into_the_live_storefront(): void
    {
        $auth = $this->registerTenant('cat-display-flow', 'owner@cat-display-flow.test');
        $seeded = $this->seedPublicStore($auth['tenant_id'], 'cat-display-flow.example.com');
        $id = $seeded['storefront']->id;
        $host = 'http://cat-display-flow.example.com/store/v1/storefront';

        // 1) المسودة الأولى (شبكة) ← إعادة فتح المسودة ← نشر.
        $this->withToken($auth['token'])
            ->putJson($this->path($id), ['config' => $this->config(['display' => $this->display('grid')]), 'draft_revision' => 0])
            ->assertOk();
        $this->withToken($auth['token'])->getJson($this->path($id))->assertOk()
            ->assertJsonPath('data.draft.homepage.sections.1.design.display.layout', 'grid');
        $this->getJson($host)->assertOk()->assertJsonPath('data.presentation', null); // المسودة لا تُقرأ عاماً

        $this->withToken($auth['token'])->postJson($this->path($id).'/publish', ['draft_revision' => 1])->assertOk();
        $this->getJson($host)->assertOk()
            ->assertJsonPath('data.presentation.homepage.sections.1.design.display', $this->display('grid'));

        // 2) تعديل المسودة فقط (دوائر) ← المنشور لم يتغيّر.
        $this->withToken($auth['token'])
            ->putJson($this->path($id), ['config' => $this->config(['display' => $this->display('circles')]), 'draft_revision' => 1])
            ->assertOk();
        $this->getJson($host)->assertOk()
            ->assertJsonPath('data.presentation.homepage.sections.1.design.display.layout', 'grid');

        // 3) النشر الصريح وحده يُظهرها.
        $this->withToken($auth['token'])->postJson($this->path($id).'/publish', ['draft_revision' => 2])->assertOk();
        $this->getJson($host)->assertOk()
            ->assertJsonPath('data.presentation.homepage.sections.1.design.display.layout', 'circles');

        // 4) العودة إلى الكلاسيكي: إزالة display تعود بالقسم إلى مظهره الأصلي بعد النشر.
        $this->withToken($auth['token'])
            ->putJson($this->path($id), ['config' => $this->config(null), 'draft_revision' => 2])
            ->assertOk();
        $this->withToken($auth['token'])->postJson($this->path($id).'/publish', ['draft_revision' => 3])->assertOk();
        $live = $this->getJson($host)->assertOk()->json('data.presentation.homepage.sections.1');
        $this->assertArrayNotHasKey('design', $live);
    }

    /** @test */
    public function one_tenants_display_is_never_served_on_another_tenants_host_and_anonymous_writes_are_rejected(): void
    {
        $a = $this->registerTenant('cat-display-a', 'owner@cat-display-a.test');
        $b = $this->registerTenant('cat-display-b', 'owner@cat-display-b.test');
        $storeA = $this->seedPublicStore($a['tenant_id'], 'cat-display-a.example.com');
        $storeB = $this->seedPublicStore($b['tenant_id'], 'cat-display-b.example.com');

        $this->withToken($a['token'])
            ->putJson($this->path($storeA['storefront']->id), ['config' => $this->config(['display' => $this->display('image_tiles')]), 'draft_revision' => 0])
            ->assertOk();
        $this->withToken($a['token'])->postJson($this->path($storeA['storefront']->id).'/publish', ['draft_revision' => 1])->assertOk();

        $this->getJson('http://cat-display-a.example.com/store/v1/storefront')->assertOk()
            ->assertJsonPath('data.presentation.homepage.sections.1.design.display.layout', 'image_tiles');
        $this->getJson('http://cat-display-b.example.com/store/v1/storefront')->assertOk()
            ->assertJsonPath('data.presentation', null);

        // مستأجر B لا يكتب في متجر A، ولا كتابة بلا مصادقة.
        $this->withToken($b['token'])
            ->putJson($this->path($storeA['storefront']->id), ['config' => $this->config(['display' => $this->display('circles')]), 'draft_revision' => 1])
            ->assertNotFound();
        $this->flushHeaders()
            ->putJson($this->path($storeA['storefront']->id), ['config' => $this->config(['display' => $this->display('circles')]), 'draft_revision' => 1])
            ->assertUnauthorized();
        $this->getJson('http://cat-display-a.example.com/store/v1/storefront')->assertOk()
            ->assertJsonPath('data.presentation.homepage.sections.1.design.display.layout', 'image_tiles');
    }
}
