<?php

namespace Tests\Feature;

use App\Services\Accounting\LedgerService;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PDO;
use Tests\TestCase;

/**
 * CUR-1 — إثبات سباق «تغيير العملة ↔ ترحيل قيد» على PostgreSQL بموصلين متزامنين حقيقيين.
 *
 * الحجّة: كل ترحيل/عكس قيد يقفل صفّ المستأجر (`FOR UPDATE`) قبل إنشاء القيد (`AccountingDateGuard::assertOpen`)، و`PUT /company`
 * يقفل **الصفّ نفسه** قبل فحص القيود. فالتسلسل على مِرساة واحدة موجودة أصلاً — لا قفل جديد. يُثبت هنا بموصل PDO ثانٍ يحجز
 * المِرساة فعلاً (يُرى الانتظار بـ`lock_timeout` قصير) في الترتيبين الممكنين:
 *   ١) ترحيل قيدٍ سابق وغير مودَع ⇒ التغيير ينتظر، وبعد الإيداع يُرفض (لا يمرّ بين الفحص والإيداع).
 *   ٢) تغيير في الطريق ⇒ الترحيل ينتظر (ولا قيود سابقة، فالتغيير مشروع).
 *
 * المنافس يُنشئ صفّ المستأجر ويودعه (RefreshDatabase تلفّ الاختبار في معاملة لا يراها موصلٌ آخر) ثم يحذفه في التنظيف.
 * الاستدعاء عبر مسار HTTP الحقيقي بلا وسطاء (`withoutMiddleware`) والسياق يُضبط يدوياً — الصلاحيات تغطّيها
 * `CompanyCurrencyProtectionTest`. يتخطّى نفسه على SQLite (لا أقفال صفوف فيه).
 *
 * تشغيل: php artisan test --filter=CompanyCurrencyProtectionPostgresTest
 */
class CompanyCurrencyProtectionPostgresTest extends TestCase
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

        $this->tenantId = (string) Str::uuid();
        $this->rival()->prepare(
            'INSERT INTO tenants (id, name, slug, vat_number, currency, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, now(), now())'
        )->execute([$this->tenantId, 'مستأجر التزامن', 'cur1-conc-'.substr($this->tenantId, 0, 8), '300000000000003', 'SAR']);

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

        // الترتيب حاسم: معاملة RefreshDatabase تُتراجَع أولاً وإلا انتظر الحذف قفلها.
        parent::tearDown();

        if ($rival !== null) {
            try {
                $rival->prepare('DELETE FROM tenants WHERE id = ?')->execute([$tenantId]); // CASCADE ينظّف القيود
            } catch (\Throwable) {
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

    private function rivalHoldsAnchor(): void
    {
        $this->rival()->exec('BEGIN');
        $st = $this->rival()->prepare('SELECT id FROM tenants WHERE id = ? FOR UPDATE');
        $st->execute([$this->tenantId]);
        $this->assertNotFalse($st->fetch(), 'المنافس لم يحجز صفّ المستأجر.');
    }

    private function rivalInsertsPostedEntry(): void
    {
        $this->rival()->prepare(
            "INSERT INTO journal_entries (id, tenant_id, number, entry_date, status, posted_at, created_at, updated_at)
             VALUES (?, ?, 'JE-CUR1-RACE', '2026-01-01', 'posted', now(), now(), now())"
        )->execute([(string) Str::uuid(), $this->tenantId]);
    }

    private function currency(): string
    {
        return (string) $this->rival()->query("SELECT currency FROM tenants WHERE id = '{$this->tenantId}'")->fetchColumn();
    }

    private function change(string $currency)
    {
        // بلا وسطاء: السياق مضبوط يدوياً؛ الاستثناءات تُرمى لا تُحوَّل إلى 500 كي يُقرأ خطأ مهلة القفل.
        return $this->withoutMiddleware()->putJson('/api/company', ['name' => 'شركة التزامن', 'currency' => $currency, 'city' => 'الخبر']);
    }

    private function assertBlocked(callable $attempt, string $failure): void
    {
        DB::statement("SET lock_timeout = '600ms'");
        try {
            $attempt();
            $this->fail($failure);
        } catch (QueryException $e) {
            $this->assertStringContainsString('lock timeout', strtolower($e->getMessage()));
        } finally {
            DB::statement('RESET lock_timeout');
        }
    }

    /** @test */
    public function the_currency_update_waits_for_the_tenant_anchor_and_writes_nothing_while_blocked(): void
    {
        $this->rivalHoldsAnchor();

        $this->withoutExceptionHandling();
        $this->assertBlocked(fn () => $this->change('USD'), 'تغيير العملة مرّ بلا انتظار: لا يقفل المِرساة.');

        $this->assertSame('SAR', $this->currency(), 'لا كتابة أثناء الانتظار/بعد مهلة القفل');

        // بعد تحرير المنافس يمرّ التغيير طبيعياً (لا قيود).
        $this->rival()->exec('ROLLBACK');
        $this->withExceptionHandling();
        $this->change('USD')->assertOk();
        // التحديث تمّ داخل معاملة الاختبار (غير مودَعة) فيُقرأ من الموصل نفسه لا من المنافس.
        $this->assertSame('USD', (string) DB::table('tenants')->where('id', $this->tenantId)->value('currency'));
    }

    /** @test */
    public function a_posting_in_flight_wins_the_race_the_change_is_rejected_after_it_commits(): void
    {
        // منافس: يحجز المِرساة (كما يفعل LedgerService) ويُدرج قيداً مرحّلاً **غير مودَع** بعد.
        $this->rivalHoldsAnchor();
        $this->rivalInsertsPostedEntry();

        $this->withoutExceptionHandling();
        $this->assertBlocked(fn () => $this->change('USD'), 'التغيير مرّ رغم ترحيلٍ متزامن قيد الإيداع.');
        $this->assertSame('SAR', $this->currency());

        $this->rival()->exec('COMMIT');

        // بعد الإيداع يرى التغيير القيد ويُرفض بسبب القفل لا بالمهلة، ولا حفظ جزئي.
        $this->withExceptionHandling();
        $this->change('USD')
            ->assertStatus(422)->assertJsonPath('reason', 'company_currency_locked');
        $this->assertSame('SAR', $this->currency());
        $this->assertSame(0, (int) DB::table('tenants')->where('id', $this->tenantId)->whereRaw("settings::text LIKE '%الخبر%'")->count(), 'city لم يُحفظ');
    }

    /** @test */
    public function ledger_posting_waits_on_the_same_anchor_so_it_cannot_slip_past_a_change_in_flight(): void
    {
        $this->rivalHoldsAnchor(); // يمثّل تغييراً جارياً يحمل المِرساة

        $this->assertBlocked(
            fn () => DB::transaction(fn () => app(LedgerService::class)->post([
                ['account_id' => (string) Str::uuid(), 'debit' => 100, 'credit' => 0],
                ['account_id' => (string) Str::uuid(), 'debit' => 0, 'credit' => 100],
            ], ['entry_date' => '2026-01-01'])),
            'الترحيل لم ينتظر مِرساة المستأجر: السباق غير محكوم.',
        );
    }
}
