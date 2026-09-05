<?php

namespace Tests\Feature;

use Tests\TestCase;
use Illuminate\Foundation\Testing\RefreshDatabase;

/**
 * PR-2S: يثبت أن `purchase_price`/`avg_cost`/`profit_margin` تغيب فعلياً من
 * استجابة `GET /pos/products` (لا مجرد إخفاء واجهة) إلا حين تجتمع صلاحية
 * `products.view_cost` **وإعداد** `show_cost_profit_in_pos` معاً. الأكثر
 * تقييداً يفوز في كل الحالات؛ الإعداد وحده لا يمنح شيئاً.
 */
class PosProductCostVisibilityTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function product(string $token): array
    {
        return $this->withToken($token)->postJson('/api/products', [
            'name' => 'منتج حساس التكلفة',
            'sku' => 'COST-001',
            'type' => 'good',
            'unit' => 'piece',
            'sale_price' => 20000,
            'purchase_price' => 10000,
            'profit_margin' => 100,
        ])->assertCreated()['data'];
    }

    private function assertNoCostFields(array $catalogProduct): void
    {
        $this->assertArrayNotHasKey('purchase_price', $catalogProduct);
        $this->assertArrayNotHasKey('avg_cost', $catalogProduct);
        $this->assertArrayNotHasKey('profit_margin', $catalogProduct);
    }

    private function assertHasCostFields(array $catalogProduct): void
    {
        $this->assertArrayHasKey('purchase_price', $catalogProduct);
        $this->assertArrayHasKey('avg_cost', $catalogProduct);
        $this->assertArrayHasKey('profit_margin', $catalogProduct);
        $this->assertSame('100.00', $catalogProduct['purchase_price']);
        $this->assertSame(100, $catalogProduct['profit_margin']);
    }

    private function catalogProduct(string $token, string $productId): array
    {
        $catalog = $this->withToken($token)->getJson('/api/pos/products')->assertOk()['data'];

        return collect($catalog)->firstWhere('id', $productId);
    }

    /** @test */
    public function unauthorized_user_never_receives_cost_fields_regardless_of_the_setting(): void
    {
        $auth = $this->registerTenant('cost-a', 'owner@cost-a.test');
        $product = $this->product($auth['token']);
        // accountant: يملك `invoices.manage` (يمرّ بوابة استعمال POS) لكن ليس
        // `products.view_cost` — بالضبط الحالة التي كشفت الثغرة الأصلية:
        // القدرة على تشغيل POS ليست تفويضاً لرؤية التكلفة/الربحية.
        $accountantToken = $this->tokenForRole($auth['tenant_id'], 'accountant', 'accountant@cost-a.test');

        // الإعداد معطّل (الافتراض)
        $this->assertNoCostFields($this->catalogProduct($accountantToken, $product['id']));

        // الإعداد مفعَّل — الصلاحية غائبة فتبقى الحقول غائبة رغم ذلك
        $this->withToken($auth['token'])->putJson('/api/sales-config/pos', [
            'data' => ['show_cost_profit_in_pos' => true],
        ])->assertOk();
        $this->assertNoCostFields($this->catalogProduct($accountantToken, $product['id']));
    }

    /** @test */
    public function authorized_user_receives_cost_fields_only_when_the_setting_is_also_on(): void
    {
        $auth = $this->registerTenant('cost-b', 'owner@cost-b.test');
        $product = $this->product($auth['token']);

        // owner يملك كل الصلاحيات (`*`) — الإعداد معطّل افتراضياً فتبقى الحقول غائبة.
        $this->assertNoCostFields($this->catalogProduct($auth['token'], $product['id']));

        $this->withToken($auth['token'])->putJson('/api/sales-config/pos', [
            'data' => ['show_cost_profit_in_pos' => true],
        ])->assertOk();
        $this->assertHasCostFields($this->catalogProduct($auth['token'], $product['id']));
    }

    /** @test */
    public function existing_tenants_default_to_the_setting_off_with_no_migration(): void
    {
        $auth = $this->registerTenant('cost-c', 'owner@cost-c.test');
        $product = $this->product($auth['token']);

        // لم يُحفظ الإعداد إطلاقاً — التوافق الرجعي: لا كشف جديد لمستأجر قائم.
        $this->assertNoCostFields($this->catalogProduct($auth['token'], $product['id']));
        $this->withToken($auth['token'])->getJson('/api/sales-config/pos')
            ->assertOk()
            ->assertJsonPath('data.show_cost_profit_in_pos', false);
    }

    /** @test */
    public function the_setting_is_tenant_scoped_and_does_not_bleed_across_tenants(): void
    {
        $tenantA = $this->registerTenant('cost-tenant-a', 'owner@cost-tenant-a.test');
        $tenantB = $this->registerTenant('cost-tenant-b', 'owner@cost-tenant-b.test');
        $productA = $this->product($tenantA['token']);
        $productB = $this->product($tenantB['token']);

        $this->withToken($tenantA['token'])->putJson('/api/sales-config/pos', [
            'data' => ['show_cost_profit_in_pos' => true],
        ])->assertOk();

        $this->assertHasCostFields($this->catalogProduct($tenantA['token'], $productA['id']));
        $this->assertNoCostFields($this->catalogProduct($tenantB['token'], $productB['id']));
    }

    /** @test */
    public function other_product_resource_consumers_outside_pos_are_unaffected(): void
    {
        $auth = $this->registerTenant('cost-d', 'owner@cost-d.test');
        $product = $this->product($auth['token']);

        // شاشة ERP العامة (`GET /products/{id}`) لا تمرّ عبر كتالوج POS إطلاقاً —
        // لا العلامة العابرة تُوضع، فتبقى الحقول ظاهرة كسلوكها السابق تماماً.
        $this->withToken($auth['token'])->getJson("/api/products/{$product['id']}")
            ->assertOk()
            ->assertJsonPath('data.purchase_price', '100.00')
            ->assertJsonPath('data.profit_margin', 100);
    }
}
