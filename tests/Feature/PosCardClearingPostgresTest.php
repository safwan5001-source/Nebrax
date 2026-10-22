<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\PaymentGateway;
use App\Models\PaymentMethod;
use App\Models\User;
use App\Services\Accounting\PosService;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * PAY-H6-01 (D-09) تحت تزامن حقيقي (PostgreSQL + `pcntl_fork`):
 *  1) طلبات بيع POS متطابقة (مفتاح idempotency واحد) على طريقة مقاصة ⇒ فاتورة واحدة وسند واحد وأثر 1170 مرة واحدة.
 *  2) مبيعات مختلفة متزامنة ⇒ كل سند على المقاصة بقيد متوازن، 1170 = المجموع، 1130 = صفر، بلا جمود.
 *  3) تبديل الربط أثناء البيع ⇒ كل سند متسق مع بوابته (A12 ⇒ مدين 1170 ولا بنك؛ A11 ⇒ بنك ولا 1170) — لا قيد هجين.
 *
 *  لا يُتخطّى على PostgreSQL إن غاب `pcntl` (يفشل). يُتخطّى على SQLite فقط. لا RefreshDatabase: ينظّف `tearDown` بحذف المستأجر.
 */
class PosCardClearingPostgresTest extends TestCase
{
    use InteractsWithApi;

    private string $dir;

    private string $tenantId;

    private string $token;

    private string $userId;

    private string $sessionId;

    private string $partnerId;

    private string $cardId;

    private string $gatewayId;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite لا يُظهر تنافساً على أقفال الصفوف.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'),
            'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ (PAY-H6-01).');

        $this->dir = sys_get_temp_dir().'/pos_clearing_'.uniqid();
        mkdir($this->dir);

        $auth = $this->registerTenant('pos-clr-pg-'.Str::lower(Str::random(8)), Str::lower(Str::random(8)).'@pos-clr.test');
        $this->tenantId = $auth['tenant_id'];
        $this->token = $auth['token'];
        app(TenantContext::class)->set($this->tenantId);
        $this->userId = (string) User::query()->where('tenant_id', $this->tenantId)->value('id');

        $warehouse = $this->withToken($this->token)->postJson('/api/warehouses', ['name' => 'مخزن', 'code' => 'PG-W', 'is_active' => true])->assertCreated()['data']['id'];
        $device = $this->withToken($this->token)->postJson('/api/pos-devices', ['name' => 'كاشير', 'code' => 'PG-D', 'warehouse_id' => $warehouse, 'is_active' => true])->assertCreated()['data']['id'];
        $this->sessionId = $this->withToken($this->token)->postJson('/api/pos-sessions/open', ['opening_balance' => 0, 'pos_device_id' => $device])->assertCreated()['data']['id'];
        $this->partnerId = $this->withToken($this->token)->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])->assertCreated()['data']['id'];

        $gateway = PaymentGateway::query()->create(['provider' => 'custom', 'name' => 'مستحوذ', 'environment' => 'live']);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => 'active', 'is_active' => true]);
        $this->gatewayId = $gateway->id;
        $this->cardId = (string) PaymentMethod::query()->where('name', 'بطاقة ائتمان')->value('id');
        $this->assertNotSame('', $this->cardId);
        DB::table('payment_methods')->where('id', $this->cardId)->update(['pos_clearing_gateway_id' => $this->gatewayId]);
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
    public function identical_concurrent_checkouts_on_a_clearing_method_create_one_sale_and_post_clearing_once(): void
    {
        $key = (string) Str::uuid();
        $results = $this->runConcurrently(array_fill(0, 4, $this->seller($key)));

        $this->assertAllOk($results);
        $ids = array_unique(array_column(array_column($results, 'value'), 'invoice_id'));
        $this->assertCount(1, $ids, 'الكل يعيد الفاتورة نفسها');
        app(TenantContext::class)->set($this->tenantId);
        $this->assertSame(1, Invoice::query()->count());
        $this->assertSame(1, Payment::query()->count());
        $this->assertSame($this->gatewayId, Payment::query()->sole()->payment_gateway_id);
        $this->assertSame(11500, $this->balance('1170'));
        $this->assertSame(0, $this->balance('1130'));
        $this->assertSame(0, $this->balance('1120'));
    }

    /** @test */
    public function distinct_concurrent_sales_all_clear_with_balanced_entries_and_no_deadlock(): void
    {
        $jobs = [];
        foreach (range(1, 6) as $i) {
            $jobs[] = $this->seller((string) Str::uuid());
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllOk($results);
        app(TenantContext::class)->set($this->tenantId);
        $this->assertSame(6, Payment::query()->count());
        $this->assertSame(6 * 11500, $this->balance('1170'));
        $this->assertSame(0, $this->balance('1130'));
        foreach (JournalEntry::query()->with('lines')->get() as $entry) {
            $this->assertSame($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        }
    }

    /** @test */
    public function toggling_the_link_during_sales_never_produces_a_hybrid_entry(): void
    {
        $tenant = $this->tenantId;
        $card = $this->cardId;
        $gateway = $this->gatewayId;
        $toggler = function () use ($card, $gateway) {
            foreach (range(1, 12) as $i) {
                DB::table('payment_methods')->where('id', $card)->update(['pos_clearing_gateway_id' => $i % 2 === 0 ? $gateway : null]);
                usleep(2000);
            }

            return ['toggled' => true];
        };
        $jobs = [$toggler];
        foreach (range(1, 6) as $i) {
            $jobs[] = $this->seller((string) Str::uuid());
        }
        $results = $this->runConcurrently($jobs);

        $this->assertAllOk($results);
        app(TenantContext::class)->set($tenant);
        $this->assertSame(6, Payment::query()->count());
        foreach (Payment::query()->get() as $payment) {
            $entry = JournalEntry::with('lines.account')->findOrFail($payment->journal_entry_id);
            $codes = $entry->lines->map(fn ($l) => $l->account->code)->all();
            if ($payment->payment_gateway_id !== null) {
                $this->assertContains('1170', $codes);
                $this->assertNotContains('1120', $codes);
            } else {
                $this->assertContains('1120', $codes);
                $this->assertNotContains('1170', $codes);
            }
            $this->assertSame($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        }
        $this->assertSame(0, $this->balance('1130'));
        $this->assertSame(6 * 11500, $this->balance('1170') + $this->balance('1120'));
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function seller(string $key): callable
    {
        $tenant = $this->tenantId;
        $data = [
            'idempotency_key' => $key, 'partner_id' => $this->partnerId, 'pos_session_id' => $this->sessionId,
            'items' => [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
            'tenders' => [['payment_method_id' => $this->cardId, 'amount' => 11500]],
            'created_by' => $this->userId,
        ];
        $userId = $this->userId;

        return function () use ($tenant, $data, $userId) {
            app(TenantContext::class)->set($tenant);
            $invoice = app(PosService::class)->checkout([...$data, 'actor' => User::query()->findOrFail($userId)]);

            return ['invoice_id' => $invoice->id];
        };
    }

    private function balance(string $code): int
    {
        return (int) (Account::where('code', $code)->first()?->balance?->fresh()?->balance ?? 0);
    }

    private function assertAllOk(array $results): void
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
