<?php

namespace Tests\Feature;

use App\Models\DeliveryConnectorAccount;
use App\Models\DeliveryHubOrder;
use App\Models\DeliveryPlatformProfile;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\StockMovement;
use App\Services\DeliveryHub\DeliveryConnectorException;
use App\Services\DeliveryHub\DeliveryProviderReadinessGate;
use App\Support\DeliveryPlatformCatalog;
use App\Support\DeliveryProviderReadiness;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use LogicException;
use Tests\TestCase;

/**
 * INT-READY-1 — سجلّ جاهزية مزوّدي التوصيل للتكامل الأصلي.
 *
 * يثبت: (1) السجلّ مطابق لتقرير الأدلة DLV-PROVIDER-READINESS-1 ولا مزوّد جاهز،
 * (2) تجميده — أي تغيير في صف يتطلب تعديل هذا الاختبار في الطلب نفسه (R-GATE-4)،
 * (3) الحارس يرفض بـ409 provider_not_ready لكل مزوّد، (4) نقطة القراءة محروسة
 * ومتطابقة لكل المستأجرين ولا تكتب شيئاً، (5) لا مسار ربط/تفويض/مزامنة لمزوّد،
 * (6) الإسناد اليدوي (A) مستقل عن الجاهزية (B).
 *
 * تشغيل: php artisan test --filter=DeliveryProviderReadinessTest
 */
class DeliveryProviderReadinessTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const EVIDENCE = 'docs/plans/pos/DLV-PROVIDER-READINESS-1-REPORT.md';

    /**
     * التجميد: نسخة مكرَّرة عمداً من السجلّ. تحويل `connect_enabled`/`sync_enabled`
     * أو الحالة التقنية يستلزم تعديل هذا الجدول في طلب الدمج نفسه، فلا يمرّ بصمت.
     *
     * @return array<string, array{0:string,1:string,2:string,3:string}>
     */
    private function frozen(): array
    {
        return [
            // key => [technical, ux_state, evidence section, evidence date]
            'hungerstation' => ['OWNER_GATE', 'AWAITING_PROVIDER_APPROVAL', '§4.1', '2026-10-11'],
            'jahez' => ['BLOCKED', 'NOT_SUPPORTED', '§4.2', '2026-10-11'],
            'mrsool' => ['BLOCKED', 'NOT_SUPPORTED', '§4.3', '2026-10-11'],
            'keeta' => ['OWNER_GATE', 'AWAITING_PROVIDER_APPROVAL', '§4.4', '2026-10-11'],
            'ninja' => ['BLOCKED', 'NOT_SUPPORTED', '§4.5', '2026-10-11'],
            'the_chefz' => ['BLOCKED', 'NOT_SUPPORTED', '§4.6', '2026-10-11'],
        ];
    }

    /** @return array<string, mixed> صف جاهز صالح (للمسار الإيجابي في الاختبارات فقط). */
    private function readyRow(): array
    {
        return [
            'technical' => 'READY',
            'evidence_ref' => self::EVIDENCE . ' §4.1',
            'evidence_date' => '2026-10-11',
            'auth_method' => 'declared_by_adapter',
            'connect_enabled' => true,
            'sync_enabled' => false,
        ];
    }

    /** @return array<string, array<string, mixed>> */
    private function rowsWith(string $key, array $override): array
    {
        $rows = DeliveryProviderReadiness::all();
        $rows[$key] = array_merge($rows[$key], $override);

        return $rows;
    }

    // ── السجلّ ──────────────────────────────────────────────────────────────

    /** @test */
    public function the_manifest_matches_the_frozen_evidence_and_no_provider_is_ready(): void
    {
        $this->assertSame(array_keys($this->frozen()), DeliveryProviderReadiness::keys(), 'الترتيب ثابت ومقصود.');

        foreach ($this->frozen() as $key => [$technical, $uxState, $section, $date]) {
            $row = DeliveryProviderReadiness::get($key);
            $this->assertSame($technical, $row['technical'], $key);
            $this->assertNotSame('READY', $row['technical'], $key);
            $this->assertSame($uxState, DeliveryProviderReadiness::uxState($row), $key);
            $this->assertSame(self::EVIDENCE . ' ' . $section, $row['evidence_ref'], $key);
            $this->assertSame($date, $row['evidence_date'], $key);
            $this->assertNull($row['auth_method'], "{$key}: لا طريقة مصادقة موثّقة.");
            $this->assertFalse($row['connect_enabled'], "{$key}: R-GATE-6.");
            $this->assertFalse($row['sync_enabled'], "{$key}: R-GATE-6.");
        }
    }

    /** @test */
    public function the_manifest_is_valid_and_covers_exactly_the_catalog(): void
    {
        DeliveryProviderReadiness::validate(DeliveryProviderReadiness::all());

        $this->assertEqualsCanonicalizing(DeliveryPlatformCatalog::keys(), DeliveryProviderReadiness::keys());
        $this->assertNull(DeliveryProviderReadiness::get('unknown'));
        $this->assertNull(DeliveryProviderReadiness::get('HUNGERSTATION'));
    }

    /** @test */
    public function the_ux_state_is_derived_and_ready_to_connect_needs_ready_and_connect_enabled(): void
    {
        $derive = fn (string $technical, bool $connect) => DeliveryProviderReadiness::uxState([
            'technical' => $technical, 'connect_enabled' => $connect,
        ]);

        $this->assertSame('NOT_SUPPORTED', $derive('BLOCKED', false));
        $this->assertSame('AWAITING_PROVIDER_APPROVAL', $derive('OWNER_GATE', false));
        // READY وحدها لا تكفي (R-LADDER-2).
        $this->assertSame('AWAITING_PROVIDER_APPROVAL', $derive('READY', false));
        $this->assertSame('READY_TO_CONNECT', $derive('READY', true));
    }

    /**
     * @test
     * @dataProvider contradictoryRows
     */
    public function contradictory_rows_are_rejected(string $key, array $override): void
    {
        $this->expectException(LogicException::class);

        DeliveryProviderReadiness::validate($this->rowsWith($key, $override));
    }

    /** @return array<string, array{0:string,1:array<string,mixed>}> */
    public static function contradictoryRows(): array
    {
        return [
            'connect on a blocked provider' => ['jahez', ['connect_enabled' => true, 'auth_method' => 'x']],
            'connect on an owner-gated provider' => ['keeta', ['connect_enabled' => true, 'auth_method' => 'x']],
            'connect without a declared auth method' => ['keeta', ['technical' => 'READY', 'connect_enabled' => true]],
            'sync without connect' => ['keeta', ['technical' => 'READY', 'auth_method' => 'x', 'sync_enabled' => true]],
            'unknown technical status' => ['keeta', ['technical' => 'CONNECTED']],
            'empty evidence reference' => ['keeta', ['evidence_ref' => ' ']],
            'non-iso evidence date' => ['keeta', ['evidence_date' => '11/10/2026']],
            'string flag' => ['keeta', ['connect_enabled' => 'false']],
            'empty auth method' => ['keeta', ['auth_method' => '']],
        ];
    }

    /** @test */
    public function missing_extra_or_malformed_rows_are_rejected(): void
    {
        $rows = DeliveryProviderReadiness::all();

        $missing = $rows;
        unset($missing['ninja']);
        $extra = $rows + ['talabat' => $rows['keeta']];
        $extraField = $rows;
        $extraField['keeta']['native_status'] = 'connected';
        $notArray = $rows;
        $notArray['keeta'] = 'READY';

        foreach (['missing platform' => $missing, 'extra platform' => $extra, 'extra field' => $extraField, 'not an array' => $notArray] as $label => $bad) {
            try {
                DeliveryProviderReadiness::validate($bad);
                $this->fail("{$label}: يجب أن يُرفض.");
            } catch (LogicException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    // ── الحارس ─────────────────────────────────────────────────────────────

    /** @test */
    public function the_gate_refuses_connect_and_sync_for_every_platform_with_409_provider_not_ready(): void
    {
        $gate = new DeliveryProviderReadinessGate();

        foreach ([...DeliveryProviderReadiness::keys(), 'unknown', '', 'HUNGERSTATION'] as $key) {
            $this->assertFalse($gate->canConnect($key), $key);
            $this->assertFalse($gate->canSync($key), $key);

            foreach (['assertConnectable', 'assertSyncable'] as $method) {
                try {
                    $gate->{$method}($key);
                    $this->fail("{$key}::{$method} يجب أن يرفض.");
                } catch (DeliveryConnectorException $e) {
                    $this->assertSame('provider_not_ready', $e->errorCode);
                    $this->assertSame(409, $e->status);
                    $this->assertSame('هذا التكامل غير متاح بعد.', $e->getMessage());
                }
            }
        }
    }

    /** @test */
    public function the_gate_allows_connect_only_when_a_validated_row_enables_it_and_sync_needs_both_flags(): void
    {
        $connectOnly = new DeliveryProviderReadinessGate($this->rowsWith('keeta', $this->readyRow()));
        $connectOnly->assertConnectable('keeta');
        $this->assertTrue($connectOnly->canConnect('keeta'));
        $this->assertFalse($connectOnly->canSync('keeta'), 'sync_enabled=false يمنع المزامنة.');
        $this->assertFalse($connectOnly->canConnect('hungerstation'), 'مزوّد آخر لا يتأثر.');

        $both = new DeliveryProviderReadinessGate($this->rowsWith('keeta', ['sync_enabled' => true] + $this->readyRow()));
        $both->assertSyncable('keeta');
        $this->assertTrue($both->canSync('keeta'));

        $this->expectException(DeliveryConnectorException::class);
        $connectOnly->assertSyncable('keeta');
    }

    /** @test */
    public function the_gate_cannot_be_built_from_a_contradictory_manifest(): void
    {
        $this->expectException(LogicException::class);

        new DeliveryProviderReadinessGate($this->rowsWith('jahez', ['connect_enabled' => true, 'auth_method' => 'x']));
    }

    // ── نقطة القراءة ──────────────────────────────────────────────────────

    /** @test */
    public function an_owner_reads_the_six_providers_and_none_can_be_connected(): void
    {
        $auth = $this->registerTenant('rdy-owner', 'owner@rdy-owner.test');

        $data = $this->withToken($auth['token'])->getJson('/api/delivery-platforms/readiness')
            ->assertOk()->assertJsonCount(6, 'data')->json('data');

        $this->assertSame(array_keys($this->frozen()), array_column($data, 'platform_key'));

        foreach ($data as $item) {
            [$technical, $uxState, $section, $date] = $this->frozen()[$item['platform_key']];
            $catalog = DeliveryPlatformCatalog::get($item['platform_key']);

            $this->assertSame($catalog['name'], $item['name']);
            $this->assertSame($catalog['name_en'], $item['name_en']);
            $this->assertSame($technical, $item['technical']);
            $this->assertSame($uxState, $item['ux_state']);
            $this->assertFalse($item['connect_enabled']);
            $this->assertFalse($item['sync_enabled']);
            $this->assertSame($date, $item['evidence_date']);
            $this->assertSame(self::EVIDENCE . ' ' . $section, $item['evidence_ref']);
            $this->assertNotSame('READY_TO_CONNECT', $item['ux_state']);
            // لا حالة اتصال ولا مزامنة ولا ادّعاء مصادقة في الاستجابة.
            $this->assertEqualsCanonicalizing(
                ['platform_key', 'name', 'name_en', 'technical', 'ux_state', 'connect_enabled', 'sync_enabled', 'evidence_date', 'evidence_ref'],
                array_keys($item),
            );
        }
    }

    /** @test */
    public function roles_without_connector_view_get_the_same_readiness_without_the_internal_evidence_reference(): void
    {
        $auth = $this->registerTenant('rdy-roles', 'owner@rdy-roles.test');
        $owner = $this->withToken($auth['token'])->getJson('/api/delivery-platforms/readiness')->assertOk()->json('data');

        foreach (['staff', 'accountant'] as $role) {
            $token = $this->tokenForRole($auth['tenant_id'], $role, "{$role}@rdy-roles.test");
            $data = $this->withToken($token)->getJson('/api/delivery-platforms/readiness')->assertOk()->json('data');

            foreach ($data as $i => $item) {
                $this->assertArrayNotHasKey('evidence_ref', $item, $role);
                unset($owner[$i]['evidence_ref']);
                $this->assertSame($owner[$i], $item, $role);
            }
        }
    }

    /** @test */
    public function unauthenticated_self_service_and_disabled_pos_application_are_refused(): void
    {
        $auth = $this->registerTenant('rdy-deny', 'owner@rdy-deny.test');

        $this->getJson('/api/delivery-platforms/readiness')->assertUnauthorized();

        $selfService = $this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@rdy-deny.test');
        $this->withToken($selfService)->getJson('/api/delivery-platforms/readiness')->assertForbidden();

        $off = $this->registerTenant('rdy-off', 'owner@rdy-off.test', autoEnableApplications: false);
        $this->withToken($off['token'])->getJson('/api/delivery-platforms/readiness')->assertForbidden();
    }

    /** @test */
    public function the_endpoint_is_get_only_and_identical_for_every_tenant_with_no_tenant_data(): void
    {
        $a = $this->registerTenant('rdy-iso-a', 'owner@rdy-iso-a.test');
        $b = $this->registerTenant('rdy-iso-b', 'owner@rdy-iso-b.test');

        $first = $this->withToken($a['token'])->getJson('/api/delivery-platforms/readiness')->assertOk();
        $second = $this->withToken($b['token'])->getJson('/api/delivery-platforms/readiness')->assertOk();

        $this->assertSame($first->json('data'), $second->json('data'));
        foreach ([$a['tenant_id'], $b['tenant_id']] as $tenantId) {
            $this->assertStringNotContainsString($tenantId, $first->getContent());
            $this->assertStringNotContainsString($tenantId, $second->getContent());
        }

        foreach (['postJson', 'putJson', 'patchJson', 'deleteJson'] as $verb) {
            $this->withToken($a['token'])->{$verb}('/api/delivery-platforms/readiness', ['connect_enabled' => true])
                ->assertStatus(405);
        }
        // لا يمكن لأي طلب أن يقلب الجاهزية.
        $this->withToken($a['token'])->getJson('/api/delivery-platforms/readiness?connect_enabled=1&platform_key=keeta')
            ->assertOk()->assertJsonPath('data.3.connect_enabled', false);
    }

    /** @test */
    public function the_endpoint_writes_nothing_and_touches_no_financial_or_connector_tables(): void
    {
        $auth = $this->registerTenant('rdy-nowrite', 'owner@rdy-nowrite.test');

        app(TenantContext::class)->set($auth['tenant_id']);
        $count = fn () => [
            JournalEntry::count(), Invoice::count(), Payment::count(), StockMovement::count(),
            DeliveryPlatformProfile::count(), DeliveryConnectorAccount::count(), DeliveryHubOrder::count(),
        ];
        $before = $count();
        app(TenantContext::class)->forget();

        $writes = [];
        DB::listen(function ($query) use (&$writes) {
            $sql = strtolower(ltrim($query->sql));
            // تحديث `last_used_at` لتوكن Sanctum يخصّ المصادقة لا هذه النقطة.
            if (preg_match('/^(insert|update|delete)\b/', $sql) === 1 && ! str_contains($sql, 'personal_access_tokens')) {
                $writes[] = $query->sql;
            }
        });

        $this->withToken($auth['token'])->getJson('/api/delivery-platforms/readiness')->assertOk();

        $this->assertSame([], $writes, 'نقطة القراءة لا تكتب.');
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame($before, $count());
    }

    // ── الاستقلال عن الإسناد اليدوي والربط الداخلي ─────────────────────────

    /** @test */
    public function manual_attribution_and_an_internal_ingress_account_do_not_change_readiness(): void
    {
        $auth = $this->registerTenant('rdy-ladder', 'owner@rdy-ladder.test');
        $token = $auth['token'];

        $before = $this->withToken($token)->getJson('/api/delivery-platforms/readiness')->assertOk()->json('data');

        // A: ملف منصة مفعَّل للإسناد اليدوي.
        $profile = $this->withToken($token)->postJson('/api/delivery-platforms', [
            'platform_key' => 'keeta',
            'collection_mode' => 'platform_collected',
            'external_reference_policy' => 'optional',
        ])->assertCreated()->json('data');

        // نقطة استقبال موقّعة من أَوْج (ليست ربطاً بمزوّد) تبقى تعمل كما هي.
        $this->withToken($token)->postJson('/api/delivery-connectors', [
            'delivery_platform_profile_id' => $profile['id'],
            'external_store_id' => 'rdy-store-1',
        ])->assertCreated()->assertJsonPath('data.status', 'configured');

        $after = $this->withToken($token)->getJson('/api/delivery-platforms/readiness')->assertOk()->json('data');

        $this->assertSame($before, $after, 'B مستقلة عن A وعن حساب الاستقبال الداخلي.');
        $keeta = collect($after)->firstWhere('platform_key', 'keeta');
        $this->assertSame('AWAITING_PROVIDER_APPROVAL', $keeta['ux_state']);
        $this->assertFalse($keeta['connect_enabled']);
        $this->assertFalse($keeta['sync_enabled']);
    }

    // ── لا مسار ربط/تفويض/مزامنة لمزوّد ───────────────────────────────────

    /** @test */
    public function no_provider_connect_authorize_or_sync_route_exists(): void
    {
        $forbidden = '#(connect(?!ors?\b)|authori[sz]e|oauth|callback|link|sync|pair|credential|token)#i';
        $delivery = '#(delivery|provider|integration)#i';

        $offenders = [];
        foreach (Route::getRoutes() as $route) {
            $uri = $route->uri();
            if (preg_match($delivery, $uri) !== 1) {
                continue;
            }
            // `delivery-connectors` (نقطة الاستقبال الموقّعة) تُستثنى بالاسم، لا بالنمط.
            $normalized = str_replace('delivery-connectors', 'delivery-ingress', $uri);
            if (preg_match($forbidden, $normalized) === 1) {
                $offenders[] = implode('|', $route->methods()) . ' ' . $uri;
            }
        }

        $this->assertSame([], $offenders, 'لا مسار ربط/تفويض/مزامنة لمزوّد قبل بوابة الجاهزية (R-GATE-1).');
    }

    /** @test */
    public function the_readiness_route_is_a_single_guarded_get(): void
    {
        $routes = collect(Route::getRoutes()->getRoutes())
            ->filter(fn ($r) => $r->uri() === 'api/delivery-platforms/readiness');

        $this->assertCount(1, $routes);
        $route = $routes->first();
        $this->assertContains('GET', $route->methods());
        $this->assertNotContains('POST', $route->methods());
        $this->assertNotContains('PUT', $route->methods());
        $this->assertNotContains('DELETE', $route->methods());

        $middleware = implode(' ', $route->gatherMiddleware());
        $this->assertStringContainsString('EnsurePermission:invoices.view', $middleware);
        $this->assertStringContainsString('EnsureApplicationActive:sales.pos', $middleware);
    }
}
