<?php

namespace Tests\Feature;

use App\Models\FiscalYear;
use App\Models\FiscalYearClose;
use App\Services\Accounting\FiscalCloseService;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PDO;
use RuntimeException;
use Tests\TestCase;

/**
 * FISCAL-2 — إثبات تسلسل الإقفال/الفتح على PostgreSQL بموصلين متزامنين حقيقيين.
 *
 * الإقفال يقرأ الأرباح والخسائر ثم يكتب قيداً ويغيّر حالة السنة. لو لم يتسلسل
 * مع الترحيل العادي لأمكن أن يُرحَّل قيدٌ داخل السنة **بعد** حساب النتيجة
 * و**قبل** تثبيت الإقفال، فيبقى خارج الأرباح المرحّلة بلا أثر.
 *
 * المِرساة نفسها التي أثبتها ACC-6: صفّ المستأجر (`tenants`). يحجزها هنا موصل
 * PDO ثانٍ مستقلّ، فيُرى أن الإقفال **ينتظر** لا أن يمرّ. مهلة `lock_timeout`
 * قصيرة تحوّل الانتظار إلى خطأ قابل للتأكيد بدل تعليق الاختبار.
 *
 * يتخطّى نفسه على SQLite: لا أقفال صفوف فيه — وهو محرّك الاختبار لا الإنتاج.
 *
 * تشغيل: php artisan test --filter=FiscalYearConcurrencyTest
 */
class FiscalYearConcurrencyTest extends TestCase
{
    use RefreshDatabase;

    private ?PDO $rival = null;
    private string $tenantId = '';

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('إثبات التزامن بموصلين خاصٌّ بـPostgreSQL.');
        }

        // صفّ مستأجر **مودَع** من الموصل الثاني: هو المِرساة المتنازع عليها،
        // ولا بدّ أن يراها الطرفان. (`RefreshDatabase` تلفّ كتابات Laravel في
        // معاملة لا يراها موصلٌ آخر.)
        $this->tenantId = (string) Str::uuid();
        $this->rival()->prepare(
            'INSERT INTO tenants (id, name, slug, vat_number, currency, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, now(), now())'
        )->execute([$this->tenantId, 'مستأجر التزامن', 'fiscal-conc-' . substr($this->tenantId, 0, 8), '300000000000003', 'SAR']);

        // الحدّ الأدنى المحاسبي — من المنافس أيضاً: حساب الأرباح المرحّلة
        // وتعيين دوره. بهما وحدهما يمرّ إقفال سنةٍ بلا نشاط (لا قيد يُنشأ).
        $accountId = (string) Str::uuid();
        $this->rival()->prepare(
            'INSERT INTO accounts (id, tenant_id, code, name, type, normal_balance, is_group, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, false, true, now(), now())'
        )->execute([$accountId, $this->tenantId, '3120', 'الأرباح المرحّلة', 'equity', 'credit']);

        $this->rival()->prepare(
            'INSERT INTO account_role_mappings (id, tenant_id, role_key, account_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, now(), now())'
        )->execute([(string) Str::uuid(), $this->tenantId, 'retained_earnings', $accountId]);

        app(TenantContext::class)->set($this->tenantId);
    }

    protected function tearDown(): void
    {
        $rival = $this->rival;
        $tenantId = $this->tenantId;
        $this->rival = null;

        if ($rival !== null) {
            try {
                $rival->exec('ROLLBACK');
            } catch (\Throwable) {
                // لا معاملة مفتوحة.
            }
        }

        // **الترتيب حاسم:** معاملة `RefreshDatabase` تُتراجَع داخل
        // `parent::tearDown()` وهي تحمل قفلاً على صفّ المستأجر؛ حذفُه قبلها
        // ينتظر إلى الأبد.
        parent::tearDown();

        if ($rival !== null) {
            try {
                $rival->prepare('DELETE FROM tenants WHERE id = ?')->execute([$tenantId]);
            } catch (\Throwable) {
                // القاعدة تُعاد تهيئتها بين التشغيلات.
            }
        }
    }

    private function rival(): PDO
    {
        if ($this->rival === null) {
            $c = config('database.connections.pgsql');
            $this->rival = new PDO(
                sprintf('pgsql:host=%s;port=%s;dbname=%s', $c['host'], $c['port'], $c['database']),
                $c['username'],
                $c['password'],
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION],
            );
        }

        return $this->rival;
    }

    /**
     * محاولة حجز المِرساة من المنافس بـ`NOWAIT`.
     *
     * `NOWAIT` لا `lock_timeout`: تفشل **فوراً** برمز 55P03 إن كان الصفّ
     * محجوزاً، وتنجح فوراً إن كان حرّاً. فحصٌ قاطع بلا انتظارٍ ولا مهلةٍ قد
     * تُتراجَع مع معاملة — وهذا بالضبط ما نريد قياسه: أمحجوزةٌ المِرساة أم لا.
     */
    private function rivalTriesAnchor(): bool
    {
        $rival = $this->rival();
        $rival->exec('BEGIN');

        try {
            $rival->prepare('SELECT id FROM tenants WHERE id = ? FOR UPDATE NOWAIT')->execute([$this->tenantId]);

            return true;
        } catch (\PDOException $e) {
            $this->assertStringContainsString('55P03', (string) $e->getCode() . ' ' . $e->getMessage());
            try {
                $rival->exec('ROLLBACK');
            } catch (\Throwable) {
                // المعاملة أُجهضت مع الخطأ.
            }

            return false;
        }
    }

    private function rivalHoldsAnchor(): void
    {
        $this->assertTrue($this->rivalTriesAnchor(), 'المنافس لم يحجز صفّ المستأجر.');
    }

    /**
     * سنة مالية **مودَعة** من الموصل الثاني.
     *
     * لا تُنشأ من Laravel عمداً: `FiscalYearService::create()` يقفل المِرساة
     * داخل معاملة `RefreshDatabase` التي لا تُغلق حتى نهاية الاختبار، فتبقى
     * المِرساة محجوزةً ولا يستطيع المنافس أخذها أصلاً — فينقلب الاختبار إلى
     * انتظارٍ أبديّ بدل إثبات شيء.
     */
    private function rivalCreatesYear(string $status = 'open'): string
    {
        $id = (string) Str::uuid();
        $this->rival()->prepare(
            'INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, now(), now())'
        )->execute([$id, $this->tenantId, '2026', '2026-01-01', '2026-12-31', $status]);

        return $id;
    }

    /** جيل إقفال نشط بلا قيد (سنة بلا نشاط) — يجعل الفتح أول عملية مالية لـLaravel. */
    private function rivalCreatesZeroActivityGeneration(string $fiscalYearId): void
    {
        $this->rival()->prepare(
            'INSERT INTO fiscal_year_closes
             (id, tenant_id, fiscal_year_id, generation, status, total_revenue, total_expense, net_income, closed_at, created_at, updated_at)
             VALUES (?, ?, ?, 1, ?, 0, 0, 0, now(), now(), now())'
        )->execute([(string) Str::uuid(), $this->tenantId, $fiscalYearId, FiscalYearClose::STATUS_ACTIVE]);
    }

    /** يتحقّق أن عملية Laravel انتظرت المِرساة التي يحجزها المنافس. */
    private function assertLaravelBlocked(callable $attempt, string $failureMessage): void
    {
        DB::statement("SET lock_timeout = '600ms'");
        try {
            $attempt();
            $this->fail($failureMessage);
        } catch (QueryException $e) {
            $this->assertStringContainsString('lock timeout', strtolower($e->getMessage()));
        } finally {
            DB::statement("SET lock_timeout = '0'");
        }
    }

    /** يتحقّق أن المنافس **لا يستطيع** حجز المِرساة التي تحجزها معاملة Laravel الجارية. */
    private function assertRivalBlocked(string $failureMessage): void
    {
        $this->assertFalse($this->rivalTriesAnchor(), $failureMessage);
    }

    /** @test */
    public function closing_waits_for_the_tenant_anchor_held_by_another_connection(): void
    {
        $yearId = $this->rivalCreatesYear();
        $this->rivalHoldsAnchor();

        $this->assertLaravelBlocked(
            fn () => app(FiscalCloseService::class)->close($yearId, null),
            'الإقفال مرّ بلا انتظار: المِرساة غير فعّالة.',
        );

        // لا حالة جزئية بعد الفشل.
        $this->assertSame(0, FiscalYearClose::count());
        $this->assertSame('open', FiscalYear::findOrFail($yearId)->status);

        // وبعد تحرّر المِرساة يمرّ الإقفال طبيعياً.
        $this->rival()->exec('ROLLBACK');
        $closed = app(FiscalCloseService::class)->close($yearId, null);
        $this->assertSame('closed', $closed['status']);
    }

    /** @test */
    public function reopening_waits_on_the_same_anchor_as_closing(): void
    {
        $yearId = $this->rivalCreatesYear('closed');
        $this->rivalCreatesZeroActivityGeneration($yearId);
        $this->rivalHoldsAnchor();

        $this->assertLaravelBlocked(
            fn () => app(FiscalCloseService::class)->reopen($yearId, 'محاولة متزامنة', null),
            'الفتح مرّ بلا انتظار: الإقفال والفتح لا يتبادلان الاستبعاد.',
        );

        $this->assertSame('closed', FiscalYear::findOrFail($yearId)->status);

        $this->rival()->exec('ROLLBACK');
        $reopened = app(FiscalCloseService::class)->reopen($yearId, 'بعد تحرّر المِرساة', null);
        $this->assertSame('open', $reopened['status']);
    }

    /**
     * الاتجاه المعاكس: إقفالٌ جارٍ يحجز المِرساة، فأي عملية متزامنة تنتظره —
     * ومنها الترحيل العادي، لأن `LedgerService::post()` يبدأ بحجز الصفّ نفسه
     * (ترقيم القيود + `AccountingDateGuard`). فلا يتسرّب قيدٌ بين حساب النتيجة
     * وتثبيت الإقفال.
     *
     * @test
     */
    public function an_in_flight_close_blocks_any_concurrent_operation_on_the_same_tenant(): void
    {
        $yearId = $this->rivalCreatesYear();

        // ضبطٌ مرجعي: قبل أي عملية من Laravel، المِرساة حرّة والمنافس يأخذها.
        $this->assertTrue($this->rivalTriesAnchor(), 'المِرساة محجوزة قبل أي عملية — الضبط المرجعي فاسد.');
        $this->rival()->exec('ROLLBACK');

        // الإقفال يحجزها ويحتفظ بها حتى نهاية معاملته.
        app(FiscalCloseService::class)->close($yearId, null);

        $this->assertRivalBlocked('الإقفال لم يحجز المِرساة: عملية متزامنة مرّت أثناءه.');
    }

    /** @test */
    public function two_close_attempts_never_produce_two_active_generations(): void
    {
        $yearId = $this->rivalCreatesYear();
        app(FiscalCloseService::class)->close($yearId, null);

        // مهما تكرّرت المحاولات لا يبقى جيلان نشطان: الفحص والكتابة داخل
        // معاملة واحدة تحمل المِرساة.
        for ($i = 0; $i < 3; $i++) {
            try {
                app(FiscalCloseService::class)->close($yearId, null);
            } catch (RuntimeException) {
                // المتوقّع.
            }
        }

        $this->assertSame(1, FiscalYearClose::where('status', FiscalYearClose::STATUS_ACTIVE)->count());
        $this->assertSame(1, FiscalYearClose::count());
    }
}
