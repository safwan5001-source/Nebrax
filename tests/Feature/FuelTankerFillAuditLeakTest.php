<?php

namespace Tests\Feature;

use App\Models\FuelNozzle;
use App\Models\FuelPump;
use App\Models\FuelShift;
use App\Models\FuelStationAuditEvent;
use App\Models\FuelTanker;
use App\Models\FuelTankerFill;
use App\Models\FuelTankerOwner;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * TANKER-SEC-1 — سجل التدقيق المشترك `/fuel-stations/audit-events` لا يكشف لقطات سندات التعبئة ومرفقاتها (موضوعها `FuelTankerFill`)
 * إلا لمن تتوافر له بوابتا PR-1 وPR-4 مفتوحتين وصلاحية `fuel.tanker.fill.view`؛ وأحداث الإزالة/الاستبدال تتطلب أيضاً `fuel.tanker.fill.attachment.remove`.
 * السجل الأصلي لا يُحذف ولا يُعدَّل، وأحداث المحطات الأخرى لا تتأثر، والعزل بالمستأجر والمحطة باقٍ.
 */
class FuelTankerFillAuditLeakTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelStaffFixture;

    private const AUDIT = '/api/fuel-stations/audit-events';
    private const FILLS = '/api/fuel-stations/tanker-fills';
    private const VOUCHER = '04052-SECRET';
    private const NOTE = 'ملاحظة-سند-سرية';

    private FuelTankerFill $fill;
    private int $seq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config(['fuel_stations.tanker_management_enabled' => true, 'fuel_stations.tanker_fills_enabled' => true]);
        $this->buildFixture();
        app(TenantContext::class)->set($this->tenantId);
        $pump = FuelPump::create(['branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s1']->id, 'pump_number' => '02', 'name' => 'مضخة 2']);
        $nozzle = FuelNozzle::create([
            'branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s1']->id, 'fuel_pump_id' => $pump->id, 'fuel_tank_id' => $this->fx['t1']->id,
            'fuel_product_id' => $this->fx['fuel']->id, 'nozzle_number' => '1',
        ]);
        $owner = FuelTankerOwner::create(['name' => 'عسكر', 'code' => 'ASK', 'status' => 'active']);
        FuelTanker::create(['fuel_tanker_owner_id' => $owner->id, 'plate_number' => 'أ ب ج 1234', 'plate_key' => 'ABJ1234', 'capacity_milliliters' => 5_000_000, 'status' => 'active']);
        FuelShift::create([
            'branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s1']->id, 'number' => 'FSH-SEC-1', 'status' => FuelShift::STATUS_OPEN,
            'opening_float_minor' => 0, 'idempotency_key' => 'shift-sec-1', 'opened_by' => $this->makeUser('seller-sec', 'role-seller-sec', ['fuel_stations.view'])['user']->id, 'opened_at' => now(),
        ]);

        // سند + مرفقان (يُستبدل أحدهما ويُزال الآخر) + سند ثانٍ ملغى: كل الأحداث موضوعها FuelTankerFill.
        $created = $this->withToken($this->fx['owner'])->postJson(self::FILLS, [
            'fuel_station_id' => $this->fx['s1']->id, 'fuel_nozzle_id' => $nozzle->id, 'fuel_tanker_owner_id' => $owner->id,
            'voucher_number' => self::VOUCHER, 'quantity_liters' => '2000', 'notes' => self::NOTE, 'idempotency_key' => 'fill-sec-1',
        ])->assertCreated();
        $this->fill = FuelTankerFill::query()->findOrFail($created->json('data.id'));
        $url = self::FILLS . "/{$this->fill->id}/attachments";
        $upload = fn (string $name, int $w) => $this->withToken($this->fx['owner'])->post($url, ['attachments' => [UploadedFile::fake()->image($name, $w, 480)]], ['Accept' => 'application/json'])->assertCreated()->json('data.0.id');
        $first = $upload('first-secret-name.jpg', 640);
        $second = $upload('second-secret-name.jpg', 700);
        $this->withToken($this->fx['owner'])->post("{$url}/{$first}/replace", ['attachment' => UploadedFile::fake()->image('replaced-secret-name.jpg', 333, 222)], ['Accept' => 'application/json'])->assertSuccessful();
        $this->withToken($this->fx['owner'])->deleteJson("{$url}/{$second}", ['reason' => 'سبب-إزالة-سري'])->assertOk();
    }

    /** @param list<string> $permissions @return string token */
    private function staff(array $permissions, ?array $stations = null): string
    {
        $n = ++$this->seq;

        return $this->makeUser("sec{$n}", "role-sec-{$n}", array_merge(['fuel_stations.view', 'fuel_stations.manage'], $permissions), $stations)['token'];
    }

    /** @return list<string> */
    private function actions(string $token, string $query = ''): array
    {
        return collect($this->withToken($token)->getJson(self::AUDIT . '?per_page=100' . $query)->assertOk()->json('data'))
            ->where('subject_type', 'FuelTankerFill')->pluck('action')->unique()->sort()->values()->all();
    }

    private function raw(string $token): string
    {
        return $this->withToken($token)->getJson(self::AUDIT . '?per_page=100')->assertOk()->getContent();
    }

    private function assertNoFillLeak(string $raw): void
    {
        foreach ([self::VOUCHER, self::NOTE, 'first-secret-name', 'second-secret-name', 'replaced-secret-name', 'سبب-إزالة-سري', 'FuelTankerFill', 'tanker_fill.'] as $needle) {
            $this->assertStringNotContainsString($needle, $raw, $needle);
        }
    }

    private const ALL_ACTIONS = ['tanker_fill.attachment_added', 'tanker_fill.attachment_removed', 'tanker_fill.attachment_replaced', 'tanker_fill.recorded'];
    private const VIEW_ONLY_ACTIONS = ['tanker_fill.attachment_added', 'tanker_fill.recorded'];

    /** @test */
    public function the_events_exist_in_the_original_audit_log_and_are_never_altered_by_reading(): void
    {
        $count = FuelStationAuditEvent::query()->where('subject_type', FuelTankerFill::class)->count();
        $this->assertGreaterThanOrEqual(5, $count); // recorded + 3 attachment_added + replaced + removed

        $this->raw($this->fx['owner']);
        $this->raw($this->staff([]));

        $this->assertSame($count, FuelStationAuditEvent::query()->where('subject_type', FuelTankerFill::class)->count());
    }

    /** @test */
    public function a_user_with_only_the_legacy_manage_key_or_unrelated_tanker_keys_never_sees_fill_events(): void
    {
        foreach ([[], ['fuel.tanker.view'], ['fuel.tanker.view', 'fuel.tanker.manage'], ['fuel.tanker.fill.record', 'fuel.tanker.fill.void', 'fuel.tanker.fill.attachment.add', 'fuel.tanker.fill.attachment.remove']] as $permissions) {
            $token = $this->staff($permissions);
            $this->assertSame([], $this->actions($token), implode(',', $permissions));
            $this->assertNoFillLeak($this->raw($token));
            // التصفية بالنوع أو المعرّف أو الإجراء لا تتجاوز القيد.
            $this->assertSame([], $this->actions($token, '&subject_type=FuelTankerFill'));
            $this->assertSame([], $this->actions($token, "&subject_id={$this->fill->id}"));
            $this->assertSame([], $this->actions($token, '&action=tanker_fill.recorded'));
            $this->assertSame([], $this->actions($token, '&action=tanker_fill.attachment_removed'));
        }
    }

    /** @test */
    public function a_viewer_sees_fill_and_added_events_but_not_the_attachment_history_events(): void
    {
        $viewer = $this->staff(['fuel.tanker.fill.view']);

        $this->assertSame(self::VIEW_ONLY_ACTIONS, $this->actions($viewer));
        $this->assertSame([], $this->actions($viewer, '&action=tanker_fill.attachment_removed'));
        $this->assertSame([], $this->actions($viewer, '&action=tanker_fill.attachment_replaced'));
        $raw = $this->raw($viewer);
        $this->assertStringNotContainsString('سبب-إزالة-سري', $raw);
        $this->assertStringNotContainsString('tanker_fill.attachment_removed', $raw);
        $this->assertStringNotContainsString('tanker_fill.attachment_replaced', $raw);
    }

    /** @test */
    public function a_user_with_view_and_remove_permissions_sees_the_whole_fill_history(): void
    {
        $historian = $this->staff(['fuel.tanker.fill.view', 'fuel.tanker.fill.attachment.remove']);

        $this->assertSame(self::ALL_ACTIONS, $this->actions($historian));
        $this->assertSame(['FuelTankerFill'], collect($this->withToken($historian)->getJson(self::AUDIT . '?subject_type=FuelTankerFill&per_page=100')->assertOk()->json('data'))->pluck('subject_type')->unique()->values()->all());
        $this->assertSame(self::ALL_ACTIONS, $this->actions($this->fx['owner'])); // المالك (`*`) كذلك.
    }

    /** @test */
    public function closing_either_deployment_gate_hides_the_fill_events_from_everyone_including_the_owner(): void
    {
        $historian = $this->staff(['fuel.tanker.fill.view', 'fuel.tanker.fill.attachment.remove']);

        foreach (['fuel_stations.tanker_fills_enabled', 'fuel_stations.tanker_management_enabled'] as $gate) {
            config([$gate => false]);
            foreach ([$historian, $this->fx['owner']] as $token) {
                $this->assertSame([], $this->actions($token), $gate);
                $this->assertNoFillLeak($this->raw($token));
                $this->assertSame([], $this->actions($token, '&subject_type=FuelTankerFill'), $gate);
            }
            config([$gate => true]);
        }

        // إعادة فتح البوابتين تعيد الظهور: السجل الأصلي لم يُمسّ.
        $this->assertSame(self::ALL_ACTIONS, $this->actions($historian));
    }

    /** @test */
    public function station_scope_still_applies_to_users_who_hold_the_fill_permissions(): void
    {
        $otherStation = $this->staff(['fuel.tanker.fill.view', 'fuel.tanker.fill.attachment.remove'], [$this->fx['s2']->id]);
        $this->assertSame([], $this->actions($otherStation));
        $this->assertNoFillLeak($this->raw($otherStation));

        $sameStation = $this->staff(['fuel.tanker.fill.view', 'fuel.tanker.fill.attachment.remove'], [$this->fx['s1']->id]);
        $this->assertSame(self::ALL_ACTIONS, $this->actions($sameStation));
    }

    /** @test */
    public function another_tenants_fill_events_are_never_listed(): void
    {
        $other = $this->registerTenant('fuel-sec-other', 'owner@fuel-sec-other.test', autoEnableApplications: true);
        app(TenantContext::class)->set($other['tenant_id']);
        FuelStationAuditEvent::create([
            'tenant_id' => $other['tenant_id'], 'action' => 'tanker_fill.recorded', 'subject_type' => FuelTankerFill::class, 'subject_id' => (string) Str::uuid(),
            'after' => ['voucher_number' => 'OTHER-TENANT-VOUCHER'], 'occurred_at' => now(),
        ]);
        app(TenantContext::class)->set($this->tenantId);

        $this->assertStringNotContainsString('OTHER-TENANT-VOUCHER', $this->raw($this->fx['owner']));
        $this->assertSame(self::ALL_ACTIONS, $this->actions($this->fx['owner']));
    }

    /** @test */
    public function the_general_audit_reader_is_not_weakened_for_non_tanker_events(): void
    {
        $legacy = $this->staff([]);
        $this->withToken($this->fx['owner'])->postJson('/api/fuel-stations/stations', ['branch_id' => $this->fx['branchA']->id, 'code' => 'FS-SEC', 'name' => 'محطة التدقيق'])->assertCreated();

        $subjects = collect($this->withToken($legacy)->getJson(self::AUDIT . '?per_page=100')->assertOk()->json('data'))->pluck('subject_type')->unique()->all();
        $this->assertNotContains('FuelTankerFill', $subjects);
        $this->assertContains('FuelStation', $subjects, 'أحداث المحطات الأخرى تبقى مرئية');
        // مستخدم بلا fuel_stations.manage يبقى ممنوعاً من القارئ نفسه.
        $noManage = $this->makeUser('sec-nomanage', 'role-sec-nomanage', ['fuel_stations.view', 'fuel.tanker.fill.view'])['token'];
        $this->withToken($noManage)->getJson(self::AUDIT)->assertForbidden();
    }
}
