<?php

namespace Tests\Feature;

use App\Models\AiBudget;
use App\Models\AiRequest;
use App\Models\PlatformAdministrator;
use App\Services\AiBudgetService;
use App\Services\AiRequestLedger;
use App\Support\AiAssistantDenied;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PDO;
use Tests\TestCase;

/**
 * AI-07 — مراجعة قبل الدمج (٣): تعديل ميزانيات المنصة/المؤسسة مع حجز طلبات الذكاء الاصطناعي لا يتجاوز السقوف
 * ولا يمحو الاستهلاك المحجوز.
 *
 * ثلاث طبقات:
 *  ١) خاصية تسلسلية على أي قاعدة: عمليات حجز/تسوية/فشل/تعديل سقف متداخلة بترتيب عشوائي ثابت البذرة، وبعد كل خطوة
 *     يُقارَن الصف بنموذج مرجعي مستقل (المحجوز = مجموع الطلبات المفتوحة، المستهلك = مجموع المسوّى) — لا فقد ولا ازدواج.
 *  ٢) تداخلات صريحة (حجز ثم خفض سقف ثم تسوية …).
 *  ٣) **PostgreSQL بموصلين حقيقيين**: منافس ثانٍ يمسك قفل صف الميزانية فيُرى أن الطرف الآخر **ينتظر** (لا يقرأ سقفاً
 *     قديماً ولا يكتب فوق عدّاد)، ثم يُرى الأثر بعد الإيداع. يتخطّى على SQLite (كاتب واحد) — يعمل في مهمة pgsql في CI.
 *
 * تشغيل: php artisan test --filter=AiBudgetConcurrencyTest
 */
class AiBudgetConcurrencyTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use InteractsWithAiAssistant;

    private const PROFILE = ['billable' => true, 'input_micro_usd_per_1k' => 1000, 'output_micro_usd_per_1k' => 1000];
    private const ACTOR = '00000000-0000-0000-0000-000000000001';

    private ?PDO $rival = null;
    /** @var list<string> فترات/مفاتيح أنشأها المنافس بإيداع حقيقي لتنظيفها. */
    private array $rivalTenants = [];

    protected function tearDown(): void
    {
        if ($this->rival !== null) {
            try {
                $this->rival->exec('ROLLBACK');
            } catch (\Throwable) {
            }
        }
        $rival = $this->rival;
        $tenants = $this->rivalTenants;
        $this->rival = null;
        parent::tearDown();
        if ($rival !== null) {
            try {
                $rival->exec("DELETE FROM ai_budgets WHERE period = '2099-01'");
                foreach ($tenants as $id) {
                    $rival->prepare('DELETE FROM tenants WHERE id = ?')->execute([$id]);
                }
            } catch (\Throwable) {
            }
        }
    }

    private function budgets(): AiBudgetService
    {
        return app(AiBudgetService::class);
    }

    private function open(string $tid, int $tokens, string $period): AiRequest
    {
        return app(AiRequestLedger::class)->open($tid, self::ACTOR, 'anthropic', 'm', self::PROFILE, $tokens, $tokens * 10, null, (string) Str::uuid());
    }

    /** @return array{cap_tokens:int,used_tokens:int,reserved_tokens:int,cap_cost_micro_usd:int,used_cost_micro_usd:int,reserved_cost_micro_usd:int} */
    private function row(string $key, string $period): array
    {
        return (array) DB::table('ai_budgets')->where('budget_key', $key)->where('period', $period)->select(
            'cap_tokens', 'used_tokens', 'reserved_tokens', 'cap_cost_micro_usd', 'used_cost_micro_usd', 'reserved_cost_micro_usd'
        )->first();
    }

    // ───────────────────────── (١) خاصية تسلسلية ─────────────────────────

    /** @test */
    public function interleaved_reserve_settle_fail_and_cap_edits_never_lose_or_double_count_consumption(): void
    {
        $a = $this->registerTenant('conc-a', 'owner@conc-a.test')['tenant_id'];
        $b = $this->registerTenant('conc-b', 'owner@conc-b.test')['tenant_id'];
        $period = $this->budgets()->period();
        $this->budgets()->setCaps(null, $period, 6000, 60_000);
        $this->budgets()->setCaps($a, $period, 4000, 40_000);
        $this->budgets()->setCaps($b, $period, 4000, 40_000);

        /** @var array<string,array{tid:string,tokens:int}> $open */
        $open = [];
        $model = ['global' => ['res' => 0, 'used' => 0, 'resCost' => 0, 'usedCost' => 0]];
        foreach ([$a, $b] as $t) {
            $model['tenant:' . $t] = ['res' => 0, 'used' => 0, 'resCost' => 0, 'usedCost' => 0];
        }
        $accepted = $rejected = $settled = $failed = $capEdits = 0;
        mt_srand(20261017);

        for ($step = 0; $step < 400; $step++) {
            $op = mt_rand(1, 100);
            if ($op <= 45) {                                              // حجز
                $tid = mt_rand(0, 1) ? $a : $b;
                $tokens = mt_rand(1, 500);
                try {
                    $request = $this->open($tid, $tokens, $period);
                } catch (AiAssistantDenied $denied) {
                    $this->assertContains($denied->reason, ['budget_exceeded', 'platform_budget_exceeded'], 'only a cap can refuse a funded request');
                    $rejected++;
                    $this->assertInvariants($model, [$a, $b], $period);
                    continue;
                }
                $accepted++;
                $open[$request->id] = ['tid' => $tid, 'tokens' => $tokens];
                foreach (['global', 'tenant:' . $tid] as $k) {
                    $model[$k]['res'] += $tokens;
                    $model[$k]['resCost'] += $tokens * 10;
                    $r = $this->row($k, $period);
                    $this->assertLessThanOrEqual($r['cap_tokens'], $r['used_tokens'] + $r['reserved_tokens'], "{$k}: a reservation never lands above the cap that was in force");
                    $this->assertLessThanOrEqual($r['cap_cost_micro_usd'], $r['used_cost_micro_usd'] + $r['reserved_cost_micro_usd']);
                }
            } elseif ($op <= 75 && $open !== []) {                        // تسوية بالفعلي (قد يتجاوز المحجوز)
                $id = array_keys($open)[mt_rand(0, count($open) - 1)];
                $actual = mt_rand(0, (int) ($open[$id]['tokens'] * 1.5));
                $this->assertTrue(app(AiRequestLedger::class)->complete(AiRequest::withoutGlobalScopes()->findOrFail($id), ['input_tokens' => $actual, 'output_tokens' => 0, 'cost_micro_usd' => $actual * 10]));
                $this->settle($model, $open[$id], $actual, $actual * 10);
                unset($open[$id]);
                $settled++;
            } elseif ($op <= 85 && $open !== []) {                        // فشل بسياسة المحجوز كاملاً
                $id = array_keys($open)[mt_rand(0, count($open) - 1)];
                $this->assertTrue(app(AiRequestLedger::class)->fail(AiRequest::withoutGlobalScopes()->findOrFail($id), null, 'provider_error'));
                $this->settle($model, $open[$id], $open[$id]['tokens'], $open[$id]['tokens'] * 10);
                unset($open[$id]);
                $failed++;
            } else {                                                      // تعديل سقف (أعلى أو أدنى من المستهلك)
                $key = [null, $a, $b][mt_rand(0, 2)];
                $this->budgets()->setCaps($key, $period, mt_rand(0, 8000), mt_rand(0, 80_000));
                $capEdits++;
            }
            $this->assertInvariants($model, [$a, $b], $period);
        }

        // نُسوّي ما بقي مفتوحاً: لا شيء معلّق، والمستهلك = مجموع ما سُجّل على الطلبات.
        foreach ($open as $id => $info) {
            $this->assertTrue(app(AiRequestLedger::class)->complete(AiRequest::withoutGlobalScopes()->findOrFail($id), ['input_tokens' => $info['tokens'], 'output_tokens' => 0, 'cost_micro_usd' => $info['tokens'] * 10]));
            $this->settle($model, $info, $info['tokens'], $info['tokens'] * 10);
        }
        $this->assertInvariants($model, [$a, $b], $period);
        foreach (['global', 'tenant:' . $a, 'tenant:' . $b] as $k) {
            $this->assertSame(0, $this->row($k, $period)['reserved_tokens'], "{$k}: nothing left reserved");
        }
        $this->assertSame($this->row('global', $period)['used_tokens'], (int) AiRequest::withoutGlobalScopes()->sum(DB::raw('input_tokens + output_tokens + unmetered_tokens')), 'budget consumption equals the sum recorded on the requests');
        $this->assertGreaterThan(15, $accepted);
        $this->assertGreaterThan(3, $rejected, 'the sequence did hit caps');
        $this->assertGreaterThan(10, $capEdits);
        $this->assertGreaterThan(10, $settled + $failed);
    }

    /** @param array<string,array{res:int,used:int,resCost:int,usedCost:int}> $model */
    private function settle(array &$model, array $info, int $tokens, int $cost): void
    {
        foreach (['global', 'tenant:' . $info['tid']] as $k) {
            $model[$k]['res'] -= $info['tokens'];
            $model[$k]['resCost'] -= $info['tokens'] * 10;
            $model[$k]['used'] += $tokens;
            $model[$k]['usedCost'] += $cost;
        }
    }

    /** @param array<string,array{res:int,used:int,resCost:int,usedCost:int}> $model */
    private function assertInvariants(array $model, array $tenants, string $period): void
    {
        foreach ($model as $key => $expected) {
            $r = $this->row($key, $period);
            $this->assertSame(
                [$expected['res'], $expected['used'], $expected['resCost'], $expected['usedCost']],
                [$r['reserved_tokens'], $r['used_tokens'], $r['reserved_cost_micro_usd'], $r['used_cost_micro_usd']],
                "{$key}: counters equal the independent model (reserved = open requests, used = settled)",
            );
            $this->assertGreaterThanOrEqual(0, $r['reserved_tokens']);
        }
    }

    // ───────────────────────── (٢) تداخلات صريحة ─────────────────────────

    /** @test */
    public function lowering_a_cap_under_an_open_reservation_keeps_it_blocks_new_ones_and_settles_exactly(): void
    {
        $tid = $this->registerTenant('conc-c', 'owner@conc-c.test')['tenant_id'];
        $p = $this->budgets()->period();
        $this->budgets()->setCaps(null, $p, 1000, 10_000);
        $this->budgets()->setCaps($tid, $p, 1000, 10_000);
        $held = $this->open($tid, 600, $p);

        $this->budgets()->setCaps($tid, $p, 100, 1_000);   // أدنى بكثير من المحجوز الجاري
        $this->budgets()->setCaps(null, $p, 100, 1_000);
        $this->assertSame(600, $this->row('tenant:' . $tid, $p)['reserved_tokens'], 'the edit did not erase the in-flight reservation');
        try {
            $this->open($tid, 1, $p);
            $this->fail('a new request must be refused while used+reserved exceeds the lowered cap');
        } catch (AiAssistantDenied $e) {
            $this->assertSame('platform_budget_exceeded', $e->reason);
        }

        $this->assertTrue(app(AiRequestLedger::class)->complete($held, ['input_tokens' => 450, 'output_tokens' => 0, 'cost_micro_usd' => 4_500]));
        $r = $this->row('tenant:' . $tid, $p);
        $this->assertSame([0, 450, 100], [$r['reserved_tokens'], $r['used_tokens'], $r['cap_tokens']], 'settlement is exact and the new cap survived');

        $this->budgets()->setCaps($tid, $p, 5000, 50_000);   // رفع السقف يعيد القبول فوراً
        $this->budgets()->setCaps(null, $p, 5000, 50_000);
        $this->assertSame(0, $this->open($tid, 100, $p)->attempt - 1);
    }

    /** @test */
    public function editing_caps_is_a_cap_only_statement_that_never_touches_the_counters(): void
    {
        $tid = $this->registerTenant('conc-d', 'owner@conc-d.test')['tenant_id'];
        $p = $this->budgets()->period();
        $this->budgets()->setCaps(null, $p, 1000, 10_000);
        $this->budgets()->setCaps($tid, $p, 1000, 10_000);
        $this->open($tid, 300, $p);
        DB::table('ai_budgets')->where('budget_key', 'tenant:' . $tid)->update(['used_tokens' => 70, 'used_cost_micro_usd' => 700]);
        $before = $this->row('tenant:' . $tid, $p);

        $this->budgets()->setCaps($tid, $p, 2222, 22_222);

        $after = $this->row('tenant:' . $tid, $p);
        $this->assertSame([2222, 22_222], [$after['cap_tokens'], $after['cap_cost_micro_usd']]);
        foreach (['used_tokens', 'reserved_tokens', 'used_cost_micro_usd', 'reserved_cost_micro_usd'] as $counter) {
            $this->assertSame($before[$counter], $after[$counter], "{$counter} untouched by a cap edit");
        }
    }

    /** @test */
    public function creating_and_editing_a_cap_row_is_one_upsert_so_repeated_writers_converge_on_one_row(): void
    {
        $p = $this->budgets()->period();
        $statements = [];
        DB::listen(function ($query) use (&$statements): void {
            if (str_contains($query->sql, 'ai_budgets')) {
                $statements[] = strtolower(strtok($query->sql, ' '));
            }
        });

        $this->budgets()->setCaps(null, $p, 100, 1_000);      // إنشاء
        $this->budgets()->setCaps(null, $p, 777, 7_777);      // تعديل نفس الصف

        $this->assertSame(1, AiBudget::query()->where('budget_key', 'global')->where('period', $p)->count(), 'one row, never two');
        $row = $this->row('global', $p);
        $this->assertSame([777, 7_777], [$row['cap_tokens'], $row['cap_cost_micro_usd']]);
        $this->assertSame(['insert', 'insert'], [$statements[0], $statements[2]], 'each edit starts with its one atomic upsert — no read-then-write window');
    }

    /** @test */
    public function the_platform_api_edit_keeps_in_flight_reservations_and_the_tenant_cap_never_exceeds_the_platform_cap(): void
    {
        $tid = $this->registerTenant('conc-e', 'owner@conc-e.test')['tenant_id'];
        $admin = PlatformAdministrator::create(['name' => 'p', 'email' => 'conc@nebrax.test', 'password' => 'platform-password-123']);
        $token = $admin->createToken('c', ['platform:read', 'platform:manage'])->plainTextToken;
        $p = $this->budgets()->period();
        $put = fn (array $payload) => $this->withToken($token)->putJson('/api/platform/ai-budgets', $payload + ['period' => $p, 'current_password' => 'platform-password-123']);

        $put(['scope' => 'global', 'cap_tokens' => 1000, 'cap_cost_micro_usd' => 10_000])->assertOk();
        $put(['scope' => 'tenant', 'tenant_id' => $tid, 'cap_tokens' => 900, 'cap_cost_micro_usd' => 9_000])->assertOk();
        $held = $this->open($tid, 500, $p);

        $put(['scope' => 'tenant', 'tenant_id' => $tid, 'cap_tokens' => 1001, 'cap_cost_micro_usd' => 9_000])->assertStatus(422);   // فوق العالمي
        $put(['scope' => 'tenant', 'tenant_id' => $tid, 'cap_tokens' => 800, 'cap_cost_micro_usd' => 8_000])->assertOk();
        $put(['scope' => 'global', 'cap_tokens' => 300, 'cap_cost_micro_usd' => 3_000])->assertOk();   // تخفيض العالمي أدنى من الجاري

        $this->assertSame(500, $this->row('tenant:' . $tid, $p)['reserved_tokens']);
        $this->assertSame(500, $this->row('global', $p)['reserved_tokens']);
        $this->assertTrue(app(AiRequestLedger::class)->complete($held, ['input_tokens' => 500, 'output_tokens' => 0, 'cost_micro_usd' => 5_000]));
        $this->assertSame([0, 500], [$this->row('global', $p)['reserved_tokens'], $this->row('global', $p)['used_tokens']]);
    }

    // ───────────────────────── (٣) PostgreSQL بموصلين حقيقيين ─────────────────────────

    private function pgOnly(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('إثبات التزامن بموصلين خاصٌّ بـPostgreSQL.');
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

    /** مؤسسة وصفّا ميزانية **مودَعة** من الموصل الثاني (معاملة `RefreshDatabase` تُخفي ما يكتبه الأول عنه). */
    private function committedBudget(int $cap, int $capCost): string
    {
        $tid = (string) Str::uuid();
        $r = $this->rival();
        $r->prepare('INSERT INTO tenants (id, name, slug, vat_number, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, now(), now())')
            ->execute([$tid, 'مستأجر ميزانية', 'conc-pg-' . substr($tid, 0, 8), '300000000000003', 'SAR']);
        $this->rivalTenants[] = $tid;
        $insert = $r->prepare('INSERT INTO ai_budgets (id, budget_key, tenant_id, period, cap_tokens, cap_cost_micro_usd, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, now(), now())');
        $insert->execute([(string) Str::uuid(), 'global', null, '2099-01', $cap, $capCost]);
        $insert->execute([(string) Str::uuid(), 'tenant:' . $tid, $tid, '2099-01', $cap, $capCost]);

        return $tid;
    }

    private function assertBlocked(callable $attempt, string $why): void
    {
        DB::statement("SET lock_timeout = '600ms'");
        try {
            // نقطة حفظ: انتهاء مهلة القفل يُجهض المعاملة الخارجية في PostgreSQL ما لم يُعزل بـSAVEPOINT.
            DB::transaction($attempt);
            $this->fail($why);
        } catch (QueryException $e) {
            $this->assertStringContainsString('lock timeout', strtolower($e->getMessage()), $why);
        } finally {
            DB::statement('RESET lock_timeout');
        }
    }

    /** @test */
    public function postgres_a_reservation_waits_for_a_cap_edit_in_flight_and_is_then_judged_against_the_new_cap(): void
    {
        $this->pgOnly();
        $tid = $this->committedBudget(1000, 1_000_000);
        $r = $this->rival();
        $r->exec('BEGIN');
        $r->exec("UPDATE ai_budgets SET cap_tokens = 100 WHERE budget_key = 'global' AND period = '2099-01'");   // تعديل سقف غير مودَع بعد

        $this->assertBlocked(fn () => $this->budgets()->reserve($tid, '2099-01', 500, 500), 'a reservation passed an uncommitted cap edit: it would have read a stale cap');

        $r->exec('COMMIT');
        try {
            $this->budgets()->reserve($tid, '2099-01', 500, 500);
            $this->fail('after the edit commits, 500 > the new cap of 100 must be refused');
        } catch (AiAssistantDenied $e) {
            $this->assertSame('platform_budget_exceeded', $e->reason);
        }
        $this->budgets()->reserve($tid, '2099-01', 60, 60);
        $this->assertSame(60, $this->row('global', '2099-01')['reserved_tokens']);
        $this->assertSame(0, $this->row('tenant:' . $tid, '2099-01')['used_tokens']);
    }

    /** @test */
    public function postgres_a_cap_edit_waits_for_a_reservation_in_flight_and_does_not_erase_it(): void
    {
        $this->pgOnly();
        $tid = $this->committedBudget(1000, 1_000_000);
        $r = $this->rival();
        $r->exec('BEGIN');
        // نفس جملة الحجز الذرّية التي ينفّذها `AiBudgetService::reserveRow` — غير مودَعة بعد.
        $r->exec("UPDATE ai_budgets SET reserved_tokens = reserved_tokens + 400, reserved_cost_micro_usd = reserved_cost_micro_usd + 400
                  WHERE budget_key = 'global' AND period = '2099-01' AND used_tokens + reserved_tokens + 400 <= cap_tokens AND used_cost_micro_usd + reserved_cost_micro_usd + 400 <= cap_cost_micro_usd");

        $this->assertBlocked(fn () => $this->budgets()->setCaps(null, '2099-01', 50, 50), 'a cap edit passed an uncommitted reservation: it could overwrite the counters');

        $r->exec('COMMIT');
        $this->budgets()->setCaps(null, '2099-01', 50, 50);
        $row = $this->row('global', '2099-01');
        $this->assertSame([50, 400], [$row['cap_tokens'], $row['reserved_tokens']], 'new cap applied, the reservation that committed first is still counted');
        try {
            $this->budgets()->reserve($tid, '2099-01', 1, 1);
            $this->fail('used+reserved (400) exceeds the new cap (50): nothing more may be reserved');
        } catch (AiAssistantDenied $e) {
            $this->assertSame('platform_budget_exceeded', $e->reason);
        }
    }

    /** @test */
    public function postgres_two_cap_edits_of_the_same_row_serialize_and_the_last_commit_wins_without_touching_counters(): void
    {
        $this->pgOnly();
        $this->committedBudget(1000, 1_000_000);
        $r = $this->rival();
        $r->exec("UPDATE ai_budgets SET reserved_tokens = 123, used_tokens = 45 WHERE budget_key = 'global' AND period = '2099-01'");
        $r->exec('BEGIN');
        $r->exec("UPDATE ai_budgets SET cap_tokens = 700 WHERE budget_key = 'global' AND period = '2099-01'");

        $this->assertBlocked(fn () => $this->budgets()->setCaps(null, '2099-01', 900, 900), 'two concurrent cap edits must serialize on the row lock');
        $r->exec('COMMIT');
        $this->budgets()->setCaps(null, '2099-01', 900, 900);

        $row = $this->row('global', '2099-01');
        $this->assertSame([900, 123, 45], [$row['cap_tokens'], $row['reserved_tokens'], $row['used_tokens']]);
    }
}
