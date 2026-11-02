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
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  COPS-H1-1 (ADR-29 §2.4، بوابات R-2) — تغذية أحداث الطلب على PostgreSQL حقيقي
 * ═══════════════════════════════════════════════════════════════
 *  1) التزام متأخر: كاتب لاحق ينتظر الرأس حتى يلتزم السابق، والتسلسل بترتيب الالتزام، ومستطلِع متزامن لا يرى فجوة أبداً.
 *  2) التراجع: لا فجوة لكاتب متزامن ولا لاحق.
 *  3) الأداء (D-H1-1-P = P-A، وتصحيح القياس D-H1-1-PERF-B): بوابة حمل واقعي (20 كاتباً × 10، تفكير 0–200ms ⇒ ≈130 حدثاً/ث/مستأجر كمتوسط للجولة)
 *     = جولة إحماء مُعلَنة مسجَّلة ومستبعدة + 3 جولات محتسبة، كلٌّ: p95 إضافي < 50ms (لم يتغيّر)، إنتاجية **نافذة النشاط** (كل الكتّاب نشطون) ≥ 90/ث
 *     ومعدل الجولة الكلي ≤ 170/ث، اكتمال. كل المقاييس (بما فيها إجمالي الجولة وبدء العمليات وCPU والتباين) تُسجَّل **قبل** أي تأكيد.
 *     + تشخيص اندفاع مشبَع يُسجَّل دائماً (اكتمال مفروض، كمون حدّ تشغيلي موثَّق لا شرط).
 *  4) لا جمود: الكاتب لا يلمس `tenants`، فممسك مِرساة المستأجر (`FOR UPDATE`) المنتظر لصف يمسكه الكاتب لا يكوّن حلقة — مع ضابط سلبي
 *     يُثبت أن قفلاً على `tenants` في الموضع نفسه كان سيُنتج 40P01 (حساسية الاختبار).
 *  5) المسارات الحقيقية (إلغاء الموظف ‖ تحصيل الاستلام ‖ ممسك مِرساة يكتب حدثاً آخراً) بلا جمود وبتسلسل متصل.
 *
 *  **عزل القياس (COPS-H1-1 CI Performance Isolation Recovery، الخيار B):** اختبارا الأداء (المجموعة `cops-h1-1-perf`) يقيسان كموناً مقابل مؤقّت جداري،
 *  فيتشوّه القياس حين يشاركان الجهاز مع عمّال ParaTest الأربعة (رُصد p95 إضافي 55–102ms بدل 18–26ms بلا أي تغيير في الكود). لذلك يتخطّيان نفسيهما
 *  داخل عامل متوازٍ (`LARAVEL_PARALLEL_TESTING`) ويعملان في وظيفة CI مخصصة (`pg-perf`) على مشغّل خاص (`vendor/bin/phpunit --group cops-h1-1-perf`)
 *  تفشل إن لم تُنتج المقاييس. حدّ 50ms وحمل العمل (20 كاتباً، تفكير 0–200ms) وكل اختبارات الصحة/الجمود/الاكتمال بلا أي تغيير ولا تخفيف.
 *
 *  على PostgreSQL **لا يُتخطّى** إن غاب `pcntl`: يفشل. يُتخطّى على SQLite فقط. بلا معاملة مُغلِّفة (الأطفال يحتاجون صفوفاً مثبَّتة).
 */
class CommerceOrderEventsPostgresTest extends TestCase
{
    use UsesWorkerDatabaseWithoutTransaction;

    /** حدّ R-2 المعتمد (P-A): الزيادة في p95 لانتظار الرأس تحت الحمل الواقعي المعتمد. */
    private const P95_BUDGET_MS = 50.0;

    /** نموذج الحمل الواقعي المعتمد (D-H1-1-P): مهلة تفكير منتظمة 0–200ms لكل كاتب ⇒ ≈130 حدثاً/ث/مستأجر (متوسط الجولة الكلي) بـ20 كاتباً. */
    private const REALISTIC_THINK_MAX_MS = 200;

    /**
     * نطاق التحقق من نموذج الحمل (≈130 ± 30%): خارجَه لا يُعتدّ بالقياس. الحدّ الأدنى يُطبَّق على إنتاجية **نافذة النشاط** (كل الكتّاب نشطون؛
     * لا يُقبل نجاح بحمل أخف من المعتمد)، والأعلى على معدل **الجولة الكلي** (لا يُقبل قياس بحمل أثقل من المعتمد). إنتاجية نافذة النشاط تقيس ≈165–185/ث لأن
     * 20 كاتباً بتفكير متوسطه 100ms يولّدون ≈175/ث حين يكونون كلهم نشطين؛ والمتوسط الكلي للجولة (≈110–130) أدنى لأن ذيل الجولة يتناقص فيه الكتّاب النشطون.
     */
    private const REALISTIC_RATE_MIN = 90.0;

    private const REALISTIC_RATE_MAX = 170.0;

    /** المعدل المعروض المعتمد (D-H1-1-P): يُسجَّل بجانب المعدل المحقق فعلاً كي لا يُنسب للقياس حمل لم يُولَّد. */
    private const OFFERED_RATE_TARGET = 130.0;

    /** مجموعة قياسات الأداء: تعمل في الخطوة التسلسلية المعزولة في CI، وتتخطّى نفسها داخل العمّال المتوازين. */
    public const PERF_GROUP = 'cops-h1-1-perf';

    private float $perfStartedAt = 0.0;

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

    // ───────────────────────── 3) الأداء: بوابة الحمل الواقعي + تشخيص الاندفاع المشبَع ─────────────────────────

    /**
     * بوابة R-2 المعتمدة (قرار المالك D-H1-1-P = P-A، وتصحيح القياس D-H1-1-PERF-B): 20 كاتباً متزامناً لمستأجر واحد، كلٌّ 10 معاملات تفصلها مهلة
     * تفكير منتظمة 0–200ms ببذرة ثابتة (الحمل المعتمد لم يتغيّر). جولة إحماء واحدة **مُعلَنة** تُسجَّل ولا تُحتسب (أول تفرّع بعد الهجرة أبطأ بسبب البداية
     * الباردة)، ثم ثلاث جولات محتسبة، وكلٌّ يجب أن (أ) يُبقي إنتاجية **نافذة النشاط** (حين كل الكتّاب نشطون) ≥ 90 حدثاً/ث — أي لا يُقبل نجاح بحمل أخف
     * من المعتمد — وألا يتجاوز معدل الجولة الكلي 170/ث، (ب) يُكمل التسلسل بلا فجوة ولا تكرار ولا جمود، (ج) يبقي p95 انتظار الرأس الإضافي
     * (p95 المتنافس − p50 خط الأساس) دون **50ms** (لم يتغيّر). كل المقاييس تُسجَّل **قبل** أي تأكيد كي لا يضيع دليل عند الفشل.
     */
    #[Test]
    #[Group(self::PERF_GROUP)]
    public function the_realistic_load_gate_keeps_the_added_p95_feed_lock_wait_under_budget_at_about_130_events_per_second(): void
    {
        $this->isolateFromParallelWorkers();
        $baselineP50 = $this->baselineP50();

        $warmup = $this->measureWriters(writers: 20, perWriter: 10, thinkMaxMs: self::REALISTIC_THINK_MAX_MS, seed: 0);
        $warmup['round'] = 0;
        $warmup['excluded_from_evaluation'] = true;
        $warmup['added_p95_ms'] = round($warmup['contended_p95_ms'] - $baselineP50, 3);

        $rounds = [];
        foreach ([1, 2, 3] as $round) {
            $m = $this->measureWriters(writers: 20, perWriter: 10, thinkMaxMs: self::REALISTIC_THINK_MAX_MS, seed: 1000 * $round);
            $m['round'] = $round;
            $m['added_p95_ms'] = round($m['contended_p95_ms'] - $baselineP50, 3);
            $m['achieved_vs_offered_target_pct'] = round(100 * $m['active_window_events_per_second'] / self::OFFERED_RATE_TARGET, 1);
            $m['checks'] = [
                'active_window_rate_not_lighter_than_approved' => $m['active_window_events_per_second'] >= self::REALISTIC_RATE_MIN,
                'total_round_rate_not_heavier_than_approved' => $m['events_per_second'] <= self::REALISTIC_RATE_MAX,
                'added_p95_under_budget' => $m['added_p95_ms'] < self::P95_BUDGET_MS,
            ];
            $rounds[] = $m;
        }

        // أولاً: التسجيل الكامل (بما فيه الإحماء) — لا يسبقه أي تأكيد.
        $this->recordMetrics('realistic_load_gate', [
            'baseline_p50_ms' => $baselineP50,
            'disclosure' => 'الجولة 0 إحماء مُعلَن: الحمل نفسه، مسجَّلة ومستبعدة من التقييم (excluded_from_evaluation). الجولات 1–3 محتسبة. حدّ p95 الإضافي 50ms لم يتغيّر.',
            'warmup' => $warmup,
            'rounds' => $rounds,
            'variance' => [
                'added_p95_ms' => self::stats(array_column($rounds, 'added_p95_ms')),
                'active_window_events_per_second' => self::stats(array_column($rounds, 'active_window_events_per_second')),
                'total_round_events_per_second' => self::stats(array_column($rounds, 'events_per_second')),
                'contended_p50_ms' => self::stats(array_column($rounds, 'contended_p50_ms')),
                'contended_p95_ms' => self::stats(array_column($rounds, 'contended_p95_ms')),
            ],
        ]);

        // ثانياً: النزاهة (اكتمال/لا جمود) لكل جولة بما فيها الإحماء — صحة لا أداء.
        foreach ([$warmup, ...$rounds] as $m) {
            $this->assertRoundIntegrity($m);
        }
        // ثالثاً: معايير الأداء المعتمدة على الجولات المحتسبة وحدها.
        foreach ($rounds as $m) {
            $this->assertTrue($m['checks']['active_window_rate_not_lighter_than_approved'], 'نموذج الحمل: إنتاجية نافذة النشاط أدنى من المعتمد (لا يُقبل نجاح بحمل أخف) '.json_encode($m));
            $this->assertTrue($m['checks']['total_round_rate_not_heavier_than_approved'], 'نموذج الحمل: معدل الجولة أعلى من المعتمد '.json_encode($m));
            $this->assertTrue($m['checks']['added_p95_under_budget'], "R-2 (P-A): الجولة {$m['round']} تجاوزت p95 الإضافي المعتمد — تصعيد للمالك. ".json_encode($m));
        }
    }

    /**
     * تشخيص لا بوابة (D-H1-1-P §3): اندفاع مشبَع — 20 كاتباً × 10 معاملات متتالية بلا فاصل. يُسجَّل دائماً (الإنتاجية، p50/p95/p99/max)
     * ولا يُخفى؛ الصحة (اكتمال بلا فجوة ولا تكرار، لا جمود) **مفروضة** هنا أيضاً، أما الكمون تحت التشبّع فحدّ تشغيلي موثَّق لا شرط قبول.
     */
    #[Test]
    #[Group(self::PERF_GROUP)]
    public function the_saturated_burst_diagnostic_stays_complete_and_records_its_capacity_and_latency(): void
    {
        $this->isolateFromParallelWorkers();
        $baselineP50 = $this->baselineP50();
        $m = $this->measureWriters(writers: 20, perWriter: 10, thinkMaxMs: 0, seed: 7);
        $m['added_p95_ms'] = round($m['contended_p95_ms'] - $baselineP50, 3);
        $this->recordMetrics('saturated_burst_diagnostic', ['baseline_p50_ms' => $baselineP50, 'burst' => $m]);
        $this->assertRoundIntegrity($m);
        $this->assertGreaterThan(0, $m['events_per_second']);
    }

    /**
     * قياس الكمون مقابل مؤقّت جداري لا يصحّ على جهاز يشاركه أربعة عمّال اختبار متوازية (تنافس المعالج يؤخّر مُمسك القفل فيطول انتظار كل من خلفه
     * — ضجيج بيئة لا خاصية في الكاتب). داخل عامل ParaTest نتخطّى بسبب صريح؛ وظيفة CI المخصصة (`pg-perf`) تشغّل المجموعة وحدها على مشغّل خاص
     * وتفشل إن لم تُنتج مقاييس.
     */
    private function isolateFromParallelWorkers(): void
    {
        if (! empty($_SERVER['LARAVEL_PARALLEL_TESTING']) || ! empty(getenv('LARAVEL_PARALLEL_TESTING'))) {
            $this->markTestSkipped('قياس الأداء يعمل في وظيفة CI مخصصة (pg-perf) على مشغّل خاص: vendor/bin/phpunit --group '.self::PERF_GROUP.' (لا داخل عمّال متوازين).');
        }
        $this->perfStartedAt = microtime(true);
    }

    /** @return array{busy:int,idle:int,iowait:int,steal:int,total:int}|null لقطة عدّادات المعالج التراكمية من /proc/stat (لينكس)؛ null إن تعذّرت. */
    private static function cpuSnapshot(): ?array
    {
        $line = @file('/proc/stat', FILE_IGNORE_NEW_LINES)[0] ?? null;
        if ($line === null || ! str_starts_with($line, 'cpu ')) {
            return null;
        }
        $f = array_map('intval', preg_split('/\s+/', trim(substr($line, 4))) ?: []);
        $f += array_fill(0, 8, 0);
        // user nice system idle iowait irq softirq steal
        $idle = $f[3] + $f[4];
        $total = array_sum(array_slice($f, 0, 8));

        return ['busy' => $total - $idle, 'idle' => $f[3], 'iowait' => $f[4], 'steal' => $f[7], 'total' => $total];
    }

    /**
     * نسب المعالج خلال نافذة القياس (فرق لقطتين). تعكس تنافس الجهاز كله لا العملية: busy مرتفع مع أنوية محدودة = المقيس يتنافس على المعالج.
     *
     * @return array<string, float|int|null>
     */
    private static function cpuWindow(?array $a, ?array $b, float $loadBefore): array
    {
        $cores = max(1, (int) trim((string) @shell_exec('nproc 2>/dev/null')));
        if ($a === null || $b === null || ($b['total'] - $a['total']) <= 0) {
            return ['cores' => $cores, 'loadavg_1m_before' => round($loadBefore, 2), 'cpu_busy_pct' => null, 'cpu_iowait_pct' => null, 'cpu_steal_pct' => null];
        }
        $d = $b['total'] - $a['total'];
        $pct = fn (int $x): float => round(100 * $x / $d, 1);

        return ['cores' => $cores, 'loadavg_1m_before' => round($loadBefore, 2),
            'cpu_busy_pct' => $pct($b['busy'] - $a['busy']), 'cpu_iowait_pct' => $pct($b['iowait'] - $a['iowait']), 'cpu_steal_pct' => $pct($b['steal'] - $a['steal'])];
    }

    /**
     * إحصاءات تباين لقيم الجولات المحتسبة (عينة): الأدنى والأقصى والمتوسط والانحراف المعياري للعيّنة.
     *
     * @param  list<float|int>  $values
     * @return array{min: float, max: float, mean: float, stdev: float}
     */
    private static function stats(array $values): array
    {
        $n = count($values);
        $mean = $n ? array_sum($values) / $n : 0.0;
        $var = $n > 1 ? array_sum(array_map(fn ($v) => ($v - $mean) ** 2, $values)) / ($n - 1) : 0.0;

        return ['min' => round((float) min($values), 3), 'max' => round((float) max($values), 3), 'mean' => round($mean, 3), 'stdev' => round(sqrt($var), 3)];
    }

    /**
     * لقطة نشاط الخلفية في PostgreSQL (تسجيل تشخيصي فقط — لا يدخل أي معيار): نقاط التفتيش (زمنية/مطلوبة)، عدد دورات autovacuum/autoanalyze التراكمي،
     * عدد عمّال autovacuum النشطين الآن، ومزامنات WAL. تفشل بصمت (null) إن غابت الصلاحية/الإصدار ولا تمسّ القياس. تُؤخذ خارج القسم المقيس.
     *
     * @return array<string, int>|null
     */
    private static function pgActivity(): ?array
    {
        try {
            $out = [];
            $out['autovacuum_workers_now'] = (int) DB::selectOne("select count(*) c from pg_stat_activity where backend_type = 'autovacuum worker'")->c;
            $out['autovac_autoanalyze_cycles'] = (int) DB::selectOne('select coalesce(sum(autovacuum_count + autoanalyze_count), 0) c from pg_stat_all_tables')->c;
            try {
                $bg = DB::selectOne('select checkpoints_timed t, checkpoints_req r, buffers_backend_fsync f from pg_stat_bgwriter');
                $out += ['checkpoints_timed' => (int) $bg->t, 'checkpoints_req' => (int) $bg->r, 'backend_fsyncs' => (int) $bg->f];
            } catch (\Throwable) {
                $cp = DB::selectOne('select num_timed t, num_requested r from pg_stat_checkpointer'); // PostgreSQL 17+
                $out += ['checkpoints_timed' => (int) $cp->t, 'checkpoints_req' => (int) $cp->r];
            }
            $out['wal_syncs'] = (int) DB::selectOne('select wal_sync c from pg_stat_wal')->c;

            return $out;
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * فرق لقطتَي نشاط الخلفية خلال الجولة. إحصاءات PostgreSQL تُدفع بتأخر قصير فهذه أدلة تقريبية لا حسابات دقيقة.
     *
     * @param  array<string, int>|null  $a
     * @param  array<string, int>|null  $b
     * @return array<string, int>|null
     */
    private static function pgActivityDelta(?array $a, ?array $b): ?array
    {
        if ($a === null || $b === null) {
            return null;
        }
        $d = [];
        foreach ($b as $k => $v) {
            $d[$k] = $k === 'autovacuum_workers_now' ? $v : $v - ($a[$k] ?? 0);
        }

        return $d;
    }

    /**
     * شكل أي توقف: كل انتظار فوق ميزانية p95 مع زمن وقوعه نسبةً لبدء الجولة (حتى 40). توقف واحد طويل يظهر كعناقيد متتالية متقاربة الزمن
     * (ممسك الرأس تعطّل ⇒ كل من خلفه تأخر)، وضجيج موزَّع يظهر متفرقاً. للتشخيص فقط.
     *
     * @param  list<array<string, mixed>>  $values
     * @return list<array{t_s: float, wait_ms: float}>
     */
    private static function slowWaits(array $values, float $started): array
    {
        $rows = [];
        foreach ($values as $v) {
            foreach ($v['timed'] ?? [] as [$at, $wait]) {
                if ($wait >= self::P95_BUDGET_MS) {
                    $rows[] = ['t_s' => round($at - $started, 3), 'wait_ms' => round($wait, 1)];
                }
            }
        }
        usort($rows, fn (array $x, array $y) => $x['t_s'] <=> $y['t_s']);

        return array_slice($rows, 0, 40);
    }

    /** p50 زمن الكتابة بلا تنافس: كاتب واحد متسلسل، 30 معاملة (قفل صف الطلب ثم الحدث آخراً). */
    private function baselineP50(): float
    {
        $tenant = $this->tenantId;
        $orderId = $this->order();
        $samples = [];
        for ($i = 0; $i < 30; $i++) {
            DB::transaction(function () use ($tenant, $orderId, &$samples) {
                CommerceOrder::query()->whereKey($orderId)->lockForUpdate()->first();
                $t0 = hrtime(true);
                self::append($tenant, $orderId);
                $samples[] = (hrtime(true) - $t0) / 1e6;
            });
        }
        sort($samples);

        return round($samples[(int) floor(0.5 * (count($samples) - 1))], 3);
    }

    /**
     * يشغّل كتّاباً متزامنين (عملية لكل كاتب، حاجز بدء واحد)، كلٌّ يقفل صف طلبه ثم يكتب الحدث آخراً ثم يلتزم، مع مهلة تفكير منتظمة
     * [0, thinkMaxMs] ببذرة حتمية لكل كاتب. **لا يؤكّد شيئاً** (كي يُسجَّل القياس قبل أي تأكيد): يعيد المقاييس وكتلة `integrity` تفحصها
     * `assertRoundIntegrity` بعد التسجيل. المعدلات:
     *  - `events_per_second`: كل أحداث الجولة ÷ زمن الجولة الكلي بما فيه تفرّع العمليات وبدء الاتصال (مسجَّل منفصلاً).
     *  - `active_window_events_per_second`: الأحداث المكتملة داخل نافذة **كل الكتّاب نشطون** (من أحدث بدء حلقة إلى أبكر انتهاء) ÷ طول تلك النافذة.
     *  - `span_events_per_second`: كل الأحداث ÷ (أبكر بدء حلقة → أحدث انتهاء)؛ والفرق عن زمن الجولة الكلي = `startup_overhead_s`.
     *
     * @return array<string, mixed>
     */
    private function measureWriters(int $writers, int $perWriter, int $thinkMaxMs, int $seed): array
    {
        $tenant = $this->tenantId;
        $orders = [];
        for ($i = 0; $i < $writers; $i++) {
            $orders[] = $this->order();
        }
        $before = $this->feedHead();

        $jobs = [];
        foreach ($orders as $i => $orderId) {
            $jobs[] = function () use ($tenant, $orderId, $perWriter, $thinkMaxMs, $seed, $i) {
                mt_srand($seed + $i);
                $waits = [];
                $ends = [];
                $slow = [];
                $loopStart = microtime(true);
                for ($j = 0; $j < $perWriter; $j++) {
                    if ($thinkMaxMs > 0) {
                        usleep(mt_rand(0, $thinkMaxMs * 1000));
                    }
                    DB::transaction(function () use ($tenant, $orderId, &$waits) {
                        CommerceOrder::query()->whereKey($orderId)->lockForUpdate()->first();
                        $t0 = hrtime(true);
                        self::append($tenant, $orderId);
                        $waits[] = (hrtime(true) - $t0) / 1e6;
                    });
                    $ends[] = microtime(true);
                    $slow[] = [end($ends), end($waits)];
                }

                return ['waits' => $waits, 'ends' => $ends, 'start' => $loopStart, 'end' => microtime(true), 'timed' => $slow];
            };
        }
        $loadBefore = (sys_getloadavg() ?: [0.0])[0];
        $cpuBefore = self::cpuSnapshot();
        $pgBefore = self::pgActivity();
        $started = microtime(true);
        $results = $this->runConcurrently($jobs);
        $elapsed = microtime(true) - $started;
        $cpu = self::cpuWindow($cpuBefore, self::cpuSnapshot(), $loadBefore);
        $pgDelta = self::pgActivityDelta($pgBefore, self::pgActivity());

        // النزاهة: تُحسب هنا وتُؤكَّد لاحقاً (بعد التسجيل). نفس الفحوص السابقة حرفياً.
        $errors = [];
        foreach ($results as $i => $result) {
            if (! ($result['ok'] ?? false)) {
                $errors[] = "العملية {$i}: ".($result['error_class'] ?? '').' '.($result['message'] ?? '');
            } elseif (($result['message'] ?? '') !== '' && (str_contains((string) $result['message'], '40P01') || stripos((string) $result['message'], 'deadlock') !== false)) {
                $errors[] = "جمود في العملية {$i}";
            }
        }
        $total = $writers * $perWriter;
        $sequenceComplete = $this->seqs() === range(1, $before + $total);
        $perWriterComplete = true;
        foreach ($orders as $orderId) {
            if (DB::table('commerce_order_events')->where('commerce_order_id', $orderId)->count() !== $perWriter) {
                $perWriterComplete = false;
            }
        }

        $values = array_values(array_map(fn ($r) => $r['value'], array_filter($results, fn ($r) => ($r['ok'] ?? false) && isset($r['value']['waits']))));
        $waits = $values ? array_merge(...array_column($values, 'waits')) : [];
        sort($waits);
        $pct = fn (float $p): float => $waits ? round($waits[(int) floor(($p / 100) * (count($waits) - 1))], 3) : 0.0;

        $winStart = $values ? max(array_column($values, 'start')) : 0.0;
        $winEnd = $values ? min(array_column($values, 'end')) : 0.0;
        $spanStart = $values ? min(array_column($values, 'start')) : 0.0;
        $spanEnd = $values ? max(array_column($values, 'end')) : 0.0;
        $inWindow = 0;
        foreach ($values as $v) {
            foreach ($v['ends'] as $t) {
                if ($t >= $winStart && $t <= $winEnd) {
                    $inWindow++;
                }
            }
        }
        $winLen = max($winEnd - $winStart, 1e-9);
        $spanLen = max($spanEnd - $spanStart, 1e-9);

        return [
            'writers' => $writers, 'transactions' => count($waits), 'think_max_ms' => $thinkMaxMs,
            'elapsed_s' => round($elapsed, 3), 'events_per_second' => round(count($waits) / $elapsed, 1),
            'active_window_s' => round($winLen, 3), 'active_window_events' => $inWindow, 'active_window_events_per_second' => round($inWindow / $winLen, 1),
            'span_events_per_second' => round(count($waits) / $spanLen, 1), 'startup_overhead_s' => round($elapsed - $spanLen, 3),
            'contended_p50_ms' => $pct(50), 'contended_p95_ms' => $pct(95), 'contended_p99_ms' => $pct(99), 'contended_max_ms' => $waits ? round(max($waits), 3) : 0.0,
            ...$cpu,
            'pg_background' => $pgDelta,
            'slow_waits' => self::slowWaits($values, $started),
            'integrity' => ['errors' => $errors, 'sequence_complete' => $sequenceComplete, 'per_writer_complete' => $perWriterComplete],
        ];
    }

    /** النزاهة المؤجَّلة إلى ما بعد التسجيل: لا أخطاء/جمود في الكتّاب، تسلسل متصل بلا فجوة ولا تكرار، وعدد أحداث كل كاتب. */
    private function assertRoundIntegrity(array $m): void
    {
        $this->assertSame([], $m['integrity']['errors'], 'أخطاء/جمود في الكتّاب المتزامنين');
        $this->assertTrue($m['integrity']['sequence_complete'], 'كل الأحداث موجودة بلا فجوة ولا تكرار');
        $this->assertTrue($m['integrity']['per_writer_complete'], 'عدد أحداث كل كاتب كما كُتب');
    }

    /** يُسجّل المقاييس دائماً: STDERR، وملفاً في `pgsql-watchdog/` حين يوجد (يرفعه CI كمرفق) — لا تُخفى نتيجة. */
    private function recordMetrics(string $name, array $metrics): void
    {
        $payload = ['slice' => 'COPS-H1-1', 'name' => $name,
            'pg' => DB::selectOne("select current_setting('synchronous_commit') as synchronous_commit, current_setting('fsync') as fsync"),
            'offered_rate_target_per_s' => self::OFFERED_RATE_TARGET, 'p95_budget_ms' => self::P95_BUDGET_MS,
            'test_duration_s' => round(microtime(true) - $this->perfStartedAt, 3), ...$metrics];
        $json = json_encode($payload, JSON_UNESCAPED_UNICODE);
        fwrite(STDERR, "\nCOPS-H1-1 feed metrics: {$json}\n");
        $dir = base_path('pgsql-watchdog');
        if (is_dir($dir)) {
            file_put_contents("{$dir}/cops-h1-1-{$name}.json", $json.PHP_EOL);
        }
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
