<?php

namespace Tests\Feature;

use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Services\Accounting\ZatcaRolloutControlService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  REM-18b-3b — سياج F2 للإشعار الدائن تحت تزامن حقيقي (PostgreSQL + عمليات `pcntl_fork`)
 * ═══════════════════════════════════════════════════════════════
 *  1) إصدارات إشعارات وفواتير متزامنة بأسلوب المخصِّص (مِرساة ← رأس ← مدخل ← تحديث) ⇒ ICV متصل بلا فجوة، كل إشعار صادر
 *     يطابق مدخله، ولا جمود (40P01).
 *  2) ترحيلات متزامنة: مستأجر مفعَّل ⇒ يرفضها السياج كلها بلا جمود ولا أثر؛ مستأجر معطَّل ⇒ تنجح كلها (السلوك القديم).
 *  3) تفعيل يتزامن مع ترحيل يحمل مِرساة المستأجر: التفعيل يصطفّ خلفه فيرى الترحيلُ حالة واحدة (معطَّلة)، وما بعده يُرفض.
 *  4) موت مفاجئ (SIGKILL) بعد إدراج المدخل وقبل التثبيت ⇒ لا مدخل ولا تغيّر في الإشعار ولا تقدّم للرأس.
 *  5) حدّ اتساق الإيقاف الطارئ: الحالة الفعّالة = **آخر حالة مثبَّتة وقت عبارة الترحيل** (READ COMMITTED)؛ إيقاف غير مثبَّت لا يراه الترحيل ولا يحجبه،
 *     وبعد تثبيته يمرّ الترحيل القديم، وبعد رفعه يعود السياج؛ والقرار الصريح مقبول في كل الحالات.
 *
 *  على PostgreSQL **لا يُتخطّى** هذا الصنف إن غاب `pcntl`: يفشل. يُتخطّى على SQLite فقط (لا أقفال صفوف).
 *  يعمل على قاعدة العامل بلا معاملة مُغلِّفة (`UsesWorkerDatabaseWithoutTransaction`) لأن العمليات الفرعية تحتاج صفوفاً مثبَّتة، وصف المنصة عالميّ فلا يُشارَك مع عمّال آخرين؛ ينظّفها `tearDown` بحذف المستأجرين.
 */
class ZatcaCreditNoteFencePostgresTest extends TestCase
{
    use UsesWorkerDatabaseWithoutTransaction;

    private string $dir;

    /** @var list<string> */
    private array $tenants = [];

    /** @var list<string> */
    private array $admins = [];

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على أقفال الصفوف.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'),
            'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ (REM-18b-3b).');

        $this->dir = sys_get_temp_dir().'/zatca_f2_'.uniqid();
        mkdir($this->dir);
        $this->clearPlatformRows(); // لا بقايا من تشغيل سابق منقطع
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
            // حذف المستأجر المتسلسل يزيل إشعاراته ومداخله وضوابطه (الحراس تسمح به بعد زوال صفه).
            foreach ($this->tenants as $id) {
                DB::table('tenants')->where('id', $id)->delete();
            }
            $this->clearPlatformRows();
            foreach ($this->admins as $id) {
                DB::table('platform_administrators')->where('id', $id)->delete();
            }
        }

        parent::tearDown();
    }

    /** @test */
    public function concurrent_note_and_invoice_issuances_share_one_contiguous_chain_without_deadlock(): void
    {
        $tenant = $this->makeTenant();
        $notes = array_map(fn () => $this->makeNote($tenant), range(1, 6));

        $jobs = [];
        foreach ($notes as $i => $note) {
            $jobs[] = fn () => $this->issueNote($tenant, $note);
            $jobs[] = fn () => $this->issueInvoiceEntry($tenant, $this->makeInvoice($tenant));
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllOk($results);
        $icvs = DB::table('zatca_chain_entries')->where('tenant_id', $tenant)->orderBy('icv')->pluck('icv')->map(fn ($v) => (int) $v)->all();
        $this->assertSame(range(1, 12), $icvs, 'ICV متصل بلا فجوة أو تكرار');
        $this->assertSame(12, (int) DB::table('zatca_chains')->where('tenant_id', $tenant)->value('last_icv'));
        foreach ($notes as $note) {
            $row = DB::table('credit_notes')->where('id', $note)->first();
            $this->assertSame('generated', $row->zatca_status);
            $entry = DB::table('zatca_chain_entries')->where('credit_note_id', $note)->sole();
            $this->assertSame((int) $entry->icv, (int) $row->zatca_icv);
            $this->assertSame($entry->hash, $row->zatca_hash);
            $this->assertSame($entry->previous_hash, $row->zatca_previous_hash);
            $this->assertSame($entry->zatca_uuid, $row->zatca_uuid);
        }
    }

    /** @test */
    public function concurrent_postings_are_all_rejected_for_an_activated_tenant_and_all_succeed_for_a_disabled_one(): void
    {
        $activated = $this->makeTenant();
        $plain = $this->makeTenant();
        $this->enable($activated);
        $activatedNotes = array_map(fn () => $this->makeNote($activated), range(1, 4));
        $plainNotes = array_map(fn () => $this->makeNote($plain), range(1, 4));

        $jobs = [];
        foreach ($activatedNotes as $note) {
            $jobs[] = fn () => $this->postWithoutDecision($note);
        }
        foreach ($plainNotes as $note) {
            $jobs[] = fn () => $this->postWithoutDecision($note);
        }
        $results = $this->runConcurrently($jobs);

        foreach ($results as $i => $result) {
            $this->assertFalse($this->isDeadlock($result), "جمود في العملية {$i}");
            $this->assertArrayHasKey('ok', $result);
        }
        foreach (range(0, 3) as $i) {
            $this->assertFalse($results[$i]['ok'], "مفعَّل: العملية {$i} يجب أن تُرفض");
            $this->assertStringContainsString('explicit ZATCA issuance decision', (string) $results[$i]['message']);
        }
        foreach (range(4, 7) as $i) {
            $this->assertTrue($results[$i]['ok'], "معطَّل: العملية {$i}: ".($results[$i]['message'] ?? ''));
        }
        $this->assertSame(0, DB::table('credit_notes')->whereIn('id', $activatedNotes)->where('status', 'posted')->count());
        $this->assertSame(4, DB::table('credit_notes')->whereIn('id', $plainNotes)->where('status', 'posted')->count());
    }

    /** @test */
    public function an_activation_queues_behind_a_posting_that_holds_the_tenant_anchor_and_later_postings_are_rejected(): void
    {
        $tenant = $this->makeTenant();
        [$first, $second] = [$this->makeNote($tenant), $this->makeNote($tenant)];
        $admin = $this->makeAdmin();
        $dir = $this->dir;

        $results = $this->runConcurrently([
            // «ترحيل»: يقفل المِرساة (كـLedgerService) ثم يرحّل بعد حجز طويل — التفعيل المنتظر خلفه لم يسرِ بعد.
            function () use ($tenant, $first, $dir) {
                return DB::transaction(function () use ($tenant, $first, $dir) {
                    Tenant::query()->whereKey($tenant)->lockForUpdate()->first();
                    touch($dir.'/anchor_locked');
                    usleep(2_000_000);
                    DB::table('credit_notes')->where('id', $first)->update(['status' => 'posted']);

                    return ['posted' => true];
                });
            },
            function () use ($tenant, $admin, $dir) {
                $this->waitFor($dir.'/anchor_locked');
                $start = microtime(true);
                $change = app(ZatcaRolloutControlService::class)->setTenantState(PlatformAdministrator::findOrFail($admin), $tenant, true, 'تفعيل خلف قفل المِرساة');

                return ['changed' => $change->changed, 'waited_ms' => (int) ((microtime(true) - $start) * 1000)];
            },
        ]);

        $this->assertAllOk($results);
        $this->assertTrue($results[1]['value']['changed']);
        $this->assertGreaterThanOrEqual(1000, $results[1]['value']['waited_ms'], 'التفعيل اصطفّ خلف قفل المِرساة');
        $this->assertSame('posted', DB::table('credit_notes')->where('id', $first)->value('status'), 'الترحيل سبق التفعيل في الترتيب (سلوك قديم)');

        // بعد سريان التفعيل: يفشل الترحيل بلا قرار مغلقاً، ويمرّ مع قرار صريح.
        $rejected = $this->runConcurrently([fn () => $this->postWithoutDecision($second)]);
        $this->assertFalse($rejected[0]['ok']);
        $this->assertSame('draft', DB::table('credit_notes')->where('id', $second)->value('status'));
        $accepted = $this->runConcurrently([function () use ($second) {
            DB::table('credit_notes')->where('id', $second)->update(['status' => 'posted', 'zatca_status' => 'not_generated', 'zatca_skip_reason' => 'payment_means_unresolved']);

            return true;
        }]);
        $this->assertAllOk($accepted);
        $this->assertSame('posted', DB::table('credit_notes')->where('id', $second)->value('status'));
    }

    /** @test */
    public function a_process_killed_after_the_entry_insert_leaves_no_entry_no_note_change_and_no_head_advance(): void
    {
        $tenant = $this->makeTenant();
        $note = $this->makeNote($tenant);
        $dir = $this->dir;

        $pid = pcntl_fork();
        $this->assertNotSame(-1, $pid, 'pcntl_fork');
        if ($pid === 0) {
            DB::purge(config('database.default'));
            try {
                DB::transaction(function () use ($tenant, $note, $dir) {
                    $chain = $this->chain($tenant);
                    $this->insertNoteEntry($tenant, $chain, $note, 1);
                    touch($dir.'/entry_inserted');
                    sleep(30); // يُقتل قبل تحديث الإشعار والتثبيت
                });
            } catch (\Throwable) {
            }
            exit(0);
        }

        $this->waitFor($dir.'/entry_inserted', 15.0);
        posix_kill($pid, SIGKILL);
        pcntl_waitpid($pid, $status);

        $this->assertSame(0, DB::table('zatca_chain_entries')->where('tenant_id', $tenant)->count());
        $this->assertSame(0, (int) DB::table('zatca_chains')->where('tenant_id', $tenant)->value('last_icv'));
        $this->assertNull(DB::table('credit_notes')->where('id', $note)->value('zatca_status'));

        // ولا يعلق شيء خلفه: الإصدار التالي ينجح بـICV 1.
        $result = $this->runConcurrently([fn () => $this->issueNote($tenant, $note)]);
        $this->assertAllOk($result);
        $this->assertSame(1, (int) DB::table('credit_notes')->where('id', $note)->value('zatca_icv'));
    }

    /** @test */
    public function a_failed_note_update_rolls_back_its_entry_and_the_head_in_the_same_transaction(): void
    {
        $tenant = $this->makeTenant();
        $note = $this->makeNote($tenant);

        $result = $this->runConcurrently([function () use ($tenant, $note) {
            return DB::transaction(function () use ($tenant, $note) {
                $chain = $this->chain($tenant);
                $this->insertNoteEntry($tenant, $chain, $note, 1);
                // قيمة لا تطابق المدخل ⇒ يرفضها F2 فتتراجع المعاملة كلها (المدخل والرأس).
                DB::table('credit_notes')->where('id', $note)->update($this->generatedColumns(1, 'x', (string) Str::uuid(), 'y'));
            });
        }]);

        $this->assertFalse($result[0]['ok']);
        $this->assertStringContainsString('without a matching shared-chain entry', (string) $result[0]['message']);
        $this->assertSame(0, DB::table('zatca_chain_entries')->where('tenant_id', $tenant)->count());
        $this->assertSame(0, (int) DB::table('zatca_chains')->where('tenant_id', $tenant)->value('last_icv'));
        $this->assertNull(DB::table('credit_notes')->where('id', $note)->value('zatca_status'));
    }

    /** @test */
    public function the_emergency_stop_boundary_is_the_committed_state_at_the_posting_statement(): void
    {
        // REM-18b-3d (السياسة B): الحدّ ما زال «آخر حالة مثبَّتة وقت عبارة الترحيل»، لكن بعد التثبيت يُرفض كل ترحيل (لا الترحيل القديم).
        $tenant = $this->makeTenant();
        [$beforeCommit, $afterCommit, $withDecision, $afterLift] = array_map(fn () => $this->makeNote($tenant), range(1, 4));
        $admin = $this->makeAdmin();
        $this->enable($tenant);
        $dir = $this->dir;

        $results = $this->runConcurrently([
            // إيقاف طارئ داخل معاملة طويلة: لا يُثبَّت إلا بعد ثانيتين ونصف.
            function () use ($admin, $dir) {
                return DB::transaction(function () use ($admin, $dir) {
                    app(ZatcaRolloutControlService::class)->setPlatformState(PlatformAdministrator::findOrFail($admin), false, 'إيقاف طارئ للاختبار');
                    touch($dir.'/stop_written');
                    usleep(2_500_000);

                    return true;
                });
            },
            // ترحيل أثناء الإيقاف غير المثبَّت: لا يراه ولا يُحجب به، فيُرفض بقاعدة القرار الصريح (3b) لا بقاعدة الإيقاف.
            function () use ($beforeCommit, $dir) {
                $this->waitFor($dir.'/stop_written');
                usleep(400_000);
                $start = microtime(true);
                try {
                    DB::table('credit_notes')->where('id', $beforeCommit)->update(['status' => 'posted']);
                    $reason = 'accepted';
                } catch (\Illuminate\Database\QueryException $e) {
                    $reason = str_contains($e->getMessage(), 'explicit ZATCA issuance decision') ? 'decision_rule'
                        : (str_contains($e->getMessage(), 'blocked while the platform emergency stop') ? 'stop_rule' : 'other');
                }

                return ['reason' => $reason, 'took_ms' => (int) ((microtime(true) - $start) * 1000)];
            },
        ]);

        $this->assertAllOk($results);
        $this->assertSame('decision_rule', $results[1]['value']['reason'], 'الإيقاف غير المثبَّت غير مرئي: تسري قاعدة القرار الصريح وحدها');
        $this->assertLessThan(1500, $results[1]['value']['took_ms'], 'الترحيل لا ينتظر كاتب الإيقاف (قراءة بلا قفل)');
        $this->assertSame('draft', DB::table('credit_notes')->where('id', $beforeCommit)->value('status'));

        // بعد التثبيت: كل ترحيل لمستأجر مفعَّل مرفوض بقاعدة الإيقاف — بلا قرار وبقرار صريح (حتى generated كامل بمدخله).
        $this->assertStopBlocks(fn () => DB::table('credit_notes')->where('id', $afterCommit)->update(['status' => 'posted']));
        $this->assertStopBlocks(fn () => DB::table('credit_notes')->where('id', $withDecision)->update(['status' => 'posted', 'zatca_status' => 'not_generated', 'zatca_skip_reason' => 'payment_means_unresolved']));
        $this->assertStopBlocks(fn () => DB::transaction(fn () => $this->issueNote($tenant, $withDecision)));
        $this->assertSame(0, DB::table('zatca_chain_entries')->where('tenant_id', $tenant)->count(), 'لا مدخل متبقٍّ بعد الرفض');

        // وبعد رفعه تعود قاعدة 3b: القرار الصريح مقبول.
        app(ZatcaRolloutControlService::class)->setPlatformState(PlatformAdministrator::findOrFail($admin), true, 'رفع الإيقاف');
        DB::table('credit_notes')->where('id', $afterLift)->update(['status' => 'posted', 'zatca_status' => 'not_generated', 'zatca_skip_reason' => 'payment_means_unresolved']);
        $this->assertSame('posted', DB::table('credit_notes')->where('id', $afterLift)->value('status'));
    }

    private function assertStopBlocks(callable $operation): void
    {
        try {
            DB::transaction($operation);
        } catch (\Illuminate\Database\QueryException $e) {
            $this->assertStringContainsString('blocked while the platform emergency stop', $e->getMessage());

            return;
        }
        $this->fail('the posting must be blocked while the platform emergency stop is in force');
    }

    // ───────────────────────── مساعدات ─────────────────────────

    /** يحاكي المخصِّص: مِرساة المستأجر ← رأس السلسلة ← المدخل ← تحديث الإشعار. */
    private function issueNote(string $tenant, string $note): array
    {
        return DB::transaction(function () use ($tenant, $note) {
            Tenant::query()->whereKey($tenant)->lockForUpdate()->first();
            $chain = $this->chain($tenant, true);
            $icv = (int) DB::table('zatca_chains')->where('id', $chain)->value('last_icv') + 1;
            $entry = $this->insertNoteEntry($tenant, $chain, $note, $icv);
            DB::table('credit_notes')->where('id', $note)->update($this->generatedColumns($icv, $entry['previous_hash'], $entry['zatca_uuid'], $entry['hash']));

            return ['icv' => $icv];
        });
    }

    private function issueInvoiceEntry(string $tenant, string $invoice): array
    {
        return DB::transaction(function () use ($tenant, $invoice) {
            Tenant::query()->whereKey($tenant)->lockForUpdate()->first();
            $chain = $this->chain($tenant, true);
            $icv = (int) DB::table('zatca_chains')->where('id', $chain)->value('last_icv') + 1;
            DB::table('zatca_chain_entries')->insert([
                'id' => (string) Str::uuid(), 'tenant_id' => $tenant, 'chain_id' => $chain, 'icv' => $icv, 'document_type' => 'invoice',
                'invoice_id' => $invoice, 'credit_note_id' => null, 'type_code' => '388', 'subtype' => 'standard',
                'zatca_uuid' => (string) Str::uuid(), 'previous_hash' => base64_encode(hash('sha256', "p{$icv}")),
                'hash' => base64_encode(hash('sha256', "h{$icv}")), 'signed' => false, 'issued_at' => '2026-02-10 08:15:30', 'created_at' => now(),
            ]);

            return ['icv' => $icv];
        });
    }

    /** @return array{previous_hash: string, hash: string, zatca_uuid: string} */
    private function insertNoteEntry(string $tenant, string $chain, string $note, int $icv): array
    {
        $entry = [
            'zatca_uuid' => (string) Str::uuid(),
            'previous_hash' => base64_encode(hash('sha256', "p{$icv}")), 'hash' => base64_encode(hash('sha256', "h{$icv}")),
        ];
        DB::table('zatca_chain_entries')->insert($entry + [
            'id' => (string) Str::uuid(), 'tenant_id' => $tenant, 'chain_id' => $chain, 'icv' => $icv, 'document_type' => 'credit_note',
            'invoice_id' => null, 'credit_note_id' => $note, 'type_code' => '381', 'subtype' => 'standard', 'signed' => false,
            'issued_at' => '2026-02-10 08:15:30', 'created_at' => now(),
        ]);

        return $entry;
    }

    /** @return array<string, mixed> */
    private function generatedColumns(int $icv, string $previousHash, string $uuid, string $hash): array
    {
        return [
            'status' => 'posted', 'zatca_status' => 'generated', 'zatca_document_type' => 'standard', 'zatca_reason_code' => 'goods_or_services_refund',
            'issued_at' => '2026-02-10 08:15:30', 'party_snapshot' => '{"v":1}', 'zatca_uuid' => $uuid, 'zatca_icv' => $icv,
            'zatca_previous_hash' => $previousHash, 'zatca_hash' => $hash, 'zatca_qr' => 'cXI=', 'zatca_xml' => '<Invoice/>',
        ];
    }

    private function postWithoutDecision(string $note): array
    {
        DB::table('credit_notes')->where('id', $note)->update(['status' => 'posted']);

        return ['posted' => true];
    }

    private function chain(string $tenant, bool $lock = false): string
    {
        $query = DB::table('zatca_chains')->where('tenant_id', $tenant);
        $existing = ($lock ? $query->lockForUpdate() : $query)->value('id');
        if ($existing !== null) {
            return $existing;
        }
        $id = (string) Str::uuid();
        DB::table('zatca_chains')->insertOrIgnore([
            'id' => $id, 'tenant_id' => $tenant, 'chain_key' => 'tenant', 'last_icv' => 0, 'seed_icv' => 0, 'created_at' => now(), 'updated_at' => now(),
        ]);

        return (string) DB::table('zatca_chains')->where('tenant_id', $tenant)->value('id');
    }

    private function makeTenant(): string
    {
        $id = Tenant::create([
            'name' => 'مستأجر F2 متزامن', 'slug' => 'zatca-f2-pg-'.Str::random(10),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ])->id;
        $this->tenants[] = $id;
        DB::table('partners')->insert(['id' => (string) Str::uuid(), 'tenant_id' => $id, 'name' => 'عميل', 'type' => 'customer', 'created_at' => now(), 'updated_at' => now()]);

        return $id;
    }

    private function makeNote(string $tenant): string
    {
        $id = (string) Str::uuid();
        DB::table('credit_notes')->insert([
            'id' => $id, 'tenant_id' => $tenant, 'number' => 'CN-'.Str::random(8), 'partner_id' => DB::table('partners')->where('tenant_id', $tenant)->value('id'),
            'note_date' => '2026-02-10', 'created_at' => now(), 'updated_at' => now(),
        ]);

        return $id;
    }

    private function makeInvoice(string $tenant): string
    {
        $id = (string) Str::uuid();
        DB::table('invoices')->insert([
            'id' => $id, 'tenant_id' => $tenant, 'number' => 'INV-'.Str::random(8), 'partner_id' => DB::table('partners')->where('tenant_id', $tenant)->value('id'),
            'invoice_date' => '2026-02-10', 'created_at' => now(), 'updated_at' => now(),
        ]);

        return $id;
    }

    private function makeAdmin(): string
    {
        $id = PlatformAdministrator::create([
            'name' => 'مدير تزامن', 'email' => Str::random(10).'@platform.test', 'password' => 'secret-password-1', 'is_active' => true,
        ])->id;
        $this->admins[] = $id;

        return $id;
    }

    private function enable(string $tenant): void
    {
        app(ZatcaRolloutControlService::class)->setTenantState(PlatformAdministrator::findOrFail($this->makeAdmin()), $tenant, true, 'تفعيل تجريبي للاختبار');
    }

    /** صفوف المنصة لا تُحذف تطبيقياً (حراس C4/E2): تنظيف الاختبار بتعطيل مُشغّلات المستخدم مؤقتاً فقط. */
    private function clearPlatformRows(): void
    {
        if (! \Illuminate\Support\Facades\Schema::hasTable('zatca_rollout_controls')) {
            return;
        }
        try {
            DB::unprepared('ALTER TABLE zatca_rollout_control_events DISABLE TRIGGER USER');
            DB::unprepared('ALTER TABLE zatca_rollout_controls DISABLE TRIGGER USER');
            DB::table('zatca_rollout_control_events')->whereNull('tenant_id')->delete();
            DB::table('zatca_rollout_controls')->whereNull('tenant_id')->delete();
        } finally {
            DB::unprepared('ALTER TABLE zatca_rollout_controls ENABLE TRIGGER USER');
            DB::unprepared('ALTER TABLE zatca_rollout_control_events ENABLE TRIGGER USER');
        }
    }

    private function waitFor(string $file, float $seconds = 10.0): void
    {
        $deadline = microtime(true) + $seconds;
        while (! file_exists($file) && microtime(true) < $deadline) {
            usleep(1_000);
        }
    }

    private function assertAllOk(array $results): void
    {
        foreach ($results as $i => $result) {
            $this->assertTrue($result['ok'] ?? false, "العملية {$i}: ".($result['error_class'] ?? '').' '.($result['message'] ?? ''));
            $this->assertFalse($this->isDeadlock($result), "جمود في العملية {$i}");
        }
    }

    private function isDeadlock(array $result): bool
    {
        $message = (string) ($result['message'] ?? '');

        return str_contains($message, '40P01') || stripos($message, 'deadlock') !== false;
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
