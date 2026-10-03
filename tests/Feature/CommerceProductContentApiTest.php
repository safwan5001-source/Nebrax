<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\CommerceProductContentBlock;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Services\Commerce\ProductContentService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/**
 * FLOWERS-H5 / ADR-17 — كتل محتوى المنتج المهيكلة: الاستبدال الذرّي، التحقق، العزل،
 * RBAC، والكشف العام (store/v1 + commerce/v1) بلا تغيير للمنتج العادي.
 *
 * تشغيل: php artisan test --filter=CommerceProductContentApiTest
 */
class CommerceProductContentApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function makeProduct(string $tenantId, string $name = 'باقة'): Product
    {
        app(TenantContext::class)->set($tenantId);
        $product = Product::create(['name' => $name, 'type' => 'good', 'unit' => 'piece', 'sale_price' => 9000, 'is_active' => true]);
        app(TenantContext::class)->forget();

        return $product;
    }

    private function url(Product $product): string
    {
        return "/api/commerce/workspace/products/{$product->id}/content";
    }

    private function blocks(): array
    {
        return [
            ['block_type' => 'composition', 'body' => '12 وردة جوري هولندية', 'body_en' => '12 Dutch roses'],
            ['block_type' => 'care', 'body' => "ضعها في ماء بارد.\nغيّر الماء يومياً."],
            ['block_type' => 'allergens', 'body' => 'قد تحتوي على حبوب لقاح.', 'is_active' => false],
        ];
    }

    /** @test */
    public function an_owner_replaces_and_reads_content_blocks_in_order(): void
    {
        $auth = $this->registerTenant('ct-def', 'owner@ct-def.test');
        $product = $this->makeProduct($auth['tenant_id']);

        $res = $this->withToken($auth['token'])->putJson($this->url($product), ['blocks' => $this->blocks()])->assertOk();

        $this->assertSame(['composition', 'care', 'allergens'], array_column($res->json('data.blocks'), 'type'));
        $this->assertSame("ضعها في ماء بارد.\nغيّر الماء يومياً.", $res->json('data.blocks.1.body'));
        $this->assertFalse($res->json('data.blocks.2.is_active'));
        $this->assertSame($res->json('data.blocks'), $this->withToken($auth['token'])->getJson($this->url($product))->json('data.blocks'));

        // استبدال idempotent + إزالة ما غاب
        $this->withToken($auth['token'])->putJson($this->url($product), ['blocks' => [$this->blocks()[0]]])->assertOk();
        $this->assertSame(1, CommerceProductContentBlock::withoutGlobalScopes()->count());
    }

    /** @test */
    public function invalid_content_is_rejected_and_the_existing_set_is_untouched(): void
    {
        $auth = $this->registerTenant('ct-bad', 'owner@ct-bad.test');
        $product = $this->makeProduct($auth['tenant_id']);
        $this->withToken($auth['token'])->putJson($this->url($product), ['blocks' => [$this->blocks()[0]]])->assertOk();

        $put = fn (array $blocks) => $this->withToken($auth['token'])->putJson($this->url($product), ['blocks' => $blocks]);
        $put([['block_type' => 'unknown', 'body' => 'x']])->assertStatus(422);
        $put([['block_type' => 'care', 'body' => '   ']])->assertStatus(422);
        $put([['block_type' => 'care', 'body' => 'a'], ['block_type' => 'care', 'body' => 'b']])->assertStatus(422);
        $put([['block_type' => 'care', 'body' => str_repeat('م', 2001)]])->assertStatus(422);
        $put([['block_type' => 'care', 'body' => str_repeat("x\n", 45)]])->assertStatus(422);

        $this->assertSame(1, CommerceProductContentBlock::withoutGlobalScopes()->count());
        $this->assertSame('composition', CommerceProductContentBlock::withoutGlobalScopes()->first()->block_type);
    }

    /** @test */
    public function text_is_sanitized_and_html_stays_literal(): void
    {
        $auth = $this->registerTenant('ct-san', 'owner@ct-san.test');
        $product = $this->makeProduct($auth['tenant_id']);

        $res = $this->withToken($auth['token'])->putJson($this->url($product), ['blocks' => [
            ['block_type' => 'care', 'body' => "<b>مهم</b>\u{202E}\x07\r\nسطر"],
        ]])->assertOk();

        $this->assertSame("<b>مهم</b>\nسطر", $res->json('data.blocks.0.body'));
    }

    /** @test */
    public function cross_tenant_access_and_model_guards(): void
    {
        $a = $this->registerTenant('ct-iso-a', 'owner@ct-iso-a.test');
        $b = $this->registerTenant('ct-iso-b', 'owner@ct-iso-b.test');
        $productB = $this->makeProduct($b['tenant_id']);

        $this->withToken($a['token'])->getJson($this->url($productB))->assertNotFound();
        $this->withToken($a['token'])->putJson($this->url($productB), ['blocks' => $this->blocks()])->assertNotFound();
        $this->assertSame(0, CommerceProductContentBlock::withoutGlobalScopes()->count());

        app(TenantContext::class)->set($a['tenant_id']);
        foreach ([
            fn () => CommerceProductContentBlock::create(['product_id' => $productB->id, 'block_type' => 'care', 'body' => 'x']),
            fn () => CommerceProductContentBlock::create(['product_id' => $this->makeProduct($a['tenant_id'])->id, 'block_type' => 'bogus', 'body' => 'x']),
        ] as $create) {
            try {
                $create();
                $this->fail('an invalid content block was accepted');
            } catch (RuntimeException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    /** @test */
    public function rbac_and_guests(): void
    {
        $auth = $this->registerTenant('ct-rbac', 'owner@ct-rbac.test');
        $product = $this->makeProduct($auth['tenant_id']);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@ct-rbac.test');
        $ss = $this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@ct-rbac.test');

        $this->withToken($staff)->getJson($this->url($product))->assertOk();
        $this->withToken($staff)->putJson($this->url($product), ['blocks' => []])->assertForbidden();
        $this->withToken($ss)->getJson($this->url($product))->assertForbidden();
        $this->withToken($ss)->putJson($this->url($product), ['blocks' => []])->assertForbidden();
    }

    /** @test */
    public function guests_are_rejected(): void
    {
        $this->getJson('/api/commerce/workspace/products/'.Str::uuid().'/content')->assertUnauthorized();
    }

    // ── public ──────────────────────────────────────────────────────────

    /** @return array{tenant: Tenant, channel: SalesChannel} */
    private function publicStore(string $slug, string $type = SalesChannel::TYPE_WEB): array
    {
        $tenant = Tenant::create([
            'name' => "متجر {$slug}", 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => $type, 'name' => 'قناة', 'type' => $type, 'is_active' => true]);
        app(TenantContext::class)->forget();

        return compact('tenant', 'channel');
    }

    private function publish(Tenant $tenant, SalesChannel $channel, string $name, array $blocks = []): Product
    {
        $product = $this->makeProduct($tenant->id, $name);
        app(TenantContext::class)->set($tenant->id);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
        if ($blocks !== []) {
            app(ProductContentService::class)->replace($product, $blocks);
        }
        app(TenantContext::class)->forget();

        return $product;
    }

    /** @test */
    public function the_public_detail_shows_only_active_blocks_and_only_when_present(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->publicStore('ct-pub');
        $rich = $this->publish($tenant, $channel, 'باقة غنية', $this->blocks());
        $plain = $this->publish($tenant, $channel, 'عادي');

        $res = $this->getJson("/store/v1/{$tenant->slug}/products/{$rich->id}")->assertOk();
        $this->assertSame(['composition', 'care'], array_column($res->json('data.content_blocks'), 'type')); // allergens معطَّل
        $this->assertArrayNotHasKey('is_active', $res->json('data.content_blocks.0'));

        $this->assertArrayNotHasKey('content_blocks', $this->getJson("/store/v1/{$tenant->slug}/products/{$plain->id}")->assertOk()->json('data'));
        foreach ($this->getJson("/store/v1/{$tenant->slug}/products")->json('data') as $row) {
            $this->assertArrayNotHasKey('content_blocks', $row);
        }
    }

    /** @test */
    public function another_tenants_blocks_never_leak_and_the_mobile_detail_matches(): void
    {
        ['tenant' => $a, 'channel' => $chA] = $this->publicStore('ct-leak-a');
        ['tenant' => $b, 'channel' => $chB] = $this->publicStore('ct-leak-b');
        $pa = $this->publish($a, $chA, 'منتج أ');
        $this->publish($b, $chB, 'منتج ب', $this->blocks());
        $this->assertArrayNotHasKey('content_blocks', $this->getJson("/store/v1/{$a->slug}/products/{$pa->id}")->json('data'));

        ['tenant' => $m, 'channel' => $chM] = $this->publicStore('ct-mob', SalesChannel::TYPE_MOBILE);
        $pm = $this->publish($m, $chM, 'كيكة', $this->blocks());
        $service = app(ApiClientKeyService::class);
        $headers = ['Authorization' => 'Bearer '.$service->issueKey($service->createClient($m, 'mobile-app', true), 'default', [])->plainTextToken];

        $res = $this->getJson("/commerce/v1/products/{$pm->id}", $headers)->assertOk();
        $this->assertSame(['composition', 'care'], array_column($res->json('data.content_blocks'), 'type'));
    }
}
