<?php

namespace Tests\Feature;

use App\Models\CommerceChannelOperationSetting;
use App\Models\CommerceOrderEvent;
use App\Models\SalesChannel;
use App\Models\SalesChannelSettingEvent;
use App\Models\Tenant;
use App\Models\User;
use App\Services\TenantApplicationService;
use App\Support\ApplicationCatalog;
use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use ReflectionClass;
use Tests\TestCase;

/**
 * COPS-H1-3 (ADR-29 §2.5) — أساس إعدادات تشغيل قناة المتجر (القبول فقط): `commerce_channel_operation_settings`، على SQLite وPostgreSQL.
 *
 * يُثبت: غياب الصف = السلوك الحالي حرفياً (القراءة لا تكتب)؛ الإنشاء الأول والنسخة لا تزداد إلا بتغيير فعلي؛ التدقيق في `sales_channel_setting_events` بمفاتيح
 * `operations.*`؛ الحماية التفاؤلية (428 بلا نسخة، 409 بنسخة قديمة بلا كتابة)؛ بوابة R-6b (manual مرفوض والبوابة مغلقة، والوضع الفعّال auto مهما خُزِّن)؛ التحقق من القيم؛
 * RBAC وتطبيق القدرة؛ عزل المستأجر والقناة؛ التوافق مع Checkout؛ وأن لا شيء في الكود القائم يقرأ الجدول (لا إنفاذ في H1-3).
 * التزامن وقيود PostgreSQL وترتيب الأقفال: `CommerceChannelOperationsSettingsPostgresTest`.
 */
class CommerceChannelOperationsSettingsTest extends TestCase
{
    use InteractsWithApi;
    use OnlineStorefrontHarness;
    use RefreshDatabase;

    private string $ownerToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootOnlineStore();
        $this->enableApplications($this->tenant);
        $this->ownerToken = $this->tokenFor($this->tenant, 'owner');
    }

    // ───────────────────────── أدوات ─────────────────────────

    private function enableApplications(Tenant $tenant): void
    {
        app(TenantContext::class)->set($tenant->id);
        foreach (ApplicationCatalog::all() as $key => $application) {
            if (! $application['mandatory'] && $application['maturity'] === ApplicationCatalog::MATURITY_BUILT) {
                app(TenantApplicationService::class)->enable($key, null);
            }
        }
        app(TenantContext::class)->forget();
    }

    private function tokenFor(Tenant $tenant, string $role): string
    {
        app(TenantContext::class)->set($tenant->id);
        $user = User::create(['tenant_id' => $tenant->id, 'name' => 'مستخدم '.$role, 'email' => $role.'-'.Str::random(6).'@ops.test', 'password' => 'password123', 'role' => $role]);
        $token = $user->createToken('api')->plainTextToken;
        app(TenantContext::class)->forget();

        return $token;
    }

    private function url(?string $channelId = null): string
    {
        return '/api/commerce/channels/'.($channelId ?? $this->channel->id).'/operations-settings';
    }

    private function fetch(?string $channelId = null, ?string $token = null)
    {
        return $this->withToken($token ?? $this->ownerToken)->getJson($this->url($channelId));
    }

    private function save(array $body, ?string $channelId = null, ?string $token = null)
    {
        return $this->withToken($token ?? $this->ownerToken)->putJson($this->url($channelId), $body);
    }

    private function rows(): int
    {
        return CommerceChannelOperationSetting::query()->withoutGlobalScopes()->count();
    }

    private function opsEvents(): int
    {
        return SalesChannelSettingEvent::query()->withoutGlobalScopes()->get()
            ->filter(fn ($e) => collect(array_keys($e->changes))->contains(fn ($k) => str_starts_with($k, 'operations.')))->count();
    }

    // ═════════════════════════ 1) الافتراضيات: غياب الصف = اليوم ═════════════════════════

    #[Test]
    public function a_channel_without_a_row_reads_the_current_behaviour_and_reading_writes_nothing(): void
    {
        $this->fetch()->assertOk()
            ->assertJsonPath('data.sales_channel_id', $this->channel->id)
            ->assertJsonPath('data.acceptance_mode', 'auto')
            ->assertJsonPath('data.effective_acceptance_mode', 'auto')
            ->assertJsonPath('data.acceptance_deployment_enabled', false)
            ->assertJsonPath('data.acceptance_reminder_minutes', null)
            ->assertJsonPath('data.acceptance_escalation_minutes', null)
            ->assertJsonPath('data.version', 0)
            ->assertJsonPath('data.configured', false)
            ->assertJsonPath('data.recent_changes', []);

        $this->fetch()->assertOk();
        $this->assertSame(0, $this->rows(), 'القراءة لا تُنشئ صفاً');
        $this->assertSame(0, SalesChannelSettingEvent::query()->withoutGlobalScopes()->count(), 'ولا تدقيقاً');
    }

    #[Test]
    public function a_put_that_equals_the_defaults_on_a_channel_without_a_row_writes_nothing(): void
    {
        $this->save(['expected_version' => 0, 'acceptance_mode' => 'auto', 'acceptance_reminder_minutes' => null])
            ->assertOk()->assertJsonPath('data.version', 0)->assertJsonPath('data.configured', false);

        $this->assertSame(0, $this->rows());
        $this->assertSame(0, SalesChannelSettingEvent::query()->withoutGlobalScopes()->count());
    }

    // ═════════════════════════ 2) الإنشاء والنسخة والتدقيق ═════════════════════════

    #[Test]
    public function the_first_change_creates_the_row_at_version_one_and_is_audited_with_prefixed_keys(): void
    {
        $res = $this->save(['expected_version' => 0, 'acceptance_reminder_minutes' => 15, 'acceptance_escalation_minutes' => 45])->assertOk();

        $res->assertJsonPath('data.version', 1)->assertJsonPath('data.configured', true)
            ->assertJsonPath('data.acceptance_mode', 'auto')
            ->assertJsonPath('data.acceptance_reminder_minutes', 15)->assertJsonPath('data.acceptance_escalation_minutes', 45);
        $this->assertNotNull($res->json('data.updated_at'));
        $this->assertSame(1, $this->rows());

        $event = SalesChannelSettingEvent::query()->withoutGlobalScopes()->firstOrFail();
        $this->assertSame($this->channel->id, $event->sales_channel_id);
        $this->assertSame(['operations.acceptance_reminder_minutes' => ['from' => null, 'to' => 15], 'operations.acceptance_escalation_minutes' => ['from' => null, 'to' => 45]], $event->changes);
        $this->assertNotNull($event->actor_user_id);

        $history = $this->fetch()->assertOk()->json('data.recent_changes');
        $this->assertCount(1, $history);
        $this->assertSame($event->changes, $history[0]['changes']);
        $this->assertSame('مستخدم owner', $history[0]['actor']['name']);
    }

    #[Test]
    public function the_version_only_increments_on_an_effective_change_and_a_repeat_is_a_silent_no_op(): void
    {
        $this->save(['expected_version' => 0, 'acceptance_reminder_minutes' => 10])->assertOk()->assertJsonPath('data.version', 1);
        $this->save(['expected_version' => 1, 'acceptance_reminder_minutes' => 10])->assertOk()->assertJsonPath('data.version', 1);
        $this->assertSame(1, $this->opsEvents(), 'التكرار المطابق لا يدقَّق');

        $this->save(['expected_version' => 1, 'acceptance_reminder_minutes' => 20])->assertOk()->assertJsonPath('data.version', 2);
        $this->save(['expected_version' => 2, 'acceptance_reminder_minutes' => null])->assertOk()->assertJsonPath('data.version', 3)->assertJsonPath('data.acceptance_reminder_minutes', null);
        $this->assertSame(3, $this->opsEvents());
        $this->assertSame(1, $this->rows(), 'صف واحد للقناة');
        $this->assertSame(['operations.acceptance_reminder_minutes' => ['from' => 20, 'to' => null]],
            SalesChannelSettingEvent::query()->withoutGlobalScopes()->orderByDesc('created_at')->orderByDesc('id')->first()->changes);
    }

    // ═════════════════════════ 3) الحماية من التحديث المتزامن ═════════════════════════

    #[Test]
    public function a_missing_expected_version_is_428_and_a_stale_one_is_409_and_neither_writes(): void
    {
        $this->save(['expected_version' => 0, 'acceptance_reminder_minutes' => 10])->assertOk();

        $this->save(['acceptance_reminder_minutes' => 99])->assertStatus(428)
            ->assertJsonPath('reason', 'expected_version_required')->assertJsonPath('current_version', 1);
        $this->save(['expected_version' => null, 'acceptance_reminder_minutes' => 99])->assertStatus(428);
        $this->save(['expected_version' => 0, 'acceptance_reminder_minutes' => 99])->assertStatus(409)
            ->assertJsonPath('reason', 'settings_version_conflict')->assertJsonPath('current_version', 1);
        $this->save(['expected_version' => 7, 'acceptance_reminder_minutes' => 99])->assertStatus(409)->assertJsonPath('current_version', 1);

        $this->assertSame(10, CommerceChannelOperationSetting::query()->firstOrFail()->acceptance_reminder_minutes);
        $this->assertSame(1, CommerceChannelOperationSetting::query()->firstOrFail()->version);
        $this->assertSame(1, $this->opsEvents());

        // النسخة الصحيحة تنجح.
        $this->save(['expected_version' => 1, 'acceptance_reminder_minutes' => 99])->assertOk()->assertJsonPath('data.version', 2);
    }

    #[Test]
    public function a_stale_version_conflicts_even_when_the_requested_values_would_be_a_no_op(): void
    {
        $this->save(['expected_version' => 0, 'acceptance_reminder_minutes' => 10])->assertOk();
        // يطابق القيمة الحالية لكن بنسخة قديمة: المحرّر لم يرَ آخر حالة ⇒ 409 لا نجاح صامت.
        $this->save(['expected_version' => 0, 'acceptance_reminder_minutes' => 10])->assertStatus(409);
    }

    // ═════════════════════════ 4) بوابة R-6b والوضع الفعّال ═════════════════════════

    #[Test]
    public function manual_acceptance_cannot_be_set_while_the_deployment_gate_is_closed(): void
    {
        $this->assertFalse((bool) config('commerce.order_acceptance_enabled'), 'مغلقة افتراضياً');

        $this->save(['expected_version' => 0, 'acceptance_mode' => 'manual'])->assertStatus(409)->assertJsonPath('reason', 'acceptance_deployment_disabled');
        $this->assertSame(0, $this->rows());
        $this->assertSame(0, SalesChannelSettingEvent::query()->withoutGlobalScopes()->count());

        // الإبقاء على auto وضبط التذكير لا يتأثر بالبوابة.
        $this->save(['expected_version' => 0, 'acceptance_mode' => 'auto', 'acceptance_reminder_minutes' => 5])->assertOk();
    }

    #[Test]
    public function an_open_gate_allows_manual_and_a_later_closed_gate_reports_auto_as_the_effective_mode_without_losing_the_stored_value(): void
    {
        config(['commerce.order_acceptance_enabled' => true]);
        $this->save(['expected_version' => 0, 'acceptance_mode' => 'manual', 'acceptance_reminder_minutes' => 10])->assertOk()
            ->assertJsonPath('data.acceptance_mode', 'manual')->assertJsonPath('data.effective_acceptance_mode', 'manual')
            ->assertJsonPath('data.acceptance_deployment_enabled', true);

        config(['commerce.order_acceptance_enabled' => false]);
        $this->fetch()->assertOk()->assertJsonPath('data.acceptance_mode', 'manual')->assertJsonPath('data.effective_acceptance_mode', 'auto');

        // والبوابة مغلقة: تعديل مفتاح آخر مع بقاء manual المخزَّن مسموح، والتحويل إلى auto مسموح دائماً.
        $this->save(['expected_version' => 1, 'acceptance_reminder_minutes' => 20])->assertOk()->assertJsonPath('data.acceptance_mode', 'manual');
        $this->save(['expected_version' => 2, 'acceptance_mode' => 'auto'])->assertOk()->assertJsonPath('data.acceptance_mode', 'auto');
        // وإعادة manual وهي مغلقة مرفوضة.
        $this->save(['expected_version' => 3, 'acceptance_mode' => 'manual'])->assertStatus(409)->assertJsonPath('reason', 'acceptance_deployment_disabled');
    }

    // ═════════════════════════ 5) التحقق من القيم ═════════════════════════

    #[Test]
    public function values_are_validated(): void
    {
        $ok = ['expected_version' => 0];
        $this->save($ok + ['acceptance_mode' => 'sometimes'])->assertStatus(422);
        $this->save($ok + ['acceptance_mode' => 1])->assertStatus(422);
        foreach ([0, -1, 1441, 'abc', 1.5, true] as $bad) {
            $this->save($ok + ['acceptance_reminder_minutes' => $bad])->assertStatus(422);
            $this->save($ok + ['acceptance_escalation_minutes' => $bad])->assertStatus(422);
        }
        $this->save($ok + ['tenant_id' => (string) Str::uuid(), 'acceptance_reminder_minutes' => 5])->assertStatus(422);
        $this->save(['expected_version' => -1, 'acceptance_reminder_minutes' => 5])->assertStatus(422);
        $this->save(['expected_version' => 'x', 'acceptance_reminder_minutes' => 5])->assertStatus(422);
        $this->save(['expected_version' => true, 'acceptance_reminder_minutes' => 5])->assertStatus(422);
        $this->assertSame(0, $this->rows());

        // الحدود المقبولة.
        $this->save($ok + ['acceptance_reminder_minutes' => 1, 'acceptance_escalation_minutes' => 1440])->assertOk();
        // رقم نصي يُقبل ويُخزَّن عدداً.
        $this->save(['expected_version' => 1, 'acceptance_reminder_minutes' => '30'])->assertOk()->assertJsonPath('data.acceptance_reminder_minutes', 30);
    }

    #[Test]
    public function the_escalation_cannot_be_shorter_than_the_reminder_including_against_the_stored_value(): void
    {
        $this->save(['expected_version' => 0, 'acceptance_reminder_minutes' => 30, 'acceptance_escalation_minutes' => 20])
            ->assertStatus(422)->assertJsonPath('reason', 'escalation_before_reminder');
        $this->assertSame(0, $this->rows());

        $this->save(['expected_version' => 0, 'acceptance_reminder_minutes' => 30, 'acceptance_escalation_minutes' => 30])->assertOk();
        // يقارن بالقيمة المخزَّنة لا بالمرسَلة فقط.
        $this->save(['expected_version' => 1, 'acceptance_escalation_minutes' => 10])->assertStatus(422)->assertJsonPath('reason', 'escalation_before_reminder');
        $this->save(['expected_version' => 1, 'acceptance_reminder_minutes' => 45])->assertStatus(422)->assertJsonPath('reason', 'escalation_before_reminder');
        // أحدهما بلا الآخر مسموح.
        $this->save(['expected_version' => 1, 'acceptance_reminder_minutes' => null])->assertOk();
        $this->save(['expected_version' => 2, 'acceptance_escalation_minutes' => 5])->assertOk();
    }

    #[Test]
    public function a_request_with_no_setting_is_rejected_without_a_write(): void
    {
        $this->save(['expected_version' => 0])->assertStatus(422)->assertJsonPath('reason', 'no_changes_supplied');
        $this->save(['expected_version' => 0, 'unknown_key' => 5])->assertStatus(422)->assertJsonPath('reason', 'no_changes_supplied');
        $this->assertSame(0, $this->rows());
    }

    // ═════════════════════════ 6) RBAC وتطبيق القدرة ═════════════════════════

    #[Test]
    public function only_the_dedicated_permission_may_read_or_write_and_the_application_gate_applies(): void
    {
        foreach (['accountant', 'staff'] as $role) {
            $token = $this->tokenFor($this->tenant, $role);
            $this->fetch(null, $token)->assertForbidden();
            $this->save(['expected_version' => 0, 'acceptance_reminder_minutes' => 5], null, $token)->assertForbidden();
        }
        $anon = $this->getJson('/api/commerce/channels/'.$this->channel->id.'/pricing-settings')->status();
        $this->assertContains($anon, [401, 403]);
        $this->getJson($this->url())->assertStatus($anon);
        $this->putJson($this->url(), ['expected_version' => 0, 'acceptance_reminder_minutes' => 5])->assertStatus($anon);

        // admin يملك الصلاحية (عبر `*`).
        $this->save(['expected_version' => 0, 'acceptance_reminder_minutes' => 5], null, $this->tokenFor($this->tenant, 'admin'))->assertOk();
        $this->assertSame(1, $this->rows());

        app(TenantContext::class)->set($this->tenant->id);
        app(TenantApplicationService::class)->disable('commerce.storefront', User::query()->first());
        app(TenantContext::class)->forget();
        $this->fetch()->assertForbidden();
        $this->save(['expected_version' => 1, 'acceptance_reminder_minutes' => 9])->assertForbidden();
    }

    // ═════════════════════════ 7) العزل ═════════════════════════

    #[Test]
    public function another_tenants_channel_and_unknown_or_non_web_channels_are_indistinguishable_not_found(): void
    {
        ['tenant' => $other] = $this->makeStore('ops-iso.test', 'ops-iso');
        $this->enableApplications($other);
        $otherToken = $this->tokenFor($other, 'owner');

        // قناتنا من مستأجر آخر: 404 على القراءة والكتابة والكتابة بلا نسخة (لا 428 يكشف وجودها).
        $this->fetch(null, $otherToken)->assertNotFound();
        $this->save(['expected_version' => 0, 'acceptance_reminder_minutes' => 5], null, $otherToken)->assertNotFound();
        $this->save(['acceptance_reminder_minutes' => 5], null, $otherToken)->assertNotFound();
        $this->fetch((string) Str::uuid())->assertNotFound();
        $this->save(['expected_version' => 0, 'acceptance_reminder_minutes' => 5], (string) Str::uuid())->assertNotFound();
        $this->assertSame(0, $this->rows());

        // قناة غير ويب: GET 404 وPUT 422 (كإعدادات التسعير).
        app(TenantContext::class)->set($this->tenant->id);
        $mobile = SalesChannel::create(['slug' => 'mob-ops', 'name' => 'Mobile', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true]);
        app(TenantContext::class)->forget();
        $this->fetch($mobile->id)->assertNotFound();
        $this->save(['expected_version' => 0, 'acceptance_reminder_minutes' => 5], $mobile->id)->assertStatus(422)->assertJsonPath('reason', 'channel_not_web');

        // قناة محذوفة ناعماً.
        app(TenantContext::class)->set($this->tenant->id);
        $gone = SalesChannel::create(['slug' => 'gone-ops', 'name' => 'Gone', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $gone->delete();
        app(TenantContext::class)->forget();
        $this->fetch($gone->id)->assertNotFound();
        $this->save(['expected_version' => 0, 'acceptance_reminder_minutes' => 5], $gone->id)->assertNotFound();

        // مستأجر آخر يضبط قناته دون أن يتأثر بقناتنا.
        $this->save(['expected_version' => 0, 'acceptance_reminder_minutes' => 7], $this->channelOf($other), $otherToken)->assertOk();
        $this->fetch()->assertOk()->assertJsonPath('data.version', 0);
        $this->assertSame(1, $this->rows());
    }

    private function channelOf(Tenant $tenant): string
    {
        return (string) SalesChannel::query()->withoutGlobalScopes()->where('tenant_id', $tenant->id)->where('type', SalesChannel::TYPE_WEB)->value('id');
    }

    #[Test]
    public function settings_are_per_channel(): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        $second = SalesChannel::create(['slug' => 'web-two', 'name' => 'Second', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        app(TenantContext::class)->forget();

        $this->save(['expected_version' => 0, 'acceptance_reminder_minutes' => 11])->assertOk();
        $this->fetch($second->id)->assertOk()->assertJsonPath('data.version', 0)->assertJsonPath('data.acceptance_reminder_minutes', null);
        $this->save(['expected_version' => 0, 'acceptance_reminder_minutes' => 22], $second->id)->assertOk();
        $this->assertSame(2, $this->rows());
        $this->fetch()->assertJsonPath('data.acceptance_reminder_minutes', 11);
    }

    // ═════════════════════════ 8) التوافق الرجعي وعدم الإنفاذ ═════════════════════════

    #[Test]
    public function a_configured_manual_mode_changes_nothing_in_checkout_or_the_order_events(): void
    {
        config(['commerce.order_acceptance_enabled' => true]);
        $this->save(['expected_version' => 0, 'acceptance_mode' => 'manual', 'acceptance_reminder_minutes' => 5, 'acceptance_escalation_minutes' => 10])->assertOk();

        $token = $this->readyCheckout($this->product($this->tenant, $this->channel), null);
        $orderId = (string) $this->complete($token, 'idem-ops-compat')->assertCreated()->json('data.order.id');

        $order = \App\Models\CommerceOrder::query()->findOrFail($orderId);
        $this->assertSame(\App\Models\CommerceOrder::STATUS_CONFIRMED, $order->status, 'يبقى مؤكَّداً آلياً (لا قبول في H1-3)');
        $this->assertNull($order->cancelled_at);
        $this->assertSame(['order.placed'], CommerceOrderEvent::query()->where('commerce_order_id', $orderId)->pluck('type')->all());
        $this->assertSame(['pickup' => 'pickup'][$order->delivery_method] ?? $order->delivery_method, $order->delivery_method);
    }

    #[Test]
    public function nothing_in_the_application_reads_the_settings_table_except_its_model_and_service(): void
    {
        $allowed = [
            'app/Models/CommerceChannelOperationSetting.php',
            'app/Services/Commerce/CommerceChannelOperationsSettingsService.php',
        ];
        $offenders = [];
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(base_path('app'), \FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            if ($file->getExtension() !== 'php') {
                continue;
            }
            $relative = str_replace(base_path().'/', '', $file->getPathname());
            if (in_array($relative, $allowed, true)) {
                continue;
            }
            $source = (string) file_get_contents($file->getPathname());
            if (str_contains($source, 'commerce_channel_operation_settings') || str_contains($source, 'CommerceChannelOperationSetting')) {
                $offenders[] = $relative;
            }
        }

        $this->assertSame([], $offenders, 'لا إنفاذ في H1-3: القبول والرفض والمهل في H1-4 وما بعده فقط، ولا مسار قائم يقرأ هذا الجدول');
    }

    #[Test]
    public function the_model_is_company_wide_not_mass_assignable_and_unique_per_channel(): void
    {
        $this->assertInstanceOf(CompanyWide::class, new CommerceChannelOperationSetting);
        $this->assertSame([], (new CommerceChannelOperationSetting)->getFillable());
        $this->assertTrue((new ReflectionClass(CommerceChannelOperationSetting::class))->isInstantiable());

        $this->save(['expected_version' => 0, 'acceptance_reminder_minutes' => 5])->assertOk();
        $this->expectException(\Illuminate\Database\QueryException::class);
        DB::table('commerce_channel_operation_settings')->insert([
            'id' => (string) Str::uuid(), 'tenant_id' => $this->tenant->id, 'sales_channel_id' => $this->channel->id,
            'acceptance_mode' => 'auto', 'version' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    #[Test]
    public function the_migration_refuses_to_roll_back_while_a_row_exists(): void
    {
        $this->save(['expected_version' => 0, 'acceptance_reminder_minutes' => 5])->assertOk();
        $migration = require base_path('database/migrations/2026_12_29_010000_create_commerce_channel_operation_settings.php');

        $this->expectException(\RuntimeException::class);
        $migration->down();
    }
}
