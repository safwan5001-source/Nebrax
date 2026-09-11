<?php

namespace Tests\Feature;

use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\StockMovement;
use App\Models\Warehouse;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class InventoryWorkspaceTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function seedWorkspace(): array
    {
        $auth = $this->registerTenant('ws-inv', 'owner@ws-inv.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $branchMain = $this->withToken($auth['token'])->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $branchOther = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع ممنوع'])->assertCreated()['data']['id'];
        $main = Warehouse::create(['name' => 'المخزن الرئيسي', 'code' => 'WH-MAIN', 'branch_id' => $branchMain, 'is_default' => true]);
        $other = Warehouse::create(['name' => 'مخزن الفرع الثاني', 'code' => 'WH-OTHER', 'branch_id' => $branchOther]);
        $cement = Product::create(['name' => 'إسمنت', 'type' => 'good', 'sku' => 'CEM-1', 'unit' => 'كيس', 'track_inventory' => true, 'quantity_on_hand' => 40, 'avg_cost' => 2500, 'reorder_level' => 10]);
        $steel = Product::create(['name' => 'حديد', 'type' => 'good', 'sku' => 'STL-1', 'unit' => 'طن', 'track_inventory' => true, 'quantity_on_hand' => 0, 'avg_cost' => 80000, 'reorder_level' => 0]);
        Product::create(['name' => 'خدمة استشارية', 'type' => 'service', 'track_inventory' => false, 'avg_cost' => 0]);
        ProductWarehouseStock::create(['product_id' => $cement->id, 'warehouse_id' => $main->id, 'quantity' => 8]);
        ProductWarehouseStock::create(['product_id' => $cement->id, 'warehouse_id' => $other->id, 'quantity' => 32]);
        ProductWarehouseStock::create(['product_id' => $steel->id, 'warehouse_id' => $main->id, 'quantity' => 0]);
        ProductWarehouseStock::create(['product_id' => $steel->id, 'warehouse_id' => $other->id, 'quantity' => -2]);
        return compact('auth') + ['token' => $auth['token'], 'tenant_id' => $auth['tenant_id'], 'product' => $cement, 'main' => $main, 'other' => $other, 'branch_main' => $branchMain, 'branch_other' => $branchOther];
    }

    public function test_it_lists_product_warehouse_rows_and_skips_untracked(): void
    {
        $fx = $this->seedWorkspace();
        $res = $this->withToken($fx['token'])->getJson('/api/inventory/workspace?per_page=10&sort=name')->assertOk();
        $this->assertSame(4, $res['meta']['total']);
        $this->assertTrue($res['meta']['cost_visible']);
        $this->assertNotContains('خدمة استشارية', array_column($res['data'], 'name'));
        $row = collect($res['data'])->first(fn ($r) => $r['sku'] === 'CEM-1' && $r['warehouse_id'] === $fx['main']->id);
        $this->assertSame(8, $row['quantity_on_hand']);
        $this->assertSame('low', $row['stock_state']);
        $this->assertSame('25.00', $row['avg_cost']);
        $this->assertSame('200.00', $row['stock_value']);
    }

    public function test_it_filters_by_warehouse_search_and_stock_state(): void
    {
        $fx = $this->seedWorkspace();
        $this->withToken($fx['token'])->getJson('/api/inventory/workspace?warehouse_id='.$fx['main']->id)->assertOk()->assertJsonPath('meta.total', 2);
        $this->assertSame(2, $this->withToken($fx['token'])->getJson('/api/inventory/workspace?search='.urlencode('إسمنت'))->assertOk()['meta']['total']);
        $neg = $this->withToken($fx['token'])->getJson('/api/inventory/workspace?stock_state=negative')->assertOk();
        $this->assertSame(1, $neg['meta']['total']);
        $this->assertSame(-2, $neg['data'][0]['quantity_on_hand']);
    }

    public function test_staff_without_view_cost_cannot_see_or_sort_cost(): void
    {
        $fx = $this->seedWorkspace();
        $staff = $this->tokenForRole($fx['tenant_id'], 'staff', 'staff@ws-inv.test');
        $res = $this->withToken($staff)->getJson('/api/inventory/workspace')->assertOk();
        $this->assertFalse($res['meta']['cost_visible']);
        $this->assertNull($res['data'][0]['avg_cost']);
        $this->assertNull($res['data'][0]['stock_value']);
        $this->withToken($staff)->getJson('/api/inventory/workspace?sort=-avg_cost')->assertForbidden();
    }

    public function test_restricted_user_cannot_see_another_warehouse(): void
    {
        $fx = $this->seedWorkspace();
        $this->withToken($fx['token'])->postJson('/api/users', [
            'name' => 'موظف', 'email' => 'wh@ws-inv.test', 'password' => 'password123', 'role' => 'staff',
            'branch_ids' => [$fx['branch_main']], 'warehouse_ids' => [$fx['main']->id],
        ])->assertCreated();
        $token = $this->postJson('/api/login', ['email' => 'wh@ws-inv.test', 'password' => 'password123'])->assertOk()['token'];
        $res = $this->withToken($token)->getJson('/api/inventory/workspace')->assertOk();
        $this->assertSame([$fx['main']->id], array_values(array_unique(array_column($res['data'], 'warehouse_id'))));
        $forced = $this->withToken($token)->getJson('/api/inventory/workspace?warehouse_id='.$fx['other']->id)->assertOk();
        $this->assertNotContains($fx['other']->id, array_column($forced['data'], 'warehouse_id'));
    }

    public function test_workspace_is_tenant_isolated_and_read_only(): void
    {
        $fx = $this->seedWorkspace();
        ['token' => $other] = $this->registerTenant('ws-other', 'owner@ws-other.test');
        $this->withToken($other)->getJson('/api/inventory/workspace')->assertOk()->assertJsonPath('meta.total', 0);
        $self = $this->tokenForRole($fx['tenant_id'], 'self_service', 'ss@ws-inv.test');
        $this->withToken($self)->getJson('/api/inventory/workspace')->assertForbidden();
        $movements = StockMovement::count();
        $journals = JournalEntry::count();
        $sum = (int) ProductWarehouseStock::sum('quantity');
        $this->withToken($fx['token'])->getJson('/api/inventory/workspace')->assertOk();
        $this->assertSame($movements, StockMovement::count());
        $this->assertSame($journals, JournalEntry::count());
        $this->assertSame($sum, (int) ProductWarehouseStock::sum('quantity'));
    }
}
