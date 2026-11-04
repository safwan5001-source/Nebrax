<?php

namespace Tests\Feature;

use App\Models\CommerceOrder;
use App\Models\CommercePaymentIntent;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Commerce\CommerceOrderEventRecorder;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  COPS-H1-1 — تشخيص موضع التوقف الذي يرفع p95 (Issue #1975، المرحلة 1)
 * ═══════════════════════════════════════════════════════════════
 *  **تشخيص فقط. لا يحكم ولا يؤكّد 50ms ولا يستبدل بوابة `CommerceOrderEventsPostgresTest`** (تبقى كما هي، ومعها وظيفة CI `pg-perf`).
 *  يعمل في مجموعته الخاصة `cops-h1-1-diag` فلا تلتقطه `--group cops-h1-1-perf`، ويتخطّى نفسه داخل عمّال ParaTest وعلى SQLite كالبوابة.
 *
 *  **الحمل مطابق للبوابة حرفياً:** 20 كاتباً × 10 معاملات، تفكير منتظم 0–200ms، البذور `1000 × رقم الجولة`، كل معاملة = قفل صف الطلب ثم
 *  `CommerceOrderEventRecorder::append()` آخراً ثم الالتزام. الفاصل الذي تقيسه البوابة (`t0 → ما بعد append`) هنا هو نفسه تماماً ويُسجَّل `wait_ms`؛
 *  القياسات الإضافية تقع **خارجه** (قبله أو بعده) فلا تغيّر ما تقيسه البوابة.
 *
 *  ما يضيفه (يفصل ما تدمجه البوابة في رقم واحد):
 *   • `wait_ms` — انتظار القفل + الإدراج (كالبوابة).
 *   • `gap_ms` — من عودة `append()` حتى بدء COMMIT: القفل ممسوك ولا شيء يُنفَّذ في PostgreSQL (الكاتب PHP نفسه). توقف هنا = العميل لا الخادم.
 *   • `commit_ms` — `DB::commit()` كاملاً (COMMIT + مزامنة WAL + مستمعو `afterCommit` داخل العملية). توقف هنا = الالتزام (غالباً fsync).
 *   • `rq_wait_ms`/`rq_gap_ms`/`rq_commit_ms` — زمن انتظار طابور التشغيل (`/proc/self/schedstat`، الحقل الثالث) للعملية نفسها في نافذة `append()`
 *     ونافذة الفجوة (بين قراءتين تحدّان `gap_ms` عملياً؛ `gap_ms` متصل بـ`wait_ms` ويضم القراءتين) ونافذة COMMIT وما بعده: يميّز «جاهزة ولم تحصل على معالج»
 *     عن «نائمة بانتظار قرص/قفل». قراءتا schedstat داخل الفجوة (≈25µs لكل قراءة) إضافة وحيدة تحت القفل خارج فاصل البوابة.
 *   • `end` — وقت الإكمال الفعلي لكل معاملة (wall clock)؛ يبني المحلّل الخط الزمني منه لا من جمع المكوّنات.
 *   • لكل كاتب: `ru_nivcsw` (تبديلات سياق قسرية) و`ru_nvcsw` و`utime/stime`.
 *   • لكل جولة: فرق `pg_stat_wal` (وقت مزامنة WAL)، وضغط المعالج/القرص على مستوى المشغّل (`/proc/pressure/{cpu,io}`).
 *   • جولات «مُعاينة» (sampled) فقط: عملية رصد تستعلم `pg_stat_activity` + `pg_blocking_pids()` كل ≈5ms وتسجّل **حالة الماسك الجذري** وقت الاصطفاف
 *     (`idle in transaction` ⇒ العميل، `active|IO:WALSync` ⇒ fsync، `active|-` ⇒ معالج الخادم…). الرصد نفسه يُنشئ حملاً (`pg_blocking_pids` تأخذ
 *     أقفال مدير الأقفال لحظياً) فلا تُخلَط جولاته بجولات «البوابة المكافئة» (gate_equiv) التي تبقى بلا رصد ولا إعدادات إضافية.
 *
 *  المخرجات: `pgsql-watchdog/cops-h1-1-diag.json` (كل المعاملات والجولات) + سطر ملخّص على STDERR. يحلّلها `scripts/ci-perf-diag/analyze.py`.
 */
class CommerceOrderEventsStallDiagnosticTest extends TestCase
{
    use UsesWorkerDatabaseWithoutTransaction;

    public const DIAG_GROUP = 'cops-h1-1-diag';

    /** نسخة مرجعية من حدّ البوابة لتمييز الجولات المتجاوزة في التقرير فقط — لا يُؤكَّد بها شيء ولا تتغيّر قيمة الحدّ. */
    private const GATE_P95_BUDGET_MS = 50.0;

    private const WRITERS = 20;

    private const PER_WRITER = 10;

    private const THINK_MAX_MS = 200;

    /** عدد جولات «البوابة المكافئة» (نفس 1–3 ببذورها) وجولات الرصد الإضافية (افتراضياً 3، يمكن تعديلها بـCOPS_DIAG_SAMPLED_ROUNDS). */
    private const GATE_EQUIV_ROUNDS = 3;

    private const SAMPLER_INTERVAL_US = 5000;

    /** عتبة اعتبار الاصطفاف «طابوراً» في الرصد: عدد المنتظرين على قفل. */
    private const QUEUE_MIN_WAITERS = 3;

    private float $startedAt = 0.0;

    private string $dir;

    private string $tenantId;

    private string $channelId;

    /** @var list<string> */
    private array $tenants = [];

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'), 'pcntl/posix مطلوبان؛ غيابهما فشل لا تخطٍّ.');

        $this->dir = sys_get_temp_dir().'/commerce_events_diag_'.uniqid();
        mkdir($this->dir);

        $tenant = Tenant::create(['name' => 'تشخيص تغذية الأحداث', 'slug' => 'cops-diag-'.Str::random(8), 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        $this->tenants[] = $this->tenantId = $tenant->id;
        app(TenantContext::class)->set($this->tenantId);
        $this->channelId = SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true])->id;
        User::create(['tenant_id' => $this->tenantId, 'name' => 'مشرف', 'email' => 'sup-'.Str::random(6).'@pg.test', 'password' => 'password123', 'role' => 'admin']);
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

    #[Test]
    #[Group(self::DIAG_GROUP)]
    public function the_diagnostic_records_where_the_feed_head_holder_stalls_without_judging_the_budget(): void
    {
        if (! empty($_SERVER['LARAVEL_PARALLEL_TESTING']) || ! empty(getenv('LARAVEL_PARALLEL_TESTING'))) {
            $this->markTestSkipped('التشخيص يعمل في وظيفة CI مخصصة على مشغّل خاص: vendor/bin/phpunit --group '.self::DIAG_GROUP.'.');
        }
        $this->startedAt = microtime(true);
        $sampledRounds = max(0, (int) (getenv('COPS_DIAG_SAMPLED_ROUNDS') !== false ? getenv('COPS_DIAG_SAMPLED_ROUNDS') : 3));

        $baseline = $this->baselineP50();
        $rounds = [];

        // الجولة 0: إحماء كالبوابة (مسجَّل). 1–3: «البوابة المكافئة» بلا رصد ولا إعدادات إضافية. 4…: جولات الرصد.
        $plan = [[0, 'warmup', false]];
        for ($r = 1; $r <= self::GATE_EQUIV_ROUNDS; $r++) {
            $plan[] = [$r, 'gate_equiv', false];
        }
        for ($k = 1; $k <= $sampledRounds; $k++) {
            $plan[] = [self::GATE_EQUIV_ROUNDS + $k, 'sampled', true];
        }

        foreach ($plan as [$round, $kind, $sampled]) {
            $m = $this->measureRound(seed: 1000 * $round, sampled: $sampled);
            $m['round'] = $round;
            $m['kind'] = $kind;
            $m['added_p95_ms'] = round($m['contended_p95_ms'] - $baseline, 3);
            $m['over_gate_budget'] = $kind !== 'warmup' && $m['added_p95_ms'] >= self::GATE_P95_BUDGET_MS;
            $rounds[] = $m;
        }

        $payload = [
            'slice' => 'COPS-H1-1', 'name' => 'stall_diagnostic', 'gate_budget_ms_reference' => self::GATE_P95_BUDGET_MS,
            'workload' => ['writers' => self::WRITERS, 'per_writer' => self::PER_WRITER, 'think_max_ms' => self::THINK_MAX_MS],
            'baseline_p50_ms' => $baseline, 'pg' => $this->pgSettings(), 'host' => $this->hostInfo(),
            'test_duration_s' => round(microtime(true) - $this->startedAt, 3), 'rounds' => $rounds,
        ];
        $this->record($payload);

        // النزاهة فقط (صحة لا أداء): لا أخطاء، تسلسل متصل، وعدد أحداث كل كاتب. لا تأكيد على أي كمون.
        foreach ($rounds as $m) {
            $this->assertSame([], $m['integrity']['errors'], "جولة {$m['round']}: أخطاء/جمود في الكتّاب");
            $this->assertTrue($m['integrity']['sequence_complete'], "جولة {$m['round']}: تسلسل غير متصل");
            $this->assertTrue($m['integrity']['per_writer_complete'], "جولة {$m['round']}: عدد أحداث الكاتب");
        }
    }

    // ───────────────────────── القياس ─────────────────────────

    /** @return array<string, mixed> */
    private function measureRound(int $seed, bool $sampled): array
    {
        $tenant = $this->tenantId;
        $orders = [];
        for ($i = 0; $i < self::WRITERS; $i++) {
            $orders[] = $this->order();
        }
        $before = (int) DB::table('commerce_order_events')->where('tenant_id', $tenant)->max('feed_seq');
        $dir = $this->dir;
        // ضبط إيجابي للتحقق من حساسية الأدوات محلياً فقط: يحقن توقفاً معروفاً (نوم) أثناء إمساك القفل لكاتب واحد في جولة واحدة.
        // لا يُفعَّل في CI أبداً (المتغيّران غير مضبوطين فيه) ولا يمسّ جولات البوابة المكافئة إلا إن طُلب صراحةً.
        $injectMs = (getenv('COPS_DIAG_INJECT_GAP_MS') !== false && (int) getenv('COPS_DIAG_INJECT_ROUND') * 1000 === $seed) ? (int) getenv('COPS_DIAG_INJECT_GAP_MS') : 0;
        $writers = self::WRITERS;
        $perWriter = self::PER_WRITER;
        $think = self::THINK_MAX_MS;

        $jobs = [];
        foreach ($orders as $i => $orderId) {
            $jobs[] = function () use ($tenant, $orderId, $perWriter, $think, $seed, $i, $sampled, $dir, $injectMs) {
                mt_srand($seed + $i);
                $walTiming = null;
                if ($sampled) {
                    try {
                        DB::statement('SET track_wal_io_timing = on');
                        $walTiming = true;
                    } catch (\Throwable) {
                        $walTiming = false;
                    }
                }
                $pid = (int) DB::selectOne('select pg_backend_pid() as p')->p;
                $ru0 = getrusage();
                $rq0 = self::runDelayNs();
                $txns = [];
                $loopStart = microtime(true);
                for ($j = 0; $j < $perWriter; $j++) {
                    if ($think > 0) {
                        usleep(mt_rand(0, $think * 1000));
                    }
                    DB::beginTransaction();
                    try {
                        CommerceOrder::query()->whereKey($orderId)->lockForUpdate()->first();
                        $rqA = self::runDelayNs();
                        $wall = microtime(true);
                        $t0 = hrtime(true);
                        self::append($tenant, $orderId);
                        $t1 = hrtime(true);                 // نهاية فاصل البوابة (wait_ms) — لا شيء قبله يتغيّر
                        $rqB = self::runDelayNs();          // أول فعل بعد append: بداية نافذة تأخر الطابور داخل الفجوة (القفل ممسوك)
                        if ($injectMs > 0 && $i === 0 && $j === 5) {
                            usleep($injectMs * 1000);
                        }
                        $rqG = self::runDelayNs();          // نهاية الفجوة: قبل COMMIT مباشرةً
                        $t2 = hrtime(true);
                        DB::commit();
                        $t3 = hrtime(true);
                        $endWall = microtime(true);         // وقت الإكمال الفعلي (يُستعمل لإعادة بناء الخط الزمني دون افتراض اتصال المكوّنات)
                        $rqC = self::runDelayNs();          // بعد الالتزام (تأخر الاستيقاظ بعده لا يطيل إمساك القفل)
                    } catch (\Throwable $e) {
                        DB::rollBack();
                        throw $e;
                    }
                    $txns[] = [
                        'w' => $i, 'at' => round($wall, 6),
                        'end' => round($endWall, 6),
                        // gap_ms متصل مع wait_ms: من نهاية append حتى قبيل COMMIT (يشمل قراءتَي schedstat ≈25µs لكلٍّ).
                        'wait_ms' => round(($t1 - $t0) / 1e6, 3), 'gap_ms' => round(($t2 - $t1) / 1e6, 3), 'commit_ms' => round(($t3 - $t2) / 1e6, 3),
                        // تأخر طابور المعالج للعملية نفسها في نافذة كلٍّ من: append / فجوة العميل (بين قراءتين تحدّان gap_ms عملياً) / COMMIT وما بعده.
                        'rq_wait_ms' => round(($rqB - $rqA) / 1e6, 3), 'rq_gap_ms' => round(($rqG - $rqB) / 1e6, 3), 'rq_commit_ms' => round(($rqC - $rqG) / 1e6, 3),
                    ];
                }
                $ru1 = getrusage();
                touch($dir.'/done_'.$i.'_'.getmypid());

                return [
                    'txns' => $txns, 'start' => $loopStart, 'end' => microtime(true), 'pg_pid' => $pid, 'wal_io_timing' => $walTiming,
                    'ru' => [
                        'nivcsw' => $ru1['ru_nivcsw'] - $ru0['ru_nivcsw'], 'nvcsw' => $ru1['ru_nvcsw'] - $ru0['ru_nvcsw'],
                        'cpu_ms' => round((($ru1['ru_utime.tv_sec'] - $ru0['ru_utime.tv_sec']) + ($ru1['ru_stime.tv_sec'] - $ru0['ru_stime.tv_sec'])) * 1000
                            + (($ru1['ru_utime.tv_usec'] - $ru0['ru_utime.tv_usec']) + ($ru1['ru_stime.tv_usec'] - $ru0['ru_stime.tv_usec'])) / 1000, 1),
                        'runqueue_delay_ms' => round((self::runDelayNs() - $rq0) / 1e6, 1),
                    ],
                ];
            };
        }
        if ($sampled) {
            $jobs[] = fn () => $this->sampler($dir, $writers);
        }

        $psiBefore = self::psi();
        $walBefore = self::pgWal();
        $cpuBefore = self::cpuSnapshot();
        $loadBefore = (sys_getloadavg() ?: [0.0])[0];
        $started = microtime(true);
        $results = $this->runConcurrently($jobs);
        $elapsed = microtime(true) - $started;
        $walAfter = self::pgWal();
        $psiAfter = self::psi();
        $cpu = self::cpuWindow($cpuBefore, self::cpuSnapshot(), $loadBefore);
        foreach (glob($dir.'/done_*') ?: [] as $f) {
            @unlink($f);
        }

        // مفاتيح أخطاء الكتّاب كالبوابة.
        $errors = [];
        $writerResults = array_slice($results, 0, $writers, true);
        foreach ($writerResults as $i => $r) {
            if (! ($r['ok'] ?? false)) {
                $errors[] = "العملية {$i}: ".($r['error_class'] ?? '').' '.($r['message'] ?? '');
            } elseif (($r['message'] ?? '') !== '' && (str_contains((string) $r['message'], '40P01') || stripos((string) $r['message'], 'deadlock') !== false)) {
                $errors[] = "جمود في العملية {$i}";
            }
        }
        $total = $writers * $perWriter;
        $seqs = array_map('intval', DB::table('commerce_order_events')->where('tenant_id', $tenant)->orderBy('feed_seq')->pluck('feed_seq')->all());
        $perWriterComplete = true;
        foreach ($orders as $orderId) {
            if (DB::table('commerce_order_events')->where('commerce_order_id', $orderId)->count() !== $perWriter) {
                $perWriterComplete = false;
            }
        }

        // مفاتيح $values = رقم الكاتب الأصلي (تُحفظ ليُنسب كل شيء إلى كاتبه).
        $values = array_map(fn ($r) => $r['value'], array_filter($writerResults, fn ($r) => ($r['ok'] ?? false) && isset($r['value']['txns'])));
        $txns = $values ? array_merge(...array_values(array_column($values, 'txns'))) : [];
        $waits = array_column($txns, 'wait_ms');
        sort($waits);
        $pct = fn (float $p): float => $waits ? round($waits[(int) floor(($p / 100) * (count($waits) - 1))], 3) : 0.0;

        $sampler = null;
        if ($sampled && ($results[$writers]['ok'] ?? false)) {
            $sampler = $results[$writers]['value'];
            $pidToWriter = [];
            foreach ($values as $idx => $v) {
                $pidToWriter[$v['pg_pid']] = $idx;
            }
            $sampler['pid_to_writer'] = $pidToWriter;
        }

        return [
            'sampled' => $sampled, 'seed' => $seed,
            'elapsed_s' => round($elapsed, 3), 'transactions' => count($waits), 'events_per_second' => round(count($waits) / max($elapsed, 1e-9), 1),
            'contended_p50_ms' => $pct(50), 'contended_p95_ms' => $pct(95), 'contended_p99_ms' => $pct(99), 'contended_max_ms' => $waits ? round(max($waits), 3) : 0.0,
            'slow_count' => count(array_filter($waits, fn ($w) => $w >= self::GATE_P95_BUDGET_MS)),
            'components' => self::componentStats($txns),
            'psi_delta_us' => self::psiDelta($psiBefore, $psiAfter),
            'pg_wal_delta' => self::walDelta($walBefore, $walAfter),
            ...$cpu,
            'writers' => array_values(array_map(fn ($idx, $v) => ['w' => $idx, 'pg_pid' => $v['pg_pid'], 'ru' => $v['ru'], 'wal_io_timing' => $v['wal_io_timing']], array_keys($values), $values)),
            'sampler' => $sampler,
            'txns' => $txns,
            'integrity' => ['errors' => $errors, 'sequence_complete' => $seqs === range(1, $before + $total), 'per_writer_complete' => $perWriterComplete],
        ];
    }

    /**
     * رصد: يستعلم نشاط الخلفيات كل ≈5ms حتى ينتهي كل الكتّاب، ويسجّل لكل لحظة اصطفاف (≥3 منتظرين على قفل) **حالة الماسك الجذري** (الذي لا ينتظر قفلاً).
     *
     * @return array<string, mixed>
     */
    private function sampler(string $dir, int $writers): array
    {
        $sql = "select pid, state, wait_event_type, wait_event, pg_blocking_pids(pid)::text as b
                from pg_stat_activity
                where datname = current_database() and backend_type = 'client backend' and pid <> pg_backend_pid() and state <> 'idle'";
        $deadline = microtime(true) + 30.0;
        $latencies = [];
        $episodes = [];
        $open = null;
        $hist = [];
        $samples = 0;
        $maxWaiters = 0;
        while (microtime(true) < $deadline && count(glob($dir.'/done_*') ?: []) < $writers) {
            $t0 = microtime(true);
            $rows = DB::select($sql);
            $latencies[] = (microtime(true) - $t0) * 1000;
            $samples++;
            $byPid = [];
            foreach ($rows as $r) {
                $byPid[(int) $r->pid] = $r;
            }
            $waiters = array_filter($rows, fn ($r) => $r->wait_event_type === 'Lock');
            $n = count($waiters);
            $maxWaiters = max($maxWaiters, $n);
            if ($n >= self::QUEUE_MIN_WAITERS) {
                $roots = [];
                foreach ($waiters as $w) {
                    foreach (array_filter(array_map('intval', explode(',', trim((string) $w->b, '{}')))) as $bp) {
                        $holder = $byPid[$bp] ?? null;
                        if ($holder === null || $holder->wait_event_type !== 'Lock') {
                            $roots[$bp] = $holder === null ? 'gone' : $holder->state.'|'.($holder->wait_event_type ?? '-').':'.($holder->wait_event ?? '-');
                        }
                    }
                }
                if ($open === null) {
                    $open = ['t0' => round($t0, 6), 'peak' => 0, 'samples' => 0, 'holder_keys' => [], 'root_pids' => []];
                }
                $open['peak'] = max($open['peak'], $n);
                $open['samples']++;
                $open['t1'] = round($t0, 6);
                foreach ($roots as $pid => $key) {
                    $open['holder_keys'][$key] = ($open['holder_keys'][$key] ?? 0) + 1;
                    $open['root_pids'][$pid] = true;
                    $hist[$key] = ($hist[$key] ?? 0) + 1;
                }
            } elseif ($open !== null) {
                $open['root_pids'] = array_keys($open['root_pids']);
                $episodes[] = $open;
                $open = null;
            }
            usleep(self::SAMPLER_INTERVAL_US);
        }
        if ($open !== null) {
            $open['root_pids'] = array_keys($open['root_pids']);
            $episodes[] = $open;
        }
        sort($latencies);
        $q = fn (float $p): float => $latencies ? round($latencies[(int) floor(($p / 100) * (count($latencies) - 1))], 3) : 0.0;

        return [
            'interval_us' => self::SAMPLER_INTERVAL_US, 'samples' => $samples, 'max_waiters' => $maxWaiters,
            'query_ms' => ['p50' => $q(50), 'p99' => $q(99), 'max' => $latencies ? round(max($latencies), 3) : 0.0],
            'queue_episodes' => $episodes, 'holder_histogram' => $hist,
        ];
    }

    // ───────────────────────── أدوات (نسخ حرفية من البوابة حيث وُجد نظير) ─────────────────────────

    /** @return array<string, array<string, float>> */
    private static function componentStats(array $txns): array
    {
        $out = [];
        foreach (['wait_ms', 'gap_ms', 'commit_ms', 'rq_wait_ms', 'rq_gap_ms', 'rq_commit_ms'] as $k) {
            $v = array_column($txns, $k);
            sort($v);
            $n = count($v);
            $at = fn (float $p): float => $n ? round($v[(int) floor(($p / 100) * ($n - 1))], 3) : 0.0;
            $out[$k] = ['p50' => $at(50), 'p95' => $at(95), 'p99' => $at(99), 'max' => $n ? round(max($v), 3) : 0.0];
        }

        return $out;
    }

    /** الحقل الثالث من `/proc/self/schedstat`: تراكمي ns قضتها العملية جاهزةً بانتظار معالج. 0 إن غاب. */
    private static function runDelayNs(): int
    {
        $s = @file_get_contents('/proc/self/schedstat');
        if ($s === false) {
            return 0;
        }
        $f = preg_split('/\s+/', trim($s)) ?: [];

        return (int) ($f[1] ?? 0);
    }

    /** @return array<string, int>|null ضغط المعالج/القرص التراكمي (µs) على مستوى المشغّل؛ null إن لم يتوفر PSI. */
    private static function psi(): ?array
    {
        $out = [];
        foreach (['cpu', 'io'] as $res) {
            $txt = @file_get_contents("/proc/pressure/{$res}");
            if ($txt === false) {
                return null;
            }
            foreach (explode("\n", trim($txt)) as $line) {
                if (preg_match('/^(some|full)\b.*\btotal=(\d+)/', $line, $mm)) {
                    $out["{$res}_{$mm[1]}_us"] = (int) $mm[2];
                }
            }
        }

        return $out ?: null;
    }

    private static function psiDelta(?array $a, ?array $b): ?array
    {
        if ($a === null || $b === null) {
            return null;
        }
        $d = [];
        foreach ($b as $k => $v) {
            $d[$k] = $v - ($a[$k] ?? 0);
        }

        return $d;
    }

    /** @return array<string, int|float>|null */
    private static function pgWal(): ?array
    {
        try {
            $r = DB::selectOne('select wal_records, wal_fpi, wal_write, wal_sync, wal_write_time, wal_sync_time from pg_stat_wal');

            return array_map('floatval', (array) $r);
        } catch (\Throwable) {
            try {
                $r = DB::selectOne('select wal_records, wal_fpi, wal_write, wal_sync from pg_stat_wal');

                return array_map('floatval', (array) $r);
            } catch (\Throwable) {
                return null;
            }
        }
    }

    private static function walDelta(?array $a, ?array $b): ?array
    {
        if ($a === null || $b === null) {
            return null;
        }
        $d = [];
        foreach ($b as $k => $v) {
            $d[$k] = round($v - ($a[$k] ?? 0), 3);
        }

        return $d;
    }

    /** @return array<string, string> */
    private function pgSettings(): array
    {
        $out = [];
        foreach (['synchronous_commit', 'fsync', 'wal_sync_method', 'wal_writer_delay', 'commit_delay', 'full_page_writes', 'shared_buffers', 'max_wal_size', 'checkpoint_timeout', 'track_io_timing', 'server_version'] as $s) {
            try {
                $out[$s] = (string) DB::selectOne('select current_setting(?) as v', [$s])->v;
            } catch (\Throwable) {
                $out[$s] = 'n/a';
            }
        }

        return $out;
    }

    /** @return array<string, mixed> */
    private function hostInfo(): array
    {
        $cpu = trim((string) @shell_exec("grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2"));

        return [
            'nproc' => (int) trim((string) @shell_exec('nproc 2>/dev/null')), 'cpu_model' => $cpu,
            'kernel' => php_uname('r'), 'loadavg' => sys_getloadavg() ?: [], 'psi_available' => self::psi() !== null,
            'schedstat_available' => is_readable('/proc/self/schedstat'), 'runner_name' => getenv('RUNNER_NAME') ?: null,
            'variant' => getenv('COPS_DIAG_VARIANT') ?: null, 'repeat' => getenv('COPS_DIAG_REPEAT') ?: null,
        ];
    }

    /** @return array{busy:int,idle:int,iowait:int,steal:int,total:int}|null */
    private static function cpuSnapshot(): ?array
    {
        $line = @file('/proc/stat', FILE_IGNORE_NEW_LINES)[0] ?? null;
        if ($line === null || ! str_starts_with($line, 'cpu ')) {
            return null;
        }
        $f = array_map('intval', preg_split('/\s+/', trim(substr($line, 4))) ?: []);
        $f += array_fill(0, 8, 0);
        $idle = $f[3] + $f[4];
        $total = array_sum(array_slice($f, 0, 8));

        return ['busy' => $total - $idle, 'idle' => $f[3], 'iowait' => $f[4], 'steal' => $f[7], 'total' => $total];
    }

    /** @return array<string, float|int|null> */
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

    private function order(): string
    {
        app(TenantContext::class)->set($this->tenantId);
        $order = CommerceOrder::create(['sales_channel_id' => $this->channelId, 'number' => 'CORD-EV-'.Str::upper(Str::random(8)), 'delivery_method' => 'pickup', 'total' => 1000]);
        $order->update(['status' => CommerceOrder::STATUS_CONFIRMED, 'confirmed_at' => now()]);
        CommercePaymentIntent::create(['commerce_order_id' => $order->id, 'method' => CommercePaymentIntent::METHOD_PAY_ON_PICKUP,
            'status' => CommercePaymentIntent::STATUS_AWAITING_COLLECTION, 'amount_minor' => 1000, 'currency' => 'SAR']);

        return $order->id;
    }

    /** يكتب حدثاً بالكاتب الحقيقي داخل معاملة الطفل (كالبوابة حرفياً). */
    private static function append(string $tenantId, string $orderId): void
    {
        app(TenantContext::class)->set($tenantId);
        $order = CommerceOrder::query()->findOrFail($orderId);
        app(CommerceOrderEventRecorder::class)->append($order, 'payment.collected', 'system');
    }

    /** p50 زمن الكتابة بلا تنافس: كاتب واحد متسلسل، 30 معاملة (كالبوابة حرفياً). */
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

    private function record(array $payload): void
    {
        $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
        $dir = base_path('pgsql-watchdog');
        if (is_dir($dir)) {
            file_put_contents("{$dir}/cops-h1-1-diag.json", $json.PHP_EOL);
        }
        $brief = array_map(fn ($m) => [
            'round' => $m['round'], 'kind' => $m['kind'], 'added_p95_ms' => $m['added_p95_ms'], 'slow' => $m['slow_count'], 'over' => $m['over_gate_budget'],
        ], $payload['rounds']);
        fwrite(STDERR, "\nCOPS-H1-1 diag summary: ".json_encode(['variant' => $payload['host']['variant'], 'repeat' => $payload['host']['repeat'], 'rounds' => $brief], JSON_UNESCAPED_UNICODE)."\n");
    }

    /** @return array<int, array<string, mixed>> نسخة حرفية من `CommerceOrderEventsPostgresTest::runConcurrently`. */
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
