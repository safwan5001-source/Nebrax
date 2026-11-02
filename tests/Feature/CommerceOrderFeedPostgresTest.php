<?php

namespace Tests\Feature;

use App\Events\CommerceOrderPaymentCollected;
use App\Models\CommerceOrder;
use App\Models\CommercePaymentIntent;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\Commerce\CommerceOrderEventRecorder;
use App\Services\Commerce\CommerceOrderFeedReader;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  COPS-H1-2 (ADR-29 §2.4) — قارئ التغذية بالمؤشّر وأحداث النطاق بعد الالتزام، على PostgreSQL حقيقي
 * ═══════════════════════════════════════════════════════════════
 *  1) التزام متأخر: قارئ بالمؤشّر لا يرى حدثاً غير ملتزم ولا يرى seq متقدّماً على سابقه، وكل صفحة متصلة بلا فجوة، والترتيب بترتيب الالتزام.
 *  2) الاكتمال: كتّاب متوازون + مستطلِع يقرأ صفحات صغيرة بالمؤشّر ⇒ يجمع بالضبط 1..N بلا تكرار ولا فقد ولا فجوة في أي صفحة.
 *  3) أحداث النطاق: تُطلق بعد الالتزام الحقيقي (مستوى المعاملة 0، والصف مرئي)، لا تُطلق عند التراجع، والتراجع لا يترك فجوة في التسلسل.
 *
 *  على PostgreSQL **لا يُتخطّى** إن غاب `pcntl`: يفشل. يُتخطّى على SQLite فقط. بلا معاملة مُغلِّفة (الأطفال يحتاجون صفوفاً مثبَّتة).
 */
class CommerceOrderFeedPostgresTest extends TestCase
{
    use UsesWorkerDatabaseWithoutTransaction;

    private string $dir;

    private string $tenantId;

    private string $channelId;

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

        $this->dir = sys_get_temp_dir().'/commerce_feed_'.uniqid();
        mkdir($this->dir);

        $tenant = Tenant::create(['name' => 'قارئ التغذية', 'slug' => 'cops-feed-'.Str::random(8), 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        $this->tenants[] = $this->tenantId = $tenant->id;
        app(TenantContext::class)->set($this->tenantId);
        $this->channelId = SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true])->id;
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

    private function order(): string
    {
        app(TenantContext::class)->set($this->tenantId);
        $order = CommerceOrder::create(['sales_channel_id' => $this->channelId, 'number' => 'CORD-FD-'.Str::upper(Str::random(8)), 'delivery_method' => 'pickup', 'total' => 1000]);
        $order->update(['status' => CommerceOrder::STATUS_CONFIRMED, 'confirmed_at' => now()]);
        CommercePaymentIntent::create(['commerce_order_id' => $order->id, 'method' => CommercePaymentIntent::METHOD_PAY_ON_PICKUP,
            'status' => CommercePaymentIntent::STATUS_AWAITING_COLLECTION, 'amount_minor' => 1000, 'currency' => 'SAR']);

        return $order->id;
    }

    /** يكتب حدثاً بالكاتب الحقيقي (داخل معاملة يملكها المستدعي). */
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

    private function assertNoFailure(array $results): void
    {
        foreach ($results as $i => $result) {
            $this->assertTrue($result['ok'] ?? false, "العملية {$i}: ".($result['error_class'] ?? '').' '.($result['message'] ?? ''));
            $message = (string) ($result['message'] ?? '');
            $this->assertFalse(str_contains($message, '40P01') || stripos($message, 'deadlock') !== false, "جمود في العملية {$i}");
        }
    }

    /**
     * يقرأ صفحة بالمؤشّر ويتحقق من اتصالها: seq الصفحة = after+1، after+2، … بلا فجوة. يعيد [الصفحة, next, أخطاء].
     *
     * @return array{0: list<int>, 1: int, 2: list<string>}
     */
    private static function readPage(string $tenantId, int $after, int $limit): array
    {
        app(TenantContext::class)->set($tenantId);
        $page = app(CommerceOrderFeedReader::class)->page($after, $limit);
        $seqs = $page['events']->pluck('feed_seq')->map(fn ($s) => (int) $s)->all();
        $violations = [];
        if ($seqs !== [] && $seqs !== range($after + 1, $after + count($seqs))) {
            $violations[] = 'صفحة غير متصلة بعد '.$after.': '.json_encode($seqs);
        }

        return [$seqs, $page['next_after_seq'], $violations];
    }

    // ───────────────────────── 1) التزام متأخر ─────────────────────────

    #[Test]
    public function the_cursor_reader_never_sees_an_uncommitted_event_and_the_late_commit_lands_in_commit_order_without_a_gap(): void
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
            $cursor = 0;
            $observed = [];
            $violations = [];
            $deadline = microtime(true) + 2.6;
            while (microtime(true) < $deadline) {
                [$seqs, $cursor, $v] = self::readPage($tenant, $cursor, 100);
                $violations = array_merge($violations, $v);
                foreach ($seqs as $s) {
                    $observed[] = ['seq' => $s, 'at' => microtime(true)];
                }
                usleep(20_000);
            }

            return ['observed' => $observed, 'violations' => $violations];
        };

        $results = $this->runConcurrently([$slow, $fast, $poller]);
        $this->assertNoFailure($results);
        [$slowR, $fastR, $pollR] = array_column($results, 'value');

        $this->assertSame([], $pollR['violations']);
        $this->assertSame([1, 2], array_column($pollR['observed'], 'seq'), 'كل حدث مرة واحدة بالترتيب');
        $this->assertGreaterThanOrEqual($slowR['committed_at'], $pollR['observed'][0]['at'], 'لا يُرى حدث قبل التزامه');
        $this->assertGreaterThan(1.0, $fastR['committed_at'] - $fastR['started_at'], 'الكاتب اللاحق انتظر الرأس حتى التزام السابق');
        $this->assertSame([1, 2], $this->seqs());
    }

    // ───────────────────────── 2) الاكتمال تحت كتّاب متوازين ─────────────────────────

    #[Test]
    public function a_paging_reader_collects_exactly_every_event_of_concurrent_writers_without_gap_or_duplicate(): void
    {
        $tenant = $this->tenantId;
        $writers = 8;
        $perWriter = 6;
        $orders = [];
        for ($i = 0; $i < $writers; $i++) {
            $orders[] = $this->order();
        }

        $jobs = [];
        foreach ($orders as $i => $orderId) {
            $jobs[] = function () use ($tenant, $orderId, $perWriter, $i) {
                mt_srand(500 + $i);
                for ($j = 0; $j < $perWriter; $j++) {
                    usleep(mt_rand(0, 40_000));
                    DB::transaction(function () use ($tenant, $orderId) {
                        CommerceOrder::query()->whereKey($orderId)->lockForUpdate()->first();
                        self::append($tenant, $orderId);
                    });
                }

                return ['wrote' => $perWriter];
            };
        }
        $expected = $writers * $perWriter;
        $jobs[] = function () use ($tenant, $expected) {
            $cursor = 0;
            $collected = [];
            $violations = [];
            $pages = 0;
            $deadline = microtime(true) + 12.0;
            while (count($collected) < $expected && microtime(true) < $deadline) {
                [$seqs, $cursor, $v] = self::readPage($tenant, $cursor, 7); // صفحات صغيرة ⇒ ترقيم متعدد
                $pages++;
                $violations = array_merge($violations, $v);
                $collected = array_merge($collected, $seqs);
                if ($seqs === []) {
                    usleep(10_000);
                }
            }

            return ['collected' => $collected, 'violations' => $violations, 'pages' => $pages];
        };

        $results = $this->runConcurrently($jobs);
        $this->assertNoFailure($results);
        $poll = $results[count($results) - 1]['value'];

        $this->assertSame([], $poll['violations'], 'كل صفحة متصلة بلا فجوة');
        $this->assertSame(range(1, $expected), $poll['collected'], 'المستطلِع جمع 1..N بلا تكرار ولا فقد وبالترتيب');
        $this->assertGreaterThan(1, $poll['pages']);
        $this->assertSame(range(1, $expected), $this->seqs());
    }

    // ───────────────────────── 3) أحداث النطاق بعد الالتزام الحقيقي ─────────────────────────

    #[Test]
    public function domain_events_fire_after_a_real_commit_never_on_rollback_and_a_rollback_leaves_no_sequence_gap(): void
    {
        $tenant = $this->tenantId;
        $orderId = $this->order();

        $job = function () use ($tenant, $orderId) {
            $fired = [];
            Event::listen(CommerceOrderPaymentCollected::class, function (CommerceOrderPaymentCollected $e) use (&$fired): void {
                $fired[] = [
                    'level' => DB::transactionLevel(),
                    'visible' => DB::table('commerce_order_events')->where('id', $e->eventId)->exists(),
                    'tenant' => $e->tenantId,
                    'order' => $e->orderId,
                ];
            });

            // أ) معاملة تتراجع بعد نجاح الكتابة: لا إطلاق ولا فجوة.
            try {
                DB::transaction(function () use ($tenant, $orderId) {
                    self::append($tenant, $orderId);
                    throw new RuntimeException('رجوع');
                });
            } catch (RuntimeException) {
            }
            $afterRollback = count($fired);

            // ب) معاملة تلتزم: إطلاق واحد بعد الالتزام.
            DB::transaction(fn () => self::append($tenant, $orderId));

            return ['after_rollback' => $afterRollback, 'fired' => $fired];
        };

        $results = $this->runConcurrently([$job]);
        $this->assertNoFailure($results);
        $r = $results[0]['value'];

        $this->assertSame(0, $r['after_rollback'], 'لا إطلاق عند التراجع');
        $this->assertCount(1, $r['fired']);
        $this->assertSame(0, $r['fired'][0]['level'], 'المستمع يعمل بعد الالتزام الفعلي (لا معاملة مفتوحة)');
        $this->assertTrue($r['fired'][0]['visible'], 'الصف ملتزم ومرئي عند الإطلاق');
        $this->assertSame([$tenant, $orderId], [$r['fired'][0]['tenant'], $r['fired'][0]['order']]);
        $this->assertSame([1], $this->seqs(), 'التراجع لم يستهلك رقماً');
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
