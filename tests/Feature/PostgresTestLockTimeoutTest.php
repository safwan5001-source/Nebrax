<?php

namespace Tests\Feature;

use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PDO;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  AWJ-BACKEND-CI-02 — انتظار أقفال PostgreSQL في الاختبارات له سقف
 * ═══════════════════════════════════════════════════════════════
 *  الحادثة (AWJ-BACKEND-CI-01): اختبارٌ فاشل ترك معاملةً مفتوحة على اتصالٍ لم
 *  يُغلَق، فانتظر الاختبار التالي في العامل نفسه قفلها إلى الأبد (42 دقيقة،
 *  عاملان). الحاجز معاملةٌ **خاملة** لا تنتظر شيئاً، فلا يراها كاشف الـDeadlock،
 *  والانتظار بلا سقف لأن `lock_timeout` الافتراضي 0.
 *
 *  المعالجة في بيئة الاختبار وحدها: `PGOPTIONS='-c lock_timeout=…'` في خطوة
 *  اختبارات PostgreSQL في CI. تقرؤه libpq عند كل اتصال، فيرثه اتصال Laravel
 *  و«المنافس» PDO وأطفال `pcntl_fork` معاً. لا إعداد إنتاجي ولا كود تطبيق.
 *
 *  هذه الاختبارات تحرس العقد من الطرفين:
 *  - المهلة موجودةٌ ومحدودة، وأكبر من أطول انتظارٍ مقصود في اختبارات التزامن.
 *  - الانتظار خلف معاملةٍ متروكة ينتهي بـ55P03 مسمّى بدل تعليق العامل.
 *  - الـDeadlock الحقيقي يبقى 40P01 بعد deadlock_timeout، لا تبتلعه المهلة.
 *
 *  **لا يعمل إلا على PostgreSQL حقيقي.**
 */
class PostgresTestLockTimeoutTest extends TestCase
{
    use RefreshDatabase;

    /**
     * أطول انتظارٍ مقصود في المجموعة: `Rem04PostingLockOrderPostgresTest::awaitFile()`
     * يمهل حتى 20 ثانية، ومهلٌ أخرى حتى 10 ثوانٍ. المهلة يجب أن تتجاوزه بوضوح
     * فلا تُفشل اختبار تزامنٍ شرعياً على عدّادٍ بطيء.
     */
    private const MIN_LOCK_TIMEOUT_MS = 30_000;

    /** سقفٌ أعلى: مهلةٌ بالساعة ليست حارساً، بل تعليقٌ أقصر قليلاً. */
    private const MAX_LOCK_TIMEOUT_MS = 120_000;

    /** @var list<PDO> */
    private array $rivals = [];

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('مهلة الأقفال إعداد PostgreSQL — لا معنى لها على SQLite.');
        }
    }

    protected function tearDown(): void
    {
        foreach ($this->rivals as $rival) {
            try {
                $rival->exec('ROLLBACK');
            } catch (\Throwable) {
                // لا معاملة مفتوحة.
            }
        }
        $this->rivals = [];

        parent::tearDown();
    }

    /** @test */
    public function every_test_connection_inherits_a_bounded_lock_timeout(): void
    {
        $laravel = $this->settingMs(fn (string $sql) => DB::selectOne($sql)->ms);
        $rival = $this->settingMs(fn (string $sql) => $this->rival()->query($sql)->fetch(PDO::FETCH_OBJ)->ms);

        foreach (['اتصال Laravel' => $laravel, 'اتصال PDO مستقل' => $rival] as $label => $ms) {
            $this->assertGreaterThan(0, $ms, "{$label}: lock_timeout = 0 — انتظار الأقفال بلا سقف. "
                ."شغّل اختبارات PostgreSQL مع PGOPTIONS='-c lock_timeout=60s' (انظر ci.yml).");
            $this->assertGreaterThanOrEqual(self::MIN_LOCK_TIMEOUT_MS, $ms, "{$label}: المهلة أقصر من أطول انتظار مقصود في اختبارات التزامن.");
            $this->assertLessThanOrEqual(self::MAX_LOCK_TIMEOUT_MS, $ms, "{$label}: المهلة طويلة حتى لا تحرس شيئاً.");
        }

        $deadlockMs = (int) DB::selectOne("SELECT setting::bigint AS ms FROM pg_settings WHERE name = 'deadlock_timeout'")->ms;
        $this->assertGreaterThan($deadlockMs, $laravel, 'المهلة يجب أن تتجاوز deadlock_timeout وإلا ابتلعت الـDeadlock الحقيقي.');
    }

    /** @test */
    public function waiting_behind_an_abandoned_transaction_fails_with_55P03_instead_of_hanging(): void
    {
        $timeoutMs = $this->settingMs(fn (string $sql) => DB::selectOne($sql)->ms);
        // بلا مهلة سيتعلّق هذا الاختبار نفسه — نفشل فوراً بدل إعادة إنتاج الحادثة.
        $this->assertGreaterThan(0, $timeoutMs, 'lock_timeout = 0: الاختبار كان سيتعلّق. اضبط PGOPTIONS.');

        // معاملةٌ متروكة: تحجز وتخمل، كما في الحادثة. لا تنتظر شيئاً فلا Deadlock.
        $abandoned = $this->rival();
        $abandoned->exec('BEGIN');
        $abandoned->exec('LOCK TABLE tenant_reference_number_sequences IN EXCLUSIVE MODE');

        $started = microtime(true);
        try {
            // الاستعلام نفسه الذي علِق في الحادثة، على اتصال Laravel بلا أي SET محلي.
            DB::select('SELECT id FROM tenant_reference_number_sequences WHERE id = 1 FOR UPDATE');
            $this->fail('الحجز مرّ رغم القفل المحجوز: الاختبار لا يقيس شيئاً.');
        } catch (QueryException $e) {
            $elapsedMs = (microtime(true) - $started) * 1000;
            $this->assertSame('55P03', $this->sqlState($e), 'متوقع lock_not_available: '.$e->getMessage());
            $this->assertGreaterThanOrEqual($timeoutMs * 0.9, $elapsedMs, 'فشل قبل المهلة: ليس انتظار قفل.');
            $this->assertLessThan($timeoutMs + 10_000, $elapsedMs, 'تجاوز المهلة بكثير: السقف غير فعّال.');
        }
    }

    /** @test */
    public function a_real_deadlock_is_still_reported_as_40P01_before_the_lock_timeout(): void
    {
        $timeoutMs = $this->settingMs(fn (string $sql) => DB::selectOne($sql)->ms);
        $this->assertGreaterThan(0, $timeoutMs, 'lock_timeout = 0: الاختبار كان سيتعلّق. اضبط PGOPTIONS.');
        $this->assertTrue(function_exists('pg_send_query'), 'امتداد pgsql مطلوب لإرسال استعلام غير متزامن.');

        // الطرف «أ» عبر ext-pgsql ليُرسل استعلامه الحاجز دون أن يحجب هذا الإجراء.
        $c = config('database.connections.pgsql');
        $a = pg_connect(sprintf(
            "host=%s port=%s dbname=%s user=%s password='%s'",
            $c['host'], $c['port'], $c['database'], $c['username'], addcslashes((string) $c['password'], "'\\"),
        ), PGSQL_CONNECT_FORCE_NEW);
        $this->assertNotFalse($a, 'تعذّر فتح الاتصال «أ».');
        $b = $this->rival();

        try {
            pg_query($a, 'BEGIN');
            pg_query($a, 'LOCK TABLE tenants IN EXCLUSIVE MODE');
            $b->exec('BEGIN');
            $b->exec('LOCK TABLE tenant_reference_number_sequences IN EXCLUSIVE MODE');

            $started = microtime(true);
            // «أ» ينتظر ما يحجزه «ب»…
            pg_send_query($a, 'LOCK TABLE tenant_reference_number_sequences IN EXCLUSIVE MODE');
            $this->awaitLockWait(pg_get_pid($a));

            // …و«ب» يطلب ما يحجزه «أ»: دورةٌ حقيقية.
            $states = [];
            try {
                $b->exec('LOCK TABLE tenants IN EXCLUSIVE MODE');
                $states['b'] = 'granted';
            } catch (\PDOException $e) {
                $states['b'] = (string) $e->getCode();
            }
            $result = pg_get_result($a);
            $states['a'] = pg_result_error_field($result, PGSQL_DIAG_SQLSTATE) ?: 'granted';
            $elapsedMs = (microtime(true) - $started) * 1000;

            sort($states);
            $this->assertSame(['40P01', 'granted'], array_values($states),
                'متوقع: طرفٌ يُكسر بـ40P01 والآخر يمضي — لا 55P03 ولا تعليق.');
            $this->assertLessThan($timeoutMs, $elapsedMs, 'الكشف تأخّر حتى المهلة: الـDeadlock لم يُكشف بذاته.');
        } finally {
            pg_close($a);
        }
    }

    /** المهلة الفعلية بالملّي ثانية كما تراها الجلسة (`pg_settings.setting` بوحدة ms). */
    private function settingMs(callable $query): int
    {
        return (int) $query("SELECT setting::bigint AS ms FROM pg_settings WHERE name = 'lock_timeout'");
    }

    private function sqlState(QueryException $e): ?string
    {
        return $e->errorInfo[0] ?? null;
    }

    /** ينتظر حتى تقف الجلسة فعلاً على قفل — لا نعتمد على توقيتٍ تخميني. */
    private function awaitLockWait(int $pid): void
    {
        $deadline = microtime(true) + 5.0;
        $probe = $this->rival();
        while (microtime(true) < $deadline) {
            $waiting = $probe->query("SELECT wait_event_type = 'Lock' FROM pg_stat_activity WHERE pid = {$pid}")->fetchColumn();
            if ($waiting === true) {
                return;
            }
            usleep(10_000);
        }
        $this->fail('الطرف «أ» لم يبدأ انتظار القفل خلال 5 ثوانٍ.');
    }

    /** اتصالٌ مستقل حقيقي إلى قاعدة العامل نفسها — لا يشارك معاملة RefreshDatabase. */
    private function rival(): PDO
    {
        $c = config('database.connections.pgsql');
        $pdo = new PDO(
            sprintf('pgsql:host=%s;port=%s;dbname=%s', $c['host'], $c['port'], $c['database']),
            $c['username'],
            $c['password'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION],
        );
        $this->rivals[] = $pdo;

        return $pdo;
    }
}
