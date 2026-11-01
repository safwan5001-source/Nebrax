<?php

namespace Tests\Feature;

use App\Models\FinancialControlAlert;
use App\Models\FuelStationReadinessEvent;
use App\Models\Tenant;
use App\Models\User;
use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * FS-44: `FuelStationAlertService::auditAlert` كان يستدعي `FuelStationReadinessEvent` بلا استيراد،
 * فكان تأكيد/إسناد أي تنبيه وقود يرمي `Class not found` ⇒ 500 دائماً، ولا اختبار يغطي المسارين.
 */
class FuelAlertLifecycleApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const BASE = '/api/fuel-stations/alerts';

    /** @test */
    public function acknowledging_a_fuel_alert_succeeds_and_writes_an_audit_event_with_the_actor(): void
    {
        [$token, $owner] = $this->fixture();
        $alert = $this->alert('fp-ack');

        $this->withToken($token)->postJson(self::BASE . '/' . $alert->id . '/acknowledge', ['note' => 'تمت المراجعة'])
            ->assertOk()->assertJsonPath('data.status', 'acknowledged')->assertJsonPath('data.acknowledged_by', $owner->id);

        $event = FuelStationReadinessEvent::query()->where('subject_id', $alert->id)->sole();
        $this->assertSame('alert.acknowledged', $event->event_type);
        $this->assertSame($owner->id, $event->performed_by);
        $this->assertSame('active', $event->before['status']);
        $this->assertSame('acknowledged', $event->after['status']);
    }

    /** @test */
    public function assigning_a_fuel_alert_succeeds_and_writes_an_audit_event(): void
    {
        [$token, $owner] = $this->fixture();
        $alert = $this->alert('fp-assign');

        $this->withToken($token)->postJson(self::BASE . '/' . $alert->id . '/assign', ['assigned_to' => $owner->id, 'reason' => 'إسناد للمالك'])
            ->assertOk()->assertJsonPath('data.assigned_to', $owner->id);

        $event = FuelStationReadinessEvent::query()->where('subject_id', $alert->id)->sole();
        $this->assertSame('alert.assigned', $event->event_type);
        $this->assertSame($owner->id, $event->performed_by);
        $this->assertSame($owner->id, $event->after['assigned_to']);
    }

    private function alert(string $fingerprint): FinancialControlAlert
    {
        return FinancialControlAlert::create([
            'fingerprint' => $fingerprint, 'rule' => 'fuel.test_rule', 'severity' => 'high', 'status' => 'active',
            'title' => 'تنبيه وقود', 'description' => 'تنبيه لاختبار دورة الحياة.', 'details' => [],
            'first_detected_at' => now(), 'last_detected_at' => now(),
        ]);
    }

    /** @return array{0:string,1:User} */
    private function fixture(): array
    {
        $auth = $this->registerTenant('fuel-alert-life', 'owner@fuel-alert-life.test', autoEnableApplications: true);
        app(TenantContext::class)->set($auth['tenant_id']);
        $grants = app(EntitlementGrantService::class);
        foreach (['fuel_stations.core', 'fuel_stations.maintenance'] as $app) {
            $grants->grant(Tenant::findOrFail($auth['tenant_id']), $app, EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL, CarbonImmutable::now('UTC'), grantReasonCode: 'test_fs44_alerts', reason: 'اختبار تنبيهات الوقود.');
        }

        return [$auth['token'], User::where('tenant_id', $auth['tenant_id'])->where('role', 'owner')->sole()];
    }
}
