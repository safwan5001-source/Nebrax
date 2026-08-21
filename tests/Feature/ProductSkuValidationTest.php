<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Support\BranchSettings;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 * رمز المنتج (SKU) — عقد المستخدم قبل قيد قاعدة البيانات
 * ═══════════════════════════════════════════════════════════════
 *
 * التفرد يتبع نطاق الكتالوج: مؤسسي عند مشاركة المنتجات، وفرعي عند فصلها.
 * المنتج المؤسسي بلا فرع يبقى مرئياً للجميع ويحجز رمزه، ولا يعاد جمع كتالوجات
 * متعارضة عند إعادة تفعيل المشاركة.
 */
class ProductSkuValidationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function payload(string $name, string $sku): array
    {
        return [
            'name'       => $name,
            'sku'        => $sku,
            'type'       => 'good',
            'sale_price' => 10000,
        ];
    }

    private function mainBranch(string $token): string
    {
        return $this->withToken($token)->getJson('/api/branches')['data'][0]['id'];
    }

    private function branch(string $token, string $name): string
    {
        return $this->withToken($token)->postJson('/api/branches', ['name' => $name])
            ->assertCreated()['data']['id'];
    }

    private function createInBranch(string $token, string $branchId, string $name, string $sku)
    {
        return $this->withToken($token)->withHeaders(['X-Branch-Id' => $branchId])
            ->postJson('/api/products', $this->payload($name, $sku));
    }

    /** @test */
    public function a_duplicate_live_sku_is_rejected_with_a_clear_422_response_when_products_are_shared(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])
            ->postJson('/api/products', $this->payload('الصنف الأول', 'SKU-ONE'))
            ->assertCreated();

        $this->withToken($auth['token'])
            ->postJson('/api/products', $this->payload('الصنف الثاني', 'SKU-ONE'))
            ->assertStatus(422)
            ->assertJsonValidationErrors('sku')
            ->assertJsonPath('errors.sku.0', 'رمز المنتج (SKU) مستخدم بالفعل في نطاق الكتالوج الحالي.');
    }

    /** @test */
    public function a_product_can_keep_its_own_sku_but_cannot_take_another_live_products_sku(): void
    {
        $auth = $this->registerTenant();

        $first = $this->withToken($auth['token'])
            ->postJson('/api/products', $this->payload('الصنف الأول', 'SKU-ONE'))
            ->assertCreated()['data'];
        $second = $this->withToken($auth['token'])
            ->postJson('/api/products', $this->payload('الصنف الثاني', 'SKU-TWO'))
            ->assertCreated()['data'];

        $this->withToken($auth['token'])
            ->putJson("/api/products/{$first['id']}", $this->payload('الصنف الأول بعد التعديل', 'SKU-ONE'))
            ->assertOk()
            ->assertJsonPath('data.sku', 'SKU-ONE');

        $this->withToken($auth['token'])
            ->putJson("/api/products/{$second['id']}", $this->payload('الصنف الثاني بعد التعديل', 'SKU-ONE'))
            ->assertStatus(422)
            ->assertJsonValidationErrors('sku');
    }

    /** @test */
    public function a_soft_deleted_product_releases_its_sku_for_a_new_live_product(): void
    {
        $auth = $this->registerTenant();

        $retired = $this->withToken($auth['token'])
            ->postJson('/api/products', $this->payload('صنف متقاعد', 'SKU-RETIRED'))
            ->assertCreated()['data'];

        $this->withToken($auth['token'])
            ->deleteJson("/api/products/{$retired['id']}")
            ->assertOk();

        $this->withToken($auth['token'])
            ->postJson('/api/products', $this->payload('صنف بديل', 'SKU-RETIRED'))
            ->assertCreated()
            ->assertJsonPath('data.sku', 'SKU-RETIRED');
    }

    /** @test */
    public function the_same_sku_is_allowed_for_a_different_tenant(): void
    {
        $first = $this->registerTenant('sku-tenant-one', 'owner@sku-tenant-one.test');
        $second = $this->registerTenant('sku-tenant-two', 'owner@sku-tenant-two.test');

        $this->withToken($first['token'])
            ->postJson('/api/products', $this->payload('صنف المستأجر الأول', 'SKU-SHARED'))
            ->assertCreated();

        $this->withToken($second['token'])
            ->postJson('/api/products', $this->payload('صنف المستأجر الثاني', 'SKU-SHARED'))
            ->assertCreated();
    }

    /** @test */
    public function isolated_branches_can_use_the_same_sku_in_separate_catalogs(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');
        BranchSettings::merge(['share_products' => false]);

        $this->createInBranch($auth['token'], $main, 'صنف الرئيسي', 'SKU-BRANCH')
            ->assertCreated();
        $this->createInBranch($auth['token'], $khobar, 'صنف الخبر', 'SKU-BRANCH')
            ->assertCreated();
    }

    /** @test */
    public function a_company_wide_legacy_product_reserves_its_sku_even_when_products_are_isolated(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main = $this->mainBranch($auth['token']);
        Product::withoutGlobalScope(BranchScope::class)->create([
            'tenant_id' => $auth['tenant_id'],
            'branch_id' => null,
            'name' => 'صنف مؤسسي قديم',
            'sku' => 'SKU-COMPANY',
            'sale_price' => 10000,
        ]);
        BranchSettings::merge(['share_products' => false]);

        $this->createInBranch($auth['token'], $main, 'صنف فرعي متعارض', 'SKU-COMPANY')
            ->assertStatus(422)
            ->assertJsonValidationErrors('sku');
    }

    /** @test */
    public function product_sharing_cannot_be_reenabled_while_branch_catalogs_have_duplicate_skus(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');
        BranchSettings::merge(['share_products' => false]);

        $this->createInBranch($auth['token'], $main, 'صنف الرئيسي', 'SKU-CONFLICT')->assertCreated();
        $this->createInBranch($auth['token'], $khobar, 'صنف الخبر', 'SKU-CONFLICT')->assertCreated();

        $this->withToken($auth['token'])
            ->putJson('/api/branch-settings', ['share_products' => true])
            ->assertStatus(422)
            ->assertJsonValidationErrors('share_products');
    }
}
