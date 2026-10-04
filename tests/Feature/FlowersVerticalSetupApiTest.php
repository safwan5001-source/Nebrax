<?php

namespace Tests\Feature;

use App\Models\CommerceFacet;
use App\Models\CommerceFacetValue;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Support\Commerce\FlowersStarterCatalog;
use App\Support\Commerce\VerticalCapability;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * FLOWERS-H14 / ADR-25 — قائمة تهيئة ملف «الهدايا والورود» والقيم المبدئية.
 *
 * تشغيل: php artisan test --filter=FlowersVerticalSetupApiTest
 */
class FlowersVerticalSetupApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function path(string $id, string $suffix = ''): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/vertical-setup'.$suffix;
    }

    private function storefront(string $tenantId): Storefront
    {
        app(TenantContext::class)->set($tenantId);
        $channel = SalesChannel::query()->where('slug', 'web')->first()
            ?? SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefront = Storefront::create(['slug' => 'main', 'name' => 'المتجر', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        app(TenantContext::class)->forget();

        return $storefront;
    }

    /** @return array{auth: array, id: string} */
    private function flowersStore(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $store = $this->storefront($auth['tenant_id']);
        $this->withToken($auth['token'])
            ->putJson('/api/commerce/workspace/storefronts/'.$store->id, ['business_vertical' => 'flowers_gifts'])
            ->assertOk();

        return ['auth' => $auth, 'id' => $store->id];
    }

    private function facets(string $tenantId): array
    {
        app(TenantContext::class)->set($tenantId);
        $rows = CommerceFacet::query()->with('values')->orderBy('key')->get()->all();
        app(TenantContext::class)->forget();

        return $rows;
    }

    private function totalStarterValues(): int
    {
        return array_sum(array_map(fn ($f) => count($f['values']), FlowersStarterCatalog::facets()));
    }

    /** @test */
    public function a_general_store_has_no_checklist_and_cannot_apply_starters(): void
    {
        $auth = $this->registerTenant('vs-general', 'owner@vs-general.test');
        $store = $this->storefront($auth['tenant_id']);

        $this->withToken($auth['token'])->getJson($this->path($store->id))
            ->assertOk()->assertJsonPath('data.setup.vertical', 'general')->assertJsonPath('data.setup.items', []);

        $this->withToken($auth['token'])->postJson($this->path($store->id, '/starters'))->assertStatus(422);
        $this->withToken($auth['token'])->getJson($this->path($store->id, '/starters'))->assertStatus(422);
        $this->assertSame([], $this->facets($auth['tenant_id']));
    }

    /** @test */
    public function a_new_flowers_store_lists_every_recommended_capability_as_available_but_not_configured(): void
    {
        $ctx = $this->flowersStore('vs-fresh');

        $res = $this->withToken($ctx['auth']['token'])->getJson($this->path($ctx['id']))->assertOk();
        $items = $res->json('data.setup.items');

        $this->assertSame(array_map(fn ($c) => $c->value, \App\Support\Commerce\BusinessVertical::FlowersGifts->recommendedCapabilities()), array_column($items, 'key'));
        foreach ($items as $item) {
            $this->assertTrue($item['available'], $item['key']);
            $this->assertSame('not_configured', $item['state'], $item['key']);
            $this->assertSame(0, $item['count'], $item['key']);
            $this->assertNotEmpty($item['manage_in']);
        }
        $this->assertCount(count(VerticalCapability::cases()), $items);
    }

    /** @test */
    public function preview_writes_nothing_and_apply_adds_the_starters(): void
    {
        $ctx = $this->flowersStore('vs-apply');
        $token = $ctx['auth']['token'];

        $preview = $this->withToken($token)->getJson($this->path($ctx['id'], '/starters'))->assertOk();
        $this->assertSame($this->totalStarterValues(), $preview->json('data.starters.would_create'));
        $this->assertSame([], $this->facets($ctx['auth']['tenant_id']), 'preview must not write');

        $apply = $this->withToken($token)->postJson($this->path($ctx['id'], '/starters'))->assertOk();
        $this->assertSame($this->totalStarterValues(), $apply->json('data.starters.created'));

        $facets = $this->facets($ctx['auth']['tenant_id']);
        $this->assertSame(['occasion', 'recipient'], array_map(fn ($f) => $f->system_key, $facets));
        $this->assertSame(
            array_map(fn ($f) => count($f['values']), FlowersStarterCatalog::facets()),
            array_map(fn ($f) => $f->values->count(), $facets),
        );
        foreach ($facets as $facet) {
            $this->assertTrue($facet->is_active);
            foreach ($facet->values as $value) {
                $this->assertTrue($value->is_active);
                $this->assertNotNull($value->name_en);
            }
        }

        $status = $this->withToken($token)->getJson($this->path($ctx['id']))->assertOk()->json('data.setup.items');
        $byKey = array_column($status, null, 'key');
        $this->assertSame('configured', $byKey['occasions']['state']);
        $this->assertSame(12, $byKey['occasions']['count']);
        $this->assertSame('configured', $byKey['recipients']['state']);
        $this->assertSame('not_configured', $byKey['gift_message']['state'], 'starters never switch on a policy');
        $this->assertSame('not_configured', $byKey['delivery_scheduling']['state']);
    }

    /** @test */
    public function applying_twice_creates_nothing_the_second_time(): void
    {
        $ctx = $this->flowersStore('vs-idem');
        $token = $ctx['auth']['token'];

        $this->withToken($token)->postJson($this->path($ctx['id'], '/starters'))->assertOk();
        $before = array_map(fn ($f) => $f->values->pluck('id')->sort()->values()->all(), $this->facets($ctx['auth']['tenant_id']));

        $again = $this->withToken($token)->postJson($this->path($ctx['id'], '/starters'))->assertOk();
        $this->assertSame(0, $again->json('data.starters.created'));
        $this->assertSame($before, array_map(fn ($f) => $f->values->pluck('id')->sort()->values()->all(), $this->facets($ctx['auth']['tenant_id'])));
        $this->withToken($token)->getJson($this->path($ctx['id'], '/starters'))->assertOk()->assertJsonPath('data.starters.would_create', 0);
    }

    /** @test */
    public function merchant_edits_are_never_overwritten_reactivated_or_duplicated(): void
    {
        $ctx = $this->flowersStore('vs-keep');
        $tenantId = $ctx['auth']['tenant_id'];
        $token = $ctx['auth']['token'];

        // التاجر أنشأ بُعد المناسبة بنفسه، سمّاه، وأعاد تسمية قيمة وعطّل أخرى وأضاف قيمة خاصة.
        $facet = $this->withToken($token)->postJson('/api/commerce/workspace/facets', [
            'key' => 'occasions-mine', 'system_key' => 'occasion', 'name' => 'مناسباتنا', 'name_en' => 'Our occasions',
        ])->assertCreated()->json('data.facet');
        $fid = $facet['id'];
        $renamed = $this->withToken($token)->postJson("/api/commerce/workspace/facets/{$fid}/values", ['slug' => 'birthday', 'name' => 'عيد ميلاد سعيد', 'name_en' => 'Happy birthday'])->assertCreated()->json('data.value');
        $disabled = $this->withToken($token)->postJson("/api/commerce/workspace/facets/{$fid}/values", ['slug' => 'wedding', 'name' => 'زفاف', 'name_en' => 'Wedding', 'is_active' => false])->assertCreated()->json('data.value');
        // اسم مطابق بـslug مختلف: يجب ألا يتكرر.
        $this->withToken($token)->postJson("/api/commerce/workspace/facets/{$fid}/values", ['slug' => 'grad', 'name' => 'تخرّج', 'name_en' => 'Graduation'])->assertCreated();
        $this->withToken($token)->postJson("/api/commerce/workspace/facets/{$fid}/values", ['slug' => 'eid-special', 'name' => 'عرض العيد', 'name_en' => 'Eid special'])->assertCreated();

        $this->withToken($token)->postJson($this->path($ctx['id'], '/starters'))->assertOk();

        app(TenantContext::class)->set($tenantId);
        $occasion = CommerceFacet::query()->where('system_key', 'occasion')->with('values')->first();
        $this->assertSame($fid, $occasion->id);
        $this->assertSame('مناسباتنا', $occasion->name);
        $this->assertSame('occasions-mine', $occasion->key);

        $byId = $occasion->values->keyBy('id');
        $this->assertSame('عيد ميلاد سعيد', $byId[$renamed['id']]->name);
        $this->assertFalse($byId[$disabled['id']]->is_active, 'a disabled value must stay disabled');
        $this->assertSame(1, $occasion->values->where('slug', 'wedding')->count());
        $this->assertSame(0, $occasion->values->where('slug', 'graduation')->count(), 'graduation exists under another slug');
        $this->assertSame(1, $occasion->values->where('slug', 'eid-special')->count());
        // 12 مبدئية - birthday - wedding - تخرّج = 9 جديدة + 4 للتاجر.
        $this->assertSame(9 + 4, $occasion->values->count());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_plain_facet_that_holds_the_key_is_left_alone_and_reported_blocked(): void
    {
        $ctx = $this->flowersStore('vs-block');
        $token = $ctx['auth']['token'];

        $fid = $this->withToken($token)->postJson('/api/commerce/workspace/facets', ['key' => 'occasion', 'name' => 'أنواع'])
            ->assertCreated()->json('data.facet.id');

        $res = $this->withToken($token)->postJson($this->path($ctx['id'], '/starters'))->assertOk();
        $occasion = collect($res->json('data.starters.facets'))->firstWhere('system_key', 'occasion');
        $this->assertSame('blocked', $occasion['facet']);
        $this->assertSame([], $occasion['created_values']);
        // بُعد المُهدى إليه لم يتأثر.
        $recipient = collect($res->json('data.starters.facets'))->firstWhere('system_key', 'recipient');
        $this->assertCount(10, $recipient['created_values']);

        app(TenantContext::class)->set($ctx['auth']['tenant_id']);
        $plain = CommerceFacet::query()->find($fid);
        $this->assertNull($plain->system_key);
        $this->assertSame('أنواع', $plain->name);
        $this->assertSame(0, CommerceFacetValue::query()->where('commerce_facet_id', $fid)->count());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function switching_the_vertical_back_never_deletes_the_added_taxonomy(): void
    {
        $ctx = $this->flowersStore('vs-back');
        $token = $ctx['auth']['token'];
        $this->withToken($token)->postJson($this->path($ctx['id'], '/starters'))->assertOk();

        $this->withToken($token)->putJson('/api/commerce/workspace/storefronts/'.$ctx['id'], ['business_vertical' => 'general'])->assertOk();

        $facets = $this->facets($ctx['auth']['tenant_id']);
        $this->assertSame($this->totalStarterValues(), array_sum(array_map(fn ($f) => $f->values->count(), $facets)));
        $this->withToken($token)->getJson($this->path($ctx['id']))->assertOk()->assertJsonPath('data.setup.items', []);
    }

    /** @test */
    public function the_checklist_reflects_real_settings_not_a_stored_flag(): void
    {
        $ctx = $this->flowersStore('vs-real');
        $token = $ctx['auth']['token'];

        $this->withToken($token)->putJson('/api/commerce/workspace/storefronts/'.$ctx['id'].'/gift-settings', ['is_enabled' => true])->assertOk();
        $byKey = array_column($this->withToken($token)->getJson($this->path($ctx['id']))->json('data.setup.items'), null, 'key');
        $this->assertSame('configured', $byKey['gift_message']['state']);

        // مفعّلة بلا نوافذ ≠ مهيَّأة: لا يمكن للمتسوق اختيار شيء.
        $this->withToken($token)->putJson('/api/commerce/workspace/storefronts/'.$ctx['id'].'/delivery-schedule/settings', ['is_enabled' => true])->assertOk();
        $byKey = array_column($this->withToken($token)->getJson($this->path($ctx['id']))->json('data.setup.items'), null, 'key');
        $this->assertSame('not_configured', $byKey['delivery_scheduling']['state']);

        // نافذة فعلية ⇒ الجدولة مهيَّأة؛ لكن «يصل اليوم» يحتاج مخزن تنفيذ للقناة أيضاً (وإلا الوعد not_configured).
        $this->withToken($token)->putJson('/api/commerce/workspace/storefronts/'.$ctx['id'].'/delivery-schedule/slots', ['slots' => [
            ['method' => 'delivery', 'label' => 'مساءً', 'start_time' => '16:00', 'end_time' => '20:00'],
        ]])->assertOk();
        $byKey = array_column($this->withToken($token)->getJson($this->path($ctx['id']))->json('data.setup.items'), null, 'key');
        $this->assertSame('configured', $byKey['delivery_scheduling']['state']);
        $this->assertSame('not_configured', $byKey['same_day_delivery']['state']);

        app(TenantContext::class)->set($ctx['auth']['tenant_id']);
        $warehouse = \App\Models\Warehouse::create(['name' => 'مخزن', 'code' => 'VS-W1', 'is_default' => true]);
        app(\App\Services\Commerce\FulfillmentPolicyService::class)->setFixedWarehouse(Storefront::query()->findOrFail($ctx['id'])->sales_channel_id, $warehouse->id);
        app(TenantContext::class)->forget();
        $byKey = array_column($this->withToken($token)->getJson($this->path($ctx['id']))->json('data.setup.items'), null, 'key');
        $this->assertSame('configured', $byKey['same_day_delivery']['state']);

        $this->withToken($token)->putJson('/api/commerce/workspace/storefronts/'.$ctx['id'].'/gift-settings', ['is_enabled' => false])->assertOk();
        $byKey = array_column($this->withToken($token)->getJson($this->path($ctx['id']))->json('data.setup.items'), null, 'key');
        $this->assertSame('not_configured', $byKey['gift_message']['state']);
    }

    /** @test */
    public function another_tenants_store_is_a_404_and_roles_without_commerce_manage_are_refused(): void
    {
        $ctx = $this->flowersStore('vs-iso');
        $other = $this->registerTenant('vs-other', 'owner@vs-other.test');

        foreach (['getJson' => '', 'postJson' => '/starters'] as $method => $suffix) {
            $this->withToken($other['token'])->{$method}($this->path($ctx['id'], $suffix))->assertNotFound();
        }
        $this->assertSame([], $this->facets($ctx['auth']['tenant_id']));

        $staff = $this->tokenForRole($ctx['auth']['tenant_id'], 'staff', 'staff@vs-iso.test');
        $accountant = $this->tokenForRole($ctx['auth']['tenant_id'], 'accountant', 'acc@vs-iso.test');
        $selfService = $this->tokenForRole($ctx['auth']['tenant_id'], 'self_service', 'ss@vs-iso.test');
        foreach ([$staff, $accountant, $selfService] as $token) {
            $this->withToken($token)->getJson($this->path($ctx['id']))->assertForbidden();
            $this->withToken($token)->postJson($this->path($ctx['id'], '/starters'))->assertForbidden();
        }
        $this->assertSame([], $this->facets($ctx['auth']['tenant_id']));
    }

    /** @test */
    public function an_unauthenticated_call_is_rejected(): void
    {
        $this->getJson($this->path('00000000-0000-0000-0000-000000000000'))->assertUnauthorized();
    }
}
