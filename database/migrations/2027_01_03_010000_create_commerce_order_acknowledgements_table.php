<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * COPS-H3-4 (ADR-30 §4، R-10 المعتمد) — إقرار تنبيه الطلب **لكل طلب**: جدول `commerce_order_acknowledgements` (صف واحد كحدّ أقصى لكل طلب) ونوع حدث `order.acknowledged`.
 *
 * الإقرار حقيقة تشغيلية لا تغيّر حالة الطلب ولا تُخرجه من قوائم العمل؛ تكتبه `CommerceOrderAcknowledgementService` وحدها (لا `$fillable`). جدول جديد (إضافي): FK
 * إلى `commerce_orders` من الجدول الجديد لا يعيد بناء `commerce_orders` على SQLite فلا يُسقط مُشغّلاته. لا قيد ولا مخزون.
 *
 * يوسّع قيد شكل أحداث الطلب (`commerce_event_shape_chk` على PostgreSQL، `cofeed_event_shape` على SQLite) بنوع `order.acknowledged` — قائمة مغلقة تطابق
 * `CommerceOrderEvent::TYPES` حرفياً (يحرسها اختبار). `down()` يرفض متى وُجد إقرار أو حدث إقرار (إصلاح إلى الأمام فقط).
 */
return new class extends Migration
{
    private const TABLE = 'commerce_order_acknowledgements';

    private const ACTORS = ['user', 'customer', 'guest', 'system'];

    private const PREVIOUS_TYPES = [
        'order.placed', 'order.cancelled', 'payment.paid', 'payment.collected', 'order.accepted',
        'fulfillment.started', 'fulfillment.ready', 'fulfillment.dispatched', 'fulfillment.delivery_failed',
        'fulfillment.returned', 'fulfillment.delivered', 'fulfillment.picked_up', 'fulfillment.details_updated',
    ];

    public function up(): void
    {
        Schema::create(self::TABLE, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('commerce_order_id')->constrained('commerce_orders');
            $table->foreignUuid('acknowledged_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('acknowledged_at');
            $table->timestamps();

            $table->unique('commerce_order_id', 'coack_order_unique');
            $table->index(['tenant_id', 'acknowledged_at'], 'coack_tenant_at_idx');
        });

        $this->eventShape([...self::PREVIOUS_TYPES, 'order.acknowledged']);
    }

    public function down(): void
    {
        if (Schema::hasTable(self::TABLE) && DB::table(self::TABLE)->exists()) {
            throw new RuntimeException('Rollback refused: acknowledgement rows exist. Use a forward-only migration instead.');
        }
        if (DB::table('commerce_order_events')->where('type', 'order.acknowledged')->exists()) {
            throw new RuntimeException('Rollback refused: order.acknowledged events exist; the previous event guard would no longer describe them.');
        }

        $this->eventShape(self::PREVIOUS_TYPES);
        Schema::dropIfExists(self::TABLE);
    }

    /** @param list<string> $types */
    private function eventShape(array $types): void
    {
        $typeList = "'".implode("','", $types)."'";
        $actors = "'".implode("','", self::ACTORS)."'";

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE commerce_order_events DROP CONSTRAINT IF EXISTS commerce_event_shape_chk');
            DB::statement("ALTER TABLE commerce_order_events ADD CONSTRAINT commerce_event_shape_chk CHECK (
                feed_seq > 0
                AND type IN ({$typeList})
                AND actor_type IN ({$actors})
                AND ((actor_type IN ('user','customer') AND actor_id IS NOT NULL) OR (actor_type IN ('guest','system') AND actor_id IS NULL))
            )");

            return;
        }

        DB::unprepared('DROP TRIGGER IF EXISTS cofeed_event_shape');
        DB::unprepared(<<<SQL
            CREATE TRIGGER cofeed_event_shape BEFORE INSERT ON commerce_order_events
            WHEN COALESCE(NOT (
                NEW.feed_seq > 0
                AND NEW.type IN ({$typeList})
                AND NEW.actor_type IN ({$actors})
                AND ((NEW.actor_type IN ('user','customer') AND NEW.actor_id IS NOT NULL) OR (NEW.actor_type IN ('guest','system') AND NEW.actor_id IS NULL))
            ), 1)
            BEGIN
                SELECT RAISE(ABORT, 'commerce_order_events: invalid event shape');
            END
            SQL);
    }
};
