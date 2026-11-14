<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\AccountRoleMapping;
use App\Models\CashBankAccount;
use App\Models\FuelInventoryCostMovement;
use App\Models\FuelInventoryCostState;
use App\Models\FuelStationConfigurationEvent;
use App\Models\FuelStationSettingOverride;
use App\Models\FuelTankerFill;
use App\Models\JournalEntry;
use App\Models\StockMovement;
use App\Services\FuelStationSettingsService;
use App\Services\FuelTankerClearingAccountGuard as Guard;
use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Support\FuelStaffTemplates;
use App\Support\StationSessionBoundary;
use App\Support\Rbac;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * TANKER-PR6B-1 — الحساب الوسيط وإعدادات الدمج المخزني والصلاحيات. **لا أثر مالي أو مخزني**: الإعدادات تخزَّن وتُقيَّم فقط؛ لا قيد ولا حركة ولا حساب جديد ولا تغيير سند،
 * وبوابة الترحيل تبقى مغلقة. يغطي: صحة اختيار الحساب ونوعه، الوراثة، الحوكمة، التدقيق والقيمة السابقة، عزل المستأجر والمحطة، جلسات PIN، والبوابتين.
 */
class FuelTankerInventorySettingsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelStaffFixture;

    private const BASE = '/api/fuel-stations';
    private const SETTINGS = '/api/fuel-stations/tanker-fills/inventory-settings';
    private const KEYS = ['tanker_issue_clearing_account_id', 'tanker_cost_recognition', 'fuel_pool_ledger_variance_policy', 'tanker_inventory_posting_start_at', 'tanker_inventory_alerts_enabled'];
    private const GOVERNANCE = ['tanker_issue_clearing_account_id', 'tanker_cost_recognition', 'fuel_pool_ledger_variance_policy', 'tanker_inventory_posting_start_at'];
    private const NEW_PERMISSIONS = ['fuel.tanker.fill.inventory.post', 'fuel.tanker.fill.inventory.reverse', 'fuel.tanker.fill.inventory.post_historical'];

    private int $seq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        config(['fuel_stations.tanker_management_enabled' => true, 'fuel_stations.tanker_fills_enabled' => true]);
        $this->buildFixture();
        app(TenantContext::class)->set($this->tenantId);
    }

    // ───────────────────────── أدوات ─────────────────────────

    private function asset(string $code = '1145', string $name = 'وقود لدى أصحاب الصهاريج', array $extra = []): Account
    {
        return Account::create(array_merge(['code' => $code, 'name' => $name, 'type' => 'asset', 'normal_balance' => 'debit', 'is_group' => false, 'is_active' => true], $extra));
    }

    /** @return array{user: \App\Models\User, token: string} */
    private function manager(bool $governance = true, array $extra = [], ?array $stations = null): array
    {
        $n = ++$this->seq;

        return $this->makeUser("t6b1m{$n}", "role-t6b1-{$n}", array_merge(['fuel_stations.view', 'fuel_stations.manage', 'accounts.view'], $governance ? ['fuel.governance.manage'] : [], $extra), $stations);
    }

    private function putTenant(string $token, array $payload): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($token)->putJson(self::BASE . '/settings', $payload + ['reason' => 'اختبار']);
    }

    private function putStation(string $token, array $payload, ?string $stationId = null): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($token)->putJson(self::BASE . '/stations/' . ($stationId ?? $this->fx['s1']->id) . '/settings', $payload + ['reason' => 'اختبار']);
    }

    /** @return array<string,int> */
    private function effects(): array
    {
        return [
            'journals' => JournalEntry::query()->count(),
            'lines' => (int) DB::table('journal_lines')->count(),
            'movements' => StockMovement::query()->count(),
            'cost_movements' => FuelInventoryCostMovement::query()->count(),
            'pools' => FuelInventoryCostState::query()->count(),
            'fills' => FuelTankerFill::query()->count(),
            'accounts' => Account::query()->count(),
            'role_mappings' => AccountRoleMapping::query()->count(),
            'postings' => (int) DB::table('fuel_tanker_fill_inventory_postings')->count(),
            'invoices' => \App\Models\Invoice::query()->count(),
        ];
    }

    private function events(string $key): \Illuminate\Support\Collection
    {
        return FuelStationConfigurationEvent::query()->where('setting_key', $key)->orderBy('changed_at')->orderBy('id')->get();
    }

    // ───────────────────────── الافتراضات والغياب ─────────────────────────

    /** @test */
    public function defaults_are_the_approved_values_and_there_is_no_silent_clearing_account(): void
    {
        $tenant = $this->withToken($this->fx['owner'])->getJson(self::BASE . '/settings')->assertOk()->json('data');
        $this->assertNull($tenant['tanker_issue_clearing_account_id']);
        $this->assertSame('clearing_until_invoice', $tenant['tanker_cost_recognition']);
        $this->assertSame('block', $tenant['fuel_pool_ledger_variance_policy'], 'الافتراضي block بقرار المالك');
        $this->assertNull($tenant['tanker_inventory_posting_start_at']);
        $this->assertTrue($tenant['tanker_inventory_alerts_enabled']);

        $config = app(FuelStationSettingsService::class)->tankerInventoryPostingConfig($this->fx['s1']);
        $this->assertFalse($config['clearing_account']['configured']);
        $this->assertFalse($config['clearing_account']['valid']);
        $this->assertNull($config['posting_start_at']);

        $before = $this->effects();
        $data = $this->withToken($this->fx['owner'])->getJson(self::SETTINGS . '?station_id=' . $this->fx['s1']->id)->assertOk()->json();
        $this->assertSame(['clearing_account_missing'], $data['data']['blockers']);
        $this->assertSame(['posting_start_not_set', 'posting_gate_closed'], $data['data']['notices']);
        $this->assertTrue($data['meta']['read_only']);
        $this->assertFalse($data['meta']['posting_enabled']);
        $this->assertFalse($data['meta']['posting_gate_open']);
        $this->assertSame($before, $this->effects());
        // لا إنشاء تلقائي لأي حساب (لا 1145 ولا غيره).
        $this->assertFalse(Account::query()->where('code', '1145')->exists());
    }

    /** @test */
    public function the_posting_gate_is_closed_by_default_and_nothing_in_the_app_reads_it_except_the_read_only_review(): void
    {
        $this->assertFalse((bool) config('fuel_stations.tanker_inventory_posting_enabled'));
        $this->assertSame(false, \App\Services\FuelTankerFillInventoryReadiness::POSTING_ENABLED);

        $hits = [];
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(base_path('app'), \FilesystemIterator::SKIP_DOTS)) as $file) {
            if ($file->isFile() && str_ends_with($file->getFilename(), '.php') && str_contains((string) file_get_contents($file->getPathname()), 'tanker_inventory_posting_enabled')) {
                $hits[] = $file->getFilename();
            }
        }
        sort($hits);
        // PR-6B-3: القارئان الجديدان هما بوابة الترحيل (الوسيط) وخدمة الترحيل نفسها (ترفض عند الإغلاق)؛ والمراجعة تعرض حالتها فقط.
        $this->assertSame(['EnsureFuelTankerInventoryPostingEnabled.php', 'FuelTankerFillInventoryPostingService.php', 'FuelTankerFillInventoryReviewController.php'], $hits, 'قرّاء البوابة: الوسيط والخدمة وعرض الحالة');
    }

    // ───────────────────────── التحقق من الحساب ─────────────────────────

    /** @test */
    public function a_valid_asset_account_is_accepted_and_stored_without_any_financial_effect(): void
    {
        $account = $this->asset();
        $before = $this->effects();

        $this->putTenant($this->fx['owner'], ['tanker_issue_clearing_account_id' => $account->id])->assertOk()->assertJsonPath('data.tanker_issue_clearing_account_id', $account->id);

        $config = app(FuelStationSettingsService::class)->tankerInventoryPostingConfig($this->fx['s1']);
        $this->assertTrue($config['clearing_account']['valid']);
        $this->assertNull($config['clearing_account']['reason']);
        $this->assertSame($before, $this->effects());
    }

    /** @return array<string, array{0: callable(self): Account, 1: string}> */
    public static function invalidAccounts(): array
    {
        return [
            'liability' => [fn (self $t) => $t->asset('2301', 'التزام', ['type' => 'liability', 'normal_balance' => 'credit']), Guard::NOT_ASSET],
            'equity' => [fn (self $t) => $t->asset('3301', 'حقوق', ['type' => 'equity', 'normal_balance' => 'credit']), Guard::NOT_ASSET],
            'expense' => [fn (self $t) => $t->asset('5301', 'مصروف', ['type' => 'expense']), Guard::NOT_ASSET],
            'group' => [fn (self $t) => $t->asset('1145', 'تجميعي', ['is_group' => true]), Guard::GROUP],
            'inactive' => [fn (self $t) => $t->asset('1146', 'معطّل', ['is_active' => false]), Guard::INACTIVE],
            'system inventory 1140' => [fn (self $t) => Account::query()->where('code', '1140')->firstOrFail(), Guard::INVENTORY_ACCOUNT],
            'system cash 1110' => [fn (self $t) => Account::query()->where('code', '1110')->firstOrFail(), Guard::CASH_OR_BANK],
            'system bank 1120' => [fn (self $t) => Account::query()->where('code', '1120')->firstOrFail(), Guard::CASH_OR_BANK],
            'vat input 1150' => [fn (self $t) => Account::query()->where('code', '1150')->firstOrFail(), Guard::TAX_ACCOUNT],
            'receivables 1130' => [fn (self $t) => Account::query()->where('code', '1130')->firstOrFail(), Guard::RESERVED_ROLE],
        ];
    }

    /**
     * @test
     * @dataProvider invalidAccounts
     */
    public function invalid_accounts_are_rejected_with_a_stable_reason_and_the_previous_value_is_kept(callable $make, string $reason): void
    {
        $good = $this->asset('1147', 'وسيط سليم');
        $this->putTenant($this->fx['owner'], ['tanker_issue_clearing_account_id' => $good->id])->assertOk();
        $eventsBefore = $this->events('tanker_issue_clearing_account_id')->count();

        $bad = $make($this);
        $response = $this->putTenant($this->fx['owner'], ['tanker_issue_clearing_account_id' => $bad->id])->assertStatus(422);
        $this->assertStringContainsString('FUEL_TANKER_CLEARING_ACCOUNT_INVALID:' . $reason . ':', (string) $response->json('message'));

        $this->assertSame($good->id, $this->withToken($this->fx['owner'])->getJson(self::BASE . '/settings')->json('data.tanker_issue_clearing_account_id'), 'القيمة السابقة محفوظة');
        $this->assertSame($eventsBefore, $this->events('tanker_issue_clearing_account_id')->count(), 'لا حدث تدقيق لرفض');
    }

    /** @test */
    public function mapped_inventory_cash_tax_and_other_role_accounts_are_rejected_even_when_custom(): void
    {
        $customInventory = $this->asset('1148', 'مخزون مخصص');
        AccountRoleMapping::query()->updateOrCreate(['role_key' => 'inventory_asset'], ['account_id' => $customInventory->id]);
        $this->putTenant($this->fx['owner'], ['tanker_issue_clearing_account_id' => $customInventory->id])->assertStatus(422);

        $cash = $this->asset('1149', 'خزينة مخصصة');
        CashBankAccount::create(['account_id' => $cash->id, 'type' => 'cash', 'name' => 'خزينة', 'currency' => 'SAR', 'is_active' => true]);
        $this->putTenant($this->fx['owner'], ['tanker_issue_clearing_account_id' => $cash->id])->assertStatus(422);

        $custom = $this->asset('1151', 'ذمم مخصصة');
        AccountRoleMapping::query()->updateOrCreate(['role_key' => 'accounts_receivable'], ['account_id' => $custom->id]);
        $this->putTenant($this->fx['owner'], ['tanker_issue_clearing_account_id' => $custom->id])->assertStatus(422);

        // حساب مخزون لمحطة (تجاوز) ولو سابقاً: يبقى ضمن مجموعة المخزون.
        $override = $this->asset('1152', 'مخزون محطة');
        $this->fx['s1']->forceFill(['default_inventory_account_id' => $override->id])->save();
        $this->putTenant($this->fx['owner'], ['tanker_issue_clearing_account_id' => $override->id])->assertStatus(422);
    }

    /** @test */
    public function an_account_of_another_tenant_or_garbage_is_never_accepted(): void
    {
        $other = $this->registerTenant('fuel-t6b1-b', 'owner@fuel-t6b1-b.test', autoEnableApplications: true);
        app(TenantContext::class)->set($other['tenant_id']);
        $foreign = $this->asset('1145', 'حساب مستأجر آخر');
        app(TenantContext::class)->set($this->tenantId);

        $this->assertSame(Guard::NOT_FOUND, app(Guard::class)->violation($foreign->id));
        $response = $this->putTenant($this->fx['owner'], ['tanker_issue_clearing_account_id' => $foreign->id])->assertStatus(422);
        $this->assertStringContainsString(':not_found:', (string) $response->json('message'));
        $this->putTenant($this->fx['owner'], ['tanker_issue_clearing_account_id' => 'not-a-uuid'])->assertStatus(422);
        $this->putTenant($this->fx['owner'], ['tanker_issue_clearing_account_id' => '1145'])->assertStatus(422);
        $this->assertNull($this->withToken($this->fx['owner'])->getJson(self::BASE . '/settings')->json('data.tanker_issue_clearing_account_id'));
    }

    // ───────────────────────── القيم الأخرى ─────────────────────────

    /** @test */
    public function cost_recognition_variance_policy_start_and_alerts_are_validated(): void
    {
        $this->putTenant($this->fx['owner'], ['tanker_cost_recognition' => 'immediate_cogs'])->assertStatus(422);
        $this->putTenant($this->fx['owner'], ['tanker_cost_recognition' => 'clearing_until_invoice'])->assertOk();

        $this->putTenant($this->fx['owner'], ['fuel_pool_ledger_variance_policy' => 'ignore'])->assertStatus(422);
        $this->putTenant($this->fx['owner'], ['fuel_pool_ledger_variance_policy' => 'warn'])->assertOk()->assertJsonPath('data.fuel_pool_ledger_variance_policy', 'warn');

        foreach (['2026-12-01', 'غد', '2026-12-01 00:00:00', '2026-13-40T00:00:00+03:00'] as $bad) {
            $this->putTenant($this->fx['owner'], ['tanker_inventory_posting_start_at' => $bad])->assertStatus(422);
        }
        $this->putTenant($this->fx['owner'], ['tanker_inventory_posting_start_at' => '2026-12-01T00:00:00+03:00'])->assertOk();
        $this->assertSame('2026-11-30T21:00:00Z', app(FuelStationSettingsService::class)->tankerInventoryPostingConfig(null)['posting_start_at']);
        // المسح على مستوى المؤسسة.
        $this->putTenant($this->fx['owner'], ['tanker_inventory_posting_start_at' => null])->assertOk();
        $this->assertNull(app(FuelStationSettingsService::class)->tankerInventoryPostingConfig(null)['posting_start_at']);

        $this->putTenant($this->fx['owner'], ['tanker_inventory_alerts_enabled' => 'yes'])->assertStatus(422);
        $this->putTenant($this->fx['owner'], ['tanker_inventory_alerts_enabled' => false])->assertOk();
        $this->assertFalse(app(FuelStationSettingsService::class)->tankerInventoryPostingConfig(null)['alerts_enabled']);
    }

    /** @test */
    public function corrupt_stored_values_fall_back_to_the_safe_defaults(): void
    {
        FuelStationSettingOverride::create(['tenant_id' => $this->tenantId, 'fuel_station_id' => $this->fx['s1']->id, 'device_key' => '', 'setting_key' => 'fuel_pool_ledger_variance_policy', 'value' => 'garbage']);
        FuelStationSettingOverride::create(['tenant_id' => $this->tenantId, 'fuel_station_id' => $this->fx['s1']->id, 'device_key' => '', 'setting_key' => 'tanker_cost_recognition', 'value' => 'immediate_cogs']);
        FuelStationSettingOverride::create(['tenant_id' => $this->tenantId, 'fuel_station_id' => $this->fx['s1']->id, 'device_key' => '', 'setting_key' => 'tanker_inventory_posting_start_at', 'value' => 'not a date']);

        $config = app(FuelStationSettingsService::class)->tankerInventoryPostingConfig($this->fx['s1']);
        $this->assertSame('block', $config['variance_policy']);
        $this->assertSame('clearing_until_invoice', $config['cost_recognition']);
        $this->assertNull($config['posting_start_at']);
    }

    // ───────────────────────── الوراثة والتدقيق ─────────────────────────

    /** @test */
    public function stations_inherit_from_the_tenant_override_per_station_and_clearing_returns_to_inheritance_with_audit_history(): void
    {
        $tenantAccount = $this->asset('1145', 'وسيط المؤسسة');
        $stationAccount = $this->asset('1146', 'وسيط المحطة');
        $svc = app(FuelStationSettingsService::class);

        $this->putTenant($this->fx['owner'], ['tanker_issue_clearing_account_id' => $tenantAccount->id, 'fuel_pool_ledger_variance_policy' => 'warn'])->assertOk();
        $this->assertSame($tenantAccount->id, $svc->tankerInventoryPostingConfig($this->fx['s1'])['clearing_account']['account_id']);
        $this->assertSame('warn', $svc->tankerInventoryPostingConfig($this->fx['s2'])['variance_policy']);

        $this->putStation($this->fx['owner'], ['tanker_issue_clearing_account_id' => $stationAccount->id])->assertOk()->assertJsonPath('meta.overrides', ['tanker_issue_clearing_account_id']);
        $this->assertSame($stationAccount->id, $svc->tankerInventoryPostingConfig($this->fx['s1'])['clearing_account']['account_id']);
        $this->assertSame($tenantAccount->id, $svc->tankerInventoryPostingConfig($this->fx['s2'])['clearing_account']['account_id'], 'محطة أخرى ترث المؤسسة');

        // مسح تجاوز المحطة ⇒ عودة الوراثة، مع سجل تدقيق بالقيمة السابقة والجديدة والفاعل والسبب.
        $this->putStation($this->fx['owner'], ['tanker_issue_clearing_account_id' => null, 'reason' => 'عودة للمؤسسة'])->assertOk()->assertJsonPath('meta.overrides', []);
        $this->assertSame($tenantAccount->id, $svc->tankerInventoryPostingConfig($this->fx['s1'])['clearing_account']['account_id']);

        $events = $this->events('tanker_issue_clearing_account_id');
        $this->assertCount(3, $events);
        $this->assertSame($tenantAccount->id, $events[0]->after['value']);
        $this->assertSame($stationAccount->id, $events[1]->after['value']);
        $this->assertSame($stationAccount->id, $events[2]->before['value']);
        $this->assertNotNull($events[1]->changed_by);
        $this->assertSame('عودة للمؤسسة', $events[2]->reason);
    }

    /** @test */
    public function an_unchanged_value_writes_no_audit_event_and_a_change_keeps_before_and_after(): void
    {
        $this->putTenant($this->fx['owner'], ['fuel_pool_ledger_variance_policy' => 'warn'])->assertOk();
        $this->putTenant($this->fx['owner'], ['fuel_pool_ledger_variance_policy' => 'warn'])->assertOk();
        $this->putTenant($this->fx['owner'], ['fuel_pool_ledger_variance_policy' => 'block'])->assertOk();

        $events = $this->events('fuel_pool_ledger_variance_policy');
        $this->assertCount(2, $events);
        $this->assertSame('warn', $events[1]->before['value']);
        $this->assertSame('block', $events[1]->after['value']);
    }

    /** @test */
    public function the_new_keys_do_not_accept_a_device_override(): void
    {
        foreach (self::KEYS as $key) {
            $thrown = null;
            try {
                app(FuelStationSettingsService::class)->putDevice($this->fx['s1'], 'dev-1', $key, $key === 'tanker_inventory_alerts_enabled' ? true : 'x');
            } catch (\RuntimeException $e) {
                $thrown = $e;
            }
            $this->assertNotNull($thrown, "{$key} لا يقبل override جهاز");
        }
    }

    // ───────────────────────── الحوكمة والصلاحيات ─────────────────────────

    /** @test */
    public function governance_keys_need_the_governance_permission_everywhere_but_alerts_need_only_manage(): void
    {
        $account = $this->asset();
        $manager = $this->manager(false);
        $payloads = [
            ['tanker_issue_clearing_account_id' => $account->id], ['tanker_cost_recognition' => 'clearing_until_invoice'],
            ['fuel_pool_ledger_variance_policy' => 'warn'], ['tanker_inventory_posting_start_at' => '2026-12-01T00:00:00+03:00'],
        ];
        foreach ($payloads as $payload) {
            $this->putTenant($manager['token'], $payload)->assertForbidden();
            $this->putStation($manager['token'], $payload)->assertForbidden();
            $this->putStation($manager['token'], array_map(fn () => null, $payload))->assertForbidden(); // المسح أيضاً
        }
        $this->assertSame([], $this->events('tanker_issue_clearing_account_id')->all());

        $this->putTenant($manager['token'], ['tanker_inventory_alerts_enabled' => false])->assertOk();
        // طلب مختلط بلا حوكمة يُرفض كله بلا تطبيق جزئي.
        $this->putTenant($manager['token'], ['tanker_inventory_alerts_enabled' => true, 'fuel_pool_ledger_variance_policy' => 'warn'])->assertForbidden();
        $this->assertFalse(app(FuelStationSettingsService::class)->tankerInventoryPostingConfig(null)['alerts_enabled']);

        $governance = $this->manager(true);
        $this->putTenant($governance['token'], ['tanker_issue_clearing_account_id' => $account->id, 'tanker_inventory_alerts_enabled' => true])->assertOk();
    }

    /** @test */
    public function the_three_new_permissions_are_reserved_owner_admin_only_with_no_route_and_no_staff_template_or_pin_access(): void
    {
        $matrix = (new \ReflectionClass(Rbac::class))->getConstant('MATRIX');
        foreach (self::NEW_PERMISSIONS as $permission) {
            $this->assertContains($permission, Rbac::PERMISSIONS);
            foreach ($matrix as $role => $permissions) {
                $this->assertNotContains($permission, $permissions, "{$role} لا يملك {$permission} ضمنياً");
            }
            foreach (FuelStaffTemplates::all() as $template => $definition) {
                $this->assertNotContains($permission, $definition['permissions'], "قالب {$template} لا يمنحها");
            }
        }

        // owner/admin عبر `*` فقط. PR-6B-3: مسار الترحيل وحده يستعمل `…inventory.post` (مرة واحدة بالضبط)؛ `post_historical` تُفحص في الخدمة لا في مسار، و`reverse` بلا مسار (PR-6B-4).
        $routes = (string) file_get_contents(base_path('routes/api.php'));
        $this->assertSame(1, preg_match_all("/fuel\.tanker\.fill\.inventory\.post'/", $routes), 'مسار ترحيل واحد فقط');
        foreach (['fuel.tanker.fill.inventory.post_historical', 'fuel.tanker.fill.inventory.reverse'] as $permission) {
            $this->assertStringNotContainsString($permission, $routes, "لا مسار يستعمل {$permission}");
        }
        // أي دور مخزَّن لم يُمنحها بهجرة.
        $this->assertSame(0, (int) DB::table('roles')->get(['permissions'])->filter(fn ($r) => array_intersect(self::NEW_PERMISSIONS, (array) json_decode((string) $r->permissions, true)) !== [])->count());
    }

    // ───────────────────────── نقطة التقييم: الصلاحيات والبوابات والعزل ─────────────────────────

    /** @test */
    public function the_evaluation_endpoint_needs_the_view_permission_both_gates_and_a_pin_session_cannot_reach_it(): void
    {
        $viewer = $this->manager(false, ['fuel.tanker.fill.view', 'fuel.tanker.fill.inventory.view']);
        $plain = $this->manager(false);

        $this->withToken($viewer['token'])->getJson(self::SETTINGS)->assertOk();
        $this->withToken($plain['token'])->getJson(self::SETTINGS)->assertForbidden();

        $session = $viewer['user']->createToken(StationSessionBoundary::TOKEN_NAME, [StationSessionBoundary::ABILITY])->plainTextToken;
        $this->withToken($session)->getJson(self::SETTINGS)->assertForbidden();

        foreach ([['fuel_stations.tanker_fills_enabled' => false], ['fuel_stations.tanker_management_enabled' => false]] as $closed) {
            config($closed);
            $this->withToken($viewer['token'])->getJson(self::SETTINGS)->assertNotFound();
            $this->withToken($this->fx['owner'])->getJson(self::SETTINGS)->assertNotFound();
            config(['fuel_stations.tanker_fills_enabled' => true, 'fuel_stations.tanker_management_enabled' => true]);
        }
    }

    /** @test */
    public function the_account_identity_is_hidden_from_a_reviewer_without_accounts_view_and_no_amounts_ever_appear(): void
    {
        $account = $this->asset();
        $this->putTenant($this->fx['owner'], ['tanker_issue_clearing_account_id' => $account->id])->assertOk();
        $withView = $this->manager(false, ['fuel.tanker.fill.view', 'fuel.tanker.fill.inventory.view']);
        $n = ++$this->seq;
        $withoutView = $this->makeUser("t6b1nv{$n}", "role-t6b1-nv{$n}", ['fuel_stations.view', 'fuel.tanker.fill.view', 'fuel.tanker.fill.inventory.view']);

        $seen = $this->withToken($withView['token'])->getJson(self::SETTINGS)->assertOk()->json('data.clearing_account');
        $this->assertSame('1145', $seen['account']['code']);
        $this->assertTrue($seen['valid']);

        $hidden = $this->withToken($withoutView['token'])->getJson(self::SETTINGS)->assertOk()->json('data.clearing_account');
        $this->assertNull($hidden['account'], 'اسم/كود الحساب لمن يملك accounts.view فقط');
        $this->assertTrue($hidden['valid']);

        $this->assertStringNotContainsString('balance', (string) json_encode($this->withToken($withView['token'])->getJson(self::SETTINGS)->json()));
    }

    /** @test */
    public function a_station_out_of_scope_is_a_uniform_404_and_other_tenants_never_see_the_configuration(): void
    {
        $viewer = $this->manager(false, ['fuel.tanker.fill.view', 'fuel.tanker.fill.inventory.view'], [$this->fx['s1']->id]);
        $this->withToken($viewer['token'])->getJson(self::SETTINGS . '?station_id=' . $this->fx['s1']->id)->assertOk();
        $this->withToken($viewer['token'])->getJson(self::SETTINGS . '?station_id=' . $this->fx['s2']->id)->assertNotFound();
        $this->withToken($viewer['token'])->getJson(self::SETTINGS . '?station_id=not-a-uuid')->assertStatus(422);

        $account = $this->asset();
        $this->putStation($this->fx['owner'], ['tanker_issue_clearing_account_id' => $account->id])->assertOk();
        $other = $this->registerTenant('fuel-t6b1-c', 'owner@fuel-t6b1-c.test', autoEnableApplications: true);
        app(TenantContext::class)->set($other['tenant_id']);
        app(EntitlementGrantService::class)->grant(
            \App\Models\Tenant::findOrFail($other['tenant_id']), 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL,
            \Carbon\CarbonImmutable::now('UTC'), grantReasonCode: 'test_t6b1_other', reason: 'اختبار عزل المستأجر.',
        );
        $this->withToken($other['token'])->getJson(self::SETTINGS . '?station_id=' . $this->fx['s1']->id)->assertStatus(404);
        $this->putStation($other['token'], ['tanker_issue_clearing_account_id' => $account->id])->assertStatus(404);
        app(TenantContext::class)->set($this->tenantId);
    }

    /** @test */
    public function the_evaluation_flags_a_clearing_account_that_stopped_being_valid_and_a_settlement_conflict(): void
    {
        $account = $this->asset();
        $this->putStation($this->fx['owner'], ['tanker_issue_clearing_account_id' => $account->id])->assertOk();
        $read = fn () => $this->withToken($this->fx['owner'])->getJson(self::SETTINGS . '?station_id=' . $this->fx['s1']->id)->assertOk()->json('data');
        $this->assertSame([], $read()['blockers']);

        $account->forceFill(['is_active' => false])->save();
        $data = $read();
        $this->assertSame(['clearing_account_invalid'], $data['blockers']);
        $this->assertSame(Guard::INACTIVE, $data['clearing_account']['reason']);
        $account->forceFill(['is_active' => true])->save();

        // يصير حساب المخزون لاحقاً ⇒ مرفوض.
        AccountRoleMapping::query()->updateOrCreate(['role_key' => 'inventory_asset'], ['account_id' => $account->id]);
        $this->assertSame(Guard::INVENTORY_ACCOUNT, $read()['clearing_account']['reason']);
    }

    // ───────────────────────── لا أثر مالي أو مخزني ─────────────────────────

    /** @test */
    public function changing_every_setting_has_no_financial_or_inventory_effect_and_creates_no_account(): void
    {
        $account = $this->asset();
        $before = $this->effects();

        $this->putTenant($this->fx['owner'], [
            'tanker_issue_clearing_account_id' => $account->id, 'tanker_cost_recognition' => 'clearing_until_invoice', 'fuel_pool_ledger_variance_policy' => 'warn',
            'tanker_inventory_posting_start_at' => '2026-12-01T00:00:00Z', 'tanker_inventory_alerts_enabled' => false,
        ])->assertOk();
        $this->putStation($this->fx['owner'], ['fuel_pool_ledger_variance_policy' => 'block', 'tanker_issue_clearing_account_id' => $account->id])->assertOk();
        $this->putStation($this->fx['owner'], ['tanker_issue_clearing_account_id' => null])->assertOk();

        $this->assertSame($before, $this->effects());
        $this->assertFalse(Account::query()->where('code', '1145')->where('id', '!=', $account->id)->exists());
    }
}
