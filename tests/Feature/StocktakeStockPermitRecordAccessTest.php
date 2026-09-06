<?php

namespace Tests\Feature;

use App\Models\JournalEntry;
use App\Models\StockMovement;
use App\Models\StockPermit;
use App\Models\Stocktake;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * PR-SEC-INV-1 — تفويض السجلّ لنفس المستأجر: الجرد والأذون المخزنية.
 * ═══════════════════════════════════════════════════════════════
 * الجرد والأذون موسومة بالفرع (BelongsToBranch) بلا Scope عالمي — شمولها
 * المتعمَّد لتحويلٍ بين فرعين. فمعرفة UUID وحده (تخميناً أو تسريباً) لا يجب
 * أن يمنح وصولاً لمن لا يملك الفرع أو المستودع العملياتي للمستند، رغم أنه
 * داخل مستأجره نفسه.
 *
 * تشغيل: php artisan test --filter=StocktakeStockPermitRecordAccessTest
 */
class StocktakeStockPermitRecordAccessTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /**
     * مستأجرٌ بفرعين، بكلٍّ منهما مخزنه الخاص ومنتجٌ برصيد مخزني، وأذون/جرد
     * جاهزان في كل فرع.
     *
     * @return array{
     *     tenant_id:string, owner_token:string,
     *     main_branch:string, other_branch:string,
     *     main_warehouse:string, other_warehouse:string,
     *     product:string,
     *     stocktake_main:string, stocktake_other:string,
     *     permit_main:string, permit_other:string,
     *     transfer_main_to_other:string,
     * }
     */
    private function twoBranchInventorySetup(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $token = $auth['token'];
        $mainBranch = $this->withToken($token)->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $otherBranch = $this->withToken($token)->postJson('/api/branches', ['name' => 'فرع آخر'])
            ->assertCreated()['data']['id'];

        $mainHeaders = ['X-Branch-Id' => $mainBranch];
        $otherHeaders = ['X-Branch-Id' => $otherBranch];

        $mainWarehouse = $this->withToken($token)->withHeaders($mainHeaders)->postJson('/api/warehouses', [
            'name' => 'مخزن رئيسي', 'code' => "{$slug}-W1", 'branch_id' => $mainBranch, 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $otherWarehouse = $this->withToken($token)->withHeaders($otherHeaders)->postJson('/api/warehouses', [
            'name' => 'مخزن آخر', 'code' => "{$slug}-W2", 'branch_id' => $otherBranch, 'is_active' => true,
        ])->assertCreated()['data']['id'];

        $product = $this->withToken($token)->postJson('/api/products', [
            'name' => 'إسمنت', 'sku' => "{$slug}-CEM", 'type' => 'good',
            'sale_price' => 20000, 'purchase_price' => 10000, 'track_inventory' => true,
        ])->assertCreated()['data']['id'];

        // رصيد ابتدائي في كل مخزن عبر إذن إضافة مرحّل.
        $permitMain = $this->withToken($token)->withHeaders($mainHeaders)->postJson('/api/stock-permits', [
            'type' => 'receipt', 'warehouse_id' => $mainWarehouse,
            'items' => [['product_id' => $product, 'quantity' => 100, 'unit_cost' => 10000]],
        ])->assertCreated()['data']['id'];
        $this->withToken($token)->withHeaders($mainHeaders)
            ->postJson("/api/stock-permits/{$permitMain}/post")->assertOk();

        $permitOther = $this->withToken($token)->withHeaders($otherHeaders)->postJson('/api/stock-permits', [
            'type' => 'receipt', 'warehouse_id' => $otherWarehouse,
            'items' => [['product_id' => $product, 'quantity' => 100, 'unit_cost' => 10000]],
        ])->assertCreated()['data']['id'];
        $this->withToken($token)->withHeaders($otherHeaders)
            ->postJson("/api/stock-permits/{$permitOther}/post")->assertOk();

        // إذن صرف مسودة في كل فرع (لاختبار show/post/destroy).
        $draftPermitMain = $this->withToken($token)->withHeaders($mainHeaders)->postJson('/api/stock-permits', [
            'type' => 'issue', 'warehouse_id' => $mainWarehouse,
            'items' => [['product_id' => $product, 'quantity' => 1]],
        ])->assertCreated()['data']['id'];
        $draftPermitOther = $this->withToken($token)->withHeaders($otherHeaders)->postJson('/api/stock-permits', [
            'type' => 'issue', 'warehouse_id' => $otherWarehouse,
            'items' => [['product_id' => $product, 'quantity' => 1]],
        ])->assertCreated()['data']['id'];

        // إذن تحويل من الرئيسي إلى الآخر.
        $transfer = $this->withToken($token)->withHeaders($mainHeaders)->postJson('/api/stock-permits', [
            'type' => 'transfer', 'warehouse_id' => $mainWarehouse, 'target_warehouse_id' => $otherWarehouse,
            'items' => [['product_id' => $product, 'quantity' => 1]],
        ])->assertCreated()['data']['id'];

        // جرد مسودة في كل فرع.
        $stocktakeMain = $this->withToken($token)->withHeaders($mainHeaders)->postJson('/api/stocktakes', [
            'warehouse_id' => $mainWarehouse,
        ])->assertCreated()['data']['id'];
        $stocktakeOther = $this->withToken($token)->withHeaders($otherHeaders)->postJson('/api/stocktakes', [
            'warehouse_id' => $otherWarehouse,
        ])->assertCreated()['data']['id'];

        return [
            'tenant_id' => $auth['tenant_id'], 'owner_token' => $token,
            'main_branch' => $mainBranch, 'other_branch' => $otherBranch,
            'main_warehouse' => $mainWarehouse, 'other_warehouse' => $otherWarehouse,
            'product' => $product,
            'stocktake_main' => $stocktakeMain, 'stocktake_other' => $stocktakeOther,
            'permit_main' => $draftPermitMain, 'permit_other' => $draftPermitOther,
            'transfer_main_to_other' => $transfer,
        ];
    }

    /** مستخدمٌ مقيَّد بفرع و/أو مستودعات معيَّنة. */
    private function restrictedTo(string $tenantId, string $email, array $branchIds = [], array $warehouseIds = []): string
    {
        app(TenantContext::class)->set($tenantId);
        $user = User::create([
            'tenant_id' => $tenantId, 'name' => 'مستخدم مقيَّد', 'email' => $email,
            'password' => 'password123', 'role' => 'admin',
        ]);
        if ($branchIds) {
            $user->branches()->sync($branchIds);
        }
        if ($warehouseIds) {
            $user->warehouses()->sync($warehouseIds);
        }

        return $user->createToken('api')->plainTextToken;
    }

    // ═══════════════════════════════════════════════════════════
    //  الجرد — same tenant, same allowed branch/warehouse → allowed
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_restricted_user_can_open_count_and_post_a_stocktake_in_their_own_branch(): void
    {
        $s = $this->twoBranchInventorySetup('stk-allow');
        $token = $this->restrictedTo($s['tenant_id'], 'stk-allow-user@test.local', [$s['main_branch']]);

        $this->withToken($token)->getJson("/api/stocktakes/{$s['stocktake_main']}")->assertOk();

        $this->withToken($token)->postJson("/api/stocktakes/{$s['stocktake_main']}/count", [
            'counts' => [['product_id' => $s['product'], 'counted_quantity' => 100]],
        ])->assertOk();

        $this->withToken($token)->postJson("/api/stocktakes/{$s['stocktake_main']}/post")->assertOk();
    }

    // ═══════════════════════════════════════════════════════════
    //  same tenant, different disallowed branch → denied
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_restricted_user_cannot_read_a_stocktake_from_a_disallowed_branch_by_id_alone(): void
    {
        $s = $this->twoBranchInventorySetup('stk-deny-branch');
        $token = $this->restrictedTo($s['tenant_id'], 'stk-deny-branch-user@test.local', [$s['main_branch']]);

        $this->withToken($token)->getJson("/api/stocktakes/{$s['stocktake_other']}")->assertNotFound();
    }

    /** @test */
    public function denied_count_post_and_destroy_on_a_disallowed_branch_stocktake_produce_no_mutation(): void
    {
        $s = $this->twoBranchInventorySetup('stk-deny-branch-mut');
        $token = $this->restrictedTo($s['tenant_id'], 'stk-deny-branch-mut-user@test.local', [$s['main_branch']]);

        $this->withToken($token)->postJson("/api/stocktakes/{$s['stocktake_other']}/count", [
            'counts' => [['product_id' => $s['product'], 'counted_quantity' => 1]],
        ])->assertNotFound();
        $this->withToken($token)->postJson("/api/stocktakes/{$s['stocktake_other']}/post")->assertNotFound();
        $this->withToken($token)->deleteJson("/api/stocktakes/{$s['stocktake_other']}")->assertNotFound();

        $fresh = Stocktake::withoutGlobalScopes()->findOrFail($s['stocktake_other']);
        $this->assertSame('draft', $fresh->status, 'المستند المرفوض بقي بلا أثر — لا حذف ولا ترحيل.');
        $this->assertNull($fresh->journal_entry_id);
    }

    // ═══════════════════════════════════════════════════════════
    //  same tenant, branch allowed but warehouse restricted → denied
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_branch_allowed_user_restricted_to_another_warehouse_is_still_denied(): void
    {
        $s = $this->twoBranchInventorySetup('stk-deny-warehouse');
        // المستخدم يملك الفرعين معاً (لا قيد فروع) لكنه مقيَّد بمستودع الفرع الآخر فقط.
        $token = $this->restrictedTo(
            $s['tenant_id'], 'stk-deny-warehouse-user@test.local', [], [$s['other_warehouse']]
        );

        $this->withToken($token)->getJson("/api/stocktakes/{$s['stocktake_main']}")->assertNotFound();
        $this->withToken($token)->getJson("/api/stocktakes/{$s['stocktake_other']}")->assertOk();
    }

    // ═══════════════════════════════════════════════════════════
    //  other tenant UUID → remains inaccessible
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_different_tenant_cannot_reach_the_stocktake_at_all(): void
    {
        $s = $this->twoBranchInventorySetup('stk-tenant-a');
        $otherTenant = $this->registerTenant('stk-tenant-b', 'owner@stk-tenant-b.test');

        $this->withToken($otherTenant['token'])->getJson("/api/stocktakes/{$s['stocktake_main']}")->assertNotFound();
    }

    // ═══════════════════════════════════════════════════════════
    //  branch=all with limited owned branches → cannot escape owned set
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function branch_all_for_a_restricted_user_still_excludes_stocktakes_outside_their_assignment(): void
    {
        $s = $this->twoBranchInventorySetup('stk-branch-all');
        $token = $this->restrictedTo($s['tenant_id'], 'stk-branch-all-user@test.local', [$s['main_branch']]);

        $ids = array_column(
            $this->withToken($token)->getJson('/api/stocktakes?branch=all')->assertOk()['data'],
            'id'
        );

        $this->assertContains($s['stocktake_main'], $ids);
        $this->assertNotContains($s['stocktake_other'], $ids, '?branch=all يوسّع داخل نطاق المستخدم لا خارجه.');
    }

    /** @test */
    public function the_stocktake_list_hides_documents_the_direct_show_would_reject(): void
    {
        $s = $this->twoBranchInventorySetup('stk-list-consistency');
        $token = $this->restrictedTo(
            $s['tenant_id'], 'stk-list-consistency-user@test.local', [], [$s['main_warehouse']]
        );

        $ids = array_column(
            $this->withToken($token)->getJson('/api/stocktakes?branch=all')->assertOk()['data'],
            'id'
        );

        $this->assertContains($s['stocktake_main'], $ids);
        $this->assertNotContains($s['stocktake_other'], $ids);
        $this->withToken($token)->getJson("/api/stocktakes/{$s['stocktake_other']}")->assertNotFound();
    }

    // ═══════════════════════════════════════════════════════════
    //  الأذون المخزنية — نفس المصفوفة + تحويل بطرفين
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_restricted_user_can_view_and_post_a_permit_in_their_own_branch(): void
    {
        $s = $this->twoBranchInventorySetup('perm-allow');
        $token = $this->restrictedTo($s['tenant_id'], 'perm-allow-user@test.local', [$s['main_branch']]);

        $this->withToken($token)->getJson("/api/stock-permits/{$s['permit_main']}")->assertOk();
        $this->withToken($token)->postJson("/api/stock-permits/{$s['permit_main']}/post")->assertOk();
    }

    /** @test */
    public function a_restricted_user_cannot_reach_a_permit_from_a_disallowed_branch_by_id_alone(): void
    {
        $s = $this->twoBranchInventorySetup('perm-deny-branch');
        $token = $this->restrictedTo($s['tenant_id'], 'perm-deny-branch-user@test.local', [$s['main_branch']]);

        $this->withToken($token)->getJson("/api/stock-permits/{$s['permit_other']}")->assertNotFound();
    }

    /** @test */
    public function denied_post_and_destroy_on_a_disallowed_permit_produce_no_stock_or_gl_effect(): void
    {
        $s = $this->twoBranchInventorySetup('perm-deny-mutation');
        $token = $this->restrictedTo($s['tenant_id'], 'perm-deny-mutation-user@test.local', [$s['main_branch']]);

        $movementsBefore = StockMovement::count();
        $entriesBefore = JournalEntry::count();

        $this->withToken($token)->postJson("/api/stock-permits/{$s['permit_other']}/post")->assertNotFound();
        $this->withToken($token)->deleteJson("/api/stock-permits/{$s['permit_other']}")->assertNotFound();

        $fresh = StockPermit::withoutGlobalScopes()->findOrFail($s['permit_other']);
        $this->assertSame('draft', $fresh->status, 'المستند المرفوض بقي بلا أثر — لا حذف ولا ترحيل.');
        $this->assertNull($fresh->journal_entry_id);
        $this->assertSame($movementsBefore, StockMovement::count(), 'لا حركة مخزون عند الرفض.');
        $this->assertSame($entriesBefore, JournalEntry::count(), 'لا قيد محاسبي عند الرفض.');
    }

    // ═══════════════════════════════════════════════════════════
    //  transfer source allowed / target denied → denied
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_transfer_permit_is_denied_when_the_target_warehouse_is_outside_the_scope(): void
    {
        $s = $this->twoBranchInventorySetup('perm-transfer-target-deny');
        $token = $this->restrictedTo(
            $s['tenant_id'], 'perm-transfer-target-deny-user@test.local', [], [$s['main_warehouse']]
        );

        $this->withToken($token)->getJson("/api/stock-permits/{$s['transfer_main_to_other']}")->assertNotFound();
        $this->withToken($token)->postJson("/api/stock-permits/{$s['transfer_main_to_other']}/post")->assertNotFound();
    }

    // ═══════════════════════════════════════════════════════════
    //  transfer target allowed / source denied → denied
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_transfer_permit_is_denied_when_the_source_warehouse_is_outside_the_scope(): void
    {
        $s = $this->twoBranchInventorySetup('perm-transfer-source-deny');
        $token = $this->restrictedTo(
            $s['tenant_id'], 'perm-transfer-source-deny-user@test.local', [], [$s['other_warehouse']]
        );

        $this->withToken($token)->getJson("/api/stock-permits/{$s['transfer_main_to_other']}")->assertNotFound();
        $this->withToken($token)->postJson("/api/stock-permits/{$s['transfer_main_to_other']}/post")->assertNotFound();
    }

    // ═══════════════════════════════════════════════════════════
    //  both transfer warehouses allowed → allowed (لا يُكسَر انحدار التحويل)
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_transfer_permit_is_allowed_when_both_warehouses_are_in_scope(): void
    {
        $s = $this->twoBranchInventorySetup('perm-transfer-both-allow');
        $token = $this->restrictedTo(
            $s['tenant_id'], 'perm-transfer-both-allow-user@test.local',
            [], [$s['main_warehouse'], $s['other_warehouse']]
        );

        $this->withToken($token)->getJson("/api/stock-permits/{$s['transfer_main_to_other']}")->assertOk();
        $this->withToken($token)->postJson("/api/stock-permits/{$s['transfer_main_to_other']}/post")->assertOk();
    }

    /** @test */
    public function an_unrestricted_user_retains_cross_branch_access_within_the_same_tenant(): void
    {
        $s = $this->twoBranchInventorySetup('stk-unrestricted');

        $this->withToken($s['owner_token'])->getJson("/api/stocktakes/{$s['stocktake_other']}")
            ->assertOk()->assertJsonPath('data.id', $s['stocktake_other']);
        $this->withToken($s['owner_token'])->getJson("/api/stock-permits/{$s['permit_other']}")
            ->assertOk()->assertJsonPath('data.id', $s['permit_other']);
    }

    /** @test */
    public function a_different_tenant_cannot_reach_the_permit_at_all(): void
    {
        $s = $this->twoBranchInventorySetup('perm-tenant-a');
        $otherTenant = $this->registerTenant('perm-tenant-b', 'owner@perm-tenant-b.test');

        $this->withToken($otherTenant['token'])->getJson("/api/stock-permits/{$s['permit_main']}")->assertNotFound();
    }
}
