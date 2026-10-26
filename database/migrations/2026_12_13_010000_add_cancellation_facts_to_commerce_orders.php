<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * COMMERCE-ORDERS-O3a-1 (ADR-28 D-9) — حقائق إلغاء طلب المتجر: أعمدة إضافية فقط + حراس قاعدة بيانات.
 *
 * **لا يتغيّر عمود `status`** (enum `draft|confirmed`) ولا أي صف قائم: الإلغاء حقيقة منفصلة (`cancelled_at`…)، فيبقى
 * `status = confirmed` للطلب الملغى وتظلّ كل حراس الجمود التي تعتمد `isConfirmed()` (لقطة/إهداء/موعد/تخصيص) سارية.
 * هذه الهجرة **لا تنشئ مسار إلغاء**؛ تهيّئ التخزين والحماية فقط (الكتابة من خدمة الإلغاء في O3a-2b).
 *
 * الحراس (PostgreSQL وSQLite، لا تعتمد على انضباط التطبيق):
 *  1. لا طلب يُنشأ ملغى (INSERT بأي عمود إلغاء ⇒ رفض).
 *  2. الإلغاء من `confirmed` إلى `confirmed` فقط (لا مسودة، ولا حالة تُغيَّر معه) وبسبب من القائمة المعتمدة؛ `other` يتطلب ملاحظة.
 *  3. تفاصيل الإلغاء (الفاعل/السبب/الملاحظة) لا توجد بلا `cancelled_at`.
 *  4. بعد الإلغاء تتجمّد `cancelled_at` والسبب والملاحظة و`status`؛ لا مسح ولا تعديل ولا إلغاء الإلغاء. الاستثناء الوحيد: `cancelled_by_user_id`
 *     يجوز أن يصير NULL (FK `nullOnDelete` عند حذف المستخدم) ولا يجوز تغييره إلى قيمة أخرى.
 *  5. لا حذف لطلب ملغى ما دام مستأجره موجوداً (حذف المستأجر النهائي يمرّ كبقية الجداول).
 *
 * `down()` يرفض متى وُجد أي طلب ملغى (إزالة الحراس تترك حقائق الإلغاء بلا حماية؛ إصلاح إلى الأمام فقط).
 */
return new class extends Migration
{
    /** قائمة الأسباب المعتمدة (ADR-28 §5.1) — مصدرها الوحيد في القاعدة؛ التطبيق يعكسها في O3a-2b. */
    private const REASONS = ['customer_request', 'out_of_stock', 'payment_issue', 'duplicate_order', 'fraud_suspected', 'other'];

    private const COLUMNS = ['cancelled_at', 'cancelled_by_user_id', 'cancellation_reason', 'cancellation_note'];

    public function up(): void
    {
        Schema::table('commerce_orders', function (Blueprint $table) {
            $table->timestamp('cancelled_at')->nullable();
            $table->foreignUuid('cancelled_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('cancellation_reason', 32)->nullable();
            $table->string('cancellation_note', 500)->nullable();

            $table->index(['tenant_id', 'cancelled_at'], 'commerce_orders_tenant_cancelled_at_index');
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->createPostgresGuards();
        } else {
            $this->createSqliteGuards();
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('commerce_orders', 'cancelled_at') && DB::table('commerce_orders')->whereNotNull('cancelled_at')->exists()) {
            throw new RuntimeException(
                'Rollback refused: cancelled commerce orders exist. Removing the cancellation guards would leave their facts unprotected; '
                .'use a forward-only migration instead.'
            );
        }

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS commerce_orders_cancellation_guard ON commerce_orders');
            DB::unprepared('DROP TRIGGER IF EXISTS commerce_orders_cancellation_no_delete ON commerce_orders');
            DB::unprepared('DROP FUNCTION IF EXISTS commerce_orders_cancellation_guard()');
            DB::unprepared('DROP FUNCTION IF EXISTS commerce_orders_cancellation_guard_delete()');
        } else {
            foreach ([
                'commerce_orders_cancel_insert', 'commerce_orders_cancel_frozen', 'commerce_orders_cancel_orphan_details',
                'commerce_orders_cancel_transition', 'commerce_orders_cancel_no_delete',
            ] as $trigger) {
                DB::unprepared("DROP TRIGGER IF EXISTS {$trigger}");
            }
        }

        Schema::table('commerce_orders', function (Blueprint $table) {
            $table->dropIndex('commerce_orders_tenant_cancelled_at_index');
            $table->dropConstrainedForeignId('cancelled_by_user_id');
            $table->dropColumn(['cancelled_at', 'cancellation_reason', 'cancellation_note']);
        });
    }

    private function reasonList(): string
    {
        return "'".implode("','", self::REASONS)."'";
    }

    private function createPostgresGuards(): void
    {
        $reasons = $this->reasonList();
        $columns = implode(', ', ['status', ...self::COLUMNS]);

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
                IF NEW.cancellation_reason IS NULL OR NEW.cancellation_reason NOT IN ({$reasons}) THEN
                    RAISE EXCEPTION 'commerce_orders: a cancellation requires an approved reason' USING ERRCODE = 'check_violation';
                END IF;
                IF NEW.cancellation_reason = 'other' AND COALESCE(btrim(NEW.cancellation_note), '') = '' THEN
                    RAISE EXCEPTION 'commerce_orders: the "other" cancellation reason requires a note' USING ERRCODE = 'check_violation';
                END IF;
                RETURN NEW;
            END
            \$fn\$
            SQL);
        DB::unprepared(
            "CREATE TRIGGER commerce_orders_cancellation_guard BEFORE INSERT OR UPDATE OF {$columns} ON commerce_orders "
            .'FOR EACH ROW EXECUTE FUNCTION commerce_orders_cancellation_guard()'
        );

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION commerce_orders_cancellation_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF OLD.cancelled_at IS NOT NULL AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
                    RAISE EXCEPTION 'commerce_orders: a cancelled order cannot be deleted' USING ERRCODE = 'check_violation';
                END IF;
                RETURN OLD;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER commerce_orders_cancellation_no_delete BEFORE DELETE ON commerce_orders FOR EACH ROW EXECUTE FUNCTION commerce_orders_cancellation_guard_delete()');
    }

    private function createSqliteGuards(): void
    {
        $reasons = $this->reasonList();
        $columns = implode(', ', ['status', ...self::COLUMNS]);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER commerce_orders_cancel_insert BEFORE INSERT ON commerce_orders
            WHEN NEW.cancelled_at IS NOT NULL OR NEW.cancelled_by_user_id IS NOT NULL
              OR NEW.cancellation_reason IS NOT NULL OR NEW.cancellation_note IS NOT NULL
            BEGIN
                SELECT RAISE(ABORT, 'commerce_orders: an order cannot be created already cancelled');
            END
            SQL);

        DB::unprepared(<<<SQL
            CREATE TRIGGER commerce_orders_cancel_frozen BEFORE UPDATE OF {$columns} ON commerce_orders
            WHEN OLD.cancelled_at IS NOT NULL AND (
                NEW.cancelled_at IS NOT OLD.cancelled_at
                OR NEW.cancellation_reason IS NOT OLD.cancellation_reason
                OR NEW.cancellation_note IS NOT OLD.cancellation_note
                OR NEW.status IS NOT OLD.status
                OR (NEW.cancelled_by_user_id IS NOT OLD.cancelled_by_user_id AND NEW.cancelled_by_user_id IS NOT NULL)
            )
            BEGIN
                SELECT RAISE(ABORT, 'commerce_orders: cancellation facts are immutable');
            END
            SQL);

        DB::unprepared(<<<SQL
            CREATE TRIGGER commerce_orders_cancel_orphan_details BEFORE UPDATE OF {$columns} ON commerce_orders
            WHEN OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NULL
              AND (NEW.cancelled_by_user_id IS NOT NULL OR NEW.cancellation_reason IS NOT NULL OR NEW.cancellation_note IS NOT NULL)
            BEGIN
                SELECT RAISE(ABORT, 'commerce_orders: cancellation details require cancelled_at');
            END
            SQL);

        DB::unprepared(<<<SQL
            CREATE TRIGGER commerce_orders_cancel_transition BEFORE UPDATE OF {$columns} ON commerce_orders
            WHEN OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL AND (
                OLD.status IS NOT 'confirmed' OR NEW.status IS NOT 'confirmed'
                OR NEW.cancellation_reason IS NULL OR NEW.cancellation_reason NOT IN ({$reasons})
                OR (NEW.cancellation_reason = 'other' AND trim(COALESCE(NEW.cancellation_note, '')) = '')
            )
            BEGIN
                SELECT RAISE(ABORT, 'commerce_orders: invalid cancellation (confirmed order, approved reason and note for "other" required)');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER commerce_orders_cancel_no_delete BEFORE DELETE ON commerce_orders
            WHEN OLD.cancelled_at IS NOT NULL AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id)
            BEGIN
                SELECT RAISE(ABORT, 'commerce_orders: a cancelled order cannot be deleted');
            END
            SQL);
    }
};
