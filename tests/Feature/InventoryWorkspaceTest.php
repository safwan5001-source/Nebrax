<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\ProductCategory;
use App\Models\ProductWarehouseStock;
use App\Models\StockMovement;
use App\Models\User;
use App\Models\Warehouse;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * PR-INV-WS-1 — مساحة عمل المخزون. قراءة فقط.
 * تشغيل: php artisan test --filter=InventoryWorkspaceTest
 */
class InventoryWorkspaceTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private string $token;
    private string $tenantId;
    private Branch $branchA;
    private Branch $branchB;
    private Warehouse $warehouseA;
    private Warehouse $warehouseB;
    private ProductCategory $category;
    private Product $cement;
    private Product $rebar;

    protected function setUp(): void
    {
        parent::setUp();

        $auth = $this->registerTenant('inv-ws', 'owner@inv-ws.test');
        $this->token = $auth['token'];
        $this->tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);

        $this->branchA = Branch::create(['tenant_id' => $this->tenantId, 'code' => 'WS-A', 'name' => 'فرع ألفا']);
        $this->branchB = Branch::create(['tenant_id' => $this->tenantId, 'code' => 'WS-B', 'name' => 'فرع بيتا']);
        $this->warehouseA = Warehouse::create(['tenant_id' => $this->tenantId, 'branch_id' => $this->branchA->id, 'code' => 'WHA', 'name' => 'مخزن ألفا']);
        $this->warehouseB = Warehouse::create(['tenant_id' => $this->tenantId, 'branch_id' => $this->branchB->id, 'code' => 'WHB', 'name' => 'مخزن بيتا']);
        $this->category = ProductCategory::create(['tenant_id' => $this->tenantId, 'name' => 'مواد بناء']);
        $this->cement = Product::create([
            'tenant_id' => $this->tenantId, 'name' => 'إسمنت مقاوم', 'sku' => 'CEM-01', 'unit' => 'كيس',
            'type' => 'good', 'track_inventory' => true, 'category_id' => $this->category->id,
            'quantity_on_hand' => 12, 'avg_cost' => 2500, 'reorder_level' => 5,
        ]);
        $this->rebar = Product::create([
            'tenant_id' => $this->tenantId, 'name' => 'حديد تسليح', 'sku' => 'REB-01', 'unit' => 'طن',
            'type' => 'good', 'track_inventory' => true, 'quantity_on_hand' => 0, 'avg_cost' => 80000,
        ]);
        Product::create([
            'tenant_id' => $this->tenantId, 'name' => 'تركيب', 'sku' => 'SRV-01', 'type' => 'service', 'track_inventory' => false,
        ]);
        ProductWarehouseStock::create(['tenant_id' => $this->tenantId, 'product_id' => $this->cement->id, 'warehouse_id' => $this->warehouseA->id, 'quantity' => 10]);
        ProductWarehouseStock::create(['tenant_id' => $this->tenantId, 'product_id' => $this->cement->id, 'warehouse_id' => $this->warehouseB->id, 'quantity' => 2]);
        ProductWarehouseStock::create(['tenant_id' => $this->tenantId, 'product_id' => $this->rebar->id, 'warehouse_id' => $this->warehouseA->id, 'quantity' => 0]);
    }

    private function userToken(string $role, string $email): string
    {
        app(TenantContext::class)->set($this->tenantId);

        $user = User::create([
            'tenant_id' => $this->tenantId,
            'name' => $role,
            'email' => $email,
            'password' => 'password123',
            'role' => $role,
            'is_active' => true,
        ]);

        return $user->createToken('api')->plainTextToken;
    }

    /** @test */
    public function it_lists_product_warehouse_rows_with_server_pagination(): void
    {
        $res = $this->withToken($this->token)->getJson('/api/inventory?view=workspace&per_page=10&page=1')->assertOk();
        $this->assertCount(3, $res['data']);
        $this->assertSame(3, $res['meta']['total']);
        $this->assertTrue($res['meta']['can_view_cost']);
        $this->assertSame(12, $res['meta']['total_quantity']);
        $this->assertSame('250.00', $res['meta']['total_value']);
        $ids = array_column($res['data'], 'id');
        $this->assertContains($this->cement->id.':'.$this->warehouseA->id, $ids);
        $first = collect($res['data'])->firstWhere('warehouse_id', $this->warehouseA->id);
        $this->assertSame('إسمنت مقاوم', $first['name']);
        $this->assertSame(10, $first['quantity']);
        $this->assertSame('25.00', $first['avg_cost']);
        $this->assertSame('250.00', $first['stock_value']);
    }

    /** @test */
    public function it_paginates_without_loading_the_full_set_in_data(): void
    {
        $page = $this->withToken($this->token)->getJson('/api/inventory?view=workspace&per_page=1&page=2')->assertOk();
        $this->assertCount(1, $page['data']);
        $this->assertSame(3, $page['meta']['total']);
        $this->assertSame(2, $page['meta']['current_page']);
        $this->assertSame(3, $page['meta']['last_page']);
    }

    /** @test */
    public function it_filters_by_search_warehouse_branch_category_and_stock_state(): void
    {
        $this->withToken($this->token)->getJson('/api/inventory?view=workspace&search=حديد')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.sku', 'REB-01');
        $this->withToken($this->token)->getJson('/api/inventory?view=workspace&warehouse_id='.$this->warehouseB->id)->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.warehouse_id', $this->warehouseB->id);
        $this->withToken($this->token)->getJson('/api/inventory?view=workspace&branch_id='.$this->branchB->id)->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.branch_id', $this->branchB->id);
        $this->withToken($this->token)->getJson('/api/inventory?view=workspace&category_id='.$this->category->id)->assertOk()->assertJsonCount(2, 'data');
        $this->withToken($this->token)->getJson('/api/inventory?view=workspace&stock_state=out')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.stock_state', 'out');
        $this->withToken($this->token)->getJson('/api/inventory?view=workspace&stock_state=low')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.warehouse_id', $this->warehouseB->id);
        $this->withToken($this->token)->getJson('/api/inventory?view=workspace&stock_state=in_stock')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.quantity', 10);
    }

    /** @test */
    public function it_marks_negative_quantity_as_negative_state(): void
    {
        ProductWarehouseStock::where('product_id', $this->rebar->id)->where('warehouse_id', $this->warehouseA->id)->update(['quantity' => -3]);
        $this->withToken($this->token)->getJson('/api/inventory?view=workspace&stock_state=negative')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.quantity', -3);
    }

    /** @test */
    public function staff_without_view_cost_does_not_see_cost_or_value(): void
    {
        $staff = $this->userToken('staff', 'staff@inv-ws.test');
        $res = $this->withToken($staff)->getJson('/api/inventory?view=workspace')->assertOk();
        $this->assertFalse($res['meta']['can_view_cost']);
        $this->assertNull($res['meta']['total_value']);
        $this->assertNull($res['data'][0]['avg_cost']);
        $this->assertNull($res['data'][0]['stock_value']);
        $this->withToken($staff)->getJson('/api/inventory?view=workspace&sort=avg_cost')->assertForbidden();
        $this->withToken($staff)->getJson('/api/inventory?view=workspace&sort=-stock_value')->assertForbidden();
        $this->withToken($staff)->getJson('/api/inventory?view=workspace&sort=name')->assertOk();
    }

    /** @test */
    public function owner_can_sort_by_cost_fields(): void
    {
        $this->withToken($this->token)->getJson('/api/inventory?view=workspace&sort=-stock_value')->assertOk()->assertJsonPath('data.0.sku', 'CEM-01');
    }

    /** @test */
    public function warehouse_scope_hides_unassigned_warehouses(): void
    {
        $this->withToken($this->token)->postJson('/api/users', [
            'name' => 'أمين مخزن', 'email' => 'wh@inv-ws.test', 'password' => 'password123',
            'role' => 'admin', 'warehouse_ids' => [$this->warehouseA->id],
        ])->assertCreated();
        $token = $this->postJson('/api/login', ['email' => 'wh@inv-ws.test', 'password' => 'password123'])->assertOk()['token'];
        $res = $this->withToken($token)->getJson('/api/inventory?view=workspace')->assertOk();
        $this->assertSame([$this->warehouseA->id], array_values(array_unique(array_column($res['data'], 'warehouse_id'))));
        $forced = $this->withToken($token)->getJson('/api/inventory?view=workspace&warehouse_id='.$this->warehouseB->id)->assertOk();
        $this->assertNotContains($this->warehouseB->id, array_column($forced['data'], 'warehouse_id'));
    }

    /** @test */
    public function branch_scope_hides_other_branch_warehouses(): void
    {
        $this->withToken($this->token)->postJson('/api/users', [
            'name' => 'موظف فرع', 'email' => 'br@inv-ws.test', 'password' => 'password123',
            'role' => 'admin', 'branch_ids' => [$this->branchA->id],
        ])->assertCreated();
        $token = $this->postJson('/api/login', ['email' => 'br@inv-ws.test', 'password' => 'password123'])->assertOk()['token'];
        $res = $this->withToken($token)->getJson('/api/inventory?view=workspace')->assertOk();
        $this->assertNotContains($this->warehouseB->id, array_column($res['data'], 'warehouse_id'));
        $this->assertContains($this->warehouseA->id, array_column($res['data'], 'warehouse_id'));
    }

    /** @test */
    public function workspace_is_tenant_isolated(): void
    {
        $other = $this->registerTenant('inv-ws-b', 'owner@inv-ws-b.test');
        $this->withToken($other['token'])->getJson('/api/inventory?view=workspace')->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($other['token'])->getJson('/api/inventory?view=workspace&warehouse_id='.$this->warehouseA->id)->assertOk()->assertJsonCount(0, 'data');
    }

    /** @test */
    public function unauthenticated_and_unpermitted_users_are_rejected(): void
    {
        $this->getJson('/api/inventory?view=workspace')->assertUnauthorized();
        $self = $this->userToken('self_service', 'ss@inv-ws.test');
        $this->withToken($self)->getJson('/api/inventory?view=workspace')->assertForbidden();
    }

    /** @test */
    public function workspace_quantities_match_warehouse_report_for_the_same_scope(): void
    {
        $report = $this->withToken($this->token)->getJson('/api/reports/inventory?view=warehouses')->assertOk();
        $workspace = $this->withToken($this->token)->getJson('/api/inventory?view=workspace&per_page=100')->assertOk();

        $reportPairs = collect($report['data'])
            ->map(fn (array $row) => $row['warehouse_id'].'|'.$row['sku'].'|'.$row['quantity'])
            ->sort()
            ->values()
            ->all();
        $workspacePairs = collect($workspace['data'])
            ->map(fn (array $row) => $row['warehouse_id'].'|'.$row['sku'].'|'.$row['quantity'])
            ->sort()
            ->values()
            ->all();

        $this->assertSame($reportPairs, $workspacePairs);
        $this->assertNotSame([], $reportPairs);
    }

    /** @test */
    public function the_endpoint_does_not_mutate_stock_movements_or_journals(): void
    {
        $stockBefore = ProductWarehouseStock::query()->orderBy('id')->get(['id', 'quantity', 'revision'])->toArray();
        $movementsBefore = StockMovement::count();
        $journalsBefore = JournalEntry::count();
        $qtyBefore = $this->cement->fresh()->quantity_on_hand;
        $avgBefore = $this->cement->fresh()->avg_cost;
        $this->withToken($this->token)->getJson('/api/inventory?view=workspace')->assertOk();
        $this->withToken($this->token)->getJson('/api/inventory?view=workspace&stock_state=low&sort=-quantity')->assertOk();
        $this->assertSame($stockBefore, ProductWarehouseStock::query()->orderBy('id')->get(['id', 'quantity', 'revision'])->toArray());
        $this->assertSame($movementsBefore, StockMovement::count());
        $this->assertSame($journalsBefore, JournalEntry::count());
        $this->assertSame($qtyBefore, $this->cement->fresh()->quantity_on_hand);
        $this->assertSame($avgBefore, $this->cement->fresh()->avg_cost);
    }
}
