<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\SalesChannelSettingEvent;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Commerce\CommerceChannelOperationsSettingsService;
use App\Services\Commerce\SalesChannelSettingsException;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  COPS-H1-3 (ADR-29 §2.5) — إعدادات تشغيل القناة على PostgreSQL حقيقي: التزامن، ترتيب الأقفال، قيود القاعدة
 * ═══════════════════════════════════════════════════════════════
 *  1) كاتبان بالنسخة المتوقعة نفسها ⇒ فائز واحد بالضبط والخاسر 409 بلا كتابة (3 جولات)، والتدقيق حدث واحد.
 *  2) كتّاب يعيدون المحاولة عند التعارض ⇒ سلسلة تغييرات خطية: النسخة النهائية = عدد التغييرات الفعلية، وكل حدث تدقيق يبدأ مما انتهى إليه سابقه.
 *  3) ترتيب الأقفال (ADR-19 §2.3): كاتب الإعدادات يقفل القناة ثم صفوفه؛ (أ) مع ممسك قناة بقفل مشترك ثم مِرساة المستأجر (مسار الإتمام) و(ب) مع ممسك
 *     مِرساة المستأجر وحدها (الترقيم/الأستاذ) ⇒ ينتظر ثم ينجح، **بلا جمود**.
 *  4) قيود CHECK في القاعدة ترفض القيم الشاذة حتى لو تجاوز أحدٌ الخدمة.
 *
 *  على PostgreSQL **لا يُتخطّى** إن غاب `pcntl`: يفشل. يُتخطّى على SQLite فقط. بلا معاملة مُغلِّفة (الأطفال يحتاجون صفوفاً مثبَّتة).
 */
class CommerceChannelOperationsSettingsPostgresTest extends TestCase
{
    use UsesWorkerDatabaseWithoutTransaction;

    private string $dir;

    private string $tenantId;

    private string $userId;

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

        $this->dir = sys_get_temp_dir().'/commerce_ops_'.uniqid();
        mkdir($this->dir);

        $tenant = Tenant::create(['name' => 'إعدادات التشغيل', 'slug' => 'cops-ops-'.Str::random(8), 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        $this->tenants[] = $this->tenantId = $tenant->id;
        app(TenantContext::class)->set($this->tenantId);
        $this->userId = User::create(['tenant_id' => $this->tenantId, 'name' => 'مشرف', 'email' => 'ops-'.Str::random(6).'@pg.test', 'password' => 'password123', 'role' => 'owner'])->id;
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
                DB::table('tenants')->where('id', $id)->delete();
            }
        }

        parent::tearDown();
    }

    // ───────────────────────── أدوات ─────────────────────────

    private function channel(): string
    {
        app(TenantContext::class)->set($this->tenantId);

        return SalesChannel::create(['slug' => 'web-'.Str::random(8), 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true])->id;
    }

    /**
     * يستدعي الخدمة الحقيقية (يُستعمل داخل الأطفال). يعيد النتيجة أو رمز الرفض.
     *
     * @param  array<string, mixed>  $changes
     * @return array<string, mixed>
     */
    private static function attempt(string $tenantId, string $userId, string $channelId, int $expected, array $changes): array
    {
        app(TenantContext::class)->set($tenantId);
        $user = User::query()->findOrFail($userId);
        try {
            $view = app(CommerceChannelOperationsSettingsService::class)->update($channelId, $expected, $changes, $user);

            return ['ok' => true, 'version' => $view['version'], 'reminder' => $view['acceptance_reminder_minutes']];
        } catch (SalesChannelSettingsException $e) {
            return ['ok' => false, 'reason' => $e->reason, 'current_version' => $e->details['current_version'] ?? null];
        }
    }

    private static function currentVersion(string $tenantId, string $channelId): int
    {
        app(TenantContext::class)->set($tenantId);

        return (int) app(CommerceChannelOperationsSettingsService::class)->view($channelId)['version'];
    }

    private function assertNoDeadlock(array $results): void
    {
        foreach ($results as $i => $result) {
            $this->assertTrue($result['ok'] ?? false, "العملية {$i}: ".($result['error_class'] ?? '').' '.($result['message'] ?? ''));
            $message = (string) ($result['message'] ?? '');
            $this->assertFalse(str_contains($message, '40P01') || stripos($message, 'deadlock') !== false, "جمود في العملية {$i}");
        }
    }

    private function rows(string $channelId): int
    {
        return DB::table('commerce_channel_operation_settings')->where('sales_channel_id', $channelId)->count();
    }

    // ───────────────────────── 1) فائز واحد ─────────────────────────

    #[Test]
    public function two_writers_with_the_same_expected_version_have_exactly_one_winner_and_the_loser_changes_nothing(): void
    {
        $tenant = $this->tenantId;
        $user = $this->userId;

        foreach ([1, 2, 3] as $round) {
            $channel = $this->channel();
            $jobs = [
                fn () => self::attempt($tenant, $user, $channel, 0, ['acceptance_reminder_minutes' => 10]),
                fn () => self::attempt($tenant, $user, $channel, 0, ['acceptance_reminder_minutes' => 20, 'acceptance_escalation_minutes' => 60]),
            ];
            $results = $this->runConcurrently($jobs);
            $this->assertNoDeadlock($results);
            $values = array_column($results, 'value');

            $winners = array_values(array_filter($values, fn (array $v) => $v['ok']));
            $losers = array_values(array_filter($values, fn (array $v) => ! $v['ok']));
            $this->assertCount(1, $winners, "الجولة {$round}: فائز واحد بالضبط");
            $this->assertCount(1, $losers);
            $this->assertSame('settings_version_conflict', $losers[0]['reason']);
            $this->assertSame(1, $losers[0]['current_version']);
            $this->assertSame(1, $this->rows($channel), 'صف واحد للقناة');
            $this->assertSame(1, (int) DB::table('commerce_channel_operation_settings')->where('sales_channel_id', $channel)->value('version'));
            $this->assertSame(1, SalesChannelSettingEvent::query()->where('sales_channel_id', $channel)->count(), 'حدث تدقيق واحد (الخاسر لم يكتب)');
            // قيم الفائز كما أرسلها فقط (لا خلط بين الكاتبين).
            $stored = DB::table('commerce_channel_operation_settings')->where('sales_channel_id', $channel)->first();
            $this->assertSame($winners[0]['reminder'], (int) $stored->acceptance_reminder_minutes);
            $this->assertSame($winners[0]['reminder'] === 10 ? null : 60, $stored->acceptance_escalation_minutes === null ? null : (int) $stored->acceptance_escalation_minutes);
        }
    }

    // ───────────────────────── 2) سلسلة خطية ─────────────────────────

    #[Test]
    public function retrying_writers_produce_a_linear_chain_of_changes_with_one_audit_event_per_effective_change(): void
    {
        $tenant = $this->tenantId;
        $user = $this->userId;
        $channel = $this->channel();
        $values = [11, 22, 33, 44, 55, 66];

        $jobs = [];
        foreach ($values as $value) {
            $jobs[] = function () use ($tenant, $user, $channel, $value) {
                $conflicts = 0;
                for ($i = 0; $i < 60; $i++) {
                    $result = self::attempt($tenant, $user, $channel, self::currentVersion($tenant, $channel), ['acceptance_reminder_minutes' => $value]);
                    if ($result['ok']) {
                        return ['conflicts' => $conflicts, 'version' => $result['version']];
                    }
                    if ($result['reason'] !== 'settings_version_conflict') {
                        return ['unexpected' => $result['reason']];
                    }
                    $conflicts++;
                    usleep(random_int(500, 5000));
                }

                return ['gave_up' => true];
            };
        }

        $results = $this->runConcurrently($jobs);
        $this->assertNoDeadlock($results);
        foreach (array_column($results, 'value') as $v) {
            $this->assertArrayNotHasKey('unexpected', $v);
            $this->assertArrayNotHasKey('gave_up', $v);
        }

        $this->assertSame(1, $this->rows($channel));
        $this->assertSame(6, (int) DB::table('commerce_channel_operation_settings')->where('sales_channel_id', $channel)->value('version'), 'النسخة = عدد التغييرات الفعلية');
        $events = SalesChannelSettingEvent::query()->where('sales_channel_id', $channel)->get();
        $this->assertCount(6, $events);

        $froms = [];
        $tos = [];
        foreach ($events as $e) {
            $change = $e->changes['operations.acceptance_reminder_minutes'];
            $froms[] = $change['from'];
            $tos[] = $change['to'];
        }
        sort($tos);
        $this->assertSame($values, $tos, 'كل قيمة سُجِّلت مرة واحدة');
        $this->assertSame(1, count(array_filter($froms, fn ($f) => $f === null)), 'بداية واحدة من الافتراضي');
        $nonNull = array_values(array_filter($froms, fn ($f) => $f !== null));
        $this->assertSame($nonNull, array_values(array_unique($nonNull)), 'كل «من» فريد: سلسلة خطية لا تفرّع');
        $this->assertCount(5, array_intersect($nonNull, $tos), 'كل «من» غير الأول هو «إلى» لحدث سابق');
        $this->assertContains((int) DB::table('commerce_channel_operation_settings')->where('sales_channel_id', $channel)->value('acceptance_reminder_minutes'), $values);
    }

    // ───────────────────────── 3) ترتيب الأقفال ─────────────────────────

    #[Test]
    public function a_settings_write_waits_for_a_checkout_style_holder_that_locks_the_channel_then_the_tenant_anchor_without_deadlock(): void
    {
        $tenant = $this->tenantId;
        $user = $this->userId;
        $channel = $this->channel();

        // مسار الإتمام (ADR-19 §2.3): قفل مشترك على القناة ← مِرساة المستأجر (ترقيم CORD) ← التزام.
        $holder = function () use ($tenant, $channel) {
            DB::transaction(function () use ($tenant, $channel) {
                app(TenantContext::class)->set($tenant);
                SalesChannel::query()->whereKey($channel)->sharedLock()->first();
                DB::table('tenants')->where('id', $tenant)->lockForUpdate()->first();
                usleep(1_000_000);
            });

            return ['done' => true];
        };
        $writer = function () use ($tenant, $user, $channel) {
            usleep(300_000); // بعد أن يمسك المالك القناة
            $t0 = microtime(true);
            $result = self::attempt($tenant, $user, $channel, 0, ['acceptance_reminder_minutes' => 15]);

            return $result + ['waited_s' => microtime(true) - $t0];
        };

        $results = $this->runConcurrently([$holder, $writer]);
        $this->assertNoDeadlock($results);
        $w = $results[1]['value'];
        $this->assertTrue($w['ok'], json_encode($w));
        $this->assertGreaterThan(0.4, $w['waited_s'], 'انتظر القناة حتى التزم الممسك');
        $this->assertSame(1, $this->rows($channel));
    }

    #[Test]
    public function a_settings_write_waits_for_a_tenant_anchor_holder_such_as_numbering_or_the_ledger_without_deadlock(): void
    {
        $tenant = $this->tenantId;
        $user = $this->userId;
        $channel = $this->channel();

        // مِرساة الترقيم/الأستاذ وحدها: `tenants FOR UPDATE`. إدراج صفوفنا يأخذ KEY SHARE على صف المستأجر عبر المفتاح الأجنبي فيتقدّم بعد الالتزام.
        $holder = function () use ($tenant) {
            DB::transaction(function () use ($tenant) {
                DB::table('tenants')->where('id', $tenant)->lockForUpdate()->first();
                usleep(1_000_000);
            });

            return ['done' => true];
        };
        $writer = function () use ($tenant, $user, $channel) {
            usleep(300_000);
            $t0 = microtime(true);
            $result = self::attempt($tenant, $user, $channel, 0, ['acceptance_reminder_minutes' => 25, 'acceptance_escalation_minutes' => 50]);

            return $result + ['waited_s' => microtime(true) - $t0];
        };

        $results = $this->runConcurrently([$holder, $writer]);
        $this->assertNoDeadlock($results);
        $w = $results[1]['value'];
        $this->assertTrue($w['ok'], json_encode($w));
        $this->assertGreaterThan(0.4, $w['waited_s'], 'انتظر مِرساة المستأجر حتى التزم الممسك');
        $this->assertSame(1, SalesChannelSettingEvent::query()->where('sales_channel_id', $channel)->count());
    }

    // ───────────────────────── 4) قيود القاعدة ─────────────────────────

    #[Test]
    public function database_check_constraints_reject_out_of_contract_values_even_when_the_service_is_bypassed(): void
    {
        $channel = $this->channel();
        $base = ['tenant_id' => $this->tenantId, 'sales_channel_id' => $channel, 'acceptance_mode' => 'auto', 'version' => 1, 'created_at' => now(), 'updated_at' => now()];
        $cases = [
            'وضع غير معتمد' => ['acceptance_mode' => 'sometimes'],
            'تذكير صفر' => ['acceptance_reminder_minutes' => 0],
            'تذكير فوق السقف' => ['acceptance_reminder_minutes' => 1441],
            'تصعيد فوق السقف' => ['acceptance_escalation_minutes' => 1441],
            'تصعيد أقصر من التذكير' => ['acceptance_reminder_minutes' => 30, 'acceptance_escalation_minutes' => 20],
            'نسخة صفر' => ['version' => 0],
        ];
        foreach ($cases as $label => $override) {
            try {
                DB::transaction(fn () => DB::table('commerce_channel_operation_settings')->insert(['id' => (string) Str::uuid()] + $override + $base));
                $this->fail("{$label}: كان يجب أن يُرفض");
            } catch (QueryException $e) {
                $this->assertStringContainsString('commerce_ops_settings_shape_chk', $e->getMessage(), $label);
            }
        }
        $this->assertSame(0, $this->rows($channel));

        // صف سليم على الحدود يُقبل.
        DB::table('commerce_channel_operation_settings')->insert(['id' => (string) Str::uuid(), 'acceptance_reminder_minutes' => 1, 'acceptance_escalation_minutes' => 1440] + $base);
        $this->assertSame(1, $this->rows($channel));
    }

    // ───────────────────────── تشغيل متزامن ─────────────────────────

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
