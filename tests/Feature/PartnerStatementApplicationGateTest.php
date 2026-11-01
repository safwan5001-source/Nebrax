<?php

namespace Tests\Feature;

use App\Models\Partner;
use App\Models\PartnerStatementReconciliation;
use App\Models\Tenant;
use App\Models\TenantApplicationEvent;
use App\Models\TenantApplicationState;
use App\Models\User;
use App\Services\PlatformApplicationOverrideService;
use App\Services\TenantApplicationService;
use App\Support\ApplicationCatalog;
use App\Support\Rbac;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

/**
 * IMP-PARTNER-STATEMENTS PS-A2a (D-PS-08 + D-PS-13) — مفتاح القدرة `accounting.partner_statements`:
 *   - **لا تفعيل ضمني**: `explicit_enable_only` ⇒ غياب القرار = معطّلة للمستأجرين القدامى (المسجَّلين قبل `ENFORCEMENT_CUTOVER_AT`) والجدد معاً،
 *     بينما بقية القدرات تحتفظ بدلالتها الافتراضية حرفياً.
 *   - التفعيل بالمسارات القائمة وحدها (`/applications/enable`)؛ التفعيل لا يمنح RBAC، وRBAC لا يتجاوز تعطيل القدرة.
 *   - التعطيل يمنع المسارات؛ وبوجود كشف مستورد يتحول الإيقاف إلى تعليق (قراءة فقط).
 *   - العزل بين المستأجرين، وتطابق ملخص تجاوزات المنصة مع دلالة `statusFor()`.
 * تشغيل: php artisan test --filter=PartnerStatementApplicationGateTest
 */
class PartnerStatementApplicationGateTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private const KEY = 'accounting.partner_statements';

    private const LEGACY_AT = '2026-01-01 00:00:00';

    private const BASE = '/api/partner-statements/import';

    // ═══════════════════════════════ أدوات ═══════════════════════════════

    /** @return array{token: string, tenant_id: string} مستأجر بلا أي قدرة مفعَّلة تلقائياً. */
    private function tenant(string $slug, bool $legacy): array
    {
        $auth = $this->registerTenant($slug, $slug.'@gate.test', autoEnableApplications: false);
        if ($legacy) {
            Tenant::query()->whereKey($auth['tenant_id'])->update(['created_at' => self::LEGACY_AT]);
        }

        return $auth;
    }

    private function csv(): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('s.csv', SpreadsheetWriter::csv(
            ['التاريخ', 'رقم المستند', 'مدين', 'دائن'],
            [['2026-09-01', 'INV-1', '100.00', '']],
        ));
    }

    /** @return array<string, int> حالة HTTP لكل مسار من مسارات الكشوف الأربعة. */
    private function statuses(string $token, string $partnerId): array
    {
        $options = ['partner_id' => $partnerId, 'role' => 'customer', 'period_from' => '2026-09-01', 'period_to' => '2026-09-30'];

        return [
            'template' => $this->withToken($token)->getJson(self::BASE.'/template')->getStatusCode(),
            'fields' => $this->withToken($token)->getJson(self::BASE.'/fields')->getStatusCode(),
            'inspect' => $this->withToken($token)->post(self::BASE.'/inspect', ['file' => $this->csv()], ['Accept' => 'application/json'])->getStatusCode(),
            'preview' => $this->withToken($token)->post(self::BASE.'/preview', ['file' => $this->csv()] + $options, ['Accept' => 'application/json'])->getStatusCode(),
        ];
    }

    private function partner(string $tenantId): Partner
    {
        app(TenantContext::class)->set($tenantId);

        return Partner::create(['type' => 'customer', 'entity_type' => 'commercial', 'name' => 'عميل البوابة', 'is_active' => true]);
    }

    private function enable(string $token): void
    {
        $this->withToken($token)->postJson('/api/applications/enable', ['application_key' => self::KEY])->assertOk();
    }

    private function appStatus(string $tenantId, string $key = self::KEY): string
    {
        app(TenantContext::class)->set($tenantId);

        return app(TenantApplicationService::class)->statusFor($key);
    }

    // ═══════════════════════════════ الكتالوج ═══════════════════════════════

    /** @test */
    public function the_catalogue_entry_is_built_optional_depends_on_the_ledger_and_is_the_only_explicit_enable_only_key(): void
    {
        $app = ApplicationCatalog::find(self::KEY);

        $this->assertSame(['accounting', ApplicationCatalog::MATURITY_BUILT, false, ['accounting.ledger'], ApplicationCatalog::ACCESS_OPERATIONAL, true], [
            $app['group'], $app['maturity'], $app['mandatory'], $app['dependencies'], $app['access'], $app['explicit_enable_only'],
        ]);
        $this->assertTrue(ApplicationCatalog::isExplicitEnableOnly(self::KEY));
        $this->assertFalse(ApplicationCatalog::isExplicitEnableOnly('unknown.key'));
        $this->assertSame([], ApplicationCatalog::validationErrors());

        // D-PS-13: لا تتغير الدلالة الافتراضية لأي قدرة أخرى.
        $others = array_keys(array_filter(ApplicationCatalog::all(), fn (array $a, string $k): bool => $a['explicit_enable_only'] && $k !== self::KEY, ARRAY_FILTER_USE_BOTH));
        $this->assertSame([], $others);
    }

    // ═══════════════════════════════ غياب القرار ═══════════════════════════════

    /** @test */
    public function a_legacy_tenant_without_a_decision_has_the_capability_disabled_while_other_undecided_apps_keep_the_legacy_default(): void
    {
        $auth = $this->tenant('legacy-a', legacy: true);

        $this->assertSame('disabled', $this->appStatus($auth['tenant_id']));
        $this->assertSame('enabled', $this->appStatus($auth['tenant_id'], 'purchases.cycle'), 'التوافق الخلفي: القدرات الأخرى بلا قرار تبقى مفعَّلة للقدامى.');
        $this->assertSame('enabled', $this->appStatus($auth['tenant_id'], 'hr.employees'));

        $nav = $this->withToken($auth['token'])->getJson('/api/applications/nav-state')->assertOk()->json('data');
        $this->assertFalse($nav[self::KEY]);
        $this->assertTrue($nav['purchases.cycle']);

        $list = $this->withToken($auth['token'])->getJson('/api/applications')->assertOk()->json('data');
        $this->assertFalse($list[self::KEY]['enabled']);

        $partner = $this->partner($auth['tenant_id']);
        $this->assertSame(['template' => 403, 'fields' => 403, 'inspect' => 403, 'preview' => 403], $this->statuses($auth['token'], $partner->id));
        $this->assertSame(0, TenantApplicationState::query()->where('application_key', self::KEY)->count(), 'لا صف قرار يُكتب ضمنياً.');
    }

    /** @test */
    public function a_new_tenant_without_a_decision_is_disabled_too(): void
    {
        $auth = $this->tenant('new-a', legacy: false);

        $this->assertSame('disabled', $this->appStatus($auth['tenant_id']));
        $this->assertSame('disabled', $this->appStatus($auth['tenant_id'], 'purchases.cycle'), 'الجديد يبقى على الافتراضي الحقيقي لبقية القدرات.');
        $partner = $this->partner($auth['tenant_id']);
        $this->assertSame(['template' => 403, 'fields' => 403, 'inspect' => 403, 'preview' => 403], $this->statuses($auth['token'], $partner->id));
    }

    // ═══════════════════════════════ التفعيل الصريح ═══════════════════════════════

    /** @test */
    public function an_explicit_enable_through_the_existing_path_opens_the_routes_and_writes_the_audit_event(): void
    {
        $auth = $this->tenant('legacy-b', legacy: true);
        $partner = $this->partner($auth['tenant_id']);

        $this->enable($auth['token']);

        $this->assertSame('enabled', $this->appStatus($auth['tenant_id']));
        $this->assertSame(['template' => 200, 'fields' => 200, 'inspect' => 200, 'preview' => 200], $this->statuses($auth['token'], $partner->id));
        $this->assertTrue($this->withToken($auth['token'])->getJson('/api/applications/nav-state')->json('data')[self::KEY]);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame('enabled', TenantApplicationEvent::query()->where('application_key', self::KEY)->value('action'));
    }

    /** @test */
    public function enabling_does_not_grant_rbac_and_rbac_does_not_bypass_a_disabled_app(): void
    {
        $this->assertNotContains('partner_statements.reconcile', Rbac::MATRIX['accountant'] ?? [], 'لا منح ضمني في المصفوفة.');
        $this->assertNotContains('partner_statements.view', Rbac::MATRIX['accountant'] ?? []);

        $auth = $this->tenant('legacy-c', legacy: true);
        $partner = $this->partner($auth['tenant_id']);
        $accountant = $this->tokenForRole($auth['tenant_id'], 'accountant', 'acct@gate.test');

        // القدرة معطلة: صاحب الصلاحية الكاملة (owner) مرفوض أيضاً.
        $this->assertSame(403, $this->statuses($auth['token'], $partner->id)['template']);

        $this->enable($auth['token']);

        // القدرة مفعلة: owner يمرّ، والمحاسب بلا الصلاحية المستقلة يبقى مرفوضاً — التفعيل لم يمنح شيئاً.
        $this->assertSame(200, $this->statuses($auth['token'], $partner->id)['template']);
        $this->assertSame(['template' => 403, 'fields' => 403, 'inspect' => 403, 'preview' => 403], $this->statuses($accountant, $partner->id));
    }

    // ═══════════════════════════════ التعطيل والتعليق ═══════════════════════════════

    /** @test */
    public function disabling_without_data_blocks_every_route(): void
    {
        $auth = $this->tenant('legacy-d', legacy: true);
        $partner = $this->partner($auth['tenant_id']);
        $this->enable($auth['token']);
        $this->assertSame(200, $this->statuses($auth['token'], $partner->id)['fields']);

        $this->withToken($auth['token'])->postJson('/api/applications/disable', ['application_key' => self::KEY])->assertOk();

        $this->assertSame('disabled', $this->appStatus($auth['tenant_id']));
        $this->assertSame(['template' => 403, 'fields' => 403, 'inspect' => 403, 'preview' => 403], $this->statuses($auth['token'], $partner->id));
    }

    /** @test */
    public function disabling_with_an_imported_statement_suspends_to_read_only(): void
    {
        $auth = $this->tenant('legacy-e', legacy: true);
        $partner = $this->partner($auth['tenant_id']);
        $this->enable($auth['token']);

        app(TenantContext::class)->set($auth['tenant_id']);
        PartnerStatementReconciliation::create([
            'partner_id' => $partner->id, 'role' => 'customer', 'period_from' => '2026-09-01', 'period_to' => '2026-09-30', 'currency' => 'SAR',
            'status' => 'draft', 'file_sha256' => str_repeat('a', 64), 'identity_sha256' => str_repeat('b', 64), 'line_count' => 0,
            'policy' => ['version' => 1], 'created_by' => User::query()->value('id'),
        ]);

        $res = $this->withToken($auth['token'])->postJson('/api/applications/disable', ['application_key' => self::KEY])->assertOk();
        $this->assertSame('suspended', $res->json('data.status'));

        // قراءة فقط: GET يمرّ، وأي POST (فحص/معاينة) مرفوض.
        $this->assertSame(['template' => 200, 'fields' => 200, 'inspect' => 403, 'preview' => 403], $this->statuses($auth['token'], $partner->id));
    }

    // ═══════════════════════════════ العزل والتكافؤ ═══════════════════════════════

    /** @test */
    public function the_decision_is_per_tenant(): void
    {
        $a = $this->tenant('iso-a', legacy: true);
        $b = $this->tenant('iso-b', legacy: true);
        $partnerA = $this->partner($a['tenant_id']);
        $partnerB = $this->partner($b['tenant_id']);

        $this->enable($a['token']);

        $this->assertSame(200, $this->statuses($a['token'], $partnerA->id)['template']);
        $this->assertSame(403, $this->statuses($b['token'], $partnerB->id)['template'], 'تفعيل مستأجر لا يفعّل غيره.');
        $this->assertSame('disabled', $this->appStatus($b['tenant_id']));
    }

    /** @test */
    public function the_platform_override_summary_uses_the_same_default_semantics(): void
    {
        $legacy = $this->tenant('sum-legacy', legacy: true);
        $new = $this->tenant('sum-new', legacy: false);
        $service = app(PlatformApplicationOverrideService::class);

        foreach ([$legacy, $new] as $auth) {
            app(TenantContext::class)->set($auth['tenant_id']);
            $rows = collect($service->globalSummaryRows(Tenant::findOrFail($auth['tenant_id']), collect(), collect(), []))->keyBy('key');
            $this->assertSame('disabled', $rows[self::KEY]['operational_status']);
        }

        app(TenantContext::class)->set($legacy['tenant_id']);
        $rows = collect($service->globalSummaryRows(Tenant::findOrFail($legacy['tenant_id']), collect(), collect(), []))->keyBy('key');
        $this->assertSame('enabled', $rows['purchases.cycle']['operational_status'], 'القدرات الأخرى للقدامى كما كانت.');
    }
}
