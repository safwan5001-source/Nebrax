<?php

namespace Tests\Feature;

use App\Models\AiActionControl;
use App\Models\AiActionControlEvent;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Services\AiActionControlService;
use App\Services\AiActionRegistry;
use App\Services\AiActionsAccessResolver as Resolver;
use App\Support\AiActionControlException;
use App\Support\Settings;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use LogicException;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * IMP-X-01a — ضوابط المشغّل لإجراءات المساعد: الافتراضي رفض (D-11)، الطبقات والأولوية (D-10)، استقلال القدرات، عزل المستأجرين، سجل تدقيق ثابت وحراسة القاعدة.
 *
 * لا يقرأ أي مسار قائم هذه الضوابط بعد (التوصيل في IMP-X-01b). تشغيل: php artisan test --filter=AiActionControlTest
 */
class AiActionControlTest extends TestCase
{
    use CapturesThrowable;
    use RefreshDatabase;

    private const TYPE = AiActionRegistry::PRODUCT_IMPORT;

    private AiActionControlService $service;

    private Resolver $resolver;

    private PlatformAdministrator $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = app(AiActionControlService::class);
        $this->resolver = app(Resolver::class);
        $this->admin = $this->makeAdmin();
        config(['ai_actions.enabled' => true, 'ai_actions.execution_enabled' => true]);
    }

    // ═══════════════ الافتراضي رفض ═══════════════

    #[Test]
    public function deployment_creates_no_rows_and_everything_is_denied_by_default(): void
    {
        $tenant = $this->makeTenant(optedIn: true);

        $this->assertSame([0, 0], [DB::table('ai_action_controls')->count(), DB::table('ai_action_control_events')->count()]);
        foreach ([Resolver::PREVIEW, Resolver::REVIEW, Resolver::EXECUTION] as $capability) {
            $decision = $this->resolver->effective($tenant, self::TYPE, $capability);
            $this->assertFalse($decision->allowed, $capability);
            $this->assertSame('platform_off', $decision->reason);
        }
        $this->assertSame(0, DB::table('ai_action_controls')->count(), 'القراءة لا تكتب');
    }

    #[Test]
    public function unknown_types_capabilities_and_missing_tenant_context_fail_closed(): void
    {
        $tenant = $this->makeTenant(optedIn: true);
        $this->grantUseChain($tenant);

        $this->assertSame('unknown_type', $this->resolver->effective($tenant, 'nope.v1', Resolver::PREVIEW)->reason);
        $this->assertSame('invalid_capability', $this->resolver->effective($tenant, self::TYPE, 'write')->reason);
        $this->assertSame('no_tenant_context', $this->resolver->effective(null, self::TYPE, Resolver::PREVIEW)->reason);
        $this->assertSame('no_tenant_context', $this->resolver->effective('not-a-uuid', self::TYPE, Resolver::PREVIEW)->reason);
    }

    // ═══════════════ الطبقات ═══════════════

    #[Test]
    public function each_layer_is_required_for_preview_and_review_and_names_its_own_reason(): void
    {
        $tenant = $this->makeTenant(optedIn: false);
        $reason = fn () => $this->resolver->effective($tenant, self::TYPE, Resolver::PREVIEW)->reason;

        $this->assertSame('platform_off', $reason());
        $this->service->setPlatformState($this->admin, '*', 'use', true, 'مفتاح رئيسي للتجربة');
        $this->assertSame('type_off', $reason());
        $this->service->setPlatformState($this->admin, self::TYPE, 'use', true, 'توفّر النوع للتجربة');
        $this->assertSame('tenant_not_granted', $reason());
        $this->service->setTenantState($this->admin, $tenant, self::TYPE, 'use', true, 'منحة المستأجر للتجربة');
        $this->assertSame('tenant_not_enabled', $reason(), 'المنحة وحدها لا تكفي دون قبول المؤسسة نفسها');
        Settings::put('ai_actions', ['enabled' => true], Tenant::query()->find($tenant));

        foreach ([Resolver::PREVIEW, Resolver::REVIEW] as $capability) {
            $this->assertTrue($this->resolver->effective($tenant, self::TYPE, $capability)->allowed, $capability);
        }
    }

    #[Test]
    public function execution_needs_the_full_use_chain_then_its_own_chain_and_the_owners_approval(): void
    {
        $tenant = $this->makeTenant(optedIn: true);
        $execution = fn () => $this->resolver->effective($tenant, self::TYPE, Resolver::EXECUTION)->reason;

        $this->assertSame('platform_off', $execution(), 'التنفيذ يستلزم سلسلة المعاينة أولاً');
        $this->grantUseChain($tenant);
        $this->assertTrue($this->resolver->effective($tenant, self::TYPE, Resolver::PREVIEW)->allowed);

        config(['ai_actions.execution_enabled' => false]);
        $this->assertSame('execution_env_floor_off', $execution());
        config(['ai_actions.execution_enabled' => true]);

        $this->assertSame('execution_platform_off', $execution());
        $this->service->setPlatformState($this->admin, '*', 'execution', true, 'تشغيل عام للتجربة');
        $this->assertSame('execution_type_off', $execution());
        $this->service->setPlatformState($this->admin, self::TYPE, 'execution', true, 'توفّر التنفيذ للنوع');
        $this->assertSame('execution_tenant_not_granted', $execution());
        $this->service->setTenantState($this->admin, $tenant, self::TYPE, 'execution', true, 'منحة تنفيذ للمستأجر');
        $this->assertSame('tenant_owner_not_approved', $execution(), 'منحة المشغّل وحدها لا تنفّذ: يلزم قبول مالك المؤسسة (D-11)');
        Settings::put('ai_actions', ['execution_approved' => true], Tenant::query()->find($tenant));

        $this->assertTrue($this->resolver->effective($tenant, self::TYPE, Resolver::EXECUTION)->allowed);
    }

    #[Test]
    public function turning_execution_off_at_any_level_leaves_preview_and_review_working(): void
    {
        $tenant = $this->makeTenant(optedIn: true, approved: true);
        $this->grantUseChain($tenant);
        $this->grantExecutionChain($tenant);
        $this->assertTrue($this->resolver->effective($tenant, self::TYPE, Resolver::EXECUTION)->allowed);

        $levels = [
            'master' => fn (bool $on) => $this->service->setPlatformState($this->admin, '*', 'execution', $on, 'تبديل التنفيذ العام'),
            'type' => fn (bool $on) => $this->service->setPlatformState($this->admin, self::TYPE, 'execution', $on, 'تبديل تنفيذ النوع'),
            'tenant' => fn (bool $on) => $this->service->setTenantState($this->admin, $tenant, self::TYPE, 'execution', $on, 'تبديل تنفيذ المستأجر'),
        ];
        foreach ($levels as $name => $toggle) {
            $toggle(false);
            $this->assertFalse($this->resolver->effective($tenant, self::TYPE, Resolver::EXECUTION)->allowed, "$name: التنفيذ يتوقف");
            foreach ([Resolver::PREVIEW, Resolver::REVIEW] as $capability) {
                $this->assertTrue($this->resolver->effective($tenant, self::TYPE, $capability)->allowed, "$name: $capability يبقى");
            }
            $toggle(true);
            $this->assertTrue($this->resolver->effective($tenant, self::TYPE, Resolver::EXECUTION)->allowed, "$name: يعود");
        }

        config(['ai_actions.execution_enabled' => false]);
        $this->assertFalse($this->resolver->effective($tenant, self::TYPE, Resolver::EXECUTION)->allowed);
        $this->assertTrue($this->resolver->effective($tenant, self::TYPE, Resolver::PREVIEW)->allowed, 'أرضية التنفيذ لا تُوقف المعاينة');
    }

    #[Test]
    public function the_platform_use_switch_off_is_a_full_stop_including_execution(): void
    {
        $tenant = $this->makeTenant(optedIn: true, approved: true);
        $this->grantUseChain($tenant);
        $this->grantExecutionChain($tenant);

        $this->service->setPlatformState($this->admin, '*', 'use', false, 'إيقاف كامل طارئ');

        foreach ([Resolver::PREVIEW, Resolver::REVIEW, Resolver::EXECUTION] as $capability) {
            $this->assertSame('platform_off', $this->resolver->effective($tenant, self::TYPE, $capability)->reason, $capability);
        }
    }

    #[Test]
    public function an_execution_grant_without_the_use_chain_grants_nothing_and_a_use_grant_never_implies_execution(): void
    {
        $tenant = $this->makeTenant(optedIn: true, approved: true);
        $this->grantExecutionChain($tenant);
        $this->assertSame('platform_off', $this->resolver->effective($tenant, self::TYPE, Resolver::EXECUTION)->reason);

        $other = $this->makeTenant(optedIn: true, approved: true);
        $this->grantUseChain($other);
        $this->assertFalse($this->resolver->effective($other, self::TYPE, Resolver::EXECUTION)->allowed);
    }

    #[Test]
    public function the_environment_floor_can_never_be_overridden_by_any_operator_setting(): void
    {
        $tenant = $this->makeTenant(optedIn: true, approved: true);
        $this->grantUseChain($tenant);
        $this->grantExecutionChain($tenant);

        config(['ai_actions.enabled' => false]);
        foreach ([Resolver::PREVIEW, Resolver::REVIEW, Resolver::EXECUTION] as $capability) {
            $this->assertSame('env_floor_off', $this->resolver->effective($tenant, self::TYPE, $capability)->reason, $capability);
        }
    }

    // ═══════════════ العزل ═══════════════

    #[Test]
    public function one_tenants_grant_never_reaches_another_tenant(): void
    {
        $a = $this->makeTenant(optedIn: true, approved: true);
        $b = $this->makeTenant(optedIn: true, approved: true);
        $this->service->setPlatformState($this->admin, '*', 'use', true, 'مفتاح رئيسي للتجربة');
        $this->service->setPlatformState($this->admin, self::TYPE, 'use', true, 'توفّر النوع للتجربة');
        $this->service->setTenantState($this->admin, $a, self::TYPE, 'use', true, 'منحة للمستأجر أ فقط');

        $this->assertTrue($this->resolver->effective($a, self::TYPE, Resolver::PREVIEW)->allowed);
        $this->assertSame('tenant_not_granted', $this->resolver->effective($b, self::TYPE, Resolver::PREVIEW)->reason);
        $this->assertSame([['tenant_id' => $a]], DB::table('ai_action_controls')->where('scope', 'tenant')->get(['tenant_id'])->map(fn ($r) => ['tenant_id' => $r->tenant_id])->all());
    }

    // ═══════════════ الخدمة والتدقيق ═══════════════

    #[Test]
    public function a_change_writes_exactly_one_audit_event_and_state_follows_it(): void
    {
        $change = $this->service->setPlatformState($this->admin, '*', 'use', true, 'سبب التغيير الأول');

        $this->assertSame([true, false, true], [$change->changed, $change->previousEnabled, $change->currentEnabled]);
        $control = AiActionControl::query()->firstOrFail();
        $this->assertSame([true, 1], [$control->enabled, $control->version]);
        $event = AiActionControlEvent::query()->firstOrFail();
        $this->assertSame([$control->id, $this->admin->id, 'سبب التغيير الأول', 1, false, true], [$event->control_id, $event->platform_administrator_id, $event->reason, $event->version, $event->previous_enabled, $event->new_enabled]);

        $again = $this->service->setPlatformState($this->admin, '*', 'use', true, 'نفس الحالة مجدداً');
        $this->assertFalse($again->changed);
        $this->assertSame(1, AiActionControlEvent::query()->count(), 'الحالة القائمة لا تكتب حدثاً');

        $this->service->setPlatformState($this->admin, '*', 'use', false, 'سحب المنحة');
        $this->assertSame([2, false], [AiActionControl::query()->firstOrFail()->version, AiActionControl::query()->firstOrFail()->enabled]);
    }

    #[Test]
    public function requesting_the_baseline_for_an_absent_control_writes_nothing(): void
    {
        $change = $this->service->setPlatformState($this->admin, self::TYPE, 'execution', false, 'منع ما هو ممنوع');

        $this->assertFalse($change->changed);
        $this->assertSame([0, 0], [DB::table('ai_action_controls')->count(), DB::table('ai_action_control_events')->count()]);
    }

    #[Test]
    public function invalid_inputs_and_unauthorised_actors_are_refused_without_writes(): void
    {
        $tenant = $this->makeTenant();
        $cases = [
            'invalid_action_type' => fn () => $this->service->setPlatformState($this->admin, 'nope.v1', 'use', true, 'نوع غير معروف'),
            'invalid_capability' => fn () => $this->service->setPlatformState($this->admin, '*', 'write', true, 'قدرة غير معروفة'),
            'invalid_reason' => fn () => $this->service->setPlatformState($this->admin, '*', 'use', true, 'ab'),
            'invalid_reason ' => fn () => $this->service->setPlatformState($this->admin, '*', 'use', true, str_repeat('س', 501)),
            'all_types_for_tenant' => fn () => $this->service->setTenantState($this->admin, $tenant, '*', 'use', true, 'لا منحة لكل الأنواع'),
            'invalid_tenant' => fn () => $this->service->setTenantState($this->admin, 'x', self::TYPE, 'use', true, 'معرّف مستأجر خاطئ'),
            'tenant_not_found' => fn () => $this->service->setTenantState($this->admin, (string) Str::uuid(), self::TYPE, 'use', true, 'مستأجر غير موجود'),
            'unauthorized_actor' => fn () => $this->service->setPlatformState($this->makeAdmin(active: false), '*', 'use', true, 'مدير معطَّل'),
        ];
        foreach ($cases as $label => $operation) {
            $e = $this->thrown($operation, "كان يجب رفض: $label", AiActionControlException::class);
            $this->assertNotSame('', $e->reason, $label);
        }
        $this->assertSame([0, 0], [DB::table('ai_action_controls')->count(), DB::table('ai_action_control_events')->count()]);
    }

    #[Test]
    public function a_soft_deleted_or_deactivated_administrator_cannot_write_even_with_a_stale_model(): void
    {
        $stale = $this->makeAdmin();
        PlatformAdministrator::query()->whereKey($stale->id)->update(['is_active' => false]);

        $e = $this->thrown(fn () => $this->service->setPlatformState($stale, '*', 'use', true, 'نموذج قديم لمدير معطَّل'), 'كان يجب الرفض', AiActionControlException::class);

        $this->assertSame('unauthorized_actor', $e->reason);
    }

    #[Test]
    public function the_models_refuse_direct_updates_and_deletes(): void
    {
        $this->service->setPlatformState($this->admin, '*', 'use', true, 'تهيئة للحراسة');
        $control = AiActionControl::query()->firstOrFail();
        $event = AiActionControlEvent::query()->firstOrFail();

        $this->assertInstanceOf(LogicException::class, $this->thrown(fn () => $control->update(['enabled' => false]), 'تحديث الضابط', LogicException::class));
        $this->assertInstanceOf(LogicException::class, $this->thrown(fn () => $control->delete(), 'حذف الضابط', LogicException::class));
        $this->assertInstanceOf(LogicException::class, $this->thrown(fn () => $event->update(['reason' => 'تعديل']), 'تحديث الحدث', LogicException::class));
        $this->assertInstanceOf(LogicException::class, $this->thrown(fn () => $event->delete(), 'حذف الحدث', LogicException::class));
    }

    // ═══════════════ حراسة القاعدة (SQL خام) ═══════════════

    #[Test]
    public function the_database_refuses_a_control_created_enabled_or_with_a_bad_shape(): void
    {
        $tenant = $this->makeTenant();
        $bad = [
            'enabled at birth' => $this->rawControl('platform', null, '*', 'use', enabled: true),
            'version at birth' => $this->rawControl('platform', null, '*', 'use', version: 1),
            'bad capability' => $this->rawControl('platform', null, '*', 'write'),
            'platform with tenant' => $this->rawControl('platform', $tenant, '*', 'use'),
            'tenant without tenant' => $this->rawControl('tenant', null, self::TYPE, 'use'),
            'tenant all types' => $this->rawControl('tenant', $tenant, '*', 'use'),
            'empty type' => $this->rawControl('platform', null, '', 'use'),
            'bad scope' => $this->rawControl('global', null, '*', 'use'),
        ];
        foreach ($bad as $label => $row) {
            $this->rejects(fn () => DB::table('ai_action_controls')->insert($row), "كان يجب أن تُرفض: $label");
        }
        $this->assertSame(0, DB::table('ai_action_controls')->count());
    }

    #[Test]
    public function the_database_refuses_direct_state_changes_deletes_and_event_tampering(): void
    {
        $this->service->setPlatformState($this->admin, '*', 'use', true, 'تهيئة للحراسة');
        $control = DB::table('ai_action_controls')->first();
        $event = DB::table('ai_action_control_events')->first();

        $this->rejects(fn () => DB::table('ai_action_controls')->where('id', $control->id)->update(['enabled' => false]), 'تحديث مباشر');
        $this->rejects(fn () => DB::table('ai_action_controls')->where('id', $control->id)->update(['version' => 5]), 'رفع نسخة');
        $this->rejects(fn () => DB::table('ai_action_controls')->where('id', $control->id)->delete(), 'حذف ضابط');
        $this->rejects(fn () => DB::table('ai_action_control_events')->where('id', $event->id)->update(['reason' => 'تلاعب بالسبب']), 'تحديث حدث');
        $this->rejects(fn () => DB::table('ai_action_control_events')->where('id', $event->id)->delete(), 'حذف حدث');

        // حدث لا يطابق الحالة الراهنة (نسخة خاطئة / حالة سابقة خاطئة) يُرفض ولا يغيّر شيئاً.
        $stale = (array) $event;
        $stale['id'] = (string) Str::uuid();
        $stale['version'] = 3;
        $this->rejects(fn () => DB::table('ai_action_control_events')->insert($stale), 'حدث بنسخة خاطئة');

        $this->assertSame([true, 1], [(bool) DB::table('ai_action_controls')->first()->enabled, (int) DB::table('ai_action_controls')->first()->version]);
    }

    #[Test]
    public function the_database_refuses_an_event_with_a_bad_shape(): void
    {
        $this->service->setPlatformState($this->admin, '*', 'use', true, 'تهيئة للحراسة');
        $event = (array) DB::table('ai_action_control_events')->first();

        foreach ([
            'same state' => ['version' => 2, 'previous_enabled' => true, 'new_enabled' => true],
            'short reason' => ['version' => 2, 'previous_enabled' => true, 'new_enabled' => false, 'reason' => 'ab'],
            'bad capability' => ['version' => 2, 'previous_enabled' => true, 'new_enabled' => false, 'capability' => 'write'],
        ] as $label => $override) {
            $row = array_merge($event, ['id' => (string) Str::uuid()], $override);
            $this->rejects(fn () => DB::table('ai_action_control_events')->insert($row), "كان يجب أن يُرفض: $label");
        }
        $this->assertSame(1, DB::table('ai_action_control_events')->count());
    }

    #[Test]
    public function rollback_is_refused_while_any_row_exists(): void
    {
        $migration = require database_path('migrations/2026_12_01_010000_create_ai_action_control_tables.php');
        $this->service->setPlatformState($this->admin, '*', 'use', true, 'صف يمنع التراجع');

        $e = $this->thrown(fn () => $migration->down(), 'كان يجب رفض التراجع', \RuntimeException::class);

        $this->assertStringContainsString('Rollback refused', $e->getMessage());
        $this->assertSame(1, DB::table('ai_action_controls')->count());
    }

    // ═══════════════ مساعدات ═══════════════

    /** كل عملية سالبة في نقطة حفظ: على PostgreSQL يُجهض الخطأ المعاملةَ كلها ما لم تُعزل. */
    private function rejects(callable $operation, string $label): void
    {
        try {
            DB::transaction($operation);
        } catch (QueryException) {
            $this->addToAssertionCount(1);

            return;
        }
        $this->fail("القاعدة كان يجب أن ترفض: {$label}");
    }

    private function grantUseChain(string $tenant): void
    {
        $this->service->setPlatformState($this->admin, '*', 'use', true, 'مفتاح رئيسي للاختبار');
        $this->service->setPlatformState($this->admin, self::TYPE, 'use', true, 'توفّر النوع للاختبار');
        $this->service->setTenantState($this->admin, $tenant, self::TYPE, 'use', true, 'منحة المستأجر للاختبار');
    }

    private function grantExecutionChain(string $tenant): void
    {
        $this->service->setPlatformState($this->admin, '*', 'execution', true, 'تنفيذ عام للاختبار');
        $this->service->setPlatformState($this->admin, self::TYPE, 'execution', true, 'تنفيذ النوع للاختبار');
        $this->service->setTenantState($this->admin, $tenant, self::TYPE, 'execution', true, 'تنفيذ المستأجر للاختبار');
    }

    private function makeAdmin(bool $active = true): PlatformAdministrator
    {
        return PlatformAdministrator::create([
            'name' => 'مدير منصة '.Str::random(5), 'email' => Str::random(10).'@platform.test',
            'password' => 'secret-password-1', 'is_active' => $active,
        ]);
    }

    private function makeTenant(bool $optedIn = false, bool $approved = false): string
    {
        $tenant = Tenant::create([
            'name' => 'مستأجر ضوابط', 'slug' => 'ai-controls-'.Str::random(10),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        if ($optedIn || $approved) {
            Settings::put('ai_actions', ['enabled' => $optedIn, 'execution_approved' => $approved], $tenant);
        }

        return $tenant->id;
    }

    /** @return array<string, mixed> */
    private function rawControl(string $scope, ?string $tenantId, string $type, string $capability, bool $enabled = false, int $version = 0): array
    {
        return [
            'id' => (string) Str::uuid(), 'scope' => $scope, 'tenant_id' => $tenantId, 'action_type' => $type, 'capability' => $capability,
            'enabled' => $enabled, 'version' => $version, 'created_at' => now(), 'updated_at' => now(),
        ];
    }
}
