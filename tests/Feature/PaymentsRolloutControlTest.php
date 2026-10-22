<?php

namespace Tests\Feature;

use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\PaymentsRolloutControl;
use App\Models\PaymentsRolloutControlEvent;
use App\Services\PaymentsRolloutControlService;
use App\Support\PaymentsRolloutControlException;
use App\Support\SchedulerHeartbeat;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use LogicException;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

/**
 * PAY-H1-02 — ضوابط تفعيل المدفوعات: معطَّل افتراضياً، تفعيل بمستأجر، إيقاف طارئ للمنصة، سجل تدقيق ثابت، بوابة نبضة المجدول (SQLite وPostgreSQL).
 *
 * لا يقرأ أي مسار مالي هذه الضوابط بعد؛ مسارات HTTP للمنصة في `PaymentsRolloutApiTest`. التزامن الحقيقي في `PaymentsRolloutControlPostgresTest`.
 */
class PaymentsRolloutControlTest extends TestCase
{
    use CapturesThrowable;
    use RefreshDatabase;

    private const FEATURE = PaymentsRolloutControl::FEATURE_ONLINE_PAYMENTS;

    private const MIGRATION = '2026_11_24_010000_create_payments_rollout_control_tables.php';

    private PaymentsRolloutControlService $service;

    private PlatformAdministrator $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = app(PaymentsRolloutControlService::class);
        $this->admin = $this->makeAdmin();
        SchedulerHeartbeat::record(); // بوابة D-25: المجدول مُثبَت افتراضياً؛ اختبارات البوابة تُسقطه صراحةً.
    }

    // ═══════════════ الافتراضي: معطَّل ولا صفوف ═══════════════

    #[Test]
    public function deployment_creates_no_rows_and_every_tenant_is_disabled_by_default(): void
    {
        $tenant = $this->makeTenant();

        $this->assertSame(0, DB::table('payments_rollout_controls')->count());
        $this->assertSame(0, DB::table('payments_rollout_control_events')->count());

        $state = $this->service->effectiveForTenant($tenant);
        $this->assertFalse($state->enabled);
        $this->assertSame('tenant_not_configured', $state->reason);
        $this->assertFalse($state->tenantEnabled);
        $this->assertFalse($state->platformStopped);
        $this->assertSame(0, DB::table('payments_rollout_controls')->count(), 'القراءة لا تكتب');
    }

    #[Test]
    public function the_current_tenant_helper_fails_closed_without_a_tenant_context(): void
    {
        app(TenantContext::class)->forget();

        $state = $this->service->effectiveForCurrentTenant();

        $this->assertFalse($state->enabled);
        $this->assertSame('no_tenant_context', $state->reason);
    }

    // ═══════════════ التفعيل والتدقيق ═══════════════

    #[Test]
    public function enabling_a_tenant_writes_one_audit_event_and_the_state_follows_it_atomically(): void
    {
        $tenant = $this->makeTenant();

        $change = $this->service->setTenantState($this->admin, $tenant, true, 'تجربة مراقبة على مستأجر واحد');

        $this->assertTrue($change->changed);
        $this->assertFalse($change->previousEnabled);
        $this->assertTrue($change->currentEnabled);

        $control = DB::table('payments_rollout_controls')->first();
        $this->assertSame('tenant', $control->scope);
        $this->assertSame($tenant, $control->tenant_id);
        $this->assertSame(self::FEATURE, $control->feature_key);
        $this->assertTrue((bool) $control->enabled);
        $this->assertSame(1, (int) $control->version);

        $event = DB::table('payments_rollout_control_events')->first();
        $this->assertSame($change->eventId, $event->id);
        $this->assertSame($control->id, $event->control_id);
        $this->assertSame('tenant', $event->scope);
        $this->assertSame($tenant, $event->tenant_id);
        $this->assertSame(self::FEATURE, $event->feature_key);
        $this->assertSame(1, (int) $event->version);
        $this->assertFalse((bool) $event->previous_enabled);
        $this->assertTrue((bool) $event->new_enabled);
        $this->assertSame($this->admin->id, $event->platform_administrator_id);
        $this->assertSame('تجربة مراقبة على مستأجر واحد', $event->reason);
        $this->assertNotNull($event->occurred_at);

        $state = $this->service->effectiveForTenant($tenant);
        $this->assertTrue($state->enabled);
        $this->assertSame('enabled', $state->reason);
    }

    #[Test]
    public function asking_for_the_state_that_already_holds_writes_nothing(): void
    {
        $tenant = $this->makeTenant();

        // معطَّل أصلاً (لا صف): لا صف ولا حدث.
        $noop = $this->service->setTenantState($this->admin, $tenant, false, 'تأكيد التعطيل الافتراضي');
        $this->assertFalse($noop->changed);
        $this->assertNull($noop->eventId);
        $this->assertSame(0, DB::table('payments_rollout_controls')->count());

        $this->service->setTenantState($this->admin, $tenant, true, 'تفعيل أول');
        $again = $this->service->setTenantState($this->admin, $tenant, true, 'تفعيل مكرر');

        $this->assertFalse($again->changed);
        $this->assertSame(1, DB::table('payments_rollout_control_events')->count());
        $this->assertSame(1, (int) DB::table('payments_rollout_controls')->value('version'));
    }

    #[Test]
    public function successive_changes_form_a_contiguous_versioned_history(): void
    {
        $tenant = $this->makeTenant();
        $second = $this->makeAdmin();

        $this->service->setTenantState($this->admin, $tenant, true, 'تفعيل');
        $this->service->setTenantState($second, $tenant, false, 'تعطيل');
        $this->service->setTenantState($this->admin, $tenant, true, 'تفعيل ثانٍ');

        $events = DB::table('payments_rollout_control_events')->orderBy('version')->get();
        $this->assertSame([1, 2, 3], $events->pluck('version')->map(fn ($v) => (int) $v)->all());
        $this->assertSame([false, true, false], $events->pluck('previous_enabled')->map(fn ($v) => (bool) $v)->all());
        $this->assertSame([true, false, true], $events->pluck('new_enabled')->map(fn ($v) => (bool) $v)->all());
        $this->assertSame([$this->admin->id, $second->id, $this->admin->id], $events->pluck('platform_administrator_id')->all());
        $this->assertSame(3, (int) DB::table('payments_rollout_controls')->value('version'));
        $this->assertTrue($this->service->effectiveForTenant($tenant)->enabled);
    }

    // ═══════════════ عزل المستأجرين ═══════════════

    #[Test]
    public function enabling_one_tenant_never_enables_another(): void
    {
        $a = $this->makeTenant();
        $b = $this->makeTenant();
        $this->service->setTenantState($this->admin, $a, true, 'تفعيل مستأجر أ');

        $this->assertTrue($this->service->effectiveForTenant($a)->enabled);
        $this->assertFalse($this->service->effectiveForTenant($b)->enabled);
        $this->assertSame('tenant_not_configured', $this->service->effectiveForTenant($b)->reason);

        app(TenantContext::class)->set($a);
        $this->assertTrue($this->service->effectiveForCurrentTenant()->enabled);
        app(TenantContext::class)->set($b);
        $this->assertFalse($this->service->effectiveForCurrentTenant()->enabled);
        app(TenantContext::class)->forget();

        $this->assertSame([$a], DB::table('payments_rollout_control_events')->pluck('tenant_id')->all());
        $this->assertSame(1, DB::table('payments_rollout_controls')->count());
    }

    #[Test]
    public function the_two_tenants_have_independent_controls_and_histories(): void
    {
        $a = $this->makeTenant();
        $b = $this->makeTenant();
        $this->service->setTenantState($this->admin, $a, true, 'تفعيل أ');
        $this->service->setTenantState($this->admin, $b, true, 'تفعيل ب');
        $this->service->setTenantState($this->admin, $a, false, 'تعطيل أ');

        $this->assertFalse($this->service->effectiveForTenant($a)->enabled);
        $this->assertTrue($this->service->effectiveForTenant($b)->enabled);
        $this->assertSame(2, DB::table('payments_rollout_control_events')->where('tenant_id', $a)->count());
        $this->assertSame(1, DB::table('payments_rollout_control_events')->where('tenant_id', $b)->count());
    }

    // ═══════════════ الإيقاف الطارئ للمنصة ═══════════════

    #[Test]
    public function the_platform_emergency_stop_overrides_every_tenant_activation_and_lifting_it_restores_them(): void
    {
        $a = $this->makeTenant();
        $b = $this->makeTenant();
        $this->service->setTenantState($this->admin, $a, true, 'تفعيل أ');
        $this->service->setTenantState($this->admin, $b, true, 'تفعيل ب');

        $stop = $this->service->setPlatformState($this->admin, false, 'إيقاف طارئ: حادثة تشغيلية');
        $this->assertTrue($stop->changed);

        foreach ([$a, $b] as $tenant) {
            $state = $this->service->effectiveForTenant($tenant);
            $this->assertFalse($state->enabled);
            $this->assertSame('platform_stop', $state->reason);
            $this->assertTrue($state->tenantEnabled, 'ضابط المستأجر نفسه لم يُمسّ');
            $this->assertTrue($state->platformStopped);
        }
        $this->assertSame(1, (int) DB::table('payments_rollout_controls')->where('tenant_id', $a)->value('version'), 'الإيقاف لا يكتب على صفوف المستأجرين');

        $this->service->setPlatformState($this->admin, true, 'رفع الإيقاف بعد المعالجة');

        $this->assertTrue($this->service->effectiveForTenant($a)->enabled);
        $this->assertTrue($this->service->effectiveForTenant($b)->enabled);
    }

    #[Test]
    public function a_stop_blocks_even_a_tenant_that_is_not_configured_and_no_stop_row_means_no_stop(): void
    {
        $tenant = $this->makeTenant();

        // لا صف منصة: الحالة الأساسية «لا إيقاف»، وطلب رفع إيقاف غير موجود لا يكتب شيئاً.
        $noop = $this->service->setPlatformState($this->admin, true, 'رفع إيقاف غير مسجّل');
        $this->assertFalse($noop->changed);
        $this->assertSame(0, DB::table('payments_rollout_controls')->count());
        $this->assertFalse($this->service->effectiveForTenant($tenant)->platformStopped);

        $this->service->setPlatformState($this->admin, false, 'إيقاف احترازي');
        $state = $this->service->effectiveForTenant($tenant);
        $this->assertFalse($state->enabled);
        $this->assertSame('platform_stop', $state->reason);

        $event = DB::table('payments_rollout_control_events')->first();
        $this->assertSame('platform', $event->scope);
        $this->assertNull($event->tenant_id);
        $this->assertTrue((bool) $event->previous_enabled);
        $this->assertFalse((bool) $event->new_enabled);
    }

    #[Test]
    public function platform_scope_controls_are_unique_per_feature(): void
    {
        $this->service->setPlatformState($this->admin, false, 'إيقاف');
        $this->service->setPlatformState($this->admin, true, 'رفع');
        $this->service->setPlatformState($this->admin, false, 'إيقاف ثانٍ');

        $this->assertSame(1, DB::table('payments_rollout_controls')->where('scope', 'platform')->count());
        $this->assertSame(3, DB::table('payments_rollout_control_events')->where('scope', 'platform')->count());
    }

    // ═══════════════ الصلاحية ═══════════════

    #[Test]
    public function only_an_active_platform_administrator_may_change_a_control(): void
    {
        $tenant = $this->makeTenant();
        $inactive = $this->makeAdmin(active: false);
        $deleted = $this->makeAdmin();
        $deleted->delete();
        $unsaved = new PlatformAdministrator(['name' => 'ghost', 'email' => 'ghost@example.test', 'password' => 'x']);
        $stale = $this->makeAdmin();
        $stale->forceFill(['is_active' => true]); // نموذج قديم في الذاكرة يبدو نشطاً
        DB::table('platform_administrators')->where('id', $stale->id)->update(['is_active' => false]);

        foreach ([['غير نشط', $inactive], ['محذوف ناعماً', $deleted], ['غير محفوظ', $unsaved], ['عُطّل بعد تحميل النموذج', $stale]] as [$label, $actor]) {
            $e = $this->thrown(fn () => $this->service->setTenantState($actor, $tenant, true, 'محاولة بلا صلاحية'), $label, PaymentsRolloutControlException::class);
            $this->assertSame('unauthorized_actor', $e->reason, $label);
            $e = $this->thrown(fn () => $this->service->setPlatformState($actor, false, 'محاولة بلا صلاحية'), $label, PaymentsRolloutControlException::class);
            $this->assertSame('unauthorized_actor', $e->reason, $label);
        }

        $this->assertSame(0, DB::table('payments_rollout_controls')->count());
        $this->assertSame(0, DB::table('payments_rollout_control_events')->count());
    }

    #[Test]
    public function tenant_users_have_no_access_path_to_the_controls(): void
    {
        // القارئ الوحيد المنسّق (H1-03)، والكاتب مسارات المنصة وحدها؛ ولا مسار مستأجر يعرض الضوابط.
        $allowed = ['PaymentsRolloutControl.php', 'PaymentsRolloutControlEvent.php', 'PaymentsRolloutControlService.php', 'PaymentsRolloutState.php',
            'PaymentsRolloutChange.php', 'PaymentsRolloutControlException.php', 'PlatformPaymentsRolloutController.php',
            // PAY-H1-03: القارئ الوحيد على مسار الدفع — قراءة فعّالة بلا قفل، ولا يكتب الضوابط.
            'PaymentOrchestrator.php'];
        $hits = [];
        $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(base_path('app'), \FilesystemIterator::SKIP_DOTS));
        foreach ($files as $file) {
            if ($file->isFile() && $file->getExtension() === 'php' && ! in_array($file->getFilename(), $allowed, true)
                && preg_match('/PaymentsRollout|payments_rollout/', (string) file_get_contents($file->getPathname())) === 1) {
                $hits[] = $file->getPathname();
            }
        }
        $this->assertSame([], $hits, 'لا شيء خارج الخدمة والنموذجين والمتحكّم يلمس الضوابط');

        $orchestrator = (string) file_get_contents(base_path('app/Services/PaymentOrchestrator.php'));
        $this->assertStringContainsString('effectiveForCurrentTenant', $orchestrator);
        $this->assertDoesNotMatchRegularExpression('/setTenantState|setPlatformState/', $orchestrator, 'المنسّق يقرأ الضوابط ولا يكتبها');

        // كل مسار يذكر الضوابط تحت `api/platform/` ومحميّ بمصادقة مدير المنصة.
        $routes = collect(\Illuminate\Support\Facades\Route::getRoutes()->getRoutes())
            ->filter(fn ($route) => str_contains($route->uri(), 'payments-rollout'));
        $this->assertGreaterThanOrEqual(4, $routes->count());
        foreach ($routes as $route) {
            $this->assertStringStartsWith('api/platform/', $route->uri());
            $middleware = array_map('strval', $route->gatherMiddleware());
            $this->assertNotEmpty(array_filter($middleware, fn (string $m) => str_starts_with($m, \App\Http\Middleware\EnsurePlatformAdministrator::class)), $route->uri());
            $this->assertNotContains(\App\Http\Middleware\SetTenant::class, $middleware, $route->uri());
        }

        // الخدمة نفسها لا تستقبل إلا PlatformAdministrator للكتابة (لا مستخدم مستأجر).
        $method = new \ReflectionMethod(PaymentsRolloutControlService::class, 'setTenantState');
        $this->assertSame(PlatformAdministrator::class, $method->getParameters()[0]->getType()?->getName());
    }

    // ═══════════════ بوابة D-25: نبضة المجدول ═══════════════

    #[Test]
    public function enabling_a_tenant_is_refused_while_the_scheduler_is_unproven_but_disabling_and_stopping_are_not(): void
    {
        $tenant = $this->makeTenant();
        $this->service->setTenantState($this->admin, $tenant, true, 'تفعيل والمجدول طازج');

        // لا نبضة أصلاً.
        DB::table('platform_runtime_heartbeats')->where('component', SchedulerHeartbeat::COMPONENT)->delete();
        $other = $this->makeTenant();
        $e = $this->thrown(fn () => $this->service->setTenantState($this->admin, $other, true, 'بلا نبضة'), 'no heartbeat', PaymentsRolloutControlException::class);
        $this->assertSame('scheduler_unproven', $e->reason);

        // نبضة أقدم من ضعف الفاصل.
        SchedulerHeartbeat::record();
        DB::table('platform_runtime_heartbeats')->where('component', SchedulerHeartbeat::COMPONENT)
            ->update(['last_seen_at' => now('UTC')->subMinutes(SchedulerHeartbeat::MAX_AGE_MINUTES + 1)]);
        $e = $this->thrown(fn () => $this->service->setTenantState($this->admin, $other, true, 'نبضة قديمة'), 'stale heartbeat', PaymentsRolloutControlException::class);
        $this->assertSame('scheduler_unproven', $e->reason);
        $this->assertSame(0, DB::table('payments_rollout_controls')->where('tenant_id', $other)->count(), 'الرفض لا يكتب صفاً ولا حدثاً');
        $this->assertSame(0, DB::table('payments_rollout_control_events')->where('tenant_id', $other)->count());

        // إعادة طلب تفعيل قائم أصلاً لا تُبوَّب (idempotent) حتى والمجدول غير مثبت.
        $retry = $this->service->setTenantState($this->admin, $tenant, true, 'إعادة محاولة بعد ضياع الاستجابة');
        $this->assertFalse($retry->changed);
        $this->assertSame(1, DB::table('payments_rollout_control_events')->where('tenant_id', $tenant)->count());

        // الإيقاف (تعطيل مستأجر + إيقاف المنصة + رفعه) غير مبوَّب.
        $this->assertTrue($this->service->setTenantState($this->admin, $tenant, false, 'إيقاف بلا مجدول')->changed);
        $this->assertTrue($this->service->setPlatformState($this->admin, false, 'إيقاف طارئ بلا مجدول')->changed);
        $this->assertTrue($this->service->setPlatformState($this->admin, true, 'رفع الإيقاف')->changed);

        // نبضة على الحد ما زالت طازجة.
        DB::table('platform_runtime_heartbeats')->where('component', SchedulerHeartbeat::COMPONENT)
            ->update(['last_seen_at' => now('UTC')->subMinutes(SchedulerHeartbeat::MAX_AGE_MINUTES - 1)]);
        $this->assertTrue($this->service->setTenantState($this->admin, $other, true, 'نبضة ضمن الحد')->changed);
    }

    #[Test]
    public function the_heartbeat_command_and_schedule_prove_the_scheduler(): void
    {
        DB::table('platform_runtime_heartbeats')->where('component', SchedulerHeartbeat::COMPONENT)->delete();
        $this->assertFalse(SchedulerHeartbeat::isFresh());
        $this->assertNull(SchedulerHeartbeat::lastSeenAt());

        $this->artisan('platform:scheduler-heartbeat')->assertExitCode(0);
        $this->assertTrue(SchedulerHeartbeat::isFresh());
        $this->assertSame(1, DB::table('platform_runtime_heartbeats')->where('component', SchedulerHeartbeat::COMPONENT)->count());

        $this->artisan('platform:scheduler-heartbeat')->assertExitCode(0);
        $this->assertSame(1, DB::table('platform_runtime_heartbeats')->where('component', SchedulerHeartbeat::COMPONENT)->count(), 'النبضة صف واحد يُحدَّث');

        $events = collect(app(\Illuminate\Console\Scheduling\Schedule::class)->events())
            ->filter(fn ($event) => str_contains((string) $event->command, 'platform:scheduler-heartbeat'));
        $this->assertCount(1, $events);
        $this->assertSame('*/5 * * * *', $events->first()->expression);
    }

    // ═══════════════ مدخلات غير صالحة ═══════════════

    #[Test]
    public function invalid_scope_tenant_feature_or_reason_is_rejected_before_anything_is_written(): void
    {
        $tenant = $this->makeTenant();
        $softDeleted = $this->makeTenant();
        Tenant::query()->whereKey($softDeleted)->first()->delete();

        $cases = [
            'feature غير معروفة' => [fn () => $this->service->setTenantState($this->admin, $tenant, true, 'سبب صالح', 'debit_note_issuance'), 'invalid_feature'],
            'معرّف مستأجر ليس UUID' => [fn () => $this->service->setTenantState($this->admin, 'not-a-uuid', true, 'سبب صالح'), 'invalid_tenant'],
            'مستأجر غير موجود' => [fn () => $this->service->setTenantState($this->admin, (string) Str::uuid(), true, 'سبب صالح'), 'tenant_not_found'],
            'مستأجر محذوف ناعماً' => [fn () => $this->service->setTenantState($this->admin, $softDeleted, true, 'سبب صالح'), 'tenant_not_found'],
            'سبب قصير' => [fn () => $this->service->setTenantState($this->admin, $tenant, true, ' ab '), 'invalid_reason'],
            'سبب فارغ' => [fn () => $this->service->setTenantState($this->admin, $tenant, true, '   '), 'invalid_reason'],
            'سبب طويل' => [fn () => $this->service->setPlatformState($this->admin, false, str_repeat('س', 501)), 'invalid_reason'],
            'ميزة منصة غير معروفة' => [fn () => $this->service->setPlatformState($this->admin, false, 'سبب صالح', 'x'), 'invalid_feature'],
            'قراءة بميزة غير معروفة' => [fn () => $this->service->effectiveForTenant($tenant, 'x'), 'invalid_feature'],
            'قراءة بمعرّف غير صالح' => [fn () => $this->service->effectiveForTenant('nope'), 'invalid_tenant'],
        ];
        foreach ($cases as $label => [$operation, $reason]) {
            $e = $this->thrown($operation, $label, PaymentsRolloutControlException::class);
            $this->assertSame($reason, $e->reason, $label);
        }

        $this->assertSame(0, DB::table('payments_rollout_controls')->count());
        $this->assertSame(0, DB::table('payments_rollout_control_events')->count());
    }

    // ═══════════════ الذرّية ═══════════════

    #[Test]
    public function a_failure_while_writing_the_event_rolls_back_the_control_row_too(): void
    {
        $tenant = $this->makeTenant();
        Event::listen('eloquent.creating: '.PaymentsRolloutControlEvent::class, function (): void {
            throw new RuntimeException('simulated failure');
        });

        $this->thrown(fn () => $this->service->setTenantState($this->admin, $tenant, true, 'تفعيل يفشل'), 'فشل الحدث', RuntimeException::class);
        Event::forget('eloquent.creating: '.PaymentsRolloutControlEvent::class);

        $this->assertSame(0, DB::table('payments_rollout_controls')->count(), 'لا ضابط يتيم');
        $this->assertSame(0, DB::table('payments_rollout_control_events')->count());
        $this->assertFalse($this->service->effectiveForTenant($tenant)->enabled);

        // وبعد زوال العطل ينجح التغيير نفسه من الصفر.
        $this->assertTrue($this->service->setTenantState($this->admin, $tenant, true, 'تفعيل بعد الإصلاح')->changed);
    }

    // ═══════════════ حراس القاعدة ═══════════════

    #[Test]
    public function the_database_refuses_to_change_a_control_without_an_audit_event(): void
    {
        $tenant = $this->makeTenant();
        $this->service->setTenantState($this->admin, $tenant, true, 'تفعيل');
        $id = DB::table('payments_rollout_controls')->value('id');

        $this->rejects(fn () => DB::table('payments_rollout_controls')->where('id', $id)->update(['enabled' => false]), 'تعطيل مباشر');
        $this->rejects(fn () => DB::table('payments_rollout_controls')->where('id', $id)->update(['enabled' => false, 'version' => 2]), 'تعطيل مع رفع النسخة بلا حدث');
        $this->rejects(fn () => DB::table('payments_rollout_controls')->where('id', $id)->update(['version' => 5]), 'نسخة وحدها');
        $this->rejects(fn () => DB::table('payments_rollout_controls')->where('id', $id)->update(['tenant_id' => null, 'scope' => 'platform']), 'تغيير الهوية');
        $this->rejects(fn () => DB::table('payments_rollout_controls')->where('id', $id)->update(['feature_key' => 'online_payments2']), 'تغيير الميزة');

        $this->assertTrue($this->service->effectiveForTenant($tenant)->enabled, 'الحالة لم تتغيّر');
        $this->assertSame(1, (int) DB::table('payments_rollout_controls')->value('version'));
    }

    #[Test]
    public function a_control_can_never_be_created_enabled_or_stopped_or_with_a_version(): void
    {
        $tenant = $this->makeTenant();

        $this->rejects(fn () => $this->rawControl('tenant', $tenant, enabled: true), 'مستأجر مفعَّل عند الإنشاء');
        $this->rejects(fn () => $this->rawControl('platform', null, enabled: false), 'إيقاف عند الإنشاء بلا حدث');
        $this->rejects(fn () => $this->rawControl('tenant', $tenant, version: 3), 'نسخة غير صفرية');
        $this->rejects(fn () => $this->rawControl('galaxy', $tenant), 'نطاق غير معروف');
        $this->rejects(fn () => $this->rawControl('tenant', null), 'نطاق مستأجر بلا مستأجر');
        $this->rejects(fn () => $this->rawControl('platform', $tenant, enabled: true), 'نطاق منصة بمستأجر');
        $this->rejects(fn () => $this->rawControl('tenant', $tenant, feature: 'debit_note_issuance'), 'ميزة غير معروفة');

        $this->assertSame(0, DB::table('payments_rollout_controls')->count());
    }

    #[Test]
    public function duplicate_controls_are_rejected_for_tenant_and_platform_scopes(): void
    {
        $tenant = $this->makeTenant();
        $this->rawControl('tenant', $tenant);
        $this->rawControl('platform', null, enabled: true);

        $this->rejects(fn () => $this->rawControl('tenant', $tenant), 'مستأجر مكرر');
        $this->rejects(fn () => $this->rawControl('platform', null, enabled: true), 'منصة مكررة (NULL لا يتفرّد في فهرس عادي)');
        $this->assertSame(2, DB::table('payments_rollout_controls')->count());
    }

    #[Test]
    public function audit_events_are_immutable_and_cannot_be_deleted_or_truncated(): void
    {
        $tenant = $this->makeTenant();
        $this->service->setTenantState($this->admin, $tenant, true, 'تفعيل');
        $this->service->setPlatformState($this->admin, false, 'إيقاف');
        $tenantEvent = DB::table('payments_rollout_control_events')->where('scope', 'tenant')->value('id');
        $platformEvent = DB::table('payments_rollout_control_events')->where('scope', 'platform')->value('id');

        $this->rejects(fn () => DB::table('payments_rollout_control_events')->where('id', $tenantEvent)->update(['reason' => 'تعديل']), 'تحديث السبب');
        $this->rejects(fn () => DB::table('payments_rollout_control_events')->where('id', $tenantEvent)->update(['new_enabled' => false]), 'تحديث الحالة');
        $this->rejects(fn () => DB::table('payments_rollout_control_events')->update(['occurred_at' => now()]), 'تحديث جماعي');
        $this->rejects(fn () => DB::table('payments_rollout_control_events')->where('id', $tenantEvent)->delete(), 'حذف حدث مستأجر موجود');
        $this->rejects(fn () => DB::table('payments_rollout_control_events')->where('id', $platformEvent)->delete(), 'حذف حدث منصة');
        $this->rejects(fn () => DB::table('payments_rollout_control_events')->delete(), 'حذف جماعي');
        $this->rejects(fn () => DB::table('payments_rollout_controls')->where('scope', 'tenant')->delete(), 'حذف ضابط مستأجر');
        $this->rejects(fn () => DB::table('payments_rollout_controls')->where('scope', 'platform')->delete(), 'حذف ضابط منصة (إيقاف لا يزول بصمت)');
        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->rejects(fn () => DB::statement('TRUNCATE payments_rollout_control_events'), 'TRUNCATE الأحداث');
            $this->rejects(fn () => DB::statement('TRUNCATE payments_rollout_controls CASCADE'), 'TRUNCATE الضوابط');
        }

        $this->assertSame(2, DB::table('payments_rollout_control_events')->count());
        $this->assertSame(2, DB::table('payments_rollout_controls')->count());
    }

    #[Test]
    public function an_event_that_does_not_match_the_control_state_is_rejected_and_changes_nothing(): void
    {
        $tenant = $this->makeTenant();
        $other = $this->makeTenant();
        $this->service->setTenantState($this->admin, $tenant, true, 'تفعيل');
        $this->service->setTenantState($this->admin, $other, true, 'تفعيل آخر');
        $control = DB::table('payments_rollout_controls')->where('tenant_id', $tenant)->first(); // enabled، نسخة 1

        $good = fn (array $override = []) => array_merge($this->rawEvent($control->id, 'tenant', $tenant, 2, true, false), $override);

        $this->rejects(fn () => DB::table('payments_rollout_control_events')->insert($good(['version' => 3])), 'قفز نسخة');
        $this->rejects(fn () => DB::table('payments_rollout_control_events')->insert($good(['version' => 1])), 'تكرار نسخة');
        $this->rejects(fn () => DB::table('payments_rollout_control_events')->insert($good(['previous_enabled' => false, 'new_enabled' => true])), 'حالة سابقة خاطئة');
        $this->rejects(fn () => DB::table('payments_rollout_control_events')->insert($good(['previous_enabled' => true, 'new_enabled' => true])), 'بلا تغيير فعلي');
        $this->rejects(fn () => DB::table('payments_rollout_control_events')->insert($good(['tenant_id' => $other])), 'حدث بمستأجر غير مستأجر الضابط');
        $this->rejects(fn () => DB::table('payments_rollout_control_events')->insert($good(['scope' => 'platform', 'tenant_id' => null])), 'نطاق لا يطابق الضابط');
        $this->rejects(fn () => DB::table('payments_rollout_control_events')->insert($good(['feature_key' => 'x'])), 'ميزة غير معروفة');
        $this->rejects(fn () => DB::table('payments_rollout_control_events')->insert($good(['reason' => ' '])), 'سبب فارغ');
        $this->rejects(fn () => DB::table('payments_rollout_control_events')->insert($good(['platform_administrator_id' => (string) Str::uuid()])), 'مدير غير موجود');
        $this->rejects(fn () => DB::table('payments_rollout_control_events')->insert($good(['control_id' => (string) Str::uuid()])), 'ضابط غير موجود');

        $this->assertTrue($this->service->effectiveForTenant($tenant)->enabled);
        $this->assertSame(1, (int) DB::table('payments_rollout_controls')->where('id', $control->id)->value('version'));

        // وحدث صحيح مُدرج مباشرةً يطبّق نفسه (المُشغّل هو الآلية): تعطيل بنسخة 2.
        DB::table('payments_rollout_control_events')->insert($good());
        $this->assertFalse($this->service->effectiveForTenant($tenant)->enabled);
        $this->assertSame(2, (int) DB::table('payments_rollout_controls')->where('id', $control->id)->value('version'));
    }

    #[Test]
    public function the_models_refuse_updates_and_deletes_before_reaching_the_database(): void
    {
        $tenant = $this->makeTenant();
        $this->service->setTenantState($this->admin, $tenant, true, 'تفعيل');
        $control = PaymentsRolloutControl::query()->firstOrFail();
        $event = PaymentsRolloutControlEvent::query()->firstOrFail();

        foreach ([fn () => $control->update(['enabled' => false]), fn () => $control->delete(), fn () => $event->update(['reason' => 'x']), fn () => $event->delete()] as $i => $operation) {
            $this->thrown($operation, "model guard #{$i}", LogicException::class);
        }
        $this->assertTrue($this->service->effectiveForTenant($tenant)->enabled);
    }

    // ═══════════════ حذف المستأجر والتراجع ═══════════════

    #[Test]
    public function a_hard_tenant_delete_removes_its_controls_and_events_but_never_the_platform_ones(): void
    {
        $tenant = $this->makeTenant();
        $keep = $this->makeTenant();
        $this->service->setTenantState($this->admin, $tenant, true, 'تفعيل');
        $this->service->setTenantState($this->admin, $keep, true, 'تفعيل آخر');
        $this->service->setPlatformState($this->admin, false, 'إيقاف');

        DB::table('tenants')->where('id', $tenant)->delete();

        $this->assertSame(0, DB::table('payments_rollout_controls')->where('tenant_id', $tenant)->count());
        $this->assertSame(0, DB::table('payments_rollout_control_events')->where('tenant_id', $tenant)->count());
        $this->assertSame(1, DB::table('payments_rollout_controls')->where('tenant_id', $keep)->count());
        $this->assertSame(1, DB::table('payments_rollout_controls')->where('scope', 'platform')->count());
        $this->assertSame(1, DB::table('payments_rollout_control_events')->where('scope', 'platform')->count());
    }

    #[Test]
    public function a_soft_deleted_tenant_keeps_its_protected_history(): void
    {
        $tenant = $this->makeTenant();
        $this->service->setTenantState($this->admin, $tenant, true, 'تفعيل');
        Tenant::query()->whereKey($tenant)->first()->delete();

        $this->rejects(fn () => DB::table('payments_rollout_control_events')->where('tenant_id', $tenant)->delete(), 'حذف حدث مستأجر محذوف ناعماً');
        $this->rejects(fn () => DB::table('payments_rollout_controls')->where('tenant_id', $tenant)->delete(), 'حذف ضابط مستأجر محذوف ناعماً');
    }

    #[Test]
    public function the_migration_refuses_to_roll_back_while_rows_exist_and_rolls_back_and_reapplies_when_empty(): void
    {
        $tenant = $this->makeTenant();
        $this->service->setTenantState($this->admin, $tenant, true, 'تفعيل');

        $e = $this->thrown(fn () => $this->migration()->down(), 'تراجع مع صفوف', RuntimeException::class);
        $this->assertStringContainsString('Rollback refused', $e->getMessage());
        $this->assertTrue(Schema::hasTable('payments_rollout_controls'));
        $this->assertTrue(Schema::hasTable('payments_rollout_control_events'));

        // ضابط بلا أحداث (حالة نادرة) يمنع التراجع أيضاً.
        DB::table('tenants')->where('id', $tenant)->delete();
        $this->assertSame(0, DB::table('payments_rollout_controls')->count());
        $other = $this->makeTenant();
        $this->rawControl('tenant', $other);
        $e = $this->thrown(fn () => $this->migration()->down(), 'تراجع مع ضابط وحده', RuntimeException::class);
        $this->assertStringContainsString('Rollback refused', $e->getMessage());

        DB::table('tenants')->where('id', $other)->delete();
        $this->migration()->down();
        $this->assertFalse(Schema::hasTable('payments_rollout_controls'));
        $this->assertFalse(Schema::hasTable('payments_rollout_control_events'));

        $this->migration()->up();
        $this->assertTrue(Schema::hasTable('payments_rollout_controls'));
        // المُشغّلات أُعيد إنشاؤها فعلاً.
        $tenant = $this->makeTenant();
        $this->rejects(fn () => $this->rawControl('tenant', $tenant, enabled: true), 'مُشغّل الإدراج بعد إعادة التطبيق');
        $this->assertSame(0, DB::table('payments_rollout_controls')->count());
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function makeAdmin(bool $active = true): PlatformAdministrator
    {
        return PlatformAdministrator::create([
            'name' => 'مدير منصة '.Str::random(5),
            'email' => Str::random(10).'@platform.test',
            'password' => 'secret-password-1',
            'is_active' => $active,
        ]);
    }

    private function makeTenant(): string
    {
        return Tenant::create([
            'name' => 'مستأجر تفعيل', 'slug' => 'payments-rollout-'.Str::random(10),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ])->id;
    }

    private function rawControl(string $scope, ?string $tenantId, bool $enabled = false, int $version = 0, string $feature = self::FEATURE): void
    {
        DB::table('payments_rollout_controls')->insert([
            'id' => (string) Str::uuid(), 'scope' => $scope, 'tenant_id' => $tenantId, 'feature_key' => $feature,
            'enabled' => $enabled, 'version' => $version, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    /** @return array<string, mixed> */
    private function rawEvent(string $controlId, string $scope, ?string $tenantId, int $version, bool $previous, bool $new): array
    {
        return [
            'id' => (string) Str::uuid(), 'control_id' => $controlId, 'scope' => $scope, 'tenant_id' => $tenantId,
            'feature_key' => self::FEATURE, 'version' => $version, 'previous_enabled' => $previous, 'new_enabled' => $new,
            'platform_administrator_id' => $this->admin->id, 'reason' => 'حدث مباشر للاختبار', 'occurred_at' => now(), 'created_at' => now(),
        ];
    }

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

    private function migration(): object
    {
        return require database_path('migrations/'.self::MIGRATION);
    }
}
