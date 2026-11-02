<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * COPS-H2-1 (ADR-29 §2.3 · خطة H2-0 §2) — تنفيذ طلب المتجر: صف واحد لكل طلب (V1، فهرس فريد) + حراس قاعدة بيانات (PostgreSQL وSQLite).
 *
 * **ليس** حقل حالة على الطلب (مرفوض صراحةً في ADR-29): مصدر الحقيقة الوحيد للتنفيذ، يكتبه `CommerceOrderFulfillmentService` وحده.
 * لا أثر مالي ولا مخزني: لا قيد ولا فاتورة ولا حركة مخزون ولا حجز. الصف **كسول**: لا يوجد قبل أول إجراء (الغياب = «لم يبدأ»).
 *
 * الحراس (لا تعتمد على انضباط التطبيق):
 *  1. الإدراج: حالة أولى `preparing|ready` فقط؛ نسخة 1؛ لا طوابع لاحقة؛ طلب **المستأجر نفسه** مؤكَّد غير ملغى؛ مخزن المستأجر نفسه؛ النوع `pickup` ⇔ طريقة الطلب `pickup`.
 *  2. التحديث: معرّفات ثابتة؛ لا تحديث لطلب ملغى (إلا تصفير مرجع مستخدم محذوف)؛ الحالتان النهائيتان (`delivered|picked_up`) مجمّدتان؛ النسخة +1؛
 *     الأضلاع المسموحة فقط؛ تبديل النوع `local_delivery↔carrier` قبل الإرسال؛ الطوابع الأحادية لا تتغيّر؛ المحاولات +1 عند الفشل فقط؛ الطوابع/السبب المطلوبة لكل انتقال.
 *  3. الحذف مرفوض ما دام المستأجر موجوداً؛ TRUNCATE مرفوض (PostgreSQL).
 *  4. **حارس إلغاء الطلب:** كتابة `commerce_orders.cancelled_at` مرفوضة إن كان تنفيذه في النقل (`out_for_delivery|delivery_failed`) أو مكتملاً (`delivered|picked_up`)
 *     — دفاع ضد الكتابة المباشرة؛ التسلسل الصحيح بين معاملتين يضمنه قفل الطلب والتنفيذ في الخدمة (المُشغّلات قراءات MVCC بلا أقفال).
 *  5. أنواع أحداث `fulfillment.*` تُضاف إلى قيد شكل الحدث (يُعاد إنشاؤه بالقائمة الموسَّعة؛ `down()` يعيد الأصلية).
 *
 * **SQLite (اختبار فقط):** الفحوص العابرة للجداول (طلب/مخزن المستأجر نفسه، مطابقة النوع لطريقة التسليم، تجميد تنفيذ طلب ملغى) تبقى في **الكاتب** لا في مُشغّلات
 * التنفيذ — مُشغّل على جدول يقرأ `commerce_orders` يكسر إعادة بناء ذلك الجدول (`no such table` أثناء `RENAME`) كما في تراجع هجرة الإلغاء؛ وهو السابقة نفسها
 * لحراس `commerce_order_events`. في PostgreSQL كلها في القاعدة. حارس إلغاء الطلب (`cmo_fulfillment_cancel_block`) على `commerce_orders` نفسه فلا أثر له.
 *
 * `down()` يرفض متى وُجد أي صف تنفيذ أو حدث `fulfillment.*` (إصلاح إلى الأمام فقط).
 */
return new class extends Migration
{
    private const TABLE = 'commerce_order_fulfillments';

    private const TYPES = ['local_delivery', 'carrier', 'pickup'];

    private const STATUSES = ['preparing', 'ready', 'out_for_delivery', 'delivery_failed', 'returned_to_store', 'delivered', 'picked_up'];

    private const FAILURE_REASONS = ['customer_unreachable', 'address_issue', 'recipient_absent', 'customer_refused', 'other'];

    /** أضلاع الانتقال المسموحة `من>إلى` (خطة H2-0 §2.2). */
    private const EDGES = [
        'preparing>ready',
        'ready>out_for_delivery', 'ready>picked_up',
        'out_for_delivery>delivered', 'out_for_delivery>delivery_failed',
        'delivery_failed>out_for_delivery', 'delivery_failed>returned_to_store',
        'returned_to_store>out_for_delivery',
    ];

    private const BASE_EVENT_TYPES = ['order.placed', 'order.cancelled', 'payment.paid', 'payment.collected', 'order.accepted'];

    private const FULFILLMENT_EVENT_TYPES = [
        'fulfillment.started', 'fulfillment.ready', 'fulfillment.dispatched', 'fulfillment.delivery_failed',
        'fulfillment.returned', 'fulfillment.delivered', 'fulfillment.picked_up', 'fulfillment.details_updated',
    ];

    private const ACTORS = ['user', 'customer', 'guest', 'system'];

    /** كل الأعمدة عدا مراجع المستخدمين و`updated_at` — تُقارَن لاستثناء «تصفير مرجع مستخدم محذوف» من الحراس. */
    private const DATA_COLUMNS = [
        'id', 'tenant_id', 'commerce_order_id', 'warehouse_id', 'type', 'status', 'version', 'carrier_name', 'tracking_number', 'tracking_url',
        'courier_name', 'courier_phone', 'delivery_attempts', 'last_failure_reason', 'last_failure_note', 'preparing_at', 'ready_at',
        'first_dispatched_at', 'last_dispatched_at', 'last_failed_at', 'last_returned_at', 'delivered_at', 'picked_up_at', 'created_at',
    ];

    /** طوابع أحادية الكتابة: إن وُجدت لا تتغيّر. */
    private const ONCE_STAMPS = ['preparing_at', 'ready_at', 'first_dispatched_at', 'delivered_at', 'picked_up_at'];

    public function up(): void
    {
        Schema::create(self::TABLE, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('commerce_order_id')->constrained('commerce_orders');
            $table->foreignUuid('warehouse_id')->constrained('warehouses')->restrictOnDelete();
            $table->string('type', 16);
            $table->string('status', 24);
            $table->unsignedInteger('version')->default(1);
            $table->string('carrier_name', 100)->nullable();
            $table->string('tracking_number', 100)->nullable();
            $table->string('tracking_url', 500)->nullable();
            $table->string('courier_name', 100)->nullable();
            $table->string('courier_phone', 32)->nullable();
            $table->unsignedSmallInteger('delivery_attempts')->default(0);
            $table->string('last_failure_reason', 32)->nullable();
            $table->string('last_failure_note', 500)->nullable();
            $table->timestamp('preparing_at')->nullable();
            $table->timestamp('ready_at')->nullable();
            $table->timestamp('first_dispatched_at')->nullable();
            $table->timestamp('last_dispatched_at')->nullable();
            $table->timestamp('last_failed_at')->nullable();
            $table->timestamp('last_returned_at')->nullable();
            $table->timestamp('delivered_at')->nullable();
            $table->timestamp('picked_up_at')->nullable();
            $table->foreignUuid('created_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique('commerce_order_id', 'cof_order_unique');
            $table->index(['tenant_id', 'status'], 'cof_tenant_status_idx');
            $table->index(['tenant_id', 'warehouse_id', 'status'], 'cof_warehouse_idx');
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->postgresGuards();
            $this->postgresEventShape([...self::BASE_EVENT_TYPES, ...self::FULFILLMENT_EVENT_TYPES]);
        } else {
            $this->sqliteGuards();
            $this->sqliteEventShape([...self::BASE_EVENT_TYPES, ...self::FULFILLMENT_EVENT_TYPES]);
        }
    }

    public function down(): void
    {
        if (Schema::hasTable(self::TABLE) && DB::table(self::TABLE)->exists()) {
            throw new RuntimeException('Rollback refused: fulfillment rows exist; the guards protect them. Use a forward-only migration instead.');
        }
        if (DB::table('commerce_order_events')->where('type', 'like', 'fulfillment.%')->exists()) {
            throw new RuntimeException('Rollback refused: fulfillment.* order events exist; the previous event guard would no longer describe them.');
        }

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS commerce_orders_fulfillment_cancel_guard ON commerce_orders');
            DB::unprepared('DROP FUNCTION IF EXISTS commerce_orders_fulfillment_cancel_guard()');
            $this->postgresEventShape(self::BASE_EVENT_TYPES);
            // الجدول أولاً: مُشغّلاته تعتمد على الدوال.
            Schema::dropIfExists(self::TABLE);
            foreach (['cof_guard', 'cof_guard_delete', 'cof_truncate_guard'] as $fn) {
                DB::unprepared("DROP FUNCTION IF EXISTS {$fn}()");
            }

            return;
        } else {
            foreach (['cof_insert', 'cof_frozen_ids', 'cof_terminal', 'cof_version', 'cof_edges', 'cof_type_switch', 'cof_once_stamps', 'cof_attempts', 'cof_transition_stamps', 'cof_value_domain', 'cof_no_delete', 'cmo_fulfillment_cancel_block'] as $trigger) {
                DB::unprepared("DROP TRIGGER IF EXISTS {$trigger}");
            }
            $this->sqliteEventShape(self::BASE_EVENT_TYPES);
        }

        Schema::dropIfExists(self::TABLE);
    }

    // ───────────────────────────── helpers ─────────────────────────────

    /** @param list<string> $values */
    private function quoted(array $values): string
    {
        return "'".implode("','", $values)."'";
    }

    /** @return string عبارة «لا عمود بيانات تغيّر» (ما عدا مراجع المستخدمين و`updated_at`) — صيغة PostgreSQL. */
    private function pgUnchanged(): string
    {
        return implode(' AND ', array_map(fn (string $c) => "NEW.{$c} IS NOT DISTINCT FROM OLD.{$c}", self::DATA_COLUMNS));
    }

    private function sqliteUnchanged(): string
    {
        return implode(' AND ', array_map(fn (string $c) => "NEW.{$c} IS OLD.{$c}", self::DATA_COLUMNS));
    }

    /** @return string «التغيير تصفير مرجع مستخدم محذوف فقط» (FK nullOnDelete). */
    private function pureNullification(bool $pg): string
    {
        $unchanged = $pg ? $this->pgUnchanged() : $this->sqliteUnchanged();
        $same = $pg ? 'IS NOT DISTINCT FROM' : 'IS';
        $diff = $pg ? 'IS DISTINCT FROM' : 'IS NOT';

        return "(NEW.created_by_user_id {$diff} OLD.created_by_user_id OR NEW.updated_by_user_id {$diff} OLD.updated_by_user_id)"
            ." AND (NEW.created_by_user_id IS NULL OR NEW.created_by_user_id {$same} OLD.created_by_user_id)"
            ." AND (NEW.updated_by_user_id IS NULL OR NEW.updated_by_user_id {$same} OLD.updated_by_user_id)"
            ." AND {$unchanged}";
    }

    // ───────────────────────────── PostgreSQL ─────────────────────────────

    private function postgresGuards(): void
    {
        $types = $this->quoted(self::TYPES);
        $statuses = $this->quoted(self::STATUSES);
        $reasons = $this->quoted(self::FAILURE_REASONS);
        $edges = $this->quoted(self::EDGES);
        $pure = $this->pureNullification(true);
        $once = implode("\n", array_map(
            fn (string $c) => "                IF OLD.{$c} IS NOT NULL AND NEW.{$c} IS DISTINCT FROM OLD.{$c} THEN RAISE EXCEPTION 'commerce_order_fulfillments: {$c} is write-once' USING ERRCODE = 'check_violation'; END IF;",
            self::ONCE_STAMPS,
        ));

        // رسائل ثابتة النص (لا استيفاء لقيم الصف).
        DB::unprepared(<<<SQL
            CREATE OR REPLACE FUNCTION cof_guard() RETURNS trigger LANGUAGE plpgsql AS \$fn\$
            DECLARE
                o_cancelled timestamp;
                o_status text;
                o_method text;
                o_tenant uuid;
            BEGIN
                IF TG_OP = 'INSERT' THEN
                    SELECT o.cancelled_at, o.status, o.delivery_method, o.tenant_id INTO o_cancelled, o_status, o_method, o_tenant
                      FROM commerce_orders o WHERE o.id = NEW.commerce_order_id;
                    IF o_tenant IS NULL OR o_tenant IS DISTINCT FROM NEW.tenant_id THEN
                        RAISE EXCEPTION 'commerce_order_fulfillments: the order must belong to the same tenant' USING ERRCODE = 'check_violation';
                    END IF;
                    IF o_status IS DISTINCT FROM 'confirmed' OR o_cancelled IS NOT NULL THEN
                        RAISE EXCEPTION 'commerce_order_fulfillments: only a confirmed, non-cancelled order can start fulfillment' USING ERRCODE = 'check_violation';
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM warehouses w WHERE w.id = NEW.warehouse_id AND w.tenant_id = NEW.tenant_id) THEN
                        RAISE EXCEPTION 'commerce_order_fulfillments: the warehouse must belong to the same tenant' USING ERRCODE = 'check_violation';
                    END IF;
                    IF NEW.type NOT IN ({$types}) OR (NEW.type = 'pickup') IS DISTINCT FROM (o_method = 'pickup') THEN
                        RAISE EXCEPTION 'commerce_order_fulfillments: the fulfillment type must match the order delivery method' USING ERRCODE = 'check_violation';
                    END IF;
                    IF NEW.status NOT IN ('preparing','ready') OR NEW.version <> 1 OR NEW.delivery_attempts <> 0 THEN
                        RAISE EXCEPTION 'commerce_order_fulfillments: a fulfillment starts as preparing or ready, version 1, with no attempts' USING ERRCODE = 'check_violation';
                    END IF;
                    IF (NEW.status = 'preparing' AND NEW.preparing_at IS NULL) OR (NEW.status = 'ready' AND NEW.ready_at IS NULL) THEN
                        RAISE EXCEPTION 'commerce_order_fulfillments: the initial status requires its timestamp' USING ERRCODE = 'check_violation';
                    END IF;
                    IF NEW.first_dispatched_at IS NOT NULL OR NEW.last_dispatched_at IS NOT NULL OR NEW.last_failed_at IS NOT NULL
                       OR NEW.last_returned_at IS NOT NULL OR NEW.delivered_at IS NOT NULL OR NEW.picked_up_at IS NOT NULL
                       OR NEW.last_failure_reason IS NOT NULL OR NEW.last_failure_note IS NOT NULL THEN
                        RAISE EXCEPTION 'commerce_order_fulfillments: later-stage facts cannot exist at creation' USING ERRCODE = 'check_violation';
                    END IF;
                    IF NEW.tracking_url IS NOT NULL AND NEW.tracking_url !~ '^https://' THEN
                        RAISE EXCEPTION 'commerce_order_fulfillments: the tracking url must be https' USING ERRCODE = 'check_violation';
                    END IF;
                    RETURN NEW;
                END IF;

                -- تصفير مرجع مستخدم محذوف (FK nullOnDelete) لا يمسّ الحقائق: مسموح دائماً.
                IF {$pure} THEN
                    RETURN NEW;
                END IF;

                IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
                   OR NEW.commerce_order_id IS DISTINCT FROM OLD.commerce_order_id OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
                   OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
                    RAISE EXCEPTION 'commerce_order_fulfillments: identity, order, warehouse and creation time are immutable' USING ERRCODE = 'check_violation';
                END IF;

                IF EXISTS (SELECT 1 FROM commerce_orders o WHERE o.id = OLD.commerce_order_id AND o.cancelled_at IS NOT NULL) THEN
                    RAISE EXCEPTION 'commerce_order_fulfillments: a cancelled order fulfillment is frozen' USING ERRCODE = 'check_violation';
                END IF;
                IF OLD.status IN ('delivered','picked_up') THEN
                    RAISE EXCEPTION 'commerce_order_fulfillments: a completed fulfillment is immutable' USING ERRCODE = 'check_violation';
                END IF;
                IF NEW.version <> OLD.version + 1 THEN
                    RAISE EXCEPTION 'commerce_order_fulfillments: the version must advance by exactly one' USING ERRCODE = 'check_violation';
                END IF;
                IF NEW.status NOT IN ({$statuses}) OR NEW.type NOT IN ({$types}) THEN
                    RAISE EXCEPTION 'commerce_order_fulfillments: invalid status or type' USING ERRCODE = 'check_violation';
                END IF;
                IF NEW.last_failure_reason IS NOT NULL AND NEW.last_failure_reason NOT IN ({$reasons}) THEN
                    RAISE EXCEPTION 'commerce_order_fulfillments: unapproved failure reason' USING ERRCODE = 'check_violation';
                END IF;
                IF NEW.tracking_url IS NOT NULL AND NEW.tracking_url !~ '^https://' THEN
                    RAISE EXCEPTION 'commerce_order_fulfillments: the tracking url must be https' USING ERRCODE = 'check_violation';
                END IF;
                IF NEW.type IS DISTINCT FROM OLD.type THEN
                    IF OLD.type = 'pickup' OR NEW.type = 'pickup' OR OLD.status NOT IN ('preparing','ready','returned_to_store') OR NEW.status IS DISTINCT FROM OLD.status THEN
                        RAISE EXCEPTION 'commerce_order_fulfillments: the type can switch between local delivery and carrier only before dispatch' USING ERRCODE = 'check_violation';
                    END IF;
                END IF;
            {$once}
                IF NEW.status IS DISTINCT FROM OLD.status THEN
                    IF (OLD.status || '>' || NEW.status) NOT IN ({$edges}) THEN
                        RAISE EXCEPTION 'commerce_order_fulfillments: transition not allowed' USING ERRCODE = 'check_violation';
                    END IF;
                    IF NEW.status = 'out_for_delivery' AND NEW.type = 'pickup' THEN
                        RAISE EXCEPTION 'commerce_order_fulfillments: a pickup cannot go out for delivery' USING ERRCODE = 'check_violation';
                    END IF;
                    IF NEW.status = 'picked_up' AND NEW.type <> 'pickup' THEN
                        RAISE EXCEPTION 'commerce_order_fulfillments: only a pickup can be picked up' USING ERRCODE = 'check_violation';
                    END IF;
                    IF NEW.status = 'ready' AND NEW.ready_at IS NULL THEN RAISE EXCEPTION 'commerce_order_fulfillments: ready requires ready_at' USING ERRCODE = 'check_violation'; END IF;
                    IF NEW.status = 'out_for_delivery' AND (NEW.last_dispatched_at IS NULL OR NEW.first_dispatched_at IS NULL) THEN
                        RAISE EXCEPTION 'commerce_order_fulfillments: dispatch requires its timestamps' USING ERRCODE = 'check_violation';
                    END IF;
                    IF NEW.status = 'out_for_delivery' AND NEW.type = 'carrier' AND COALESCE(btrim(NEW.carrier_name), '') = '' THEN
                        RAISE EXCEPTION 'commerce_order_fulfillments: a carrier dispatch requires the carrier name' USING ERRCODE = 'check_violation';
                    END IF;
                    IF NEW.status = 'delivered' AND NEW.delivered_at IS NULL THEN RAISE EXCEPTION 'commerce_order_fulfillments: delivered requires delivered_at' USING ERRCODE = 'check_violation'; END IF;
                    IF NEW.status = 'picked_up' AND NEW.picked_up_at IS NULL THEN RAISE EXCEPTION 'commerce_order_fulfillments: picked_up requires picked_up_at' USING ERRCODE = 'check_violation'; END IF;
                    IF NEW.status = 'delivery_failed' AND (NEW.last_failed_at IS NULL OR NEW.last_failure_reason IS NULL) THEN
                        RAISE EXCEPTION 'commerce_order_fulfillments: a failure requires its time and reason' USING ERRCODE = 'check_violation';
                    END IF;
                    IF NEW.status = 'returned_to_store' AND NEW.last_returned_at IS NULL THEN RAISE EXCEPTION 'commerce_order_fulfillments: a return requires its time' USING ERRCODE = 'check_violation'; END IF;
                    IF NEW.status = 'delivery_failed' THEN
                        IF NEW.delivery_attempts <> OLD.delivery_attempts + 1 THEN
                            RAISE EXCEPTION 'commerce_order_fulfillments: a failure increments the attempts by one' USING ERRCODE = 'check_violation';
                        END IF;
                    ELSIF NEW.delivery_attempts IS DISTINCT FROM OLD.delivery_attempts THEN
                        RAISE EXCEPTION 'commerce_order_fulfillments: attempts change only on failure' USING ERRCODE = 'check_violation';
                    END IF;
                ELSIF NEW.delivery_attempts IS DISTINCT FROM OLD.delivery_attempts THEN
                    RAISE EXCEPTION 'commerce_order_fulfillments: attempts change only on failure' USING ERRCODE = 'check_violation';
                END IF;
                RETURN NEW;
            END
            \$fn\$
            SQL);
        DB::unprepared('CREATE TRIGGER cof_guard BEFORE INSERT OR UPDATE ON '.self::TABLE.' FOR EACH ROW EXECUTE FUNCTION cof_guard()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION cof_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
                    RAISE EXCEPTION 'commerce_order_fulfillments: a fulfillment cannot be deleted' USING ERRCODE = 'check_violation';
                END IF;
                RETURN OLD;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER cof_no_delete BEFORE DELETE ON '.self::TABLE.' FOR EACH ROW EXECUTE FUNCTION cof_guard_delete()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION cof_truncate_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                RAISE EXCEPTION 'commerce_order_fulfillments: truncate is not allowed' USING ERRCODE = 'check_violation';
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER cof_truncate_guard BEFORE TRUNCATE ON '.self::TABLE.' FOR EACH STATEMENT EXECUTE FUNCTION cof_truncate_guard()');

        // حارس إلغاء الطلب (مُشغّل مستقل عن مُشغّلات الإلغاء/القبول القائمة — لا إعادة إنشاء لها).
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION commerce_orders_fulfillment_cancel_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL
                   AND EXISTS (SELECT 1 FROM commerce_order_fulfillments f WHERE f.commerce_order_id = NEW.id
                               AND f.status IN ('out_for_delivery','delivery_failed','delivered','picked_up')) THEN
                    RAISE EXCEPTION 'commerce_orders: an order whose fulfillment is in transit or completed cannot be cancelled' USING ERRCODE = 'check_violation';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        // بلا قائمة أعمدة `UPDATE OF cancelled_at`: مُشغّل بقائمة أعمدة يعتمد على العمود فيمنع `DROP COLUMN` (هجرة الإلغاء `down()` في اختبار تراجعها).
        // الفحص الأول في الدالة (`OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL`) يجعل تكلفة بقية التحديثات لا تُذكر.
        DB::unprepared(
            'CREATE TRIGGER commerce_orders_fulfillment_cancel_guard BEFORE UPDATE ON commerce_orders '
            .'FOR EACH ROW EXECUTE FUNCTION commerce_orders_fulfillment_cancel_guard()'
        );
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

    // ───────────────────────────── SQLite ─────────────────────────────

    private function sqliteGuards(): void
    {
        $t = self::TABLE;
        $types = $this->quoted(self::TYPES);
        $statuses = $this->quoted(self::STATUSES);
        $reasons = $this->quoted(self::FAILURE_REASONS);
        $edges = $this->quoted(self::EDGES);
        $notPure = 'NOT ('.$this->pureNullification(false).')';

        DB::unprepared(<<<SQL
            CREATE TRIGGER cof_insert BEFORE INSERT ON {$t}
            WHEN NEW.type NOT IN ({$types})
              OR NEW.status NOT IN ('preparing','ready') OR NEW.version IS NOT 1 OR NEW.delivery_attempts IS NOT 0
              OR (NEW.status = 'preparing' AND NEW.preparing_at IS NULL) OR (NEW.status = 'ready' AND NEW.ready_at IS NULL)
              OR NEW.first_dispatched_at IS NOT NULL OR NEW.last_dispatched_at IS NOT NULL OR NEW.last_failed_at IS NOT NULL
              OR NEW.last_returned_at IS NOT NULL OR NEW.delivered_at IS NOT NULL OR NEW.picked_up_at IS NOT NULL
              OR NEW.last_failure_reason IS NOT NULL OR NEW.last_failure_note IS NOT NULL
              OR (NEW.tracking_url IS NOT NULL AND NEW.tracking_url NOT LIKE 'https://%')
            BEGIN
                SELECT RAISE(ABORT, 'commerce_order_fulfillments: invalid creation (type, initial status, version 1, no later-stage facts)');
            END
            SQL);

        DB::unprepared(<<<SQL
            CREATE TRIGGER cof_frozen_ids BEFORE UPDATE ON {$t}
            WHEN {$notPure} AND (NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.commerce_order_id IS NOT OLD.commerce_order_id
                 OR NEW.warehouse_id IS NOT OLD.warehouse_id OR NEW.created_at IS NOT OLD.created_at)
            BEGIN
                SELECT RAISE(ABORT, 'commerce_order_fulfillments: identity, order, warehouse and creation time are immutable');
            END
            SQL);

        DB::unprepared(<<<SQL
            CREATE TRIGGER cof_terminal BEFORE UPDATE ON {$t}
            WHEN {$notPure} AND OLD.status IN ('delivered','picked_up')
            BEGIN
                SELECT RAISE(ABORT, 'commerce_order_fulfillments: a completed fulfillment is immutable');
            END
            SQL);

        DB::unprepared(<<<SQL
            CREATE TRIGGER cof_version BEFORE UPDATE ON {$t}
            WHEN {$notPure} AND NEW.version IS NOT OLD.version + 1
            BEGIN
                SELECT RAISE(ABORT, 'commerce_order_fulfillments: the version must advance by exactly one');
            END
            SQL);

        DB::unprepared(<<<SQL
            CREATE TRIGGER cof_value_domain BEFORE UPDATE ON {$t}
            WHEN {$notPure} AND (
                NEW.status NOT IN ({$statuses}) OR NEW.type NOT IN ({$types})
                OR (NEW.last_failure_reason IS NOT NULL AND NEW.last_failure_reason NOT IN ({$reasons}))
                OR (NEW.tracking_url IS NOT NULL AND NEW.tracking_url NOT LIKE 'https://%')
            )
            BEGIN
                SELECT RAISE(ABORT, 'commerce_order_fulfillments: invalid status, type, failure reason or tracking url');
            END
            SQL);

        DB::unprepared(<<<SQL
            CREATE TRIGGER cof_edges BEFORE UPDATE ON {$t}
            WHEN {$notPure} AND NEW.status IS NOT OLD.status AND (
                (OLD.status || '>' || NEW.status) NOT IN ({$edges})
                OR (NEW.status = 'out_for_delivery' AND NEW.type = 'pickup')
                OR (NEW.status = 'picked_up' AND NEW.type <> 'pickup')
            )
            BEGIN
                SELECT RAISE(ABORT, 'commerce_order_fulfillments: transition not allowed');
            END
            SQL);

        DB::unprepared(<<<SQL
            CREATE TRIGGER cof_type_switch BEFORE UPDATE ON {$t}
            WHEN {$notPure} AND NEW.type IS NOT OLD.type AND (
                OLD.type = 'pickup' OR NEW.type = 'pickup' OR OLD.status NOT IN ('preparing','ready','returned_to_store') OR NEW.status IS NOT OLD.status
            )
            BEGIN
                SELECT RAISE(ABORT, 'commerce_order_fulfillments: the type can switch between local delivery and carrier only before dispatch');
            END
            SQL);

        $onceConditions = implode(' OR ', array_map(fn (string $c) => "(OLD.{$c} IS NOT NULL AND NEW.{$c} IS NOT OLD.{$c})", self::ONCE_STAMPS));
        DB::unprepared(<<<SQL
            CREATE TRIGGER cof_once_stamps BEFORE UPDATE ON {$t}
            WHEN {$notPure} AND ({$onceConditions})
            BEGIN
                SELECT RAISE(ABORT, 'commerce_order_fulfillments: a recorded timestamp is write-once');
            END
            SQL);

        DB::unprepared(<<<SQL
            CREATE TRIGGER cof_attempts BEFORE UPDATE ON {$t}
            WHEN {$notPure} AND (
                (NEW.status IS NOT OLD.status AND NEW.status = 'delivery_failed' AND NEW.delivery_attempts IS NOT OLD.delivery_attempts + 1)
                OR ((NEW.status IS OLD.status OR NEW.status <> 'delivery_failed') AND NEW.delivery_attempts IS NOT OLD.delivery_attempts)
            )
            BEGIN
                SELECT RAISE(ABORT, 'commerce_order_fulfillments: attempts increment by one on failure only');
            END
            SQL);

        DB::unprepared(<<<SQL
            CREATE TRIGGER cof_transition_stamps BEFORE UPDATE ON {$t}
            WHEN {$notPure} AND NEW.status IS NOT OLD.status AND (
                (NEW.status = 'ready' AND NEW.ready_at IS NULL)
                OR (NEW.status = 'out_for_delivery' AND (NEW.last_dispatched_at IS NULL OR NEW.first_dispatched_at IS NULL))
                OR (NEW.status = 'out_for_delivery' AND NEW.type = 'carrier' AND trim(COALESCE(NEW.carrier_name, '')) = '')
                OR (NEW.status = 'delivered' AND NEW.delivered_at IS NULL)
                OR (NEW.status = 'picked_up' AND NEW.picked_up_at IS NULL)
                OR (NEW.status = 'delivery_failed' AND (NEW.last_failed_at IS NULL OR NEW.last_failure_reason IS NULL))
                OR (NEW.status = 'returned_to_store' AND NEW.last_returned_at IS NULL)
            )
            BEGIN
                SELECT RAISE(ABORT, 'commerce_order_fulfillments: the transition is missing its required timestamp, reason or carrier');
            END
            SQL);

        DB::unprepared(<<<SQL
            CREATE TRIGGER cof_no_delete BEFORE DELETE ON {$t}
            WHEN EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id)
            BEGIN
                SELECT RAISE(ABORT, 'commerce_order_fulfillments: a fulfillment cannot be deleted');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER cmo_fulfillment_cancel_block BEFORE UPDATE OF cancelled_at ON commerce_orders
            WHEN OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL
              AND EXISTS (SELECT 1 FROM commerce_order_fulfillments f WHERE f.commerce_order_id = NEW.id
                          AND f.status IN ('out_for_delivery','delivery_failed','delivered','picked_up'))
            BEGIN
                SELECT RAISE(ABORT, 'commerce_orders: an order whose fulfillment is in transit or completed cannot be cancelled');
            END
            SQL);
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
