<?php

namespace Tests\Feature;

use App\Models\CustomerIdentity;
use App\Models\PriceList;
use App\Models\SalesChannel;
use App\Models\SalesChannelSettingEvent;
use App\Models\Tenant;
use App\Models\User;
use App\Models\WholesaleMembership;
use App\Models\WholesaleMembershipEvent;
use App\Services\Commerce\SalesChannelSettingsException;
use App\Services\Commerce\SalesChannelSettingsService;
use App\Services\Commerce\WholesaleMembershipException;
use App\Services\Commerce\WholesaleMembershipService;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  H6 Batch F — تزامن حقيقي متعدد العمليات لانتقالات عضوية الجملة (PostgreSQL)
 * ═══════════════════════════════════════════════════════════════
 *  اختبارات Batch E التسلسلية على SQLite **ليست** دليل تزامن. هنا عمليات `pcntl_fork` حقيقية باتصالات PostgreSQL منفصلة
 *  وحاجز بدء مشترك:
 *   1) قرارات متعارضة متزامنة على عضوية واحدة (اعتماد مقابل رفض؛ أربعة اعتمادات؛ إيقافان) ⇒ فائز واحد بالضبط، والبقية
 *      `invalid_transition`، وحدث تدقيق واحد للقرار، وحالة نهائية = حالة الفائز.
 *   2) سلوك قفل الصف: عملية تمسك `FOR UPDATE` على العضوية ٤٠٠ms ⇒ قرارٌ متزامن ينتظر فعلاً (زمنٌ ≥ مدة القفل) ثم يُطبَّق على الحالة الحالية.
 *   3) تقديمان متزامنان من هوية واحدة يتقاربان على عضوية واحدة وحدث واحد (قيد الفرادة).
 *   4) تعديلات إعدادات القناة المتزامنة تتسلسل (قفل صف القناة): سلسلة التدقيق متصلة (`from` = `to` السابق) والقيمة النهائية = آخر حدث.
 *
 *  على PostgreSQL **لا يُتخطّى** إن غاب `pcntl`: يفشل. يُتخطّى على SQLite فقط. بلا معاملة مُغلِّفة (الأطفال يحتاجون صفوفاً مثبَّتة).
 */
class WholesaleMembershipPostgresConcurrencyTest extends TestCase
{
    use UsesWorkerDatabaseWithoutTransaction;

    private string $dir;

    private string $tenantId;

    private string $channelId;

    private string $actorId;

    /** @var list<string> */
    private array $tenants = [];

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على أقفال الصفوف.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'),
            'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ.');

        $this->dir = sys_get_temp_dir().'/wholesale_pg_'.uniqid();
        mkdir($this->dir);

        $tenant = Tenant::create(['name' => 'جملة متزامنة', 'slug' => 'ws-pg-'.Str::random(8), 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        $this->tenants[] = $this->tenantId = $tenant->id;
        app(TenantContext::class)->set($this->tenantId);
        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $channel->forceFill(['wholesale_membership_enabled' => true])->save();
        $this->channelId = $channel->id;
        $this->actorId = User::create([
            'tenant_id' => $this->tenantId, 'name' => 'owner', 'email' => 'o-'.Str::random(6).'@pg.test',
            'password' => 'password123', 'role' => 'owner',
        ])->id;
        config(['commerce.wholesale_buyer_enabled' => true]);
    }

    protected function tearDown(): void
    {
        if (isset($this->dir) && is_dir($this->dir)) {
            foreach (glob($this->dir.'/*') ?: [] as $f) {
                @unlink($f);
            }
            @rmdir($this->dir);
        }
        if (DB::connection()->getDriverName() === 'pgsql') {
            foreach ($this->tenants as $id) {
                // children first: sales_channel FKs are RESTRICT
                DB::table('sales_channel_setting_events')->where('tenant_id', $id)->delete();
                DB::table('wholesale_membership_events')->where('tenant_id', $id)->delete();
                DB::table('wholesale_memberships')->where('tenant_id', $id)->delete();
                DB::table('tenants')->where('id', $id)->delete();
            }
        }

        parent::tearDown();
    }

    private function pendingMembership(string $label): string
    {
        app(TenantContext::class)->set($this->tenantId);
        $identity = CustomerIdentity::create([
            'tenant_id' => $this->tenantId, 'display_name' => $label, 'email' => $label.'-'.Str::random(5).'@pg.test',
            'password' => 'correct-horse-9', 'email_verified_at' => now(), 'is_active' => true,
        ]);

        return app(WholesaleMembershipService::class)->apply($identity, $this->channelId)->id;
    }

    /** @return callable(): array<string, mixed> */
    private function decision(string $membershipId, string $action, int $delayUs = 0): callable
    {
        $tenant = $this->tenantId;
        $actorId = $this->actorId;

        return function () use ($tenant, $membershipId, $action, $actorId, $delayUs): array {
            app(TenantContext::class)->set($tenant);
            $actor = User::query()->findOrFail($actorId);
            usleep($delayUs);
            try {
                app(WholesaleMembershipService::class)->transition($membershipId, $action, $actor);

                return ['won' => true, 'action' => $action];
            } catch (WholesaleMembershipException $e) {
                return ['won' => false, 'action' => $action, 'reason' => $e->reason];
            }
        };
    }

    private function staffEvents(string $membershipId): int
    {
        return (int) DB::table('wholesale_membership_events')
            ->where('wholesale_membership_id', $membershipId)->where('actor_type', 'staff')->count();
    }

    // ───────────────────────── 1 · قرارات متعارضة ─────────────────────────

    #[Test]
    public function opposing_decisions_on_one_membership_have_exactly_one_winner(): void
    {
        foreach (range(1, 6) as $round) {
            $id = $this->pendingMembership("opp{$round}");

            $results = $this->runConcurrently([
                $this->decision($id, 'approve'),
                $this->decision($id, 'reject'),
            ]);
            $this->assertAllOk($results);

            $winners = array_values(array_filter($results, fn ($r) => $r['value']['won']));
            $losers = array_values(array_filter($results, fn ($r) => ! $r['value']['won']));
            $this->assertCount(1, $winners, "الجولة {$round}: ".json_encode($results));
            $this->assertCount(1, $losers);
            $this->assertSame('invalid_transition', $losers[0]['value']['reason']);

            $final = DB::table('wholesale_memberships')->where('id', $id)->value('status');
            $this->assertSame($winners[0]['value']['action'] === 'approve' ? 'approved' : 'rejected', $final);
            $this->assertSame(1, $this->staffEvents($id), 'حدث تدقيق واحد للقرار الفائز فقط');
        }
    }

    #[Test]
    public function four_simultaneous_approvals_yield_one_decision_and_three_refusals(): void
    {
        $id = $this->pendingMembership('quad');

        $results = $this->runConcurrently(array_fill(0, 4, $this->decision($id, 'approve')));
        $this->assertAllOk($results);

        $this->assertCount(1, array_filter($results, fn ($r) => $r['value']['won']), json_encode($results));
        $this->assertCount(3, array_filter($results, fn ($r) => ! $r['value']['won'] && $r['value']['reason'] === 'invalid_transition'));
        $this->assertSame('approved', DB::table('wholesale_memberships')->where('id', $id)->value('status'));
        $this->assertSame(1, $this->staffEvents($id));
    }

    #[Test]
    public function two_simultaneous_suspensions_of_an_approved_buyer_apply_once(): void
    {
        $id = $this->pendingMembership('susp');
        app(TenantContext::class)->set($this->tenantId);
        app(WholesaleMembershipService::class)->transition($id, 'approve', User::query()->findOrFail($this->actorId));

        $results = $this->runConcurrently([$this->decision($id, 'suspend'), $this->decision($id, 'suspend')]);
        $this->assertAllOk($results);

        $this->assertCount(1, array_filter($results, fn ($r) => $r['value']['won']), json_encode($results));
        $this->assertSame('suspended', DB::table('wholesale_memberships')->where('id', $id)->value('status'));
        $this->assertSame(2, $this->staffEvents($id), 'approve + one suspend');
    }

    // ───────────────────────── 2 · سلوك قفل الصف ─────────────────────────

    #[Test]
    public function a_decision_waits_for_a_held_row_lock_then_applies_to_the_current_state(): void
    {
        $id = $this->pendingMembership('lock');
        $tenant = $this->tenantId;
        $holdUs = 400000;

        $holder = function () use ($tenant, $id, $holdUs): array {
            app(TenantContext::class)->set($tenant);
            DB::transaction(function () use ($id, $holdUs): void {
                WholesaleMembership::query()->lockForUpdate()->findOrFail($id);
                usleep($holdUs);
            });

            return ['held_us' => $holdUs];
        };
        $decider = function () use ($tenant, $id): array {
            app(TenantContext::class)->set($tenant);
            $actor = User::query()->where('tenant_id', $tenant)->firstOrFail();
            usleep(120000); // let the holder take the lock first
            $start = microtime(true);
            app(WholesaleMembershipService::class)->transition($id, 'approve', $actor);

            return ['waited_ms' => (int) round((microtime(true) - $start) * 1000)];
        };

        $results = $this->runConcurrently([$holder, $decider]);
        $this->assertAllOk($results);

        // ≥ ~280ms remained of the holder's lock when the decider started at +120ms; allow generous slack for CI jitter.
        $this->assertGreaterThanOrEqual(150, $results[1]['value']['waited_ms'], 'القرار يجب أن ينتظر قفل الصف فعلاً: '.json_encode($results));
        $this->assertSame('approved', DB::table('wholesale_memberships')->where('id', $id)->value('status'));
        $this->assertSame(1, $this->staffEvents($id));
    }

    // ───────────────────────── 3 · تقديم متزامن ─────────────────────────

    #[Test]
    public function simultaneous_applications_from_one_identity_converge_on_one_membership(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        $identity = CustomerIdentity::create([
            'tenant_id' => $this->tenantId, 'display_name' => 'racer', 'email' => 'racer-'.Str::random(5).'@pg.test',
            'password' => 'correct-horse-9', 'email_verified_at' => now(), 'is_active' => true,
        ]);
        $tenant = $this->tenantId;
        $channelId = $this->channelId;
        $identityId = $identity->id;

        $apply = function () use ($tenant, $channelId, $identityId): array {
            app(TenantContext::class)->set($tenant);
            $identity = CustomerIdentity::query()->findOrFail($identityId);

            return ['id' => app(WholesaleMembershipService::class)->apply($identity, $channelId)->id];
        };

        $results = $this->runConcurrently([$apply, $apply, $apply, $apply]);
        $this->assertAllOk($results);

        $ids = array_unique(array_map(fn ($r) => $r['value']['id'], $results));
        $this->assertCount(1, $ids, json_encode($results));
        $this->assertSame(1, DB::table('wholesale_memberships')->where('customer_identity_id', $identityId)->count());
        $this->assertSame(1, DB::table('wholesale_membership_events')->where('wholesale_membership_id', $ids[0])->count());
    }

    // ───────────────────────── 4 · إعدادات القناة المتزامنة ─────────────────────────

    #[Test]
    public function concurrent_channel_setting_edits_serialize_into_a_contiguous_audit_chain(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        $lists = [];
        foreach (range(1, 4) as $i) {
            $lists[] = PriceList::create(['name' => "L{$i} ".Str::random(4), 'is_active' => true])->id;
        }
        $tenant = $this->tenantId;
        $channelId = $this->channelId;
        $actorId = $this->actorId;

        $jobs = array_map(fn (string $listId) => function () use ($tenant, $channelId, $actorId, $listId): array {
            app(TenantContext::class)->set($tenant);
            $actor = User::query()->findOrFail($actorId);
            try {
                app(SalesChannelSettingsService::class)->update($channelId, ['default_price_list_id' => $listId], $actor);

                return ['ok' => true];
            } catch (SalesChannelSettingsException $e) {
                return ['ok' => false, 'reason' => $e->reason];
            }
        }, $lists);

        $results = $this->runConcurrently($jobs);
        $this->assertAllOk($results);
        $this->assertCount(4, array_filter($results, fn ($r) => $r['value']['ok']), json_encode($results));

        $events = SalesChannelSettingEvent::withoutGlobalScopes()
            ->where('sales_channel_id', $channelId)->orderBy('created_at')->orderBy('id')->get();
        $this->assertCount(4, $events);

        // Serialised by the channel row lock ⇒ each event's `from` is exactly the previous event's `to` (no lost update).
        // created_at has 1s resolution here, so order the chain by following links instead of timestamps.
        $byFrom = [];
        foreach ($events as $event) {
            $byFrom[$event->changes['default_price_list_id']['from'] ?? 'null'] = $event->changes['default_price_list_id']['to'];
        }
        $cursor = 'null';
        $walked = 0;
        while (isset($byFrom[$cursor])) {
            $cursor = $byFrom[$cursor];
            $walked++;
        }
        $this->assertSame(4, $walked, 'السلسلة متصلة بلا تحديث ضائع: '.json_encode($byFrom));
        $this->assertSame($cursor, DB::table('sales_channels')->where('id', $channelId)->value('default_price_list_id'), 'القيمة النهائية = نهاية السلسلة');
    }

    // ───────────────────────── حاضنة الأطفال ─────────────────────────

    /** @param array<int, array<string, mixed>> $results */
    private function assertAllOk(array $results): void
    {
        foreach ($results as $i => $r) {
            $this->assertTrue($r['ok'] ?? false, "العملية {$i} فشلت: ".json_encode($r));
        }
    }

    /** @param list<callable> $jobs @return array<int, array<string, mixed>> */
    private function runConcurrently(array $jobs): array
    {
        $barrier = $this->dir.'/barrier_'.uniqid();
        $resultFiles = [];
        $pids = [];

        foreach ($jobs as $i => $job) {
            $resultFiles[$i] = $this->dir.'/result_'.uniqid()."_{$i}";
            $pid = pcntl_fork();
            if ($pid === -1) {
                $this->fail('فشل pcntl_fork.');
            }
            if ($pid === 0) {
                DB::purge(config('database.default'));
                $deadline = microtime(true) + 10.0;
                while (! file_exists($barrier) && microtime(true) < $deadline) {
                    usleep(500);
                }
                try {
                    $value = $job();
                    file_put_contents($resultFiles[$i], json_encode(['ok' => true, 'value' => $value]));
                } catch (\Throwable $e) {
                    file_put_contents($resultFiles[$i], json_encode([
                        'ok' => false, 'error_class' => get_class($e), 'message' => $e->getMessage(),
                    ]));
                }
                exit(0);
            }
            $pids[] = $pid;
        }

        touch($barrier);
        foreach ($pids as $pid) {
            pcntl_waitpid($pid, $status);
        }

        $results = [];
        foreach ($resultFiles as $i => $file) {
            $raw = is_file($file) ? file_get_contents($file) : false;
            $results[$i] = json_decode($raw !== false ? $raw : '{"ok":false,"message":"no output"}', true);
        }

        return $results;
    }
}
