<?php

namespace Tests\Feature;

use App\Models\ImportDocumentReservation;
use App\Services\DocumentDuplicateReservationService as Svc;
use App\Support\DuplicateDocumentException;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use LogicException;
use Tests\TestCase;

/**
 * IMP-H5-S1a — الفهرس الفريد هو الحَكَم تحت **تزامن حقيقي** (PostgreSQL + `pcntl_fork`): عملياتٌ تحجز الهوية نفسها معاً ⇒ حجزٌ واحد فقط،
 * والخاسرون يتلقّون `DuplicateDocumentException` لا خطأ قاعدة. **لا يُتخطّى** إن غاب `pcntl` على PostgreSQL. ضابط سلبي: بلا الفهرس يمرّ أكثر من حجز.
 */
class DocumentDuplicateReservationConcurrencyPostgresTest extends TestCase
{
    use InteractsWithApi;
    use UsesWorkerDatabaseWithoutTransaction;

    private string $dir;

    /** @var list<string> */
    private array $tenants = [];

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'), 'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ.');

        $this->dir = sys_get_temp_dir().'/dup_reservation_race_'.uniqid();
        mkdir($this->dir);
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

    private function tenant(): string
    {
        $auth = $this->registerTenant('resv-'.substr(md5((string) microtime(true)), 0, 8), 'resv'.uniqid().'@pb.test');
        $this->tenants[] = $auth['tenant_id'];
        app(TenantContext::class)->set($auth['tenant_id']);

        return $auth['tenant_id'];
    }

    /** @return list<callable> */
    private function racers(string $tenant, int $n, array $predicate): array
    {
        $jobs = [];
        foreach (range(1, $n) as $i) {
            $jobs[] = function () use ($tenant, $predicate) {
                app(TenantContext::class)->set($tenant);
                $doc = (string) Str::uuid();
                // نافذة المعاملة عريضة عمداً ليتداخل المتسابقون فعلاً
                return DB::transaction(function () use ($predicate, $doc) {
                    app(Svc::class)->reserve(Svc::DOMAIN_EXPENSE, $predicate, 'expense', $doc, Svc::SOURCE_STANDARD);
                    usleep(50_000);

                    return $doc;
                });
            };
        }

        return $jobs;
    }

    /** @test */
    public function racing_reservations_of_the_same_identity_yield_exactly_one_winner(): void
    {
        $tenant = $this->tenant();
        $predicate = Svc::expensePredicate(null, 'Acme', 'INV-1', '2026-10-01', 12345);

        $results = $this->runConcurrently($this->racers($tenant, 6, $predicate));

        app(TenantContext::class)->set($tenant);
        $this->assertSame(1, ImportDocumentReservation::query()->count(), json_encode($results, JSON_UNESCAPED_UNICODE));
        $wins = array_values(array_filter($results, fn ($r) => ($r['ok'] ?? false) === true));
        $this->assertCount(1, $wins);
        $this->assertSame($wins[0]['value'], ImportDocumentReservation::query()->first()->document_id);
        foreach ($results as $r) {
            if (($r['ok'] ?? false) !== true) {
                $this->assertSame(DuplicateDocumentException::class, $r['error_class'] ?? null, 'الخاسر يتلقى استثناء المجال لا خطأ قاعدة: '.json_encode($r, JSON_UNESCAPED_UNICODE));
            }
        }
    }

    /** @test */
    public function racing_reservations_of_distinct_identities_all_succeed(): void
    {
        $tenant = $this->tenant();
        $jobs = [];
        foreach (range(1, 5) as $i) {
            $jobs = array_merge($jobs, $this->racers($tenant, 1, Svc::expensePredicate(null, 'Acme', "INV-{$i}", '2026-10-01', 100)));
        }

        $results = $this->runConcurrently($jobs);

        app(TenantContext::class)->set($tenant);
        $this->assertCount(5, array_filter($results, fn ($r) => ($r['ok'] ?? false) === true), json_encode($results, JSON_UNESCAPED_UNICODE));
        $this->assertSame(5, ImportDocumentReservation::query()->count());
    }

    /** @test */
    public function negative_control_without_the_unique_index_the_race_admits_several_reservations(): void
    {
        $tenant = $this->tenant();
        DB::statement('ALTER TABLE import_document_reservations DROP CONSTRAINT import_doc_reservation_unique');
        try {
            $results = $this->runConcurrently($this->racers($tenant, 4, Svc::expensePredicate(null, 'Acme', 'INV-NC', '2026-10-01', 1)));
            app(TenantContext::class)->set($tenant);
            $this->assertGreaterThan(1, ImportDocumentReservation::query()->count(), 'بلا الفهرس يجب أن يمرّ أكثر من حجز — وإلا فالاختبار أعلاه لا يثبت شيئاً: '.json_encode($results));
        } finally {
            DB::table('import_document_reservations')->where('tenant_id', $tenant)->delete();
            DB::statement('ALTER TABLE import_document_reservations ADD CONSTRAINT import_doc_reservation_unique UNIQUE (tenant_id, domain, dedupe_key)');
        }
    }

    /** @test */
    public function concurrent_rekeys_of_one_document_never_lose_an_edit(): void
    {
        $tenant = $this->tenant();
        $doc = (string) Str::uuid();
        DB::transaction(fn () => app(Svc::class)->reserve(Svc::DOMAIN_EXPENSE, Svc::expensePredicate(null, 'V', 'R0', '2026-10-01', 1), 'expense', $doc, Svc::SOURCE_STANDARD));

        $jobs = [];
        foreach (['R1', 'R2', 'R3', 'R4'] as $ref) {
            $jobs[] = function () use ($tenant, $doc, $ref) {
                app(TenantContext::class)->set($tenant);

                return DB::transaction(function () use ($doc, $ref) {
                    app(Svc::class)->rekey('expense', $doc, Svc::expensePredicate(null, 'V', $ref, '2026-10-01', 1));
                    usleep(30_000);

                    return $ref;
                });
            };
        }
        $results = $this->runConcurrently($jobs);

        app(TenantContext::class)->set($tenant);
        $this->assertSame(1, ImportDocumentReservation::query()->count(), json_encode($results));
        // الحجز الباقي هو إحدى الهويات المطلوبة فعلاً (لا R0 الأصلية): لا تعديلٌ ضاع بصمت.
        $this->assertContains(strtoupper((string) ImportDocumentReservation::query()->first()->predicate['reference']), ['R1', 'R2', 'R3', 'R4'], json_encode($results));
    }

    /** @test */
    public function it_refuses_to_run_outside_a_transaction(): void
    {
        $this->tenant();
        $this->assertSame(0, DB::transactionLevel());
        $svc = app(Svc::class);

        foreach ([
            fn () => $svc->reserve(Svc::DOMAIN_EXPENSE, [], 'expense', (string) Str::uuid(), Svc::SOURCE_STANDARD),
            fn () => $svc->release('expense', (string) Str::uuid()),
            fn () => $svc->rekey('expense', (string) Str::uuid(), []),
        ] as $op) {
            try {
                $op();
                $this->fail('كان يجب أن يُرمى LogicException خارج المعاملة.');
            } catch (LogicException $e) {
                $this->assertStringContainsString('معاملة', $e->getMessage());
            }
        }
    }

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
                DB::connection()->getPdo();
                $deadline = microtime(true) + 10.0;
                while (! file_exists($barrier) && microtime(true) < $deadline) {
                    usleep(500);
                }
                try {
                    file_put_contents($resultFiles[$i], json_encode(['ok' => true, 'value' => $job()]));
                } catch (\Throwable $e) {
                    file_put_contents($resultFiles[$i], json_encode(['ok' => false, 'error_class' => get_class($e), 'message' => $e->getMessage()]));
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
