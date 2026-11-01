<?php

namespace Tests\Feature;

use App\Models\CommerceOrder;
use App\Models\CommercePaymentIntent;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Commerce\CommerceOrderEventRecorder;
use App\Services\Commerce\CommerceOrderLifecycleService;
use App\Services\Commerce\CommercePaymentIntentService;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  COPS-H1-1 (ADR-29 §2.4، بوابات R-2) — تغذية أحداث الطلب على PostgreSQL حقيقي
 * ═══════════════════════════════════════════════════════════════
 *  1) التزام متأخر: كاتب لاحق ينتظر الرأس حتى يلتزم السابق، والتسلسل بترتيب الالتزام، ومستطلِع متزامن لا يرى فجوة أبداً.
 *  2) التراجع: لا فجوة لكاتب متزامن ولا لاحق.
 *  3) الاكتمال والأداء: 20 كاتباً × 10 معاملات ⇒ 1..200 بلا تكرار ولا فقد، وقياس انتظار الرأس مقابل حدّ p95 المعتمد (50ms إضافية).
 *  4) لا جمود: الكاتب لا يلمس `tenants`، فممسك مِرساة المستأجر (`FOR UPDATE`) المنتظر لصف يمسكه الكاتب لا يكوّن حلقة — مع ضابط سلبي
 *     يُثبت أن قفلاً على `tenants` في الموضع نفسه كان سيُنتج 40P01 (حساسية الاختبار).
 *  5) المسارات الحقيقية (إلغاء الموظف ‖ تحصيل الاستلام ‖ ممسك مِرساة يكتب حدثاً آخراً) بلا جمود وبتسلسل متصل.
 *
 *  على PostgreSQL **لا يُتخطّى** إن غاب `pcntl`: يفشل. يُتخطّى على SQLite فقط. بلا معاملة مُغلِّفة (الأطفال يحتاجون صفوفاً مثبَّتة).
 */
class CommerceOrderEventsPostgresTest extends TestCase
{
    use UsesWorkerDatabaseWithoutTransaction;

    /** حدّ R-2 المعتمد: الزيادة في p95 لانتظار الرأس تحت 20 كاتباً متزامناً. */
    private const P95_BUDGET_MS = 50.0;

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

        $this->dir = sys_get_temp_dir().'/commerce_events_'.uniqid();
        mkdir($this->dir);

        $tenant = Tenant::create(['name' => 'تغذية الأحداث', 'slug' => 'cops-pg-'.Str::random(8), 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        $this->tenants[] = $this->tenantId = $tenant->id;
        app(TenantContext::class)->set($this->tenantId);
        $this->channelId = SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true])->id;
        $this->actorId = User::create(['tenant_id' => $this->tenantId, 'name' => 'مشرف', 'email' => 'sup-'.Str::random(6).'@pg.test', 'password' => 'password123', 'role' => 'admin'])->id;
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

    /** طلب استلام مؤكَّد بنية بانتظار التحصيل. */
    private function order(): string
    {
        app(TenantContext::class)->set($this->tenantId);
        $order = CommerceOrder::create(['sales_channel_id' => $this->channelId, 'number' => 'CORD-EV-'.Str::upper(Str::random(8)), 'delivery_method' => 'pickup', 'total' => 1000]);
        $order->update(['status' => CommerceOrder::STATUS_CONFIRMED, 'confirmed_at' => now()]);
        CommercePaymentIntent::create(['commerce_order_id' => $order->id, 'method' => CommercePaymentIntent::METHOD_PAY_ON_PICKUP,
            'status' => CommercePaymentIntent::STATUS_AWAITING_COLLECTION, 'amount_minor' => 1000, 'currency' => 'SAR']);

        return $order->id;
    }

    /** يكتب حدثاً بالكاتب الحقيقي داخل معاملة الطفل. */
    private static function append(string $tenantId, string $orderId): void
    {
        app(TenantContext::class)->set($tenantId);
        $order = CommerceOrder::query()->findOrFail($orderId);
        app(CommerceOrderEventRecorder::class)->append($order, 'payment.collected', 'system');
    }

    /** @return list<int> */
    private function seqs(): array
    {
        return array_map('intval', DB::table('commerce_order_events')->where('tenant_id', $this->tenantId)->orderBy('feed_seq')->pluck('feed_seq')->all());
    }

    private function feedHead(): int
    {
        return (int) DB::table('commerce_order_events')->where('tenant_id', $this->tenantId)->max('feed_seq');
    }

    private function assertNoDeadlock(array $results): void
    {
        foreach ($results as $i => $result) {
            $this->assertTrue($result['ok'] ?? false, "العملية {$i}: ".($result['error_class'] ?? '').' '.($result['message'] ?? ''));
            $message = (string) ($result['message'] ?? '');
            $this->assertFalse(str_contains($message, '40P01') || stripos($message, 'deadlock') !== false, "جمود في العملية {$i}");
        }
    }

    // ───────────────────────── 0) خارج المعاملة ─────────────────────────

    #[Test]
    public function appending_outside_a_transaction_is_refused_and_writes_nothing(): void
    {
        $orderId = $this->order();
        $this->assertSame(0, DB::transactionLevel());
        $this->expectException(\LogicException::class);
        try {
            self::append($this->tenantId, $orderId);
        } finally {
            $this->assertSame([], $this->seqs());
            $this->assertSame(0, $this->feedHead());
        }
    }

    // ───────────────────────── 1) التزام متأخر + مستطلِع ─────────────────────────

    #[Test]
    public function a_delayed_commit_blocks_the_next_writer_and_a_concurrent_poller_never_observes_a_gap(): void
    {
        $tenant = $this->tenantId;
        [$o1, $o2] = [$this->order(), $this->order()];

        $slow = function () use ($tenant, $o1) {
            DB::transaction(function () use ($tenant, $o1) {
                self::append($tenant, $o1);
                usleep(1_500_000); // يمسك الرأس 1.5ث قبل الالتزام
            });

            return ['committed_at' => microtime(true)];
        };
        $fast = function () use ($tenant, $o2) {
            usleep(300_000); // يبدأ بعد أن يمسك البطيء الرأس
            $t0 = microtime(true);
            DB::transaction(fn () => self::append($tenant, $o2));

            return ['started_at' => $t0, 'committed_at' => microtime(true)];
        };
        $poller = function () use ($tenant) {
            $observations = [];
            $deadline = microtime(true) + 2.6;
            while (microtime(true) < $deadline) {
                $observations[] = array_map('intval', DB::table('commerce_order_events')->where('tenant_id', $tenant)->orderBy('feed_seq')->pluck('feed_seq')->all());
                usleep(20_000);
            }

            return $observations;
        };

        $results = $this->runConcurrently([$slow, $fast, $poller]);
        $this->assertNoDeadlock($results);
        [$slowR, $fastR, $pollR] = array_column($results, 'value');

        $this->assertGreaterThanOrEqual($slowR['committed_at'], $fastR['committed_at'], 'الكاتب اللاحق التزم بعد السابق');
        $this->assertGreaterThan(1.0, $fastR['committed_at'] - $fastR['started_at'], 'الكاتب اللاحق انتظر رأس التغذية حتى التزام السابق');
        $this->assertSame([1, 2], $this->seqs());
        $this->assertSame($o1, DB::table('commerce_order_events')->where('tenant_id', $tenant)->where('feed_seq', 1)->value('commerce_order_id'), 'التسلسل بترتيب الالتزام');
        $this->assertNotEmpty($pollR);
        foreach ($pollR as $seen) {
            $this->assertSame($seen === [] ? [] : range(1, max($seen)), $seen, 'المستطلِع رأى فجوة في التسلسل');
        }
    }

    // ───────────────────────── 2) التراجع ─────────────────────────

    #[Test]
    public function a_rolled_back_writer_leaves_no_gap_for_a_concurrent_or_later_writer(): void
    {
        $tenant = $this->tenantId;
        [$o1, $o2] = [$this->order(), $this->order()];

        $rollsBack = function () use ($tenant, $o1) {
            try {
                DB::transaction(function () use ($tenant, $o1) {
                    self::append($tenant, $o1);
                    usleep(800_000);
                    throw new \RuntimeException('فشل بعد كتابة الحدث');
                });
            } catch (\RuntimeException) {
                return ['rolled_back' => true];
            }

            return ['rolled_back' => false];
        };
        $waits = function () use ($tenant, $o2) {
            usleep(200_000);
            DB::transaction(fn () => self::append($tenant, $o2));

            return ['ok' => true];
        };

        $results = $this->runConcurrently([$rollsBack, $waits]);
        $this->assertNoDeadlock($results);
        $this->assertTrue($results[0]['value']['rolled_back']);
        $this->assertSame([1], $this->seqs(), 'الحدث المتراجَع لم يستهلك رقماً');
        $this->assertSame($o2, DB::table('commerce_order_events')->where('tenant_id', $tenant)->value('commerce_order_id'));

        DB::transaction(fn () => self::append($tenant, $o1));
        $this->assertSame([1, 2], $this->seqs());
        $this->assertSame(2, $this->feedHead());
    }

    // ───────────────────────── 3) الاكتمال + قياس التنازع ─────────────────────────

    #[Test]
    public function twenty_concurrent_writers_produce_a_complete_gap_free_sequence_within_the_contention_budget(): void
    {
        $tenant = $this->tenantId;
        $writers = 20;
        $perWriter = 10;
        $orders = [];
        for ($i = 0; $i < $writers; $i++) {
            $orders[] = $this->order();
        }

        // خط أساس بلا تنافس: كاتب واحد متسلسل.
        $baseline = [];
        for ($i = 0; $i < 30; $i++) {
            DB::transaction(function () use ($tenant, $orders, &$baseline) {
                CommerceOrder::query()->whereKey($orders[0])->lockForUpdate()->first();
                $t0 = hrtime(true);
                self::append($tenant, $orders[0]);
                $baseline[] = (hrtime(true) - $t0) / 1e6;
            });
        }
        $already = count($this->seqs());

        $jobs = [];
        foreach ($orders as $orderId) {
            $jobs[] = function () use ($tenant, $orderId, $perWriter) {
                $waits = [];
                for ($j = 0; $j < $perWriter; $j++) {
                    DB::transaction(function () use ($tenant, $orderId, &$waits) {
                        // عمل سابق في المعاملة (قفل صف الطلب) ثم الحدث آخراً — كما في مسارات الانتقال الحقيقية.
                        CommerceOrder::query()->whereKey($orderId)->lockForUpdate()->first();
                        $t0 = hrtime(true);
                        self::append($tenant, $orderId);
                        $waits[] = (hrtime(true) - $t0) / 1e6;
                    });
                }

                return $waits;
            };
        }
        $results = $this->runConcurrently($jobs);
        $this->assertNoDeadlock($results);

        $total = $already + $writers * $perWriter;
        $this->assertSame(range(1, $total), $this->seqs(), 'كل الأحداث موجودة بلا فجوة ولا تكرار');
        $this->assertSame($total, $this->feedHead());
        foreach ($orders as $i => $orderId) {
            $expected = $perWriter + ($i === 0 ? 30 : 0);
            $this->assertSame($expected, DB::table('commerce_order_events')->where('commerce_order_id', $orderId)->count(), "الكاتب {$i}");
        }

        $waits = array_merge(...array_column($results, 'value'));
        sort($waits);
        sort($baseline);
        $pct = fn (array $xs, float $p): float => $xs[(int) floor(($p / 100) * (count($xs) - 1))];
        $metrics = [
            'writers' => $writers, 'transactions' => count($waits),
            'baseline_p50_ms' => round($pct($baseline, 50), 3), 'baseline_p95_ms' => round($pct($baseline, 95), 3),
            'contended_p50_ms' => round($pct($waits, 50), 3), 'contended_p95_ms' => round($pct($waits, 95), 3), 'contended_max_ms' => round(max($waits), 3),
        ];
        $metrics['added_p95_ms'] = round($metrics['contended_p95_ms'] - $metrics['baseline_p50_ms'], 3);
        fwrite(STDERR, "\nCOPS-H1-1 FeedHead contention: ".json_encode($metrics)."\n");

        $this->assertLessThan(self::P95_BUDGET_MS, $metrics['added_p95_ms'],
            'R-2: انتظار رأس التغذية تحت 20 كاتباً تجاوز حدّ p95 المعتمد — تصعيد للمالك. '.json_encode($metrics));
    }

    // ───────────────────────── 4) لا جمود مع مِرساة المستأجر ─────────────────────────

    /**
     * X يمسك `tenants FOR UPDATE` (مِرساة الترقيم/الأستاذ) ثم ينتظر صف طلب يمسكه Y؛ Y يكتب حدثاً بعد إمساكه الصف. لو احتاج الكاتب أي قفل على
     * `tenants` لانتظر X فتكوّنت حلقة. النتيجة المطلوبة: Y يكتب ويلتزم دون انتظار X، ثم يكمل X.
     */
    #[Test]
    public function the_recorder_never_waits_on_the_tenant_anchor_so_an_anchor_holder_cannot_deadlock_it(): void
    {
        foreach (range(1, 3) as $round) {
            $results = $this->anchorRace(fn (string $tenant, string $orderId) => self::append($tenant, $orderId));
            $this->assertNoDeadlock($results);
            $this->assertLessThan($results[0]['value']['done_at'], $results[1]['value']['appended_at'], "الجولة {$round}: الكاتب لم ينتظر ممسك المِرساة");
        }
        $this->assertSame([1, 2, 3], $this->seqs());
    }

    /** ضابط سلبي: الموضع نفسه بقفل `FOR KEY SHARE` على `tenants` (ما كان سيأخذه مفتاح أجنبي إليه) يُنتج جموداً — الاختبار السابق حسّاس. */
    #[Test]
    public function control_a_tenant_key_share_at_the_same_point_would_deadlock(): void
    {
        $results = $this->anchorRace(function (string $tenant): void {
            DB::select('SELECT 1 FROM tenants WHERE id = ? FOR KEY SHARE', [$tenant]);
        });
        $messages = implode(' | ', array_map(fn ($r) => (string) ($r['message'] ?? ''), $results));
        $this->assertTrue(str_contains($messages, '40P01') || stripos($messages, 'deadlock') !== false,
            'الضابط السلبي لم يُنتج جموداً: الاختبار الإيجابي لن يكشف كاتباً يلمس tenants. '.$messages);
    }

    /** @return array<int, array<string, mixed>> */
    private function anchorRace(callable $writerTail): array
    {
        $tenant = $this->tenantId;
        $orderId = $this->order();

        $anchorHolder = function () use ($tenant, $orderId) {
            DB::transaction(function () use ($tenant, $orderId) {
                DB::select('SELECT 1 FROM tenants WHERE id = ? FOR UPDATE', [$tenant]);
                usleep(300_000);
                DB::select('SELECT 1 FROM commerce_orders WHERE id = ? FOR UPDATE', [$orderId]);
            });

            return ['done_at' => microtime(true)];
        };
        $writer = function () use ($tenant, $orderId, $writerTail) {
            $appendedAt = null;
            DB::transaction(function () use ($tenant, $orderId, $writerTail, &$appendedAt) {
                DB::select('SELECT 1 FROM commerce_orders WHERE id = ? FOR UPDATE', [$orderId]);
                usleep(600_000); // ممسك المِرساة صار ينتظر هذا الصف
                $writerTail($tenant, $orderId);
                $appendedAt = microtime(true);
            });

            return ['appended_at' => $appendedAt];
        };

        return $this->runConcurrently([$anchorHolder, $writer]);
    }

    // ───────────────────────── 5) المسارات الحقيقية متزامنة ─────────────────────────

    #[Test]
    public function real_cancel_and_collect_paths_race_an_anchor_holding_writer_without_deadlock_or_gaps(): void
    {
        $tenant = $this->tenantId;
        $actor = $this->actorId;
        $expected = 0;
        foreach (range(1, 4) as $round) {
            [$a, $b, $c] = [$this->order(), $this->order(), $this->order()];

            $cancel = function () use ($tenant, $a, $actor) {
                app(TenantContext::class)->set($tenant);
                app(CommerceOrderLifecycleService::class)->cancel(CommerceOrder::query()->findOrFail($a), User::query()->withoutGlobalScopes()->findOrFail($actor), 'customer_request', null);

                return 'cancelled';
            };
            $collect = function () use ($tenant, $b, $actor) {
                app(TenantContext::class)->set($tenant);
                $intent = CommercePaymentIntent::query()->where('commerce_order_id', $b)->firstOrFail();
                app(CommercePaymentIntentService::class)->markCollected($intent, null, User::query()->withoutGlobalScopes()->findOrFail($actor));

                return 'collected';
            };
            // مثل إتمام Checkout: مِرساة المستأجر (الترقيم) ثم الحدث آخراً.
            $placing = function () use ($tenant, $c) {
                DB::transaction(function () use ($tenant, $c) {
                    DB::select('SELECT 1 FROM tenants WHERE id = ? FOR UPDATE', [$tenant]);
                    usleep(100_000);
                    self::append($tenant, $c);
                });

                return 'appended';
            };
            $jobs = $round % 2 === 0 ? [$placing, $cancel, $collect] : [$cancel, $collect, $placing];
            $results = $this->runConcurrently($jobs);
            $this->assertNoDeadlock($results);
            $expected += 3;
            $this->assertSame(range(1, $expected), $this->seqs(), "الجولة {$round}");
        }
        $this->assertSame(4, DB::table('commerce_order_events')->where('tenant_id', $tenant)->where('type', 'order.cancelled')->count());
        $this->assertSame(4, DB::table('commerce_order_events')->where('tenant_id', $tenant)->where('type', 'payment.collected')->where('actor_type', 'user')->count());
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
