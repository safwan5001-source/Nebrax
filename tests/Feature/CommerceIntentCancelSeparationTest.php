<?php

namespace Tests\Feature;

use App\Console\Commands\CloseCancelledOrderAttemptsCommand;
use App\Models\CommerceListing;
use App\Models\CommercePaymentIntent;
use App\Models\InventoryReservation;
use App\Models\PaymentAttempt;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\Warehouse;
use App\Services\Commerce\CommercePaymentIntentService;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Services\Commerce\OrderCancellationCleanup;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

/**
 * COMMERCE-ORDERS-O3a-2a (ADR-28 §4.1 P-1…P-6) — فصل انتقال حالة نية الدفع عن تنظيف المحاولات.
 *
 * `cancelWithinTransaction()` انتقال حالة فقط؛ التنظيف (المزوّد + قفل المحاولة) بعد الالتزام النهائي عبر `DB::afterCommit` ويُعاد بمطابِق دوري؛
 * `cancel()` العامة بسلوك مطابق. اختبارات PostgreSQL (أقفال/جمود/تزامن) في `CommerceIntentCancelPostgresTest`.
 *
 * تشغيل: php artisan test --filter=CommerceIntentCancelSeparationTest
 */
class CommerceIntentCancelSeparationTest extends TestCase
{
    use InteractsWithApi;
    use OnlineStorefrontHarness;
    use RefreshDatabase;

    private Warehouse $warehouse;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootOnlineStore();
        app(TenantContext::class)->set($this->tenant->id);
        $this->warehouse = Warehouse::create(['name' => 'مخزن المتجر', 'code' => 'ONL-W1', 'is_default' => true]);
        app(FulfillmentPolicyService::class)->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        app(TenantContext::class)->forget();
    }

    private function tracked(int $onHand = 10): Product
    {
        app(TenantContext::class)->set($this->tenant->id);
        $product = Product::create(['name' => 'منتج مخزني', 'sku' => 'TR-'.Str::random(8), 'unit' => 'piece', 'sale_price' => 5000, 'is_active' => true, 'track_inventory' => true]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $this->channel->id, 'is_published' => true]);
        ProductWarehouseStock::create(['product_id' => $product->id, 'warehouse_id' => $this->warehouse->id, 'quantity' => $onHand]);
        app(TenantContext::class)->forget();

        return $product;
    }

    /** طلب إلكتروني بحجز فعّال ومحاولة دفع بصفحة حيّة (`pending_customer`). */
    private function liveOrder(string $key = 'idem-live-1'): array
    {
        $order = $this->onlineOrder(product: $this->tracked(), key: $key);
        $this->startPayment($order)->assertSuccessful();

        return $order;
    }

    /** طلب إلكتروني بحجز فعّال ومحاولة عالقة في `created` (انقطع المزوّد أثناء البدء) — إغلاقها يتطلب اتصالاً بالمزوّد. */
    private function createdAttemptOrder(string $key = 'idem-created-1'): array
    {
        $order = $this->onlineOrder(product: $this->tracked(), key: $key);
        $this->fake->failNextCheckouts();
        $this->startPayment($order)->assertStatus(503);
        $this->assertSame('created', $this->attempts($order['order_id'])->first()->capture_status);

        return $order;
    }

    private function service(): CommercePaymentIntentService
    {
        return app(CommercePaymentIntentService::class);
    }

    private function attemptStatus(string $orderId): string
    {
        return (string) $this->attempts($orderId)->first()->capture_status;
    }

    private function holdStatuses(string $orderId): array
    {
        return InventoryReservation::query()->withoutGlobalScopes()->where('source_id', $orderId)->pluck('status')->all();
    }

    // ── P-1: cancel() العامة بسلوك مطابق ─────────────────────────────────

    #[Test]
    public function public_cancel_keeps_its_behavior_for_a_live_online_order(): void
    {
        $order = $this->liveOrder();
        $intent = $this->intent($order['order_id']);

        $cancelled = $this->service()->cancel($intent);

        $this->assertSame(CommercePaymentIntent::STATUS_CANCELLED, $cancelled->status);
        $this->assertNotNull($cancelled->cancelled_at);
        $this->assertSame('cancelled', $this->attemptStatus($order['order_id']), 'the live attempt is closed right after the commit, as before');
        $this->assertSame([InventoryReservation::STATUS_RELEASED], $this->holdStatuses($order['order_id']), 'the hold is released, as before');
    }

    #[Test]
    public function public_cancel_keeps_its_rejections(): void
    {
        // ملتقَط ⇒ يُرفض ولا يتغيّر شيء.
        $captured = $this->liveOrder('idem-cap-1');
        $this->capture($this->attempts($captured['order_id'])->first());
        app(\App\Services\PaymentOrchestrator::class)->sync($this->attempts($captured['order_id'])->first());
        $this->unsettle($captured['order_id']);
        $e = $this->thrownRuntime(fn () => $this->service()->cancel($this->intent($captured['order_id'])));
        $this->assertStringContainsString('التقاط', $e->getMessage());
        $this->assertSame('pending', $this->intent($captured['order_id'])->fresh()->status);
        $this->assertSame([InventoryReservation::STATUS_ACTIVE], $this->holdStatuses($captured['order_id']));

        // ملغاة بالفعل ⇒ يُرفض.
        $live = $this->liveOrder('idem-live-2');
        $this->service()->cancel($this->intent($live['order_id']));
        $this->assertStringContainsString('مُلغىً', $this->thrownRuntime(fn () => $this->service()->cancel($this->intent($live['order_id'])))->getMessage());

        // مدفوعة ⇒ يُرفض.
        $paid = $this->liveOrder('idem-paid-1');
        DB::table('commerce_payment_intents')->where('commerce_order_id', $paid['order_id'])->update(['status' => 'paid', 'paid_at' => now('UTC')]);
        $this->assertStringContainsString('مُحصَّل', $this->thrownRuntime(fn () => $this->service()->cancel($this->intent($paid['order_id'])))->getMessage());
    }

    /** يعيد النية إلى `pending` بعد التقاط المحاولة (حالة سبق فيها الالتقاط تثبيتَ النية) ليُمرَّن حاجز `hasCapture` وحده. */
    private function unsettle(string $orderId): void
    {
        DB::table('commerce_payment_intents')->where('commerce_order_id', $orderId)->update(['status' => 'pending', 'paid_at' => null]);
    }

    private function thrownRuntime(callable $fn): RuntimeException
    {
        try {
            $fn();
        } catch (RuntimeException $e) {
            return $e;
        }
        $this->fail('RuntimeException expected');
    }

    // ── P-1/P-2: cancelWithinTransaction انتقال حالة فقط ─────────────────

    #[Test]
    public function cancel_within_transaction_changes_only_the_intent_state(): void
    {
        $order = $this->liveOrder();
        $calls = count($this->fake->checkoutCalls);
        $fetches = $this->fake->fetchCount;

        $cancelled = $this->service()->cancelWithinTransaction($this->intent($order['order_id']));

        $this->assertSame(CommercePaymentIntent::STATUS_CANCELLED, $cancelled->status);
        $this->assertNotNull($cancelled->cancelled_at);
        $this->assertSame('pending_customer', $this->attemptStatus($order['order_id']), 'attempts are not touched');
        $this->assertSame([InventoryReservation::STATUS_ACTIVE], $this->holdStatuses($order['order_id']), 'the hold is not released here');
        $this->assertCount($calls, $this->fake->checkoutCalls, 'no provider call');
        $this->assertSame($fetches, $this->fake->fetchCount, 'no provider call');
    }

    #[Test]
    public function cancel_within_transaction_keeps_every_rejection_of_the_public_method(): void
    {
        $order = $this->liveOrder();
        $this->service()->cancelWithinTransaction($this->intent($order['order_id']));
        $this->assertStringContainsString('مُلغىً', $this->thrownRuntime(fn () => $this->service()->cancelWithinTransaction($this->intent($order['order_id'])))->getMessage());

        $captured = $this->liveOrder('idem-cap-2');
        $this->capture($this->attempts($captured['order_id'])->first());
        app(\App\Services\PaymentOrchestrator::class)->sync($this->attempts($captured['order_id'])->first());
        $this->unsettle($captured['order_id']);
        $this->assertStringContainsString('التقاط', $this->thrownRuntime(fn () => $this->service()->cancelWithinTransaction($this->intent($captured['order_id'])))->getMessage());
        $this->assertSame('pending', $this->intent($captured['order_id'])->fresh()->status);
    }

    // ── P-3: التنظيف بعد الالتزام النهائي ────────────────────────────────

    #[Test]
    public function nested_in_an_outer_transaction_the_cleanup_waits_for_the_final_commit(): void
    {
        $order = $this->createdAttemptOrder();
        $calls = count($this->fake->checkoutCalls);
        $seen = [];

        DB::transaction(function () use ($order, &$seen, $calls): void {
            $this->service()->cancel($this->intent($order['order_id']));
            $seen = [
                'attempt' => $this->attemptStatus($order['order_id']),
                'holds' => $this->holdStatuses($order['order_id']),
                'provider_calls' => count($this->fake->checkoutCalls) - $calls,
            ];
        });

        // داخل المعاملة الخارجية: لا تنظيف ولا اتصال بالمزوّد ولا تحرير حجز.
        $this->assertSame('created', $seen['attempt']);
        $this->assertSame([InventoryReservation::STATUS_ACTIVE], $seen['holds']);
        $this->assertSame(0, $seen['provider_calls']);
        // بعد الالتزام النهائي: التنظيف جرى.
        $this->assertSame('cancelled', $this->attemptStatus($order['order_id']));
        $this->assertSame([InventoryReservation::STATUS_RELEASED], $this->holdStatuses($order['order_id']));
        $this->assertGreaterThan($calls, count($this->fake->checkoutCalls), 'the provider is contacted only after the commit');
    }

    #[Test]
    public function a_rolled_back_outer_transaction_never_cleans_up_and_leaves_everything_untouched(): void
    {
        $order = $this->createdAttemptOrder();
        $calls = count($this->fake->checkoutCalls);

        try {
            DB::transaction(function () use ($order): void {
                $this->service()->cancel($this->intent($order['order_id']));
                throw new RuntimeException('outer failure after the intent transition');
            });
            $this->fail('the outer transaction must roll back');
        } catch (RuntimeException $e) {
            $this->assertSame('outer failure after the intent transition', $e->getMessage());
        }

        $this->assertSame('pending', $this->intent($order['order_id'])->fresh()->status, 'intent transition rolled back');
        $this->assertNull($this->intent($order['order_id'])->fresh()->cancelled_at);
        $this->assertSame('created', $this->attemptStatus($order['order_id']));
        $this->assertSame([InventoryReservation::STATUS_ACTIVE], $this->holdStatuses($order['order_id']));
        $this->assertCount($calls, $this->fake->checkoutCalls, 'the provider was never contacted');
    }

    // ── فشل المزوّد/المهلة: الحالة متسقة والمطابِق يعيد المحاولة ───────────

    #[Test]
    public function a_provider_failure_during_cleanup_leaves_a_consistent_state_and_the_reconciler_heals_it(): void
    {
        $order = $this->createdAttemptOrder();
        $this->fake->failNextCheckouts(); // المزوّد ما زال غير متاح عند تنظيف ما بعد الالتزام

        $cancelled = $this->service()->cancel($this->intent($order['order_id'])); // لا يرمي

        $this->assertSame(CommercePaymentIntent::STATUS_CANCELLED, $cancelled->status);
        $this->assertSame('created', $this->attemptStatus($order['order_id']), 'cleanup failed — the attempt stays active');
        $this->assertSame([InventoryReservation::STATUS_RELEASED], $this->holdStatuses($order['order_id']), 'the hold release is independent of the provider');
        $this->assertSame('cancelled', $this->intent($order['order_id'])->fresh()->status);

        // النافذة: الإلغاء حديث (لم تمرّ مهلة السماح) ⇒ المطابِق لا يلمسه بعد.
        $summary = $this->runReconciler();
        $this->assertSame(0, $summary['processed']);

        $this->backdateCancellation($order['order_id'], 5);
        $this->fake->failNextCheckouts(); // ما زال المزوّد معطلاً: يُحتسب «ما زال معلّقاً» لا فشلاً قاتلاً
        $summary = $this->runReconciler();
        $this->assertSame(['processed' => 1, 'cleaned' => 0, 'still_pending' => 1, 'failed' => 0], $summary);
        $this->assertSame('created', $this->attemptStatus($order['order_id']));

        // عاد المزوّد: النجاح.
        $summary = $this->runReconciler();
        $this->assertSame(['processed' => 1, 'cleaned' => 1, 'still_pending' => 0, 'failed' => 0], $summary);
        $this->assertSame('cancelled', $this->attemptStatus($order['order_id']));

        // idempotent: لا عمل متبقٍّ ولا اتصال إضافي بالمزوّد.
        $calls = count($this->fake->checkoutCalls);
        $this->assertSame(['processed' => 0, 'cleaned' => 0, 'still_pending' => 0, 'failed' => 0], $this->runReconciler());
        $this->assertCount($calls, $this->fake->checkoutCalls);
    }

    #[Test]
    public function the_reconciler_respects_the_window_the_scope_and_the_limit(): void
    {
        // إلغاء حديث (داخل مهلة السماح) لا يُلمس؛ أقدم من النافذة لا يُلمس؛ نية COD لا تُلمس.
        $recent = $this->createdAttemptOrder('idem-r-1');
        $old = $this->createdAttemptOrder('idem-r-2');
        $this->fake->failNextCheckouts(2);
        $this->service()->cancelWithinTransaction($this->intent($recent['order_id']));
        $this->service()->cancelWithinTransaction($this->intent($old['order_id']));
        $this->backdateCancellation($old['order_id'], 60 * 24 * 8); // 8 أيام

        $this->assertSame(0, $this->runReconciler()['processed']);

        $this->backdateCancellation($recent['order_id'], 5);
        $this->assertSame(1, $this->runReconciler(1)['processed'], 'limit and window');
        $this->assertSame('created', $this->attemptStatus($old['order_id']), 'older than the window: never touched');
    }

    /** مراجعة Codex P2: محاولة `authorized` لا يغلقها `cancel()` أبداً فلا يجوز أن تحجز مقدّمة الدفعة وتجوّع النوايا القابلة للإغلاق. */
    #[Test]
    public function an_authorized_attempt_never_occupies_the_batch_or_starves_closable_intents(): void
    {
        $stuck = $this->createdAttemptOrder('idem-auth-1');
        $closable = $this->createdAttemptOrder('idem-auth-2');
        $this->service()->cancelWithinTransaction($this->intent($stuck['order_id']));
        $this->service()->cancelWithinTransaction($this->intent($closable['order_id']));
        $this->backdateCancellation($stuck['order_id'], 60 * 24 * 3); // الأقدم: كان سيتصدّر ترتيب «الأقدم أولاً»
        $this->backdateCancellation($closable['order_id'], 5);
        DB::table('payment_attempts')->where('id', $this->attempts($stuck['order_id'])->first()->id)->update(['capture_status' => PaymentAttempt::STATUS_AUTHORIZED]);

        $summary = $this->runReconciler(1); // دفعة من واحد: لو دخلت المصرَّح بها لحجزتها

        $this->assertSame(['processed' => 1, 'cleaned' => 1, 'still_pending' => 0, 'failed' => 0], $summary);
        $this->assertSame('cancelled', $this->attemptStatus($closable['order_id']), 'the closable intent is reached');
        $this->assertSame('authorized', $this->attemptStatus($stuck['order_id']), 'the authorized attempt is left to its own (capture/review) path');
        $this->assertSame(0, $this->runReconciler(1)['processed'], 'nothing is left for the reconciler once only the authorized attempt remains');
    }

    /** مراجعة Codex P2: فشل تحميل المحاولات يجب أن يُحتسب فشلاً (معلّقاً) لا تنظيفاً ناجحاً (`array +` كان يُبقي failed=0). */
    #[Test]
    public function a_failure_loading_the_attempts_is_reported_as_failed_not_as_cleaned(): void
    {
        $order = $this->createdAttemptOrder();
        $intent = $this->intent($order['order_id']);
        PaymentAttempt::addGlobalScope('boom', static function (): void {
            throw new RuntimeException('simulated attempt query failure');
        });

        try {
            $result = app(\App\Services\Commerce\CommerceOnlinePaymentService::class)->closeActiveAttemptsIsolated($intent);
        } finally {
            PaymentAttempt::clearBootedModels();
        }

        $this->assertSame(['closed' => 0, 'skipped' => 0, 'failed' => 1, 'remaining' => 0], $result);
        $this->assertSame('created', $this->attemptStatus($order['order_id']), 'nothing was closed');
    }

    #[Test]
    public function the_reconciler_runs_each_intent_under_its_own_tenant_and_restores_the_context(): void
    {
        $order = $this->createdAttemptOrder();
        $this->service()->cancelWithinTransaction($this->intent($order['order_id']));
        $this->backdateCancellation($order['order_id'], 5);
        app(TenantContext::class)->forget();

        $summary = app(OrderCancellationCleanup::class)->runPending();

        $this->assertSame(1, $summary['cleaned']);
        $this->assertFalse(app(TenantContext::class)->has(), 'the tenant context is restored after the run');
        $this->assertSame('cancelled', DB::table('payment_attempts')->where('tenant_id', $this->tenant->id)->value('capture_status'));
    }

    #[Test]
    public function the_command_is_scheduled_and_has_no_accounting_or_inventory_effect(): void
    {
        $scheduled = collect(app(\Illuminate\Console\Scheduling\Schedule::class)->events())
            ->contains(fn ($event) => str_contains((string) $event->command, 'commerce:close-cancelled-order-attempts'));
        $this->assertTrue($scheduled, 'must be scheduled like the other commerce safety nets');

        $order = $this->createdAttemptOrder();
        $this->service()->cancelWithinTransaction($this->intent($order['order_id']));
        $this->backdateCancellation($order['order_id'], 5);
        $before = $this->counts();
        $intent = $this->intent($order['order_id'])->fresh()->toArray();

        $this->assertSame(0, Artisan::call('commerce:close-cancelled-order-attempts'));

        $this->assertSame($before, $this->counts(), 'no journal, payment, invoice, stock or reservation effect');
        $this->assertSame($intent, $this->intent($order['order_id'])->fresh()->toArray(), 'the intent is not touched by the reconciler');
        $this->assertInstanceOf(CloseCancelledOrderAttemptsCommand::class, app(\Illuminate\Contracts\Console\Kernel::class)->all()['commerce:close-cancelled-order-attempts']);
    }

    // ── P-2/P-4/P-6: ضمانات ساكنة ─────────────────────────────────────────

    #[Test]
    public function the_state_transition_method_contains_no_provider_attempt_or_reservation_work(): void
    {
        $source = file_get_contents(app_path('Services/Commerce/CommercePaymentIntentService.php'));
        $start = strpos($source, 'public function cancelWithinTransaction');
        $this->assertSame(1, preg_match('/\n    (?:public|private|protected) function /', $source, $next, PREG_OFFSET_CAPTURE, $start + 10));
        $body = substr($source, $start, $next[0][1] - $start);

        foreach (['closeActiveAttempts', 'Orchestrator', 'orchestrator', 'releaseActive', 'OrderCancellationCleanup', 'Http::', 'PaymentAttempt::query', 'afterCommit'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $body, "cancelWithinTransaction must not use {$forbidden} (ADR-28 P-2)");
        }
        $this->assertStringContainsString('lockForUpdate', $body);
        // التنظيف يُجدوَل عبر afterCommit فقط داخل cancel().
        $cancel = substr($source, strpos($source, 'public function cancel('), $start - strpos($source, 'public function cancel('));
        $this->assertStringContainsString('DB::afterCommit', $cancel);
        $this->assertStringNotContainsString('->closeActiveAttempts(', $cancel, 'cleanup goes through OrderCancellationCleanup');
    }

    #[Test]
    public function the_cleanup_class_never_opens_a_transaction_or_locks_and_never_throws(): void
    {
        $source = file_get_contents(app_path('Services/Commerce/OrderCancellationCleanup.php'));
        $this->assertStringNotContainsString('DB::transaction', $source);
        $this->assertStringNotContainsString('lockForUpdate', $source);

        $online = file_get_contents(app_path('Services/Commerce/CommerceOnlinePaymentService.php'));
        $start = strpos($online, 'public function closeActiveAttemptsIsolated');
        $body = substr($online, $start, strpos($online, 'public function runPending', $start) - $start);
        $this->assertStringContainsString('catch (\\Throwable', $body);
        $this->assertStringNotContainsString('lockForUpdate', $body);
        $this->assertStringNotContainsString('DB::transaction', $body);
    }

    #[Test]
    public function only_the_expected_callers_use_the_public_intent_cancel(): void
    {
        // P-6 (ADR-28): خدمة الإلغاء المقبلة (O3a-2b) تستعمل cancelWithinTransaction لا cancel(). المستدعون العامّون اليوم محصورون هنا.
        $allowed = [
            'app/Http/Controllers/Api/CommercePaymentIntentController.php',
            'app/Services/Commerce/CommerceUnpaidOrderSweeper.php',
        ];
        $found = [];
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(app_path()));
        foreach ($iterator as $file) {
            if (! str_ends_with((string) $file, '.php')) {
                continue;
            }
            if (preg_match('/\b(intents|paymentIntents|intentService|intent_service)->cancel\(/', (string) file_get_contents((string) $file))) {
                $found[] = str_replace(base_path().'/', '', (string) $file);
            }
        }
        sort($found);
        $this->assertSame($allowed, $found);
    }

    #[Test]
    public function this_slice_added_no_order_cancellation_route_and_the_o3a_2b_gate_stays_closed_by_default(): void
    {
        // O3a-2a لم تضف مساراً ولا بوابة؛ O3a-2b أضافت مسار الموظف الوحيد وبوابته المغلقة افتراضياً (لا مسار إلغاء آخر).
        $routes = [];
        foreach (\Illuminate\Support\Facades\Route::getRoutes() as $route) {
            if (preg_match('#commerce/orders/\{[^}]+\}/cancel#', $route->uri())) {
                $routes[] = $route->uri();
            }
        }
        $this->assertSame(['api/commerce/orders/{id}/cancel'], $routes);
        $this->assertFalse((bool) (require base_path('config/commerce.php'))['order_cancellation_enabled'], 'closed unless explicitly enabled');
    }

    // ── مساعدات ───────────────────────────────────────────────────────────

    /** @return array{processed: int, cleaned: int, still_pending: int, failed: int} */
    private function runReconciler(int $limit = 100): array
    {
        app(TenantContext::class)->forget();
        $summary = app(OrderCancellationCleanup::class)->runPending($limit);
        app(TenantContext::class)->set($this->tenant->id);

        return $summary;
    }

    private function backdateCancellation(string $orderId, int $minutes): void
    {
        DB::table('commerce_payment_intents')->where('commerce_order_id', $orderId)->update(['cancelled_at' => now('UTC')->subMinutes($minutes)]);
    }
}
