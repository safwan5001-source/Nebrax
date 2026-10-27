<?php

namespace Tests\Feature;

use App\Models\CommerceOrder;
use App\Models\CommerceOrderLine;
use App\Models\CommercePaymentIntent;
use App\Models\InventoryReservation;
use App\Models\JournalEntry;
use App\Models\SalesChannel;
use App\Models\StockMovement;
use App\Models\Storefront;
use App\Models\User;
use App\Support\CommerceOrderSerializer;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/**
 * COMMERCE-ORDERS-O3a-1 (ADR-28) — حقائق إلغاء طلب المتجر: التخزين، حراس قاعدة البيانات، القراءة المشتقّة، وعرض الموظف.
 * لا مسار إلغاء هنا (O3a-2b): الاختبارات تكتب الحقائق عبر SQL مباشر فقط لتمرين الحراس.
 *
 * تشغيل: php artisan test --filter=CommerceOrderCancellationFactsTest
 */
class CommerceOrderCancellationFactsTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use RefreshDatabase;

    private function order(string $tenantId, bool $confirmed = true, ?string $number = null): CommerceOrder
    {
        $ctx = app(TenantContext::class);
        $prev = $ctx->id();
        $ctx->set($tenantId);

        $channel = SalesChannel::query()->first()
            ?? SalesChannel::create(['slug' => 'web', 'name' => 'متجر الويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefront = Storefront::query()->first()
            ?? Storefront::create(['slug' => 'main-'.Str::random(5), 'name' => 'المتجر', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        $order = CommerceOrder::create([
            'sales_channel_id' => $channel->id, 'storefront_id' => $storefront->id,
            'number' => $number ?? 'CORD-'.Str::upper(Str::random(6)), 'delivery_method' => 'standard', 'total' => 11500,
        ]);
        CommerceOrderLine::create([
            'commerce_order_id' => $order->id, 'product_name_snapshot' => 'وردة', 'quantity' => 1, 'unit_price' => 11500, 'line_total' => 11500,
        ]);
        $order->snapshot()->create(['customer_name' => 'سارة', 'phone' => '0500000001']);
        if ($confirmed) {
            $order->update(['status' => CommerceOrder::STATUS_CONFIRMED, 'confirmed_at' => now()]);
            CommercePaymentIntent::create([
                'commerce_order_id' => $order->id, 'method' => CommercePaymentIntent::METHOD_COD,
                'status' => CommercePaymentIntent::STATUS_AWAITING_COLLECTION, 'amount_minor' => 11500, 'currency' => 'SAR',
            ]);
        }
        $prev === null ? $ctx->forget() : $ctx->set($prev);

        return $order->fresh();
    }

    /** SQL مباشر (يتجاوز النموذج) لتمرين الحراس. */
    private function raw(string $id, array $set): int
    {
        return DB::table('commerce_orders')->where('id', $id)->update($set);
    }

    private function assertGuard(callable $operation, string $why): void
    {
        // savepoint: على PostgreSQL يُبطل الخطأ المعاملة المحيطة (معاملة الاختبار) ما لم يُعزل.
        $e = $this->thrown(fn () => DB::transaction($operation), $why, QueryException::class);
        $this->assertStringContainsString('commerce_orders', $e->getMessage(), $why);
    }

    private function cancelRaw(string $id, string $reason = 'customer_request', ?string $note = null, ?string $by = null): int
    {
        return $this->raw($id, [
            'cancelled_at' => now('UTC'), 'cancellation_reason' => $reason, 'cancellation_note' => $note, 'cancelled_by_user_id' => $by,
        ]);
    }

    // ── التخزين ───────────────────────────────────────────────────────────

    #[\PHPUnit\Framework\Attributes\Test]
    public function the_columns_exist_are_nullable_and_leave_existing_rows_untouched(): void
    {
        foreach (['cancelled_at', 'cancelled_by_user_id', 'cancellation_reason', 'cancellation_note'] as $column) {
            $this->assertTrue(Schema::hasColumn('commerce_orders', $column), $column);
        }
        [$tenantId] = $this->owner();
        $order = $this->order($tenantId);

        $row = DB::table('commerce_orders')->where('id', $order->id)->first();
        $this->assertNull($row->cancelled_at);
        $this->assertNull($row->cancelled_by_user_id);
        $this->assertNull($row->cancellation_reason);
        $this->assertNull($row->cancellation_note);
        $this->assertSame('confirmed', $row->status);
    }

    #[\PHPUnit\Framework\Attributes\Test]
    public function the_status_column_is_unchanged_and_still_rejects_cancelled(): void
    {
        // قيد enum يُفرض في PostgreSQL (CHECK). جدول SQLite أُعيد بناؤه بهجرات سابقة فلا يحمل قيد enum — خاصية قائمة قبل O3a-1.
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('The status enum CHECK constraint exists on PostgreSQL only (SQLite table was rebuilt by earlier migrations).');
        }
        [$tenantId] = $this->owner();
        $order = $this->order($tenantId);

        $this->thrown(fn () => DB::transaction(fn () => $this->raw($order->id, ['status' => 'cancelled'])), 'status enum must not accept cancelled', QueryException::class);
    }

    #[\PHPUnit\Framework\Attributes\Test]
    public function the_tenant_cancelled_at_index_exists(): void
    {
        $indexes = collect(Schema::getIndexes('commerce_orders'))->pluck('name')->all();
        $this->assertContains('commerce_orders_tenant_cancelled_at_index', $indexes);
    }

    // ── الحراس ────────────────────────────────────────────────────────────

    #[\PHPUnit\Framework\Attributes\Test]
    public function a_confirmed_order_can_be_cancelled_with_an_approved_reason(): void
    {
        [$tenantId, , $userId] = $this->owner();
        $order = $this->order($tenantId);

        $this->assertSame(1, $this->cancelRaw($order->id, 'out_of_stock', null, $userId));
        $fresh = $order->fresh();
        $this->assertTrue($fresh->isCancelled());
        $this->assertSame('out_of_stock', $fresh->cancellation_reason);
        $this->assertSame($userId, $fresh->cancelled_by_user_id);
        $this->assertSame('confirmed', $fresh->status, 'status stays confirmed — cancellation is a separate fact');
    }

    #[\PHPUnit\Framework\Attributes\Test]
    public function every_approved_reason_is_accepted_and_other_requires_a_note(): void
    {
        [$tenantId] = $this->owner();
        foreach (CommerceOrder::CANCELLATION_REASONS as $reason) {
            $order = $this->order($tenantId);
            if ($reason === 'other') {
                $this->assertGuard(fn () => $this->cancelRaw($order->id, 'other'), 'other without a note');
                $this->assertGuard(fn () => $this->cancelRaw($order->id, 'other', '   '), 'other with a blank note');
                $this->assertSame(1, $this->cancelRaw($order->id, 'other', 'تواصل العميل هاتفياً'));
            } else {
                $this->assertSame(1, $this->cancelRaw($order->id, $reason), $reason);
            }
        }
    }

    #[\PHPUnit\Framework\Attributes\Test]
    public function a_draft_order_cannot_be_cancelled(): void
    {
        [$tenantId] = $this->owner();
        $draft = $this->order($tenantId, confirmed: false);

        $this->assertGuard(fn () => $this->cancelRaw($draft->id), 'draft cancellation');
        // ولا بالتزامن مع تأكيده في العبارة نفسها.
        $this->assertGuard(fn () => $this->raw($draft->id, [
            'status' => 'confirmed', 'cancelled_at' => now('UTC'), 'cancellation_reason' => 'customer_request',
        ]), 'confirm and cancel in one statement');
    }

    #[\PHPUnit\Framework\Attributes\Test]
    public function a_cancellation_without_an_approved_reason_is_rejected(): void
    {
        [$tenantId] = $this->owner();
        $order = $this->order($tenantId);

        $this->assertGuard(fn () => $this->raw($order->id, ['cancelled_at' => now('UTC')]), 'no reason');
        $this->assertGuard(fn () => $this->cancelRaw($order->id, 'because'), 'unknown reason');
        $this->assertGuard(fn () => $this->cancelRaw($order->id, ''), 'empty reason');
        $this->assertFalse($order->fresh()->isCancelled());
    }

    #[\PHPUnit\Framework\Attributes\Test]
    public function cancellation_details_cannot_exist_without_cancelled_at(): void
    {
        [$tenantId] = $this->owner();
        $order = $this->order($tenantId);

        $this->assertGuard(fn () => $this->raw($order->id, ['cancellation_reason' => 'customer_request']), 'reason only');
        $this->assertGuard(fn () => $this->raw($order->id, ['cancellation_note' => 'x']), 'note only');
    }

    #[\PHPUnit\Framework\Attributes\Test]
    public function an_order_cannot_be_created_already_cancelled(): void
    {
        [$tenantId] = $this->owner();
        $order = $this->order($tenantId);
        $row = (array) DB::table('commerce_orders')->where('id', $order->id)->first();
        $row['id'] = (string) Str::uuid();
        $row['number'] = 'CORD-X-'.Str::random(5);
        $row['commerce_checkout_id'] = null;
        $row['cancelled_at'] = now('UTC');
        $row['cancellation_reason'] = 'customer_request';

        $this->assertGuard(fn () => DB::table('commerce_orders')->insert($row), 'insert cancelled');
    }

    #[\PHPUnit\Framework\Attributes\Test]
    public function the_cancellation_facts_are_immutable_once_recorded(): void
    {
        [$tenantId, , $userId] = $this->owner();
        $order = $this->order($tenantId);
        $this->cancelRaw($order->id, 'customer_request', 'ملاحظة', $userId);

        $this->assertGuard(fn () => $this->raw($order->id, ['cancelled_at' => null]), 'clear cancelled_at (un-cancel)');
        $this->assertGuard(fn () => $this->raw($order->id, ['cancelled_at' => now('UTC')->addDay()]), 'move cancelled_at');
        $this->assertGuard(fn () => $this->raw($order->id, ['cancellation_reason' => 'other']), 'change reason');
        $this->assertGuard(fn () => $this->raw($order->id, ['cancellation_reason' => null]), 'clear reason');
        $this->assertGuard(fn () => $this->raw($order->id, ['cancellation_note' => 'تعديل']), 'change note');
        $this->assertGuard(fn () => $this->raw($order->id, ['cancellation_note' => null]), 'clear note');
        $this->assertGuard(fn () => $this->raw($order->id, ['cancelled_by_user_id' => (string) Str::uuid()]), 'change actor');
        $this->assertGuard(fn () => $this->raw($order->id, ['status' => 'draft']), 'status change after cancel');

        $fresh = $order->fresh();
        $this->assertSame('customer_request', $fresh->cancellation_reason);
        $this->assertSame('ملاحظة', $fresh->cancellation_note);
        $this->assertSame($userId, $fresh->cancelled_by_user_id);
    }

    #[\PHPUnit\Framework\Attributes\Test]
    public function deleting_the_actor_only_nulls_the_actor_and_never_breaks_the_guard(): void
    {
        [$tenantId] = $this->owner();
        $actor = $this->userFor($tenantId, 'admin', 'actor@acme.test');
        $order = $this->order($tenantId);
        $this->cancelRaw($order->id, 'customer_request', null, $actor);

        DB::table('users')->where('id', $actor)->delete(); // FK nullOnDelete ⇒ UPDATE cancelled_by_user_id = NULL

        $fresh = $order->fresh();
        $this->assertNull($fresh->cancelled_by_user_id);
        $this->assertTrue($fresh->isCancelled());
        $this->assertSame('customer_request', $fresh->cancellation_reason);
    }

    #[\PHPUnit\Framework\Attributes\Test]
    public function a_soft_deleted_actor_still_appears_as_the_historical_actor(): void
    {
        [$tenantId, $token] = $this->owner();
        $actor = $this->userFor($tenantId, 'admin', 'actor@acme.test');
        $order = $this->order($tenantId);
        $this->cancelRaw($order->id, 'customer_request', null, $actor);

        $before = $this->withToken($token)->getJson("/api/commerce/orders/{$order->id}")->assertOk()->json('data.cancellation.by');
        $this->assertSame(['id' => $actor, 'name' => User::withoutGlobalScopes()->find($actor)->name], $before);

        // الحذف الناعم كما يفعله UserController::destroy: الصف و cancelled_by_user_id باقيان.
        User::withoutGlobalScopes()->findOrFail($actor)->delete();
        $this->assertNull(User::query()->find($actor), "soft-deleted: hidden from the default scope");
        $this->assertNotNull(User::withTrashed()->find($actor));
        $this->assertSame($actor, $order->fresh()->cancelled_by_user_id);

        $after = $this->withToken($token)->getJson("/api/commerce/orders/{$order->id}")->assertOk()->json('data.cancellation.by');
        $this->assertSame($before, $after, 'deleting the account must not obscure who cancelled');

        // التحميل الكسول عبر النموذج (سياق المستأجر مضبوط) يحلّ المحذوف أيضاً.
        $ctx = app(TenantContext::class);
        $ctx->set($tenantId);
        $this->assertSame($actor, CommerceOrder::query()->findOrFail($order->id)->cancelledBy?->id);
    }

    #[\PHPUnit\Framework\Attributes\Test]
    public function the_actor_is_resolved_only_within_the_current_tenant(): void
    {
        [$tenantA, $tokenA] = $this->owner('acme', 'owner@acme.test');
        [$tenantB] = $this->owner('globex', 'owner@globex.test');
        $foreign = $this->userFor($tenantB, 'admin', 'foreign@globex.test');
        $order = $this->order($tenantA);
        // معرّف مستخدم من مستأجر آخر مكتوب بكتابة مباشرة (لا مسار تطبيقي يفعلها): لا يتسرّب اسمه.
        $this->cancelRaw($order->id, 'customer_request', null, $foreign);
        User::withoutGlobalScopes()->findOrFail($foreign)->delete(); // وحتى لو كان محذوفاً ناعماً

        $by = $this->withToken($tokenA)->getJson("/api/commerce/orders/{$order->id}")->assertOk()->json('data.cancellation.by');
        $this->assertSame($foreign, $by['id']);
        $this->assertNull($by['name'], 'a user of another tenant must never be resolved');
    }

    #[\PHPUnit\Framework\Attributes\Test]
    public function a_cancelled_order_cannot_be_deleted_but_other_orders_and_tenant_removal_still_work(): void
    {
        [$tenantId] = $this->owner();
        $cancelled = $this->order($tenantId);
        $plain = $this->order($tenantId);
        $this->cancelRaw($cancelled->id);

        $this->assertGuard(fn () => DB::table('commerce_orders')->where('id', $cancelled->id)->delete(), 'delete cancelled');
        $this->assertSame(1, DB::table('commerce_orders')->where('id', $cancelled->id)->count());
        // الحذف المنطقي للمستأجر لا يمسّ الطلبات؛ وطلب غير ملغى يُحذف عند غياب أي حارس نموذج (SQL مباشر).
        DB::table('commerce_order_lines')->where('commerce_order_id', $plain->id)->delete();
        DB::table('commerce_payment_intents')->where('commerce_order_id', $plain->id)->delete();
        DB::table('commerce_order_snapshots')->where('commerce_order_id', $plain->id)->delete();
        $this->assertSame(1, DB::table('commerce_orders')->where('id', $plain->id)->delete());

        // حذف المستأجر النهائي (cascade) يمرّ: المستأجر غير موجود عند حذف الطلب.
        DB::table('tenants')->where('id', $tenantId)->delete();
        $this->assertSame(0, DB::table('commerce_orders')->where('id', $cancelled->id)->count());
    }

    #[\PHPUnit\Framework\Attributes\Test]
    public function historical_data_stays_frozen_after_cancellation(): void
    {
        [$tenantId] = $this->owner();
        $order = $this->order($tenantId);
        $this->cancelRaw($order->id);
        $fresh = $order->fresh();

        // `isConfirmed()` لم يتغيّر معناه ⇒ حراس اللقطة/الإهداء/الموعد/التخصيص وحذف الطلب باقية.
        $this->assertTrue($fresh->isConfirmed());
        $this->assertFalse($fresh->isDraft());
        app(TenantContext::class)->set($tenantId);
        $e = $this->thrown(fn () => $fresh->snapshot->update(['customer_name' => 'تعديل']), 'snapshot must stay immutable', \Throwable::class);
        $this->assertNotNull($e);
        $this->thrown(fn () => $fresh->delete(), 'a confirmed (cancelled) order cannot be deleted', \LogicException::class);
        app(TenantContext::class)->forget();
        $this->assertSame('سارة', $order->fresh()->snapshot->customer_name);
    }

    // ── النموذج ───────────────────────────────────────────────────────────

    #[\PHPUnit\Framework\Attributes\Test]
    public function lifecycle_status_is_derived_and_the_facts_are_not_mass_assignable(): void
    {
        [$tenantId] = $this->owner();
        $draft = $this->order($tenantId, confirmed: false);
        $order = $this->order($tenantId);

        $this->assertSame('draft', $draft->lifecycleStatus());
        $this->assertSame('confirmed', $order->lifecycleStatus());
        $this->cancelRaw($order->id);
        $this->assertSame('cancelled', $order->fresh()->lifecycleStatus());

        $this->assertNotContains('cancelled_at', (new CommerceOrder)->getFillable());
        $this->assertNotContains('cancellation_reason', (new CommerceOrder)->getFillable());
        $this->assertNotContains('cancelled_by_user_id', (new CommerceOrder)->getFillable());
        $this->assertNotContains('cancellation_note', (new CommerceOrder)->getFillable());
        app(TenantContext::class)->set($tenantId);
        $other = $this->order($tenantId);
        $other->fill(['cancelled_at' => now(), 'cancellation_reason' => 'other']); // يُتجاهل بصمت (غير fillable)
        $this->assertFalse($other->isCancelled());
        app(TenantContext::class)->forget();
    }

    // ── API الموظف ────────────────────────────────────────────────────────

    #[\PHPUnit\Framework\Attributes\Test]
    public function staff_api_exposes_lifecycle_status_and_the_cancellation_block_additively(): void
    {
        [$tenantId, $token, $userId] = $this->owner();
        $active = $this->order($tenantId, number: 'CORD-ACTIVE');
        $cancelled = $this->order($tenantId, number: 'CORD-CANCELLED');
        $this->cancelRaw($cancelled->id, 'other', 'ملاحظة داخلية', $userId);

        $list = $this->withToken($token)->getJson('/api/commerce/orders?sort=number&direction=asc')->assertOk();
        $rows = collect($list->json('data'))->keyBy('number');
        // التوافق الخلفي: الحقول السابقة كما هي.
        $this->assertSame('confirmed', $rows['CORD-ACTIVE']['status']);
        $this->assertSame('confirmed', $rows['CORD-CANCELLED']['status']);
        $this->assertSame('confirmed', $rows['CORD-ACTIVE']['lifecycle_status']);
        $this->assertSame('cancelled', $rows['CORD-CANCELLED']['lifecycle_status']);
        $this->assertSame(['cancelled' => false, 'at' => null, 'reason' => null], $rows['CORD-ACTIVE']['cancellation']);
        $this->assertTrue($rows['CORD-CANCELLED']['cancellation']['cancelled']);
        $this->assertSame('other', $rows['CORD-CANCELLED']['cancellation']['reason']);
        // القائمة بلا الفاعل/الملاحظة (تفاصيل داخلية).
        $this->assertArrayNotHasKey('note', $rows['CORD-CANCELLED']['cancellation']);
        $this->assertArrayNotHasKey('by', $rows['CORD-CANCELLED']['cancellation']);
        foreach (['id', 'number', 'total', 'items_count', 'customer', 'channel', 'payment', 'created_at', 'delivery_method'] as $key) {
            $this->assertArrayHasKey($key, $rows['CORD-ACTIVE'], "previous key {$key} must remain");
        }

        $detail = $this->withToken($token)->getJson("/api/commerce/orders/{$cancelled->id}")->assertOk();
        $detail->assertJsonPath('data.lifecycle_status', 'cancelled')
            ->assertJsonPath('data.cancellation.cancelled', true)
            ->assertJsonPath('data.cancellation.reason', 'other')
            ->assertJsonPath('data.cancellation.note', 'ملاحظة داخلية')
            ->assertJsonPath('data.cancellation.by.id', $userId);
        $this->assertNotNull($detail->json('data.cancellation.by.name'));

        $plain = $this->withToken($token)->getJson("/api/commerce/orders/{$active->id}")->assertOk();
        $plain->assertJsonPath('data.cancellation.cancelled', false)->assertJsonPath('data.cancellation.by', null)->assertJsonPath('data.cancellation.note', null);
    }

    /** مراجعة Codex P2: حذف حساب الفاعل ناعمٌ (`SoftDeletes`) ويجب ألا يُخفي هويته التاريخية في تفاصيل الإلغاء. */
    #[\PHPUnit\Framework\Attributes\Test]
    public function the_cancellation_actor_stays_attributed_after_the_user_is_soft_deleted(): void
    {
        [$tenantId, $token] = $this->owner();
        $actorId = $this->userFor($tenantId, 'admin', 'former@acme.test');
        $actorName = (string) User::withoutGlobalScopes()->whereKey($actorId)->value('name');
        $order = $this->order($tenantId, number: 'CORD-HIST');
        $this->cancelRaw($order->id, 'customer_request', null, $actorId);

        User::withoutGlobalScopes()->findOrFail($actorId)->delete(); // حذف ناعم كما في UserController::destroy

        $this->assertSoftDeleted('users', ['id' => $actorId]);
        $this->assertSame($actorId, $order->fresh()->cancelled_by_user_id, 'the soft delete keeps the foreign key');

        $detail = $this->withToken($token)->getJson("/api/commerce/orders/{$order->id}")->assertOk();
        $detail->assertJsonPath('data.cancellation.by.id', $actorId)
            ->assertJsonPath('data.cancellation.by.name', $actorName);
        $this->assertNotSame('', $actorName);
    }

    #[\PHPUnit\Framework\Attributes\Test]
    public function the_lifecycle_status_filter_works_and_the_raw_status_filter_keeps_its_meaning(): void
    {
        [$tenantId, $token] = $this->owner();
        $this->order($tenantId, number: 'CORD-A');
        $this->order($tenantId, number: 'CORD-B');
        $b = $this->order($tenantId, number: 'CORD-C');
        $this->cancelRaw($b->id);
        $this->order($tenantId, confirmed: false, number: 'CORD-DRAFT');

        $numbers = fn (string $qs) => collect($this->withToken($token)->getJson('/api/commerce/orders?sort=number&direction=asc&'.$qs)->assertOk()->json('data'))->pluck('number')->all();

        $this->assertSame(['CORD-C'], $numbers('lifecycle_status=cancelled'));
        $this->assertSame(['CORD-A', 'CORD-B'], $numbers('lifecycle_status=confirmed'));
        $this->assertSame(['CORD-DRAFT'], $numbers('lifecycle_status=draft'));
        // التوافق: `status=confirmed` يضم الملغى كما كان (status الخام لم يتغيّر).
        $this->assertSame(['CORD-A', 'CORD-B', 'CORD-C'], $numbers('status=confirmed'));
        $this->withToken($token)->getJson('/api/commerce/orders?lifecycle_status=hacked')->assertStatus(422);
    }

    #[\PHPUnit\Framework\Attributes\Test]
    public function permissions_and_tenant_isolation_are_unchanged_for_cancelled_orders(): void
    {
        [$tenantA, $tokenA] = $this->owner('tenant-a', 'a@a.test');
        [$tenantB, $tokenB] = $this->owner('tenant-b', 'b@b.test');
        $orderA = $this->order($tenantA, number: 'CORD-A');
        $orderB = $this->order($tenantB, number: 'CORD-B');
        $this->cancelRaw($orderA->id);
        $this->cancelRaw($orderB->id);

        $this->withToken($tokenA)->getJson("/api/commerce/orders/{$orderB->id}")->assertNotFound();
        $this->assertSame(['CORD-A'], collect($this->withToken($tokenA)->getJson('/api/commerce/orders?lifecycle_status=cancelled')->json('data'))->pluck('number')->all());
        foreach (['accountant', 'staff', 'self_service'] as $role) {
            $token = $this->tokenForRole($tenantA, $role, "$role@a.test");
            $this->withToken($token)->getJson('/api/commerce/orders?lifecycle_status=cancelled')->assertForbidden();
            $this->withToken($token)->getJson("/api/commerce/orders/{$orderA->id}")->assertForbidden();
        }
        $this->flushHeaders()->getJson('/api/commerce/orders')->assertUnauthorized();
    }

    #[\PHPUnit\Framework\Attributes\Test]
    public function cancelled_rows_do_not_add_queries_to_the_list(): void
    {
        [$tenantId, $token] = $this->owner();
        $this->order($tenantId);
        $count = function () use ($token): int {
            DB::flushQueryLog();
            DB::enableQueryLog();
            $this->withToken($token)->getJson('/api/commerce/orders?per_page=50')->assertOk();
            // Sanctum يحدّث `last_used_at` للرمز عند تجاوز نافذته الزمنية — استعلام زمني لا علاقة له بعدد الطلبات
            // (يظهر أحياناً في القياس الثاني فقط فيُنتج 17/18). نستثنيه بالاسم فيبقى الاختبار كاشفاً لأي استعلام لكل طلب.
            $n = count(array_filter(DB::getQueryLog(), fn (array $q) => ! str_starts_with($q['query'], 'update "personal_access_tokens"')));
            DB::disableQueryLog();

            return $n;
        };
        // الأعداد تُقاس بعد إدخال الصفوف المُلغاة وبعد تسخين كافٍ: الاستعلامات العابرة
        // (مثل تحديث آخر استخدام للرمز) لا تُنسب إلى الإلغاء. المقارنة بين حجمين مختلفين
        // من الصفوف المُلغاة، وهي التي تكشف أي استعلام لكل صف.
        for ($i = 0; $i < 2; $i++) {
            $this->cancelRaw($this->order($tenantId)->id);
        }
        $count();
        $count();
        $few = $count();
        for ($i = 0; $i < 5; $i++) {
            $this->cancelRaw($this->order($tenantId)->id);
        }
        $count();
        $this->assertSame($few, $count());
    }

    // ── النطاق: لا مسار إلغاء ولا أثر جانبي ───────────────────────────────

    #[\PHPUnit\Framework\Attributes\Test]
    public function there_is_no_cancel_route_and_the_public_serializer_is_untouched(): void
    {
        foreach (Route::getRoutes() as $route) {
            $this->assertDoesNotMatchRegularExpression('#commerce/orders/\{[^}]+\}/cancel#', $route->uri());
        }
        [$tenantId] = $this->owner();
        $order = $this->order($tenantId);
        $this->cancelRaw($order->id);
        app(TenantContext::class)->set($tenantId);
        $public = CommerceOrderSerializer::serialize(CommerceOrder::query()->findOrFail($order->id));
        app(TenantContext::class)->forget();

        // O3c لاحقاً: لا تغيير في عقد الجمهور الآن.
        $this->assertSame('confirmed', $public['status']);
        $this->assertArrayNotHasKey('cancellation', $public);
        $this->assertArrayNotHasKey('lifecycle_status', $public);
    }

    #[\PHPUnit\Framework\Attributes\Test]
    public function writing_the_facts_has_no_payment_inventory_or_ledger_side_effect(): void
    {
        [$tenantId] = $this->owner();
        $order = $this->order($tenantId);
        $snapshot = fn () => [
            'intent' => DB::table('commerce_payment_intents')->get()->toJson(),
            'journal' => JournalEntry::withoutGlobalScopes()->count(),
            'stock' => StockMovement::withoutGlobalScopes()->count(),
            'reservations' => InventoryReservation::withoutGlobalScopes()->count(),
            'reservation_rows' => DB::table('inventory_reservations')->get()->toJson(),
        ];
        $before = $snapshot();
        $this->cancelRaw($order->id);
        $this->assertSame($before, $snapshot());
    }

    #[\PHPUnit\Framework\Attributes\Test]
    public function rolling_back_is_refused_while_cancelled_orders_exist_and_works_otherwise(): void
    {
        [$tenantId] = $this->owner();
        $order = $this->order($tenantId);
        $migration = require base_path('database/migrations/2026_12_13_010000_add_cancellation_facts_to_commerce_orders.php');

        $this->cancelRaw($order->id);
        $e = $this->thrown(fn () => $migration->down(), 'down() must refuse with cancelled orders', RuntimeException::class);
        $this->assertStringContainsString('Rollback refused', $e->getMessage());
        $this->assertTrue(Schema::hasColumn('commerce_orders', 'cancelled_at'));
    }

    #[\PHPUnit\Framework\Attributes\Test]
    public function rollback_without_cancelled_orders_removes_the_guards_and_up_restores_them(): void
    {
        [$tenantId] = $this->owner();
        $order = $this->order($tenantId);
        $migration = require base_path('database/migrations/2026_12_13_010000_add_cancellation_facts_to_commerce_orders.php');

        $migration->down();
        $this->assertFalse(Schema::hasColumn('commerce_orders', 'cancelled_at'));
        $this->assertSame($order->id, DB::table('commerce_orders')->where('id', $order->id)->value('id'), 'existing rows survive the rollback');

        $migration->up();
        $this->assertTrue(Schema::hasColumn('commerce_orders', 'cancelled_at'));
        $this->assertGuard(fn () => $this->raw($order->id, ['cancelled_at' => now('UTC')]), 'guards are back after up()');
        $this->assertSame(1, $this->cancelRaw($order->id));
    }

    // ── مساعدات ───────────────────────────────────────────────────────────

    /** @return array{0: string, 1: string, 2: string} [tenantId, token, ownerUserId] */
    private function owner(string $slug = 'acme', string $email = 'owner@acme.test'): array
    {
        $auth = $this->registerTenant($slug, $email);
        $userId = User::withoutGlobalScopes()->where('email', $email)->value('id');

        return [$auth['tenant_id'], $auth['token'], (string) $userId];
    }

    private function userFor(string $tenantId, string $role, string $email): string
    {
        $this->tokenForRole($tenantId, $role, $email);

        return (string) User::withoutGlobalScopes()->where('email', $email)->value('id');
    }
}
