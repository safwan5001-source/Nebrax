<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * COPS-H1-4 (ADR-29 §2.2 R-3 · §2.4) — **مُشغِّلات/قيود فقط**، لا عمود ولا صف يتغيّر:
 *
 *  1. حارس الإلغاء (هجرة `2026_12_13_010000`) يضمّن قائمة الأسباب حرفياً ⇒ يُعاد إنشاء جزء الانتقال بالقائمة الموسَّعة بـ`merchant_rejected`،
 *     مع قاعدة جديدة: **الرفض قبل القبول فقط** — `merchant_rejected` مسموح لطلب `acceptance_mode = manual` غير مقبول (بعد القبول = إلغاء عادي
 *     بأسبابه). بقية حراس الإلغاء (عدم الإنشاء ملغى، الجمود، التفاصيل بلا وقت، منع الحذف) كما هي حرفياً.
 *  2. قيد شكل الحدث (هجرة `2026_12_27_010000`) يضمّن قائمة الأنواع المغلقة ⇒ تُضاف `order.accepted`.
 *
 * `down()` يرفض متى وُجد طلب مرفوض (`merchant_rejected`) أو حدث `order.accepted`، وإلا يعيد التعريفات السابقة حرفياً.
 */
return new class extends Migration
{
    private const BASE_REASONS = ['customer_request', 'out_of_stock', 'payment_issue', 'duplicate_order', 'fraud_suspected', 'other'];

    private const REJECTION_REASON = 'merchant_rejected';

    private const BASE_TYPES = ['order.placed', 'order.cancelled', 'payment.paid', 'payment.collected'];

    private const ACCEPTED_TYPE = 'order.accepted';

    private const ACTORS = ['user', 'customer', 'guest', 'system'];

    private const CANCELLATION_COLUMNS = ['status', 'cancelled_at', 'cancelled_by_user_id', 'cancellation_reason', 'cancellation_note'];

    public function up(): void
    {
        $this->apply([...self::BASE_REASONS, self::REJECTION_REASON], [...self::BASE_TYPES, self::ACCEPTED_TYPE], true);
    }

    public function down(): void
    {
        if (DB::table('commerce_orders')->where('cancellation_reason', self::REJECTION_REASON)->exists()
            || DB::table('commerce_order_events')->where('type', self::ACCEPTED_TYPE)->exists()) {
            throw new RuntimeException(
                'Rollback refused: merchant-rejected orders or order.accepted events exist; the previous guards would no longer describe them. '
                .'Use a forward-only migration instead.'
            );
        }

        $this->apply(self::BASE_REASONS, self::BASE_TYPES, false);
    }

    /** @param list<string> $reasons @param list<string> $types */
    private function apply(array $reasons, array $types, bool $rejectionRule): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->postgresCancellationGuard($reasons, $rejectionRule);
            $this->postgresEventShape($types);
        } else {
            $this->sqliteCancellationTransition($reasons, $rejectionRule);
            $this->sqliteEventShape($types);
        }
    }

    /** @param list<string> $values */
    private function quoted(array $values): string
    {
        return "'".implode("','", $values)."'";
    }

    /**
     * يعيد جسم `commerce_orders_cancellation_guard()` كما في `2026_12_13_010000` حرفياً، بقائمة الأسباب المعطاة، ويضيف (في `up` فقط) قاعدة الرفض
     * قبل القبول. المُشغِّل نفسه (`BEFORE INSERT OR UPDATE OF status, cancelled_*`) لا يتغيّر: `CREATE OR REPLACE FUNCTION` يكفي.
     *
     * @param  list<string>  $reasons
     */
    private function postgresCancellationGuard(array $reasons, bool $rejectionRule): void
    {
        $list = $this->quoted($reasons);
        $rejection = $rejectionRule ? <<<'SQL'
                IF NEW.cancellation_reason = 'merchant_rejected'
                   AND (OLD.acceptance_mode IS DISTINCT FROM 'manual' OR OLD.accepted_at IS NOT NULL OR NEW.accepted_at IS NOT NULL) THEN
                    RAISE EXCEPTION 'commerce_orders: a merchant rejection is only allowed for a manual-acceptance order before it is accepted' USING ERRCODE = 'check_violation';
                END IF;
            SQL : '';

        DB::unprepared(<<<SQL
            CREATE OR REPLACE FUNCTION commerce_orders_cancellation_guard() RETURNS trigger LANGUAGE plpgsql AS \$fn\$
            BEGIN
                IF TG_OP = 'INSERT' THEN
                    IF NEW.cancelled_at IS NOT NULL OR NEW.cancelled_by_user_id IS NOT NULL
                       OR NEW.cancellation_reason IS NOT NULL OR NEW.cancellation_note IS NOT NULL THEN
                        RAISE EXCEPTION 'commerce_orders: an order cannot be created already cancelled' USING ERRCODE = 'check_violation';
                    END IF;
                    RETURN NEW;
                END IF;

                IF OLD.cancelled_at IS NOT NULL THEN
                    IF NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
                       OR NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason
                       OR NEW.cancellation_note IS DISTINCT FROM OLD.cancellation_note
                       OR NEW.status IS DISTINCT FROM OLD.status
                       OR (NEW.cancelled_by_user_id IS DISTINCT FROM OLD.cancelled_by_user_id AND NEW.cancelled_by_user_id IS NOT NULL) THEN
                        RAISE EXCEPTION 'commerce_orders: cancellation facts are immutable' USING ERRCODE = 'check_violation';
                    END IF;
                    RETURN NEW;
                END IF;

                IF NEW.cancelled_at IS NULL THEN
                    IF NEW.cancelled_by_user_id IS NOT NULL OR NEW.cancellation_reason IS NOT NULL OR NEW.cancellation_note IS NOT NULL THEN
                        RAISE EXCEPTION 'commerce_orders: cancellation details require cancelled_at' USING ERRCODE = 'check_violation';
                    END IF;
                    RETURN NEW;
                END IF;

                IF OLD.status IS DISTINCT FROM 'confirmed' OR NEW.status IS DISTINCT FROM 'confirmed' THEN
                    RAISE EXCEPTION 'commerce_orders: only a confirmed order can be cancelled' USING ERRCODE = 'check_violation';
                END IF;
                IF NEW.cancellation_reason IS NULL OR NEW.cancellation_reason NOT IN ({$list}) THEN
                    RAISE EXCEPTION 'commerce_orders: a cancellation requires an approved reason' USING ERRCODE = 'check_violation';
                END IF;
                IF NEW.cancellation_reason = 'other' AND COALESCE(btrim(NEW.cancellation_note), '') = '' THEN
                    RAISE EXCEPTION 'commerce_orders: the "other" cancellation reason requires a note' USING ERRCODE = 'check_violation';
                END IF;
            {$rejection}
                RETURN NEW;
            END
            \$fn\$
            SQL);
    }

    /** @param list<string> $reasons */
    private function sqliteCancellationTransition(array $reasons, bool $rejectionRule): void
    {
        $list = $this->quoted($reasons);
        $columns = implode(', ', self::CANCELLATION_COLUMNS);
        $rejection = $rejectionRule
            ? "OR (NEW.cancellation_reason = 'merchant_rejected' AND (OLD.acceptance_mode IS NOT 'manual' OR OLD.accepted_at IS NOT NULL OR NEW.accepted_at IS NOT NULL))"
            : '';

        DB::unprepared('DROP TRIGGER IF EXISTS cmo_cancel_transition');
        DB::unprepared(<<<SQL
            CREATE TRIGGER cmo_cancel_transition BEFORE UPDATE OF {$columns} ON commerce_orders
            WHEN OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL AND (
                OLD.status IS NOT 'confirmed' OR NEW.status IS NOT 'confirmed'
                OR NEW.cancellation_reason IS NULL OR NEW.cancellation_reason NOT IN ({$list})
                OR (NEW.cancellation_reason = 'other' AND trim(COALESCE(NEW.cancellation_note, '')) = '')
                {$rejection}
            )
            BEGIN
                SELECT RAISE(ABORT, 'commerce_orders: invalid cancellation (confirmed order, approved reason and note for "other" required)');
            END
            SQL);
    }

    /** @param list<string> $types */
    private function postgresEventShape(array $types): void
    {
        $typeList = $this->quoted($types);
        $actors = $this->quoted(self::ACTORS);

        DB::statement('ALTER TABLE commerce_order_events DROP CONSTRAINT IF EXISTS commerce_event_shape_chk');
        DB::statement("ALTER TABLE commerce_order_events ADD CONSTRAINT commerce_event_shape_chk CHECK (
            feed_seq > 0
            AND type IN ({$typeList})
            AND actor_type IN ({$actors})
            AND ((actor_type IN ('user','customer') AND actor_id IS NOT NULL) OR (actor_type IN ('guest','system') AND actor_id IS NULL))
        )");
    }

    /** @param list<string> $types */
    private function sqliteEventShape(array $types): void
    {
        $typeList = $this->quoted($types);
        $actors = $this->quoted(self::ACTORS);

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
