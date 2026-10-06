<?php

namespace Tests\Feature;

use App\Models\FulfillmentPolicy;
use App\Models\JournalEntry;
use App\Models\SalesChannel;
use App\Models\StockMovement;
use App\Models\Storefront;
use App\Models\Warehouse;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * FLOWERS-H2-5 / ADR-27 — مخزن تنفيذ قناة المتجر عبر واجهة الإدارة (طبقة رفيعة فوق FulfillmentPolicyService).
 *
 * تشغيل: php artisan test --filter=CommerceFulfillmentAdminApiTest
 */
class CommerceFulfillmentAdminApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function url(string $storefrontId): string
    {
        return '/api/commerce/workspace/storefronts/'.$storefrontId.'/fulfillment';
    }

    /** @return array{auth: array, store: Storefront} */
    private function tenantWithStore(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        app(TenantContext::class)->set($auth['tenant_id']);
        $channel = SalesChannel::query()->where('slug', 'web')->first()
            ?? SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $store = Storefront::create(['slug' => 'main', 'name' => 'المتجر', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        app(TenantContext::class)->forget();

        return ['auth' => $auth, 'store' => $store];
    }

    private function warehouse(string $tenantId, string $code, array $extra = []): Warehouse
    {
        app(TenantContext::class)->set($tenantId);
        $warehouse = Warehouse::create(['name' => "مخزن {$code}", 'code' => $code] + $extra);
        app(TenantContext::class)->forget();

        return $warehouse;
    }

    private function policyCount(string $tenantId): int
    {
        app(TenantContext::class)->set($tenantId);
        $count = FulfillmentPolicy::query()->count();
        app(TenantContext::class)->forget();

        return $count;
    }

    /** @test */
    public function an_unassigned_channel_reports_no_warehouse_and_lists_only_own_tenant_warehouses(): void
    {
        $a = $this->tenantWithStore('ff-a');
        $b = $this->tenantWithStore('ff-b');
        $mine = $this->warehouse($a['auth']['tenant_id'], 'FF-1');
        $foreign = $this->warehouse($b['auth']['tenant_id'], 'FF-OTHER');

        $res = $this->withToken($a['auth']['token'])->getJson($this->url($a['store']->id))->assertOk();

        $this->assertNull($res->json('data.fulfillment.warehouse'));
        $ids = array_column($res->json('data.warehouses'), 'id');
        $this->assertContains($mine->id, $ids);
        $this->assertNotContains($foreign->id, $ids, 'a foreign tenant warehouse must never be listed');
        $this->assertSame(0, $this->policyCount($a['auth']['tenant_id']), 'reading must not create a policy');
    }

    /** @test */
    public function assigning_writes_the_existing_fulfillment_policy_and_replacing_keeps_a_single_row(): void
    {
        $a = $this->tenantWithStore('ff-assign');
        $first = $this->warehouse($a['auth']['tenant_id'], 'FF-1');
        $second = $this->warehouse($a['auth']['tenant_id'], 'FF-2');
        $token = $a['auth']['token'];

        $this->withToken($token)->putJson($this->url($a['store']->id), ['warehouse_id' => $first->id])
            ->assertOk()->assertJsonPath('data.fulfillment.warehouse.id', $first->id)->assertJsonPath('data.fulfillment.warehouse.code', 'FF-1');
        $this->withToken($token)->putJson($this->url($a['store']->id), ['warehouse_id' => $second->id])
            ->assertOk()->assertJsonPath('data.fulfillment.warehouse.id', $second->id);

        $this->assertSame(1, $this->policyCount($a['auth']['tenant_id']));
        app(TenantContext::class)->set($a['auth']['tenant_id']);
        $this->assertSame($second->id, app(FulfillmentPolicyService::class)->resolveWarehouseFor($a['store']->sales_channel_id)->id);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function it_refuses_missing_malformed_unknown_and_inactive_warehouses_without_writing(): void
    {
        $a = $this->tenantWithStore('ff-invalid');
        $inactive = $this->warehouse($a['auth']['tenant_id'], 'FF-OFF', ['is_active' => false]);
        $token = $a['auth']['token'];
        $url = $this->url($a['store']->id);

        $this->withToken($token)->putJson($url, [])->assertStatus(422);
        $this->withToken($token)->putJson($url, ['warehouse_id' => 'not-a-uuid'])->assertStatus(422);
        $this->withToken($token)->putJson($url, ['warehouse_id' => '00000000-0000-4000-8000-000000000000'])->assertStatus(422);
        $this->withToken($token)->putJson($url, ['warehouse_id' => $inactive->id])->assertStatus(422);

        $this->assertSame(0, $this->policyCount($a['auth']['tenant_id']));
    }

    /** @test */
    public function tenant_isolation_foreign_stores_and_warehouses_are_not_revealed_or_usable(): void
    {
        $a = $this->tenantWithStore('ff-iso-a');
        $b = $this->tenantWithStore('ff-iso-b');
        $foreignWarehouse = $this->warehouse($b['auth']['tenant_id'], 'FF-B1');

        // متجر مستأجرٍ آخر ⇒ 404 للقراءة والكتابة.
        $this->withToken($a['auth']['token'])->getJson($this->url($b['store']->id))->assertNotFound();
        $this->withToken($a['auth']['token'])->putJson($this->url($b['store']->id), ['warehouse_id' => $foreignWarehouse->id])->assertNotFound();

        // مخزن مستأجرٍ آخر على متجري ⇒ نفس رفض «غير موجود» ولا سياسة تُكتب لأيٍّ منهما.
        $this->withToken($a['auth']['token'])->putJson($this->url($a['store']->id), ['warehouse_id' => $foreignWarehouse->id])
            ->assertStatus(422)->assertJsonPath('message', 'المخزن غير موجود.');
        $this->assertSame(0, $this->policyCount($a['auth']['tenant_id']));
        $this->assertSame(0, $this->policyCount($b['auth']['tenant_id']));
    }

    /** @test */
    public function it_requires_commerce_manage_for_reading_and_writing(): void
    {
        $a = $this->tenantWithStore('ff-rbac');
        $warehouse = $this->warehouse($a['auth']['tenant_id'], 'FF-1');
        $staff = $this->tokenForRole($a['auth']['tenant_id'], 'staff', 'staff@ff-rbac.test');

        $this->withToken($staff)->getJson($this->url($a['store']->id))->assertForbidden();
        $this->withToken($staff)->putJson($this->url($a['store']->id), ['warehouse_id' => $warehouse->id])->assertForbidden();
        $this->flushHeaders();
        $this->getJson($this->url($a['store']->id))->assertUnauthorized();
        $this->assertSame(0, $this->policyCount($a['auth']['tenant_id']));
    }

    /** @test */
    public function assigning_a_warehouse_has_no_accounting_or_stock_effect(): void
    {
        $a = $this->tenantWithStore('ff-noeffect');
        $warehouse = $this->warehouse($a['auth']['tenant_id'], 'FF-1');
        app(TenantContext::class)->set($a['auth']['tenant_id']);
        $journals = JournalEntry::query()->count();
        $movements = StockMovement::query()->count();
        app(TenantContext::class)->forget();

        $this->withToken($a['auth']['token'])->putJson($this->url($a['store']->id), ['warehouse_id' => $warehouse->id])->assertOk();

        app(TenantContext::class)->set($a['auth']['tenant_id']);
        $this->assertSame($journals, JournalEntry::query()->count());
        $this->assertSame($movements, StockMovement::query()->count());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function the_setup_checklist_marks_same_day_configured_only_after_the_warehouse_is_assigned(): void
    {
        $a = $this->tenantWithStore('ff-setup');
        $token = $a['auth']['token'];
        $id = $a['store']->id;
        $warehouse = $this->warehouse($a['auth']['tenant_id'], 'FF-1');
        $this->withToken($token)->putJson('/api/commerce/workspace/storefronts/'.$id, ['business_vertical' => 'flowers_gifts'])->assertOk();
        $this->withToken($token)->putJson('/api/commerce/workspace/storefronts/'.$id.'/delivery-schedule/settings', ['is_enabled' => true])->assertOk();
        $this->withToken($token)->putJson('/api/commerce/workspace/storefronts/'.$id.'/delivery-schedule/slots', ['slots' => [
            ['method' => 'delivery', 'label' => 'صباحاً', 'start_time' => '09:00', 'end_time' => '12:00'],
        ]])->assertOk();

        $state = fn () => collect($this->withToken($token)->getJson('/api/commerce/workspace/storefronts/'.$id.'/vertical-setup')->json('data.setup.items'))
            ->firstWhere('key', 'same_day_delivery')['state'];

        $this->assertSame('not_configured', $state());
        $this->withToken($token)->putJson($this->url($id), ['warehouse_id' => $warehouse->id])->assertOk();
        $this->assertSame('configured', $state());
    }
}
