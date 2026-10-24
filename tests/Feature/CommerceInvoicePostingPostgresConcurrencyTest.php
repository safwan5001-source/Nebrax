<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\CommercePaymentIntent;
use App\Models\InventoryReservation;
use App\Models\Partner;
use App\Models\PaymentAttempt;
use App\Models\PaymentGateway;
use App\Models\PaymentMethod;
use App\Models\PlatformAdministrator;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Commerce\CommerceOnlinePaymentService;
use App\Services\Commerce\CommerceOrderReservationService;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Services\FakePaymentGatewayAdapter;
use App\Services\PaymentAttemptPostingService;
use App\Services\PaymentOrchestrator;
use App\Support\PaymentProviderSnapshot;
use App\Support\SchedulerHeartbeat;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PAY-H4-03 — ترحيل طلب المتجر المدفوع تحت تزامن حقيقي (PostgreSQL + `pcntl_fork`): ست عمليات ترحيل متزامنة لالتقاط واحد (مع تثبيت النية)
 * ⇒ فاتورة واحدة وسند واحد ومِرساة واحدة، بلا جمود ولا خطأ. على PostgreSQL لا يُتخطّى إن غاب `pcntl`.
 */
class CommerceInvoicePostingPostgresConcurrencyTest extends TestCase
{
    use DiagnosesUnprovenScheduler;
    use UsesWorkerDatabaseWithoutTransaction;

    private string $dir;

    private string $tenantId;

    private string $attemptId;

    private string $orderId;

    /** @var list<string> */
    private array $tenants = [];

    /** @var list<string> */
    private array $admins = [];

    protected function setUp(): void
    {
        parent::setUp();
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً.');
        }
        $this->assertTrue(function_exists('pcntl_fork') && function_exists('posix_kill'), 'pcntl/posix مطلوبان لاختبارات تزامن PostgreSQL؛ غيابهما فشل لا تخطٍّ.');
        config([
            'payments.commerce_online_checkout.enabled' => true,
            'payments.commerce_invoice_on_payment.enabled' => true,
            'payments.commerce_invoice_on_payment.tax_opinion_ref' => 'EXT-05/TEST',
        ]);
        $this->dir = sys_get_temp_dir().'/commerce_invoice_'.uniqid();
        mkdir($this->dir);

        $tenant = Tenant::create(['name' => 'ترحيل الطلب المتزامن', 'slug' => 'pay-h4-03-'.Str::random(8), 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        $this->tenants[] = $this->tenantId = $tenant->id;
        app(TenantContext::class)->set($this->tenantId);
        app(ChartOfAccountsSeeder::class)->seed($this->tenantId);
        Settings::put('sales', ['commerce_invoice_trigger' => 'on_payment_confirmed', 'commerce_price_tax_mode' => 'inclusive']);
        $admin = PlatformAdministrator::create(['name' => 'مشغّل', 'email' => Str::random(8).'@platform.test', 'password' => 'platform-password-123']);
        $this->admins[] = $admin->id;
        SchedulerHeartbeat::record();
        $this->enableTenantPaymentsOrDiagnose($admin, $this->tenantId, 'تفعيل اختبار التزامن');

        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $method = PaymentMethod::create(['name' => 'بطاقة', 'name_en' => 'Card', 'settlement_type' => 'bank', 'available_online' => true]);
        $gateway = PaymentGateway::query()->create(['provider' => 'fake', 'name' => 'Fake', 'environment' => 'sandbox', 'payment_method_id' => $method->id]);
        DB::table('payment_gateways')->where('id', $gateway->id)->update(['status' => 'active', 'is_active' => true]);
        $warehouse = Warehouse::create(['name' => 'مخزن', 'code' => 'PG-W1', 'is_default' => true]);
        app(FulfillmentPolicyService::class)->setFixedWarehouse($channel->id, $warehouse->id);
        $product = Product::create(['name' => 'منتج', 'sku' => 'PG-'.uniqid(), 'unit' => 'piece', 'sale_price' => 5000, 'purchase_price' => 2000, 'avg_cost' => 2000, 'tax_rate' => 15, 'is_active' => true, 'track_inventory' => true]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
        ProductWarehouseStock::create(['product_id' => $product->id, 'warehouse_id' => $warehouse->id, 'quantity' => 10]);
        DB::table('products')->where('id', $product->id)->update(['quantity_on_hand' => 10]);
        $partner = Partner::create(['name' => 'عميل', 'type' => 'customer']);

        $order = CommerceOrder::create(['sales_channel_id' => $channel->id, 'partner_id' => $partner->id, 'number' => 'CORD-PG-'.uniqid(), 'status' => CommerceOrder::STATUS_CONFIRMED, 'total' => 5000, 'confirmed_at' => now()]);
        $order->lines()->create(['product_id' => $product->id, 'product_name_snapshot' => 'منتج', 'quantity' => 1, 'unit_name' => 'piece', 'unit_factor' => 1, 'unit_price' => 5000, 'line_total' => 5000]);
        $this->orderId = $order->id;
        CommercePaymentIntent::create([
            'commerce_order_id' => $order->id, 'payment_method_id' => $method->id, 'payment_method_name' => $method->name,
            'method' => CommercePaymentIntent::METHOD_ONLINE, 'status' => CommercePaymentIntent::STATUS_PENDING, 'amount_minor' => 5000, 'currency' => 'SAR',
        ]);
        app(CommerceOrderReservationService::class)->reserve($order->fresh());

        $this->app->singleton(FakePaymentGatewayAdapter::class);
        \Illuminate\Support\Facades\Event::fake([\App\Events\CommercePaymentAttemptCaptured::class]); // بلا مستمع: التثبيت والترحيل يجريهما العاملون المتزامنون
        $attempt = app(CommerceOnlinePaymentService::class)->start($order)['attempt'];
        app(PaymentOrchestrator::class)->applySnapshot($attempt, new PaymentProviderSnapshot((string) $attempt->provider_payment_id, 'captured', 5000, 'SAR', 5000));
        $this->attemptId = $attempt->id;
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
            // الجداول المحاسبية بلا CASCADE على الفاتورة/السند: نحذف مراجعها أولاً ثم المستأجر المتسلسل.
            foreach ($this->tenants as $id) {
                DB::table('commerce_order_postings')->where('tenant_id', $id)->delete();
                DB::table('payment_attempt_postings')->where('tenant_id', $id)->delete();
                DB::table('tenants')->where('id', $id)->delete();
            }
            DB::table('platform_runtime_heartbeats')->where('component', SchedulerHeartbeat::COMPONENT)->delete();
        }

        parent::tearDown();
    }

    #[Test]
    public function concurrent_postings_and_completions_of_one_capture_create_exactly_one_invoice_and_one_voucher(): void
    {
        $tenant = $this->tenantId;
        $attemptId = $this->attemptId;
        $poster = function () use ($tenant, $attemptId) {
            app(TenantContext::class)->set($tenant);
            config(['payments.commerce_invoice_on_payment.enabled' => true, 'payments.commerce_invoice_on_payment.tax_opinion_ref' => 'EXT-05/TEST']);
            $attempt = PaymentAttempt::query()->findOrFail($attemptId);
            app(CommerceOnlinePaymentService::class)->completeCaptured($attempt);

            return ['outcome' => app(PaymentAttemptPostingService::class)->process(PaymentAttempt::query()->findOrFail($attemptId))];
        };

        $results = $this->runConcurrently(array_fill(0, 6, $poster));

        $this->assertAllOk($results);
        $outcomes = array_column(array_column($results, 'value'), 'outcome');
        $this->assertGreaterThanOrEqual(1, count(array_keys($outcomes, 'posted')), 'واحد على الأقل يُرحِّل');
        $this->assertSame(1, DB::table('invoices')->where('tenant_id', $tenant)->count());
        $this->assertSame(1, DB::table('payments')->where('tenant_id', $tenant)->count());
        $this->assertSame(1, DB::table('commerce_order_postings')->where('tenant_id', $tenant)->count());
        $this->assertSame(1, DB::table('payment_attempt_postings')->where('tenant_id', $tenant)->count());
        $this->assertSame('posted', DB::table('payment_attempts')->where('id', $attemptId)->value('posting_status'));
        $this->assertSame('paid', DB::table('commerce_payment_intents')->where('commerce_order_id', $this->orderId)->value('status'));
        $this->assertSame('consumed', InventoryReservation::query()->withoutGlobalScopes()->where('source_id', $this->orderId)->value('status'));
        $this->assertSame(1, DB::table('stock_movements')->where('tenant_id', $tenant)->count(), 'إخراج مخزون واحد');
    }

    // ───────────────────────── مساعدات ─────────────────────────

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
