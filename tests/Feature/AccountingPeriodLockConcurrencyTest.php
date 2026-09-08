<?php

namespace Tests\Feature;

use App\Models\AccountingPeriodLock;
use App\Services\Accounting\AccountingDateGuard;
use App\Services\Accounting\AccountingPeriodLockService;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PDO;
use RuntimeException;
use Tests\TestCase;

/**
 * ACC-6 — إثبات التسلسل على PostgreSQL بموصلين متزامنين حقيقيين.
 *
 * لا يكفي أن ينجح المنطق على موصلٍ واحد: العقد يقول إن «افحص ثم أدرج» يجب
 * ألّا يكون عرضةً للسباق، وأن الترحيل وإدارة الأقفال يتبادلان الاستبعاد على
 * مِرساة قاعدة بيانات على مستوى المستأجر — لا mutex في ذاكرة العملية. يُثبت
 * هنا بموصل PDO ثانٍ مستقلّ يحجز المِرساة فعلاً، فيُرى أن الموصل الأول
 * **ينتظر** لا أن يمرّ. مهلة `lock_timeout` قصيرة تحوّل الانتظار إلى خطأ
 * قابل للتأكيد بدل تعليق الاختبار.
 *
 * ═══ لماذا يُنشئ المنافس صفّ المستأجر؟ ═══
 * `RefreshDatabase` تلفّ الاختبار في معاملة، فما تكتبه Laravel غير مرئيّ
 * للموصل الثاني إطلاقاً. فالمِرساة المشتركة يجب أن تكون صفّاً **مودَعاً**،
 * ولذلك يُنشئه المنافس ويُودعه ثم يُحذف في التنظيف. (البديل `DatabaseMigrations`
 * مرفوض هنا: مسار تراجعه يسقط على خللٍ قائمٍ في هجرةٍ لا صلة لها بـACC-6.)
 *
 * يتخطّى نفسه على SQLite: لا أقفال صفوف فيه ولا موصلان متزامنان — محرّكه
 * أحادي الكاتب أصلاً، وهو محرّك الاختبار لا الإنتاج. الفرق موثَّق في التقرير.
 *
 * تشغيل: php artisan test --filter=AccountingPeriodLockConcurrencyTest
 */
class AccountingPeriodLockConcurrencyTest extends TestCase
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

        // صفّ مستأجر **مودَع** من الموصل الثاني: هو المِرساة التي يتنازع عليها
        // الطرفان، ولا بدّ أن يراها كلاهما.
        $this->tenantId = (string) Str::uuid();
        $this->rival()->prepare(
            'INSERT INTO tenants (id, name, slug, vat_number, currency, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, now(), now())'
        )->execute([$this->tenantId, 'مستأجر التزامن', 'acc6-conc-' . substr($this->tenantId, 0, 8), '300000000000003', 'SAR']);

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
                // لا معاملة مفتوحة — لا شيء يُتراجع عنه.
            }
        }

        // **الترتيب حاسم:** معاملة `RefreshDatabase` تُتراجَع داخل
        // `parent::tearDown()`، وهي تحمل قفلاً على صفّ المستأجر. حذفُه من
        // المنافس قبلها ينتظر إلى الأبد.
        parent::tearDown();

        if ($rival !== null) {
            try {
                // الحذف بأثرٍ تتالٍ ينظّف أقفال هذا المستأجر وأحداثها معاً.
                $rival->prepare('DELETE FROM tenants WHERE id = ?')->execute([$tenantId]);
            } catch (\Throwable) {
                // القاعدة تُعاد تهيئتها بين التشغيلات على أي حال.
            }
        }
    }

    /** موصل ثانٍ حقيقي إلى القاعدة نفسها — منافسٌ مستقلّ لا نسخةٌ من الأول. */
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

    private function rivalHoldsAnchor(): void
    {
        $rival = $this->rival();
        $rival->exec('BEGIN');
        $statement = $rival->prepare('SELECT id FROM tenants WHERE id = ? FOR UPDATE');
        $statement->execute([$this->tenantId]);
        $this->assertNotFalse($statement->fetch(), 'المنافس لم يحجز صفّ المستأجر.');
    }

    private function assertBlockedByAnchor(callable $attempt, string $failureMessage): void
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

    /** @test */
    public function creating_a_lock_waits_for_the_tenant_anchor_held_by_another_connection(): void
    {
        $this->rivalHoldsAnchor();

        $this->assertBlockedByAnchor(
            fn () => app(AccountingPeriodLockService::class)->create('2026-01-01', '2026-01-31', 'إقفال يناير', null),
            'إنشاء القفل مرّ بلا انتظار: المِرساة غير فعّالة.',
        );

        // لا صفّ جزئي بعد الفشل: المعاملة تراجعت كاملةً.
        $this->assertSame(0, AccountingPeriodLock::count());

        // وبعد تحرير المنافس للمِرساة يمرّ الإنشاء طبيعياً.
        $this->rival()->exec('ROLLBACK');
        $created = app(AccountingPeriodLockService::class)->create('2026-01-01', '2026-01-31', 'إقفال يناير', null);
        $this->assertSame('active', $created['status']);
    }

    /** @test */
    public function the_ledger_guard_waits_on_the_same_anchor_so_a_posting_cannot_slip_past_a_landing_lock(): void
    {
        $this->rivalHoldsAnchor();

        // الحارس يقفل المِرساة **قبل** قراءة الأقفال، فلا يمكن أن يمرّ فحصٌ
        // بينما يُثبَّت قفلٌ متزامن: القراءة نفسها تنتظر تحرّر الصفّ.
        // داخل معاملة كما يعمل فعلاً في `LedgerService` — فيتراجع الفشل إلى
        // نقطة حفظٍ بدل أن يُجهض معاملة الاختبار الخارجية.
        $this->assertBlockedByAnchor(
            fn () => DB::transaction(fn () => app(AccountingDateGuard::class)->activeLockFor('2026-01-15')),
            'الحارس قرأ الأقفال بلا انتظار: المِرساة غير مشتركة بين المسارين.',
        );

        $this->rival()->exec('ROLLBACK');
        $this->assertNull(DB::transaction(fn () => app(AccountingDateGuard::class)->activeLockFor('2026-01-15')));
    }

    /** @test */
    public function a_concurrent_overlapping_lock_is_rejected_after_the_rival_commits_never_admitted_twice(): void
    {
        // المنافس يحجز المِرساة ويُدرج قفلاً نشطاً بلا إيداع — تماماً وضعُ
        // طلبٍ متزامن سبقنا وما زال داخل معاملته.
        $rival = $this->rival();
        $rival->exec('BEGIN');
        $rival->prepare('SELECT id FROM tenants WHERE id = ? FOR UPDATE')->execute([$this->tenantId]);
        $rival->prepare(
            'INSERT INTO accounting_period_locks (id, tenant_id, start_date, end_date, status, reason, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, now(), now())'
        )->execute([(string) Str::uuid(), $this->tenantId, '2026-01-01', '2026-01-31', 'active', 'منافس']);

        $this->assertBlockedByAnchor(
            fn () => app(AccountingPeriodLockService::class)->create('2026-01-10', '2026-02-10', 'نطاق متداخل', null),
            'المحاولة المتداخلة مرّت رغم قفلٍ متزامن قيد الإيداع.',
        );

        $rival->exec('COMMIT');

        // بعد الإيداع تُرفض المحاولة **بالتداخل** لا بالمهلة، ولا يبقى نطاقان نشطان.
        try {
            app(AccountingPeriodLockService::class)->create('2026-01-10', '2026-02-10', 'نطاق متداخل', null);
            $this->fail('المحاولة المتداخلة قُبلت بعد إيداع المنافس.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('يتداخل', $e->getMessage());
        }

        $this->assertSame(1, AccountingPeriodLock::where('status', 'active')->count());
    }
}
