<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\FuelStationConfigurationEvent;
use App\Models\FuelStationProductPrice;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\ProductUnitPrice;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\UnitTemplate;
use App\Models\UnitTemplateUnit;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\EntitlementGrantService;
use App\Services\FuelStationProductPriceService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * #2011 — إدارة أسعار الوقود: الإضافة الرسمية، الاستبدال الصريح، التكرار، النطاق، واقتراح بطاقة المنتج (قراءة فقط ثم حفظ بإقرار).
 * بيانات اختبار اصطناعية معزولة فقط؛ لا بيع ولا ترحيل مالي.
 */
class FuelPriceManagementApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const BASE = '/api/fuel-stations';

    /** @test */
    public function only_holders_of_price_manage_can_write_or_read_suggestions(): void
    {
        $f = $this->fixture();

        $this->withToken($f['viewer_token'])->postJson(self::BASE . '/prices', $this->body($f))->assertForbidden();
        $this->withToken($f['viewer_token'])->getJson(self::BASE . '/prices/suggestions?station_id=' . $f['a']->id)->assertForbidden();
        $this->assertSame(0, FuelStationProductPrice::count());

        $this->withToken($f['owner_token'])->postJson(self::BASE . '/prices', $this->body($f))->assertCreated();
        $this->withToken($f['manager_token'])->postJson(self::BASE . '/prices', $this->body($f, ['fuel_station_id' => $f['a2']->id]))->assertCreated();
    }

    /** @test */
    public function station_and_organization_scope_are_enforced_by_the_server(): void
    {
        $f = $this->fixture();
        $token = $f['branch_manager_token']; // مقيَّد بفرع أ

        $this->withToken($token)->postJson(self::BASE . '/prices', $this->body($f, ['fuel_station_id' => $f['b']->id]))->assertNotFound();
        $this->withToken($token)->postJson(self::BASE . '/prices', $this->body($f, ['fuel_station_id' => null]))->assertForbidden(); // سعر المؤسسة
        $this->withToken($token)->getJson(self::BASE . '/prices/suggestions')->assertForbidden();
        $this->withToken($token)->getJson(self::BASE . '/prices/suggestions?station_id=' . $f['b']->id)->assertNotFound();
        $this->assertSame(0, FuelStationProductPrice::count());

        $this->withToken($token)->postJson(self::BASE . '/prices', $this->body($f, ['fuel_station_id' => $f['a']->id]))->assertCreated();
        $this->withToken($f['warehouse_manager_token'])->postJson(self::BASE . '/prices', $this->body($f, ['fuel_station_id' => $f['a2']->id]))->assertNotFound();
        $this->withToken($f['owner_token'])->postJson(self::BASE . '/prices', $this->body($f, ['fuel_station_id' => null, 'price_per_liter_minor' => 205]))->assertCreated();

        // مستأجر آخر لا يصل لمحطاتنا.
        $foreign = $this->registerTenant('fuel-mgmt-foreign', 'owner@fuel-mgmt-foreign.test', autoEnableApplications: true);
        app(EntitlementGrantService::class)->grant(Tenant::findOrFail($foreign['tenant_id']), 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL, CarbonImmutable::now('UTC'), grantReasonCode: 'test_fuel_mgmt', reason: 'عزل.');
        $this->withToken($foreign['token'])->postJson(self::BASE . '/prices', $this->body($f, ['fuel_station_id' => $f['a']->id]))->assertNotFound();
    }

    /** @test */
    public function the_approver_is_always_the_authenticated_actor_and_the_server_stamps_start_now(): void
    {
        $f = $this->fixture();
        $before = now()->startOfSecond()->subSecond();
        $response = $this->withToken($f['manager_token'])->postJson(self::BASE . '/prices', [
            'fuel_station_id' => $f['a']->id, 'fuel_product_id' => $f['fuel']->id, 'price_per_liter_minor' => 218,
            'start_now' => true, 'approved_by' => $f['owner']->id, 'effective_from' => '1999-01-01T00:00:00Z',
        ])->assertCreated();

        $row = FuelStationProductPrice::findOrFail($response->json('data.id'));
        $this->assertSame($f['manager']->id, $row->approved_by); // لا نسب موافقة لمستخدم آخر
        $this->assertSame($f['manager']->id, $row->created_by);
        $this->assertTrue($row->effective_from->between($before, now()->addSecond()), 'وقت البدء من ساعة الخادم لا العميل');
        $this->assertSame('manual', $row->entry_source);
        $this->assertSame(218, $this->effective($f['owner_token'], $f['a']->id)[0]['price_per_liter_minor']); // ساري فوراً
    }

    /** @test */
    public function validation_rejects_non_integer_zero_oversized_and_inverted_windows_without_writing(): void
    {
        $f = $this->fixture();
        $t = $f['owner_token'];
        foreach ([2.18, 0, -5, 1000001, '2,18', null] as $bad) {
            $this->withToken($t)->postJson(self::BASE . '/prices', $this->body($f, ['price_per_liter_minor' => $bad]))->assertUnprocessable();
        }
        $this->withToken($t)->postJson(self::BASE . '/prices', $this->body($f, ['effective_from' => now()->addDay()->toIso8601String(), 'effective_until' => now()->toIso8601String()]))->assertUnprocessable();
        $this->withToken($t)->postJson(self::BASE . '/prices', $this->body($f, ['idempotency_key' => 'short']))->assertUnprocessable();
        $this->withToken($t)->postJson(self::BASE . '/prices', ['fuel_station_id' => $f['a']->id, 'fuel_product_id' => $f['fuel']->id, 'price_per_liter_minor' => 218])->assertUnprocessable(); // لا بدء
        $this->assertSame(0, FuelStationProductPrice::count());
    }

    /** @test */
    public function an_overlapping_price_is_rejected_by_default_and_changes_nothing(): void
    {
        $f = $this->fixture();
        $old = $this->price($f, $f['a'], 200, now()->subDays(2));

        $response = $this->withToken($f['owner_token'])->postJson(self::BASE . '/prices', $this->body($f, ['start_now' => true, 'effective_from' => null, 'price_per_liter_minor' => 230]))->assertUnprocessable();
        $this->assertSame('price_overlap', $response->json('reason'));
        $this->assertTrue($response->json('can_supersede'));
        $this->assertSame($old->id, $response->json('conflicts.0.id'));
        $this->assertSame(200, $response->json('conflicts.0.price_per_liter_minor'));

        $this->assertSame(1, FuelStationProductPrice::count());
        $this->assertNull($old->fresh()->effective_until);
    }

    /** @test */
    public function explicit_supersede_closes_the_open_price_keeps_history_and_audits_both_sides(): void
    {
        $f = $this->fixture();
        $old = $this->price($f, $f['a'], 200, now()->subDays(2));
        $events = FuelStationConfigurationEvent::count();

        $response = $this->withToken($f['owner_token'])->postJson(self::BASE . '/prices', $this->body($f, ['start_now' => true, 'effective_from' => null, 'price_per_liter_minor' => 230, 'supersede' => true]))->assertCreated();
        $new = FuelStationProductPrice::findOrFail($response->json('data.id'));

        $this->assertSame([$old->id], $response->json('meta.superseded_price_ids'));
        $closed = $old->fresh();
        $this->assertSame(200, (int) $closed->price_per_liter_minor); // القيمة التاريخية لم تُمسّ
        $this->assertSame($old->effective_from->toIso8601String(), $closed->effective_from->toIso8601String());
        $this->assertSame($new->effective_from->toIso8601String(), $closed->effective_until->toIso8601String());
        $this->assertSame(2, FuelStationProductPrice::count()); // السجل التاريخي باقٍ
        $this->assertSame($events + 2, FuelStationConfigurationEvent::count()); // إغلاق + إنشاء
        $this->assertSame(230, $this->effective($f['owner_token'], $f['a']->id)[0]['price_per_liter_minor']);

        // سعر محطة أخرى/المؤسسة لم يتأثر.
        $this->assertSame('not_configured', $this->effective($f['owner_token'], $f['a2']->id)[0]['status']);
    }

    /** @test */
    public function supersede_is_refused_for_temporary_backdated_or_later_scheduled_prices(): void
    {
        $f = $this->fixture();
        $old = $this->price($f, $f['a'], 200, now()->subDays(2));
        $t = $f['owner_token'];

        $temporary = $this->withToken($t)->postJson(self::BASE . '/prices', $this->body($f, ['start_now' => true, 'effective_from' => null, 'effective_until' => now()->addDay()->toIso8601String(), 'supersede' => true]))->assertUnprocessable();
        $this->assertSame('supersede_requires_open_ended', $temporary->json('reason'));

        $backdated = $this->withToken($t)->postJson(self::BASE . '/prices', $this->body($f, ['effective_from' => now()->subDay()->toIso8601String(), 'supersede' => true]))->assertUnprocessable();
        $this->assertSame('supersede_backdated', $backdated->json('reason'));

        $later = $this->price($f, $f['a2'], 210, now()->addDays(2));
        $conflict = $this->withToken($t)->postJson(self::BASE . '/prices', $this->body($f, ['fuel_station_id' => $f['a2']->id, 'start_now' => true, 'effective_from' => null, 'supersede' => true]))->assertUnprocessable();
        $this->assertSame('supersede_conflicts_with_later_price', $conflict->json('reason'));

        $this->assertNull($old->fresh()->effective_until);
        $this->assertNull($later->fresh()->effective_until);
        $this->assertSame(2, FuelStationProductPrice::count());
    }

    /** @test */
    public function a_scheduled_future_price_is_created_without_closing_the_current_one_when_windows_do_not_overlap(): void
    {
        $f = $this->fixture();
        $current = $this->price($f, $f['a'], 200, now()->subDays(2), now()->addDay());

        $this->withToken($f['owner_token'])->postJson(self::BASE . '/prices', $this->body($f, ['effective_from' => now()->addDay()->toIso8601String(), 'price_per_liter_minor' => 230]))->assertCreated();

        $this->assertSame(200, $this->effective($f['owner_token'], $f['a']->id)[0]['price_per_liter_minor']);
        $this->assertSame(2, FuelStationProductPrice::count());
        $this->assertNotNull($current->fresh()->effective_until);
    }

    /** @test */
    public function the_same_idempotency_key_returns_the_existing_price_and_a_different_payload_conflicts(): void
    {
        $f = $this->fixture();
        $body = $this->body($f, ['start_now' => true, 'effective_from' => null, 'idempotency_key' => 'price-key-0001']);

        $first = $this->withToken($f['owner_token'])->postJson(self::BASE . '/prices', $body)->assertCreated();
        $events = FuelStationConfigurationEvent::count();
        $second = $this->withToken($f['owner_token'])->postJson(self::BASE . '/prices', $body)->assertOk();

        $this->assertSame($first->json('data.id'), $second->json('data.id'));
        $this->assertTrue($second->json('meta.replayed'));
        $this->assertFalse($first->json('meta.replayed'));
        $this->assertSame(1, FuelStationProductPrice::count());
        $this->assertSame($events, FuelStationConfigurationEvent::count()); // لا تدقيق مكرر

        $conflict = $this->withToken($f['owner_token'])->postJson(self::BASE . '/prices', ['price_per_liter_minor' => 999] + $body)->assertStatus(409);
        $this->assertSame('idempotency_key_conflict', $conflict->json('reason'));
        $this->assertSame(1, FuelStationProductPrice::count());
    }

    /** @test */
    public function a_replay_after_a_supersede_does_not_close_anything_twice(): void
    {
        $f = $this->fixture();
        $old = $this->price($f, $f['a'], 200, now()->subDays(2));
        $body = $this->body($f, ['start_now' => true, 'effective_from' => null, 'price_per_liter_minor' => 230, 'supersede' => true, 'idempotency_key' => 'supersede-key-01']);

        $this->withToken($f['owner_token'])->postJson(self::BASE . '/prices', $body)->assertCreated();
        $until = $old->fresh()->effective_until;
        $this->withToken($f['owner_token'])->postJson(self::BASE . '/prices', $body)->assertOk();

        $this->assertEquals($until, $old->fresh()->effective_until);
        $this->assertSame(2, FuelStationProductPrice::count());
    }

    /** @test */
    public function history_is_paginated_scoped_and_labels_the_entry_source(): void
    {
        $f = $this->fixture();
        for ($i = 0; $i < 60; $i++) {
            FuelStationProductPrice::create([
                'fuel_station_id' => $f['a']->id, 'fuel_product_id' => $f['fuel']->id, 'price_per_liter_minor' => 100 + $i,
                'effective_from' => now()->subDays(200 - $i), 'effective_until' => now()->subDays(199 - $i), 'status' => 'active',
            ]);
        }
        $page1 = $this->withToken($f['owner_token'])->getJson(self::BASE . '/prices?station_id=' . $f['a']->id)->assertOk();
        $page2 = $this->withToken($f['owner_token'])->getJson(self::BASE . '/prices?station_id=' . $f['a']->id . '&page=2')->assertOk();

        $this->assertCount(50, $page1->json('data'));
        $this->assertCount(10, $page2->json('data'));
        $this->assertSame(2, $page1->json('meta.last_page'));
        $this->assertSame('manual', $page1->json('data.0.entry_source'));
        // الأحدث أولاً.
        $this->assertGreaterThan($page1->json('data.49.effective_from'), $page1->json('data.0.effective_from'));
    }

    /** @test */
    public function the_tenant_default_effective_view_reports_source_and_tax_mode_and_requires_exactly_one_scope(): void
    {
        $f = $this->fixture();
        $this->price($f, null, 205, now()->subDay());
        $t = $f['branch_manager_token']; // يقرأ الافتراضي ولا يكتبه

        $row = $this->withToken($t)->getJson(self::BASE . '/prices/effective?scope=tenant_default')->assertOk()->json('data.0');
        $this->assertSame('tenant_default', $row['source']);
        $this->assertSame(205, $row['price_per_liter_minor']);
        $this->assertSame('tax_inclusive', $row['tax_mode']);
        $this->assertNull($row['fuel_station_id']);

        $this->withToken($t)->getJson(self::BASE . '/prices/effective')->assertUnprocessable();
        $this->withToken($t)->getJson(self::BASE . '/prices/effective?scope=tenant_default&station_id=' . $f['a']->id)->assertUnprocessable();
    }

    /** @test */
    public function suggestion_is_available_only_from_an_explicit_liter_unit_price_and_never_exposes_the_raw_card_price(): void
    {
        $f = $this->fixture();
        $this->literCard($f, 218);

        $row = $this->suggestions($f['owner_token'], $f['a']->id)[0];
        $this->assertSame('available', $row['status']);
        $this->assertSame(218, $row['price_per_liter_minor']);
        $this->assertSame('L', $row['unit']);
        $this->assertSame('tax_inclusive', $row['tax_mode']);
        $this->assertSame([], $row['blockers']);
        $this->assertFalse($row['matches_current']);
        $this->assertStringNotContainsString('1000', json_encode($row)); // sale_price الخام (للمل) لا يتسرّب

        // مقارنة بسعر النطاق نفسه.
        $this->price($f, $f['a'], 218, now()->subMinute());
        $this->assertTrue($this->suggestions($f['owner_token'], $f['a']->id)[0]['matches_current']);
        // نطاق المؤسسة: لا سعر مؤسسة بعد.
        $tenantRow = $this->suggestions($f['owner_token'], null)[0];
        $this->assertSame('available', $tenantRow['status']);
        $this->assertFalse($tenantRow['matches_current']);
    }

    /** @test */
    public function suggestion_is_blocked_for_ml_only_cards_ambiguous_units_zero_price_tax_and_mapping_problems(): void
    {
        $f = $this->fixture();
        $t = $f['owner_token'];
        $blockers = fn () => $this->suggestions($t, $f['a']->id)[0]['blockers'];

        // بطاقة بسعر وحدة الأساس (mL) فقط، بلا قالب وحدات.
        $this->assertSame(['requires_liter_price'], $blockers());
        $this->assertNull($this->suggestions($t, $f['a']->id)[0]['price_per_liter_minor']);

        $unit = $this->literCard($f, 218);
        $this->assertSame([], $blockers());

        // وحدتان بمعامل 1000 بسعرين ⇒ غموض.
        UnitTemplateUnit::create(['unit_template_id' => $unit['template']->id, 'name' => 'liter-b', 'factor' => 1000]);
        ProductUnitPrice::create(['product_id' => $f['fuel']->product_id, 'unit_name' => 'liter-b', 'price' => 219]);
        $this->assertSame(['ambiguous_liter_price'], $blockers());
        ProductUnitPrice::where('unit_name', 'liter-b')->delete();
        UnitTemplateUnit::where('name', 'liter-b')->delete();

        // سعر وحدة اللتر صفر.
        ProductUnitPrice::where('unit_name', 'L')->update(['price' => 0]);
        $this->assertSame(['price_not_positive'], $blockers());
        ProductUnitPrice::where('unit_name', 'L')->update(['price' => 218]);

        // وحدة معاملها ليس 1000 (مثلاً 500 مل) لا تُعدّ لتراً حتى لو سُمّيت L.
        UnitTemplateUnit::where('name', 'L')->update(['factor' => 500]);
        $this->assertSame(['requires_liter_price'], $blockers());
        UnitTemplateUnit::where('name', 'L')->update(['factor' => 1000]);

        // معدل ضريبة البطاقة يخالف الافتراضي.
        Product::whereKey($f['fuel']->product_id)->update(['tax_rate' => 5]);
        $this->assertSame(['tax_rate_mismatch'], $blockers());
        Product::whereKey($f['fuel']->product_id)->update(['tax_rate' => 15]);

        // منتج وقود بوحدة أساس خاطئة.
        Product::whereKey($f['fuel']->product_id)->update(['unit' => 'pcs']);
        $this->assertContains('unit_mapping_invalid', $blockers());
        Product::whereKey($f['fuel']->product_id)->update(['unit' => 'mL']);

        // منتج وقود غير نشط.
        FuelProduct::whereKey($f['fuel']->id)->update(['is_active' => false]);
        $inactive = $this->withToken($t)->getJson(self::BASE . '/prices/suggestions?station_id=' . $f['a']->id . '&fuel_product_id=' . $f['fuel']->id)->assertOk()->json('data.0');
        $this->assertContains('product_inactive', $inactive['blockers']);
    }

    /** @test */
    public function suggestion_is_blocked_when_the_fuel_tax_mode_is_unset(): void
    {
        $f = $this->fixture(country: 'US');
        $this->literCard($f, 218);

        $row = $this->suggestions($f['owner_token'], $f['a']->id)[0];
        $this->assertSame('blocked', $row['status']);
        $this->assertSame(['tax_mode_unset'], $row['blockers']);
        $this->assertNull($row['price_per_liter_minor']);
    }

    /** @test */
    public function saving_a_suggestion_requires_explicit_unit_and_tax_confirmation_and_records_the_source(): void
    {
        $f = $this->fixture();
        $this->literCard($f, 218);
        $t = $f['owner_token'];
        $source = ['type' => 'product_card', 'confirm_tax_mode' => 'tax_inclusive', 'confirm_unit' => 'L'];
        $base = $this->body($f, ['start_now' => true, 'effective_from' => null, 'price_per_liter_minor' => 218]);
        $cardBefore = [Product::find($f['fuel']->product_id)->sale_price, ProductUnitPrice::where('unit_name', 'L')->value('price')];

        // لا إقرار/إقرار ناقص ⇒ 422 دون كتابة.
        $this->withToken($t)->postJson(self::BASE . '/prices', $base + ['source' => ['type' => 'product_card']])->assertUnprocessable();
        $this->withToken($t)->postJson(self::BASE . '/prices', $base + ['source' => ['type' => 'product_card', 'confirm_tax_mode' => 'tax_inclusive', 'confirm_unit' => 'mL']])->assertUnprocessable();
        // إقرار أساس ضريبة مخالف للمعمول به.
        $this->assertSame('suggestion_tax_mode_mismatch', $this->withToken($t)->postJson(self::BASE . '/prices', $base + ['source' => ['confirm_tax_mode' => 'tax_exclusive'] + $source])->assertStatus(409)->json('reason'));
        // سعر مراجَع مختلف عن الاقتراح الحالي.
        $this->assertSame('suggestion_stale', $this->withToken($t)->postJson(self::BASE . '/prices', ['price_per_liter_minor' => 219] + $base + ['source' => $source])->assertStatus(409)->json('reason'));
        $this->assertSame(0, FuelStationProductPrice::count());

        $created = $this->withToken($t)->postJson(self::BASE . '/prices', $base + ['source' => $source])->assertCreated();
        $row = FuelStationProductPrice::findOrFail($created->json('data.id'));
        $this->assertSame('product_card', $row->entry_source);
        $this->assertSame(218, (int) $row->price_per_liter_minor);
        $this->assertStringContainsString('بطاقة المنتج', (string) $row->reason);
        $this->assertSame('product_card', FuelStationConfigurationEvent::latest('changed_at')->first()->after['entry_source']);

        // بطاقة المنتج وسجلاتها لم تُعدَّل، ولا أثر محاسبي أو بيع.
        $this->assertSame($cardBefore, [Product::find($f['fuel']->product_id)->sale_price, ProductUnitPrice::where('unit_name', 'L')->value('price')]);
        $this->assertSame(0, JournalEntry::count() + Invoice::count());
    }

    /** @test */
    public function a_blocked_or_changed_card_cannot_be_saved_as_a_suggestion(): void
    {
        $f = $this->fixture();
        $t = $f['owner_token'];
        $source = ['type' => 'product_card', 'confirm_tax_mode' => 'tax_inclusive', 'confirm_unit' => 'L'];
        $body = $this->body($f, ['start_now' => true, 'effective_from' => null, 'price_per_liter_minor' => 218, 'source' => $source]);

        // بطاقة بلا سعر لتر ⇒ يُحجب الحفظ ولو أرسل العميل رقماً.
        $blocked = $this->withToken($t)->postJson(self::BASE . '/prices', $body)->assertUnprocessable();
        $this->assertSame('suggestion_unavailable', $blocked->json('reason'));
        $this->assertSame(['requires_liter_price'], $blocked->json('blockers'));

        $this->literCard($f, 218);
        ProductUnitPrice::where('unit_name', 'L')->update(['price' => 250]); // تغيّرت البطاقة بعد المراجعة
        $this->assertSame('suggestion_stale', $this->withToken($t)->postJson(self::BASE . '/prices', $body)->assertStatus(409)->json('reason'));
        $this->assertSame(0, FuelStationProductPrice::count());
    }

    /** @test */
    public function a_suggestion_save_that_overlaps_follows_the_same_explicit_supersede_rule(): void
    {
        $f = $this->fixture();
        $this->literCard($f, 218);
        $old = $this->price($f, $f['a'], 200, now()->subDay());
        $source = ['type' => 'product_card', 'confirm_tax_mode' => 'tax_inclusive', 'confirm_unit' => 'L'];
        $body = $this->body($f, ['start_now' => true, 'effective_from' => null, 'price_per_liter_minor' => 218, 'source' => $source]);

        $this->assertSame('price_overlap', $this->withToken($f['owner_token'])->postJson(self::BASE . '/prices', $body)->assertUnprocessable()->json('reason'));
        $this->withToken($f['owner_token'])->postJson(self::BASE . '/prices', $body + ['supersede' => true])->assertCreated();
        $this->assertNotNull($old->fresh()->effective_until);
        $this->assertSame(218, $this->effective($f['owner_token'], $f['a']->id)[0]['price_per_liter_minor']);
    }

    /** @return list<array<string,mixed>> */
    private function effective(string $token, string $stationId): array
    {
        return $this->withToken($token)->getJson(self::BASE . '/prices/effective?station_id=' . $stationId)->assertOk()->json('data');
    }

    /** @return list<array<string,mixed>> */
    private function suggestions(string $token, ?string $stationId): array
    {
        return $this->withToken($token)->getJson(self::BASE . '/prices/suggestions' . ($stationId ? '?station_id=' . $stationId : ''))->assertOk()->json('data');
    }

    /** @param array<string,mixed> $f @param array<string,mixed> $over @return array<string,mixed> */
    private function body(array $f, array $over = []): array
    {
        return $over + [
            'fuel_station_id' => $f['a']->id, 'fuel_product_id' => $f['fuel']->id, 'price_per_liter_minor' => 218,
            'effective_from' => now()->subMinute()->toIso8601String(), 'reason' => 'اختبار',
        ];
    }

    /** @param array<string,mixed> $f */
    private function price(array $f, ?FuelStation $station, int $minor, \DateTimeInterface $from, ?\DateTimeInterface $until = null): FuelStationProductPrice
    {
        return app(FuelStationProductPriceService::class)->create([
            'fuel_station_id' => $station?->id, 'fuel_product_id' => $f['fuel']->id, 'price_per_liter_minor' => $minor,
            'effective_from' => CarbonImmutable::instance($from)->toIso8601String(),
            'effective_until' => $until === null ? null : CarbonImmutable::instance($until)->toIso8601String(), 'reason' => 'سابق',
        ], $f['owner']);
    }

    /** بطاقة بقالب وحدات mL ووحدة لتر معاملها 1000 وسعر وحدة صريح. @param array<string,mixed> $f @return array<string,mixed> */
    private function literCard(array $f, int $literMinor): array
    {
        $template = UnitTemplate::create(['name' => 'وقود', 'base_unit' => 'mL']);
        UnitTemplateUnit::create(['unit_template_id' => $template->id, 'name' => 'L', 'factor' => 1000]);
        Product::whereKey($f['fuel']->product_id)->update(['unit_template_id' => $template->id]);
        $price = ProductUnitPrice::create(['product_id' => $f['fuel']->product_id, 'unit_name' => 'L', 'price' => $literMinor]);

        return compact('template', 'price');
    }

    /** @return array<string,mixed> */
    private function fixture(string $country = 'SA'): array
    {
        $auth = $this->registerTenant('fuel-mgmt', 'owner@fuel-mgmt.test', autoEnableApplications: true);
        $tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($tenantId);
        $tenant = Tenant::findOrFail($tenantId);
        $tenant->update(['country' => $country]);
        app(EntitlementGrantService::class)->grant($tenant, 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL, CarbonImmutable::now('UTC'), grantReasonCode: 'test_fuel_mgmt', reason: 'اختبار إدارة الأسعار.');

        $branchA = Branch::where('is_main', true)->firstOrFail();
        $branchB = Branch::create(['code' => 'BR-B', 'name' => 'فرع ب']);
        $warehouseA = Warehouse::where('is_default', true)->firstOrFail();
        $warehouseA2 = Warehouse::create(['name' => 'مخزن أ2', 'code' => 'WH-A2', 'branch_id' => $branchA->id]);
        $warehouseB = Warehouse::create(['name' => 'مخزن ب', 'code' => 'WH-B', 'branch_id' => $branchB->id]);

        // بطاقة المنتج: وحدة mL وسعر وحدة أساس 1000 (عمداً: لا يُقرأ كسعر لتر).
        $productId = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'بنزين اختبار', 'type' => 'good', 'unit' => 'mL', 'sale_price' => 1000, 'purchase_price' => 10, 'track_inventory' => true,
        ])->assertCreated()['data']['id'];
        $fuel = FuelProduct::create(['product_id' => $productId, 'code' => 'F-MG', 'name' => 'بنزين 95']);

        $station = fn (Branch $branch, Warehouse $warehouse, string $code) => FuelStation::create(['branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'FS-' . $code, 'name' => 'محطة ' . $code]);

        $mk = function (string $slug, array $permissions) use ($tenantId) {
            Role::create(['tenant_id' => $tenantId, 'slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);
        };
        $manage = ['fuel.sale.view', 'fuel.sale.price.manage', 'fuel_stations.view'];
        $mk('fuel-mgmt-manager', $manage);
        $mk('fuel-mgmt-viewer', ['fuel.sale.view', 'fuel_stations.view']);

        $user = function (string $email, string $role) use ($tenantId) {
            return User::create(['tenant_id' => $tenantId, 'name' => $email, 'email' => $email, 'password' => 'password123', 'role' => $role]);
        };
        $manager = $user('manager@fuel-mgmt.test', 'fuel-mgmt-manager');
        $viewer = $user('viewer@fuel-mgmt.test', 'fuel-mgmt-viewer');
        $branchManager = $user('branch@fuel-mgmt.test', 'fuel-mgmt-manager');
        $branchManager->branches()->attach($branchA->id);
        $warehouseManager = $user('wh@fuel-mgmt.test', 'fuel-mgmt-manager');
        $warehouseManager->warehouses()->attach($warehouseA->id);

        return [
            'owner' => User::where('tenant_id', $tenantId)->where('role', 'owner')->sole(),
            'owner_token' => $auth['token'],
            'manager' => $manager, 'manager_token' => $manager->createToken('api')->plainTextToken,
            'viewer_token' => $viewer->createToken('api')->plainTextToken,
            'branch_manager_token' => $branchManager->createToken('api')->plainTextToken,
            'warehouse_manager_token' => $warehouseManager->createToken('api')->plainTextToken,
            'fuel' => $fuel,
            'a' => $station($branchA, $warehouseA, 'A'), 'a2' => $station($branchA, $warehouseA2, 'A2'), 'b' => $station($branchB, $warehouseB, 'B'),
        ];
    }
}
