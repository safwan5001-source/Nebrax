<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * COPS-H1-4 (ADR-29 §2.2) — حقائق قبول التاجر على `commerce_orders`: أعمدة إضافية nullable فقط + حراس قاعدة بيانات. **بلا backfill**:
 * كل طلب قائم يبقى `acceptance_mode = NULL` (تلقائي) — لا يتغيّر تفسير أي طلب تاريخي.
 *
 *  - `acceptance_mode`: لقطة وضع القبول عند الإنشاء. `NULL` = تلقائي (التاريخي، وكل طلب أُنشئ وبوابة القبول مغلقة) · `manual`.
 *  - `accepted_at` / `accepted_by_user_id`: لحظة القبول اليدوي وفاعله.
 *
 * الحراس (PostgreSQL وSQLite، لا تعتمد على انضباط التطبيق):
 *  1. الإنشاء: الوضع `NULL` أو `manual` فقط، ولا يُنشأ طلب مقبولاً.
 *  2. `acceptance_mode` لقطة لا تتغيّر بعد الإدراج.
 *  3. الفاعل لا يوجد بلا `accepted_at`.
 *  4. القبول (`accepted_at` من NULL) فقط لطلب `manual` مؤكَّد غير ملغى، وبفاعل.
 *  5. بعد القبول تتجمّد `accepted_at`؛ والفاعل لا يتغيّر إلا إلى NULL (FK `nullOnDelete`) — فلا إلغاء ولا تعديل يمحو القبول.
 *  6. لا حذف لطلب مقبول ما دام مستأجره موجوداً.
 *
 * `down()` يرفض متى وُجد أي طلب بوضع يدوي أو مقبول (إصلاح إلى الأمام فقط).
 */
return new class extends Migration
{
    private const COLUMNS = ['acceptance_mode', 'accepted_at', 'accepted_by_user_id'];

    public function up(): void
    {
        $pgsql = DB::connection()->getDriverName() === 'pgsql';

        Schema::table('commerce_orders', function (Blueprint $table) use ($pgsql) {
            $table->string('acceptance_mode', 16)->nullable();
            $table->timestamp('accepted_at')->nullable();
            if ($pgsql) {
                $table->foreignUuid('accepted_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            }
        });

        if ($pgsql) {
            $this->postgresGuards();

            return;
        }

        // SQLite: إضافة مفتاح أجنبي عبر Schema Builder **يعيد بناء الجدول** فتضيع مُشغِّلات حارس الإلغاء (2026_12_13) — فيُضاف العمود بعبارة
        // `ADD COLUMN … REFERENCES` الأصلية (لا إعادة بناء)، بالدلالة نفسها (`ON DELETE SET NULL`). يحرس بقاء المُشغِّلات اختبار.
        DB::statement('ALTER TABLE commerce_orders ADD COLUMN accepted_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL');
        $this->sqliteGuards();
    }

    public function down(): void
    {
        if (Schema::hasColumn('commerce_orders', 'acceptance_mode')
            && DB::table('commerce_orders')->where(fn ($q) => $q->whereNotNull('acceptance_mode')->orWhereNotNull('accepted_at'))->exists()) {
            throw new RuntimeException(
                'Rollback refused: commerce orders carry acceptance facts. Removing the acceptance guards would leave them unprotected; '
                .'use a forward-only migration instead.'
            );
        }

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS commerce_orders_acceptance_guard ON commerce_orders');
            DB::unprepared('DROP TRIGGER IF EXISTS commerce_orders_acceptance_no_delete ON commerce_orders');
            DB::unprepared('DROP FUNCTION IF EXISTS commerce_orders_acceptance_guard()');
            DB::unprepared('DROP FUNCTION IF EXISTS commerce_orders_acceptance_guard_delete()');

            Schema::table('commerce_orders', function (Blueprint $table) {
                $table->dropConstrainedForeignId('accepted_by_user_id');
                $table->dropColumn(['acceptance_mode', 'accepted_at']);
            });

            return;
        }

        foreach (['cmo_accept_insert', 'cmo_accept_mode_frozen', 'cmo_accept_frozen', 'cmo_accept_orphan_actor', 'cmo_accept_transition', 'cmo_accept_no_delete'] as $trigger) {
            DB::unprepared("DROP TRIGGER IF EXISTS {$trigger}");
        }
        // حذف أصلي (لا إعادة بناء) فلا تضيع مُشغِّلات الإلغاء.
        foreach (['accepted_by_user_id', 'accepted_at', 'acceptance_mode'] as $column) {
            DB::statement("ALTER TABLE commerce_orders DROP COLUMN {$column}");
        }
    }

    private function postgresGuards(): void
    {
        $columns = implode(', ', self::COLUMNS);

        // رسائل ثابتة النص (لا استيفاء لقيم الصف).
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION commerce_orders_acceptance_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF TG_OP = 'INSERT' THEN
                    IF NEW.acceptance_mode IS NOT NULL AND NEW.acceptance_mode <> 'manual' THEN
                        RAISE EXCEPTION 'commerce_orders: the acceptance mode snapshot must be NULL (automatic) or manual' USING ERRCODE = 'check_violation';
                    END IF;
                    IF NEW.accepted_at IS NOT NULL OR NEW.accepted_by_user_id IS NOT NULL THEN
                        RAISE EXCEPTION 'commerce_orders: an order cannot be created already accepted' USING ERRCODE = 'check_violation';
                    END IF;
                    RETURN NEW;
                END IF;

                IF NEW.acceptance_mode IS DISTINCT FROM OLD.acceptance_mode THEN
                    RAISE EXCEPTION 'commerce_orders: the acceptance mode is a creation-time snapshot and cannot change' USING ERRCODE = 'check_violation';
                END IF;

                IF OLD.accepted_at IS NOT NULL THEN
                    IF NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
                       OR (NEW.accepted_by_user_id IS DISTINCT FROM OLD.accepted_by_user_id AND NEW.accepted_by_user_id IS NOT NULL) THEN
                        RAISE EXCEPTION 'commerce_orders: acceptance facts are immutable' USING ERRCODE = 'check_violation';
                    END IF;
                    RETURN NEW;
                END IF;

                IF NEW.accepted_at IS NULL THEN
                    IF NEW.accepted_by_user_id IS NOT NULL THEN
                        RAISE EXCEPTION 'commerce_orders: acceptance details require accepted_at' USING ERRCODE = 'check_violation';
                    END IF;
                    RETURN NEW;
                END IF;

                IF OLD.acceptance_mode IS DISTINCT FROM 'manual' THEN
                    RAISE EXCEPTION 'commerce_orders: only a manual-acceptance order can be accepted' USING ERRCODE = 'check_violation';
                END IF;
                IF OLD.status IS DISTINCT FROM 'confirmed' OR NEW.status IS DISTINCT FROM 'confirmed' THEN
                    RAISE EXCEPTION 'commerce_orders: only a confirmed order can be accepted' USING ERRCODE = 'check_violation';
                END IF;
                IF OLD.cancelled_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL THEN
                    RAISE EXCEPTION 'commerce_orders: a cancelled order cannot be accepted' USING ERRCODE = 'check_violation';
                END IF;
                IF NEW.accepted_by_user_id IS NULL THEN
                    RAISE EXCEPTION 'commerce_orders: an acceptance requires its actor' USING ERRCODE = 'check_violation';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared(
            "CREATE TRIGGER commerce_orders_acceptance_guard BEFORE INSERT OR UPDATE OF {$columns} ON commerce_orders "
            .'FOR EACH ROW EXECUTE FUNCTION commerce_orders_acceptance_guard()'
        );

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION commerce_orders_acceptance_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF OLD.accepted_at IS NOT NULL AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id) THEN
                    RAISE EXCEPTION 'commerce_orders: an accepted order cannot be deleted' USING ERRCODE = 'check_violation';
                END IF;
                RETURN OLD;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER commerce_orders_acceptance_no_delete BEFORE DELETE ON commerce_orders FOR EACH ROW EXECUTE FUNCTION commerce_orders_acceptance_guard_delete()');
    }

    private function sqliteGuards(): void
    {
        $columns = implode(', ', self::COLUMNS);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER cmo_accept_insert BEFORE INSERT ON commerce_orders
            WHEN (NEW.acceptance_mode IS NOT NULL AND NEW.acceptance_mode IS NOT 'manual')
              OR NEW.accepted_at IS NOT NULL OR NEW.accepted_by_user_id IS NOT NULL
            BEGIN
                SELECT RAISE(ABORT, 'commerce_orders: invalid acceptance facts at creation (mode NULL or manual, never already accepted)');
            END
            SQL);

        DB::unprepared(<<<SQL
            CREATE TRIGGER cmo_accept_mode_frozen BEFORE UPDATE OF {$columns} ON commerce_orders
            WHEN NEW.acceptance_mode IS NOT OLD.acceptance_mode
            BEGIN
                SELECT RAISE(ABORT, 'commerce_orders: the acceptance mode is a creation-time snapshot and cannot change');
            END
            SQL);

        DB::unprepared(<<<SQL
            CREATE TRIGGER cmo_accept_frozen BEFORE UPDATE OF {$columns} ON commerce_orders
            WHEN OLD.accepted_at IS NOT NULL AND (
                NEW.accepted_at IS NOT OLD.accepted_at
                OR (NEW.accepted_by_user_id IS NOT OLD.accepted_by_user_id AND NEW.accepted_by_user_id IS NOT NULL)
            )
            BEGIN
                SELECT RAISE(ABORT, 'commerce_orders: acceptance facts are immutable');
            END
            SQL);

        DB::unprepared(<<<SQL
            CREATE TRIGGER cmo_accept_orphan_actor BEFORE UPDATE OF {$columns} ON commerce_orders
            WHEN OLD.accepted_at IS NULL AND NEW.accepted_at IS NULL AND NEW.accepted_by_user_id IS NOT NULL
            BEGIN
                SELECT RAISE(ABORT, 'commerce_orders: acceptance details require accepted_at');
            END
            SQL);

        DB::unprepared(<<<SQL
            CREATE TRIGGER cmo_accept_transition BEFORE UPDATE OF {$columns} ON commerce_orders
            WHEN OLD.accepted_at IS NULL AND NEW.accepted_at IS NOT NULL AND (
                OLD.acceptance_mode IS NOT 'manual'
                OR OLD.status IS NOT 'confirmed' OR NEW.status IS NOT 'confirmed'
                OR OLD.cancelled_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL
                OR NEW.accepted_by_user_id IS NULL
            )
            BEGIN
                SELECT RAISE(ABORT, 'commerce_orders: invalid acceptance (confirmed, uncancelled manual order and an actor required)');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER cmo_accept_no_delete BEFORE DELETE ON commerce_orders
            WHEN OLD.accepted_at IS NOT NULL AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = OLD.tenant_id)
            BEGIN
                SELECT RAISE(ABORT, 'commerce_orders: an accepted order cannot be deleted');
            END
            SQL);
    }
};
