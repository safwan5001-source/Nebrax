<?php

namespace Tests\Feature;

use App\Models\BuilderDraftExperience;
use App\Models\PreviewExchangeReference;
use App\Models\PreviewSession;
use App\Services\AppBuilder\PreviewExchangeService;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PDO;
use Tests\TestCase;

/**
 * MOBILE-PREVIEW-7 §8 — إثبات أن استهلاك مرجع التبادل متسلسلٌ حقاً على
 * PostgreSQL بموصلين متزامنين حقيقيين، لا افتراضاً منطقياً على موصلٍ واحد.
 * نفس بنية `AccountingPeriodLockConcurrencyTest` (ACC-6) حرفياً: موصل PDO
 * ثانٍ مستقلّ يحجز صفّ `preview_exchange_references` فعلاً بـ`FOR UPDATE`،
 * فيُرى أن `PreviewExchangeService::consume()` **ينتظر** فعلاً (`lock_timeout`
 * قصير يحوّل الانتظار إلى خطأ قابل للتأكيد)، ثم — بعد أن "يفوز" المنافس
 * ويُثبّت الاستهلاك ويُودع — يُثبَت أن محاولة استهلاكٍ ثانية حقيقية لا تُنشئ
 * جلسة معاينة ثانية أبداً، بل تُرفَض بالضبط كأي مرجعٍ مُستهلَكٍ آخر.
 *
 * يتخطّى نفسه على SQLite (لا أقفال صفوف حقيقية ولا موصلان متزامنان فيه).
 *
 * تشغيل: php artisan test --filter=PreviewExchangePostgresConcurrencyTest
 */
class PreviewExchangePostgresConcurrencyTest extends TestCase
{
    use RefreshDatabase;

    private ?PDO $rival = null;
    private string $tenantId = '';
    private string $appId = '';
    private string $referenceId = '';
    private string $plainReference = '';

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('إثبات التزامن بموصلين خاصٌّ بـPostgreSQL.');
        }

        $this->tenantId = (string) Str::uuid();
        $this->appId = (string) Str::uuid();
        $this->referenceId = (string) Str::uuid();
        $this->plainReference = Str::random(40);

        $rival = $this->rival();

        // كل هذه الصفوف **مودَعة فعلاً** (لا داخل معاملة RefreshDatabase التي
        // لا يراها الموصل الثاني إطلاقاً) — المِرساة المشتركة يجب أن تكون
        // مرئية لكلا الموصلين.
        $rival->prepare(
            'INSERT INTO tenants (id, name, slug, vat_number, currency, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, now(), now())'
        )->execute([$this->tenantId, 'مستأجر تبادل التزامن', 'mp7-conc-'.substr($this->tenantId, 0, 8), '300000000000003', 'SAR']);

        $rival->prepare(
            'INSERT INTO builder_apps (id, tenant_id, name, creation_source, created_at, updated_at)
             VALUES (?, ?, ?, ?, now(), now())'
        )->execute([$this->appId, $this->tenantId, 'تطبيق التزامن', 'scratch']);

        $schema = json_encode(BuilderDraftExperience::minimalSafeSchema());
        $rival->prepare(
            'INSERT INTO preview_exchange_references
                (id, tenant_id, builder_app_id, reference_hash, schema_snapshot, draft_revision, channel, expires_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, now(), now())'
        )->execute([
            $this->referenceId, $this->tenantId, $this->appId,
            hash('sha256', $this->plainReference), $schema, 0, 'device',
            now()->addMinutes(5)->toDateTimeString(),
        ]);
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

        parent::tearDown();

        if ($rival !== null) {
            try {
                $rival->prepare('DELETE FROM tenants WHERE id = ?')->execute([$tenantId]);
            } catch (\Throwable) {
                // القاعدة تُعاد تهيئتها بين التشغيلات على أي حال.
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
        $rival = $this->rival();
        $rival->exec('BEGIN');
        $statement = $rival->prepare('SELECT id FROM preview_exchange_references WHERE id = ? FOR UPDATE');
        $statement->execute([$this->referenceId]);
        $this->assertNotFalse($statement->fetch(), 'المنافس لم يحجز صفّ مرجع التبادل.');
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
    public function consuming_a_reference_waits_for_the_row_lock_held_by_another_connection(): void
    {
        $this->rivalHoldsAnchor();

        $this->assertBlockedByAnchor(
            fn () => app(PreviewExchangeService::class)->consume($this->plainReference),
            'الاستهلاك مرّ بلا انتظار: القفل غير فعّال.',
        );

        // لا جلسة جزئية بعد الفشل — المعاملة تراجعت كاملةً.
        $this->assertSame(0, PreviewSession::withoutGlobalScopes()->where('builder_app_id', $this->appId)->count());

        $this->rival()->exec('ROLLBACK');
        $result = app(PreviewExchangeService::class)->consume($this->plainReference);
        $this->assertNotNull($result, 'الاستهلاك فشل بعد تحرّر القفل رغم أن المرجع صالح.');
    }

    /** @test */
    public function a_concurrent_winning_exchange_leaves_no_room_for_a_second_session_from_the_same_reference(): void
    {
        // المنافس يحجز المِرساة ثم "يفوز" فعلياً: ينشئ جلسة معاينة حقيقية
        // خاصّته ويستهلك المرجع — تماماً وضعُ طلبٍ متزامن سبقنا وأنهى عمله
        // قبل أن يُودع.
        $rival = $this->rival();
        $rival->exec('BEGIN');
        $rival->prepare('SELECT id FROM preview_exchange_references WHERE id = ? FOR UPDATE')->execute([$this->referenceId]);

        $rivalSessionId = (string) Str::uuid();
        $schema = json_encode(BuilderDraftExperience::minimalSafeSchema());
        $rival->prepare(
            'INSERT INTO preview_sessions
                (id, tenant_id, builder_app_id, source, schema_snapshot, draft_revision, channel, expires_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, now(), now())'
        )->execute([$rivalSessionId, $this->tenantId, $this->appId, 'draft', $schema, 0, 'device', now()->addMinutes(15)->toDateTimeString()]);

        $rival->prepare(
            'UPDATE preview_exchange_references SET consumed_at = now(), preview_session_id = ? WHERE id = ?'
        )->execute([$rivalSessionId, $this->referenceId]);

        // بينما لا يزال المنافس داخل معاملته (لم يودع بعد)، محاولتنا يجب أن
        // تنتظر لا أن تسبقه أو تتجاهل ما فعله.
        $this->assertBlockedByAnchor(
            fn () => app(PreviewExchangeService::class)->consume($this->plainReference),
            'استهلاكنا مرّ رغم أن المنافس لا يزال داخل معاملته الفائزة.',
        );

        $rival->exec('COMMIT');

        // بعد إيداع الفائز: محاولة استهلاكٍ حقيقية جديدة تُرفَض — المرجع
        // مستهلَكٌ فعلاً، ولا تُمنَح جلسة ثانية مهما "انتظرت" منطقياً في الطابور.
        $result = app(PreviewExchangeService::class)->consume($this->plainReference);
        $this->assertNull($result, 'مرجعٌ مستهلَكٌ بالفعل من منافس مُنح جلسة ثانية.');

        $this->assertSame(
            1,
            PreviewSession::withoutGlobalScopes()->where('builder_app_id', $this->appId)->count(),
            'وُجدت أكثر من جلسة معاينة واحدة لمرجع تبادلٍ واحد — تبادل مزدوج نجح.',
        );
    }
}
