<?php

namespace Tests\Feature;

use App\Models\StorefrontPresentation;
use App\Services\Commerce\StaleDraftRevisionException;
use App\Services\Commerce\StorefrontPresentationService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PDO;
use Tests\TestCase;

/**
 * STORE-BACKEND-1 — قفل الصف يسلسل حفظين بنفس `draft_revision`.
 *
 * تشغيل (PostgreSQL فقط):
 *   DB_CONNECTION=pgsql php artisan test --filter=StorefrontPresentationPostgresConcurrencyTest
 */
class StorefrontPresentationPostgresConcurrencyTest extends TestCase
{
    use RefreshDatabase;

    private ?string $tenantId = null;

    private ?string $storefrontId = null;

    private ?PDO $fixtureConnection = null;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً لإثبات أقفال الصفوف.');
        }
        if (! function_exists('pcntl_fork')) {
            $this->markTestSkipped('امتداد pcntl غير متاح في هذه البيئة.');
        }
    }

    protected function tearDown(): void
    {
        $fixtureConnection = $this->fixtureConnection;
        $this->fixtureConnection = null;

        if ($fixtureConnection !== null && $fixtureConnection->inTransaction()) {
            $fixtureConnection->rollBack();
        }

        parent::tearDown();

        if ($fixtureConnection !== null && $this->tenantId !== null) {
            $fixtureConnection->prepare('DELETE FROM tenants WHERE id = ?')->execute([$this->tenantId]);
        }
    }

    /** @test */
    public function two_saves_with_the_same_revision_serialize_and_the_loser_gets_a_stale_revision(): void
    {
        $this->seedGraph();

        $lockReady = $this->signalPath('pres_lock_');
        $callerStarted = $this->signalPath('pres_caller_started_');
        $resultFile = tempnam(sys_get_temp_dir(), 'pres_result_');

        $locker = pcntl_fork();
        if ($locker === 0) {
            DB::connection()->reconnect();
            app(TenantContext::class)->set($this->tenantId);
            DB::beginTransaction();
            StorefrontPresentation::query()
                ->where('storefront_id', $this->storefrontId)
                ->orderBy('id')
                ->lockForUpdate()
                ->first();
            file_put_contents($lockReady, '1');
            $this->waitFor($callerStarted);
            usleep(200000);
            DB::commit();
            exit(0);
        }

        $this->waitFor($lockReady);

        $caller = pcntl_fork();
        if ($caller === 0) {
            DB::connection()->reconnect();
            app(TenantContext::class)->set($this->tenantId);
            file_put_contents($callerStarted, '1');
            try {
                $payload = app(StorefrontPresentationService::class)->saveDraftForCurrentTenant(
                    $this->storefrontId,
                    ['homepage' => ['heroHeadline' => 'المتسابق']],
                    1,
                );
                file_put_contents($resultFile, json_encode(['ok' => true, 'revision' => $payload['draft_revision']]));
            } catch (StaleDraftRevisionException $e) {
                file_put_contents($resultFile, json_encode(['ok' => false, 'stale' => true]));
            } catch (\Throwable $e) {
                file_put_contents($resultFile, json_encode(['ok' => false, 'error' => $e->getMessage()]));
            }
            exit(0);
        }

        pcntl_waitpid($locker, $status);
        pcntl_waitpid($caller, $status);

        $result = json_decode((string) file_get_contents($resultFile), true);
        $this->assertIsArray($result);

        app(TenantContext::class)->set($this->tenantId);
        $winnerSave = app(StorefrontPresentationService::class)->saveDraftForCurrentTenant(
            $this->storefrontId,
            ['homepage' => ['heroHeadline' => 'بعد القفل']],
            1,
        );

        if (($result['ok'] ?? false) === true) {
            $this->assertSame(2, $result['revision']);
            $this->assertSame(3, $winnerSave['draft_revision']);
        } else {
            $this->assertTrue($result['stale'] ?? false, json_encode($result));
            $this->assertSame(2, $winnerSave['draft_revision']);
            $this->assertSame('بعد القفل', $winnerSave['draft']['homepage']['heroHeadline']);
        }
        app(TenantContext::class)->forget();
    }

    private function seedGraph(): void
    {
        $this->fixtureConnection = $this->fixtureConnection();
        $this->fixtureConnection->beginTransaction();

        $this->tenantId = (string) Str::uuid();
        $channelId = (string) Str::uuid();
        $this->storefrontId = (string) Str::uuid();
        $now = now()->toDateTimeString();

        $this->fixtureConnection->prepare(
            'INSERT INTO tenants (id, name, slug, vat_number, currency, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([
            $this->tenantId,
            'Concurrency presentation',
            'pres-conc-'.substr(bin2hex(random_bytes(4)), 0, 8),
            '300000000000003',
            'SAR',
            true,
            $now,
            $now,
        ]);
        $this->fixtureConnection->prepare(
            'INSERT INTO sales_channels (id, tenant_id, slug, name, type, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([$channelId, $this->tenantId, 'web', 'ويب', 'web', true, $now, $now]);
        $this->fixtureConnection->prepare(
            'INSERT INTO storefronts (id, tenant_id, sales_channel_id, slug, name, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([$this->storefrontId, $this->tenantId, $channelId, 'main', 'متجر', true, $now, $now]);
        $this->fixtureConnection->prepare(
            'INSERT INTO storefront_presentations (storefront_id, schema_version, draft_config, draft_revision, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)'
        )->execute([
            $this->storefrontId,
            1,
            json_encode(['version' => 1, 'themePreset' => 'awj-modern'], JSON_THROW_ON_ERROR),
            1,
            $now,
            $now,
        ]);
        $this->fixtureConnection->commit();

        app(TenantContext::class)->set($this->tenantId);
        StorefrontPresentation::query()->where('storefront_id', $this->storefrontId)->firstOrFail();
        app(TenantContext::class)->forget();
    }

    private function fixtureConnection(): PDO
    {
        $config = config('database.connections.pgsql');

        return new PDO(
            sprintf('pgsql:host=%s;port=%s;dbname=%s', $config['host'], $config['port'], $config['database']),
            $config['username'],
            $config['password'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION],
        );
    }

    private function signalPath(string $prefix): string
    {
        return tempnam(sys_get_temp_dir(), $prefix);
    }

    private function waitFor(string $path): void
    {
        $tries = 0;
        while (! is_file($path) || filesize($path) === 0) {
            usleep(20000);
            $tries++;
            if ($tries > 250) {
                $this->fail('انتهت مهلة إشارة التزامن: '.$path);
            }
        }
    }
}
