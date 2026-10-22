<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Payment;
use App\Models\PosTerminalRequest;
use App\Models\User;
use App\Services\Accounting\PosService;
use App\Services\FakePosTerminalAdapter;
use App\Services\PosTerminalService;
use App\Support\PosTerminalException;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PAY-H6-02 — أجهزة دفع POS والتعويض تحت تزامن حقيقي (PostgreSQL + `pcntl_fork`)
 * ═══════════════════════════════════════════════════════════════
 *  1) موافقة واحدة وعدة بيوع متزامنة ⇒ بيع واحد فقط، والباقي يفشل **دون أن يلغي** الموافقة المستهلكة.
 *  2) إلغاء (تعويض) متزامن مع استهلاك ⇒ إما مستهلك بسند أو ملغى بلا سند — لا حالة هجينة ولا سند على موافقة ملغاة.
 *  3) إنشاء طلبات متزامنة على جهاز واحد ⇒ طلب نشط واحد والباقي terminal_busy بلا جمود.
 *  4) مجدولات متزامنة على موافقة يتيمة ⇒ إلغاء واحد (إيجار) وحالة نهائية voided.
 *
 *  لا يُتخطّى على PostgreSQL إن غاب `pcntl` (يفشل). يُتخطّى على SQLite فقط. لا RefreshDatabase: ينظّف `tearDown` بحذف المستأجر.
 */
class PosTerminalPostgresTest extends TestCase
{
    use InteractsWithApi;

    private string $dir;

    private string $tenantId;

    private string $token;

    private string $userId;

    private string $sessionId;

    private string $partnerId;

    private string $cardId;

    private string $terminalId;

    private FakePosTerminalAdapter $fake;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على أقفال الصفوف.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'),
            'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ (PAY-H6-02).');

        $this->dir = sys_get_temp_dir().'/pos_terminal_'.uniqid();
        mkdir($this->dir);
        $this->app->singleton(FakePosTerminalAdapter::class);
        $this->fake = app(FakePosTerminalAdapter::class);

        $auth = $this->registerTenant('pos-trm-pg-'.Str::lower(Str::random(8)), Str::lower(Str::random(8)).'@pos-trm.test');
        $this->tenantId = $auth['tenant_id'];
        $this->token = $auth['token'];
        app(TenantContext::class)->set($this->tenantId);
        $this->userId = (string) User::query()->where('tenant_id', $this->tenantId)->value('id');

        $warehouse = $this->withToken($this->token)->postJson('/api/warehouses', ['name' => 'مخزن', 'code' => 'TPG-W', 'is_active' => true])->assertCreated()['data']['id'];
        $device = $this->withToken($this->token)->postJson('/api/pos-devices', ['name' => 'كاشير', 'code' => 'TPG-D', 'warehouse_id' => $warehouse, 'is_active' => true])->assertCreated()['data']['id'];
        $this->sessionId = $this->withToken($this->token)->postJson('/api/pos-sessions/open', ['opening_balance' => 0, 'pos_device_id' => $device])->assertCreated()['data']['id'];
        $this->partnerId = $this->withToken($this->token)->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])->assertCreated()['data']['id'];
        $this->terminalId = $this->newTerminal('جهاز 1');
        $methods = $this->withToken($this->token)->getJson('/api/payment-methods')->assertOk()['data'];
        $this->cardId = collect($methods)->firstWhere('name', 'بطاقة ائتمان')['id'];
    }

    protected function tearDown(): void
    {
        if (isset($this->dir) && is_dir($this->dir)) {
            foreach (glob($this->dir.'/*') ?: [] as $f) {
                @unlink($f);
            }
            @rmdir($this->dir);
        }
        if (DB::connection()->getDriverName() === 'pgsql' && isset($this->tenantId)) {
            DB::table('tenants')->where('id', $this->tenantId)->delete();
        }

        parent::tearDown();
    }

    /** @test */
    public function one_approval_and_many_concurrent_sales_sell_once_and_failed_duplicates_never_void_the_consumed_approval(): void
    {
        $id = $this->approved(11500, $this->terminalId);

        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = $this->seller($id, 11500);
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllNoDeadlock($results);
        $sold = array_filter($results, fn ($r) => ($r['ok'] ?? false) && isset($r['value']['invoice_id']));
        $this->assertCount(1, $sold, 'بيع واحد فقط');
        app(TenantContext::class)->set($this->tenantId);
        $this->assertSame(1, Payment::query()->count());
        $row = DB::table('pos_terminal_requests')->where('id', $id)->first();
        $this->assertSame('consumed', $row->status);
        $this->assertNotNull($row->consumed_payment_id);
        $this->assertNull($row->voided_at, 'الخاسرون لا يلغون موافقة استهلكها غيرهم');
    }

    /** @test */
    public function a_concurrent_void_and_a_sale_never_leave_a_hybrid_state(): void
    {
        foreach (range(1, 4) as $round) {
            $terminal = $this->newTerminal("جهاز سباق {$round}");
            $id = $this->approved(11500, $terminal);

            $results = $this->runConcurrently([
                $this->seller($id, 11500),
                function () use ($id) {
                    app(TenantContext::class)->set($this->tenantId);
                    app(BranchContext::class)->set(DB::table('pos_terminal_requests')->where('id', $id)->value('branch_id'));
                    app(PosTerminalService::class)->compensate($id);

                    return ['compensated' => true];
                },
            ]);

            $this->assertAllNoDeadlock($results);
            $row = DB::table('pos_terminal_requests')->where('id', $id)->first();
            $this->assertContains($row->status, ['consumed', 'voided'], "الجولة {$round}: {$row->status}");
            $payments = DB::table('payments')->where('id', $row->consumed_payment_id ?? '00000000-0000-0000-0000-000000000000')->count();
            if ($row->status === 'consumed') {
                $this->assertSame(1, $payments, 'مستهلك ⇒ سند');
                $this->assertNull($row->voided_at);
            } else {
                $this->assertNull($row->consumed_payment_id, 'ملغى ⇒ لا سند');
                $this->assertSame(0, DB::table('payments')->where('payment_details', 'like', "%{$id}%")->count());
            }
        }
    }

    /** @test */
    public function concurrent_requests_on_one_terminal_leave_exactly_one_active_without_deadlock(): void
    {
        $terminal = $this->newTerminal('جهاز مزدحم');
        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = function () use ($terminal) {
                app(TenantContext::class)->set($this->tenantId);
                $user = User::query()->findOrFail($this->userId);
                $branch = DB::table('pos_sessions')->where('id', $this->sessionId)->value('branch_id');
                app(BranchContext::class)->set($branch);
                try {
                    $req = app(PosTerminalService::class)->createRequest($user, [
                        'pos_session_id' => $this->sessionId, 'pos_payment_terminal_id' => $terminal, 'payment_method_id' => $this->cardId,
                        'amount' => 11500, 'idempotency_key' => (string) Str::uuid(),
                    ]);

                    return ['id' => $req->id];
                } catch (PosTerminalException $e) {
                    return ['reason' => $e->reason];
                }
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllNoDeadlock($results);
        $values = array_column($results, 'value');
        $this->assertCount(1, array_filter($values, fn ($v) => isset($v['id'])));
        foreach ($values as $v) {
            if (! isset($v['id'])) {
                $this->assertSame('terminal_busy', $v['reason']);
            }
        }
        $this->assertSame(1, DB::table('pos_terminal_requests')->where('pos_payment_terminal_id', $terminal)->whereIn('status', ['created', 'sent', 'approved'])->count());
    }

    /** @test */
    public function concurrent_sweepers_void_an_orphan_approval_exactly_once(): void
    {
        $terminal = $this->newTerminal('جهاز يتيم');
        $id = $this->approved(11500, $terminal);
        DB::table('pos_terminal_requests')->where('id', $id)->update(['approved_at' => now('UTC')->subMinutes(30)]);

        $results = $this->runConcurrently(array_fill(0, 4, function () {
            app(TenantContext::class)->forget();
            app(BranchContext::class)->forget();

            return app(PosTerminalService::class)->sweep();
        }));

        $this->assertAllNoDeadlock($results);
        $row = DB::table('pos_terminal_requests')->where('id', $id)->first();
        $this->assertSame('voided', $row->status);
        $this->assertSame(1, (int) $row->void_attempts, 'الإيجار يمنع إلغاءً مزدوجاً');
        $this->assertNull($row->compensating_until);
    }

    /** @test */
    public function concurrent_creates_with_one_key_and_different_payloads_never_return_a_replay_for_the_wrong_payload(): void
    {
        $terminal = $this->newTerminal('جهاز مفتاح');
        $key = (string) Str::uuid();
        $jobs = [];
        foreach ([11500, 9900, 11500, 9900, 11500, 9900] as $amount) {
            $jobs[] = function () use ($terminal, $key, $amount) {
                app(TenantContext::class)->set($this->tenantId);
                app(BranchContext::class)->set(DB::table('pos_sessions')->where('id', $this->sessionId)->value('branch_id'));
                try {
                    $req = app(PosTerminalService::class)->createRequest(User::query()->findOrFail($this->userId), [
                        'pos_session_id' => $this->sessionId, 'pos_payment_terminal_id' => $terminal, 'payment_method_id' => $this->cardId,
                        'amount' => $amount, 'idempotency_key' => $key,
                    ]);

                    return ['id' => $req->id, 'amount' => $req->amount, 'asked' => $amount];
                } catch (PosTerminalException $e) {
                    return ['reason' => $e->reason, 'asked' => $amount];
                }
            };
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllNoDeadlock($results);
        $winner = DB::table('pos_terminal_requests')->where('idempotency_key', $key)->first();
        $this->assertSame(1, DB::table('pos_terminal_requests')->where('idempotency_key', $key)->count());
        foreach (array_column($results, 'value') as $v) {
            if ($v['asked'] === (int) $winner->amount) {
                $this->assertSame($winner->id, $v['id'] ?? null, 'نفس المحتوى ⇒ الفائز نفسه (إنشاء أو replay)');
            } else {
                $this->assertSame('idempotency_conflict', $v['reason'] ?? null, 'محتوى مختلف بنفس المفتاح ⇒ تعارض لا replay');
            }
        }
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function newTerminal(string $name): string
    {
        return $this->withToken($this->token)->postJson('/api/pos-payment-terminals', ['name' => $name.' '.Str::random(4), 'provider' => 'fake'])->assertCreated()['data']['id'];
    }

    private function approved(int $amount, string $terminal): string
    {
        $id = $this->withToken($this->token)->postJson('/api/pos/terminal-requests', [
            'pos_session_id' => $this->sessionId, 'pos_payment_terminal_id' => $terminal, 'payment_method_id' => $this->cardId,
            'amount' => $amount, 'idempotency_key' => (string) Str::uuid(),
        ])->assertCreated()->json('data.id');
        $this->fake->script($id, 'approved');
        $this->withToken($this->token)->getJson("/api/pos/terminal-requests/{$id}")->assertOk()->assertJsonPath('data.status', 'approved');

        return $id;
    }

    private function seller(string $terminalRequestId, int $amount): callable
    {
        $data = [
            'idempotency_key' => '', 'partner_id' => $this->partnerId, 'pos_session_id' => $this->sessionId,
            'items' => [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
            'tenders' => [['payment_method_id' => $this->cardId, 'amount' => $amount, 'terminal_request_id' => $terminalRequestId]],
            'created_by' => $this->userId,
        ];
        $tenant = $this->tenantId;
        $userId = $this->userId;

        return function () use ($data, $tenant, $userId) {
            app(TenantContext::class)->set($tenant);
            $branch = DB::table('pos_sessions')->where('id', $data['pos_session_id'])->value('branch_id');
            app(BranchContext::class)->set($branch);
            try {
                $invoice = app(PosService::class)->checkout([...$data, 'idempotency_key' => (string) Str::uuid(), 'actor' => User::query()->findOrFail($userId)]);

                return ['invoice_id' => $invoice->id];
            } catch (\RuntimeException $e) {
                return ['rejected' => true, 'message' => substr($e->getMessage(), 0, 80)];
            }
        };
    }

    private function assertAllNoDeadlock(array $results): void
    {
        foreach ($results as $i => $result) {
            $this->assertTrue($result['ok'] ?? false, "العملية {$i}: ".($result['error_class'] ?? '').' '.($result['message'] ?? ''));
            $message = (string) ($result['message'] ?? '');
            $this->assertFalse(str_contains($message, '40P01') || stripos($message, 'deadlock') !== false, "جمود في العملية {$i}");
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
