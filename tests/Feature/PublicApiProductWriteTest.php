<?php

namespace Tests\Feature;

use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * PR-5: إنشاء منتج عبر الـ Public API. يغطّي عزل الـ scope، الإنشاء ودقّة النقود،
 * تفرّد SKU، رفض النقود السالبة وحقن tenant_id، **غياب أيّ أثر مخزني/محاسبي**،
 * والعقد المُنتقى وidempotency. تشغيل: php artisan test --filter=PublicApiProductWriteTest
 */
class PublicApiProductWriteTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const URI = '/api/v1/products';

    private function service(): ApiClientKeyService
    {
        return app(ApiClientKeyService::class);
    }

    private function makeTenant(string $slug = 'acme'): Tenant
    {
        return Tenant::create(['name' => $slug, 'slug' => $slug . '-' . Str::random(6)]);
    }

    private function key(Tenant $tenant, array $scopes = ['products:write']): string
    {
        return $this->service()->issueKey($this->service()->createClient($tenant, 'x'), 'k', $scopes)->plainTextToken;
    }

    private function payload(array $overrides = []): array
    {
        return array_merge([
            'name'             => 'منتج اختبار',
            'sale_price_minor' => 13225,
            'tax_rate'         => 15,
        ], $overrides);
    }

    private function idem(string $key = 'product-key-1'): array
    {
        return ['Idempotency-Key' => $key];
    }

    /** @test */
    public function a_read_scope_cannot_write(): void
    {
        $token = $this->key($this->makeTenant(), ['products:read']);
        $this->withToken($token)->postJson(self::URI, $this->payload(), $this->idem())
            ->assertStatus(403)->assertJsonPath('error.code', 'insufficient_scope');
        $this->assertSame(0, Product::count());
    }

    /** @test */
    public function a_valid_request_creates_a_product_with_exact_money_and_no_side_effects(): void
    {
        $token = $this->key($this->makeTenant());

        $res = $this->withToken($token)->postJson(self::URI, $this->payload(['sku' => 'SKU-XYZ']), $this->idem())
            ->assertStatus(201)
            ->assertJsonPath('data.name', 'منتج اختبار')
            ->assertJsonPath('data.sku', 'SKU-XYZ')
            ->assertJsonPath('data.sale_price_minor', 13225)   // دقّة النقود
            ->assertJsonPath('data.currency', 'SAR');

        // العقد المُنتقى: لا تكلفة/حساب/كمية داخلية.
        foreach (['purchase_price', 'purchase_price_minor', 'avg_cost', 'cogs_account_id', 'quantity_on_hand'] as $hidden) {
            $this->assertArrayNotHasKey($hidden, $res->json('data'));
        }

        $this->assertSame(1, Product::count());
        $this->assertSame(13225, (int) Product::withoutGlobalScopes()->firstOrFail()->sale_price);

        // لا أثر مخزني ولا محاسبي إطلاقًا.
        $this->assertSame(0, StockMovement::count());
        $this->assertSame(0, JournalEntry::count());
    }

    /** @test */
    public function a_server_generated_sku_is_assigned_when_absent(): void
    {
        $token = $this->key($this->makeTenant());
        $res = $this->withToken($token)->postJson(self::URI, $this->payload(), $this->idem())->assertStatus(201);
        $this->assertNotEmpty($res->json('data.sku'));
    }

    /** @test */
    public function a_duplicate_sku_is_rejected(): void
    {
        $token = $this->key($this->makeTenant());
        $this->withToken($token)->postJson(self::URI, $this->payload(['sku' => 'DUP-1']), $this->idem('sku-dup-a'))->assertStatus(201);
        $this->withToken($token)->postJson(self::URI, $this->payload(['sku' => 'DUP-1', 'name' => 'آخر']), $this->idem('sku-dup-b'))
            ->assertStatus(422)->assertJsonPath('error.code', 'validation_failed');
        $this->assertSame(1, Product::count());
    }

    /** @test */
    public function negative_money_is_rejected(): void
    {
        $token = $this->key($this->makeTenant());
        $this->withToken($token)->postJson(self::URI, $this->payload(['sale_price_minor' => -5]), $this->idem())
            ->assertStatus(422)->assertJsonPath('error.code', 'validation_failed');
        $this->assertSame(0, Product::count());
    }

    /** @test */
    public function tenant_id_injection_is_ignored(): void
    {
        $tenant = $this->makeTenant('a');
        $other = $this->makeTenant('b');
        $token = $this->key($tenant);

        $res = $this->withToken($token)->postJson(self::URI, $this->payload(['tenant_id' => $other->id]), $this->idem())
            ->assertStatus(201);
        $product = Product::withoutGlobalScopes()->findOrFail($res->json('data.id'));
        $this->assertSame($tenant->id, $product->tenant_id);
    }

    /** @test */
    public function a_duplicate_request_replays_without_creating_twice(): void
    {
        $token = $this->key($this->makeTenant());
        $payload = $this->payload(['sku' => 'REPLAY-1']);

        $a = $this->withToken($token)->postJson(self::URI, $payload, $this->idem('prod-replay'))->assertStatus(201);
        $b = $this->withToken($token)->postJson(self::URI, $payload, $this->idem('prod-replay'))
            ->assertStatus(201)->assertHeader('Idempotency-Replayed', 'true');

        $this->assertSame($a->json('data.id'), $b->json('data.id'));
        $this->assertSame(1, Product::count());
    }

    /** @test */
    public function same_key_changed_payload_conflicts(): void
    {
        $token = $this->key($this->makeTenant());
        $this->withToken($token)->postJson(self::URI, $this->payload(['name' => 'أول']), $this->idem('prod-conflict'))->assertStatus(201);
        $this->withToken($token)->postJson(self::URI, $this->payload(['name' => 'ثانٍ']), $this->idem('prod-conflict'))
            ->assertStatus(409)->assertJsonPath('error.code', 'idempotency_conflict');
        $this->assertSame(1, Product::count());
    }
}
