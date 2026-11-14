<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * TANKER-PR8 — مطابقة قراءات الفوهات مع العمليات المسجَّلة عليها عند إغلاق الوردية ومراجعة فروق العدّادات. جداول إضافية + عمود إضافي واحد، لا Backfill ولا تعديل لأي صف قائم.
 *
 *  - `fuel_shift_nozzle_reconciliations` لقطة **مجمَّدة** لكل فوهة عند الإغلاق: M (فرق العدّاد) = D (مبيعات مباشرة نهائية) + T (سندات تعبئة صهاريج مسجَّلة) + U (غير مفسَّر).
 *  - `fuel_shift_meter_variance_reviews` مراجعة المشرف (`fuel.shift.meter_variance_review`): **تصنيف وصفي فقط** لفرق فوهة، قرار واحد لكل لقطة، **بلا أي أثر محاسبي أو مخزني**.
 *  - `fuel_shift_settlement_lines.tanker_milliliters` (nullable): لترات سندات التعبئة التي استبعدتها التسوية من البقية. **NULL = تسوية سابقة لهذا التعديل لم تستبعدها** (لا Backfill):
 *    يمنع ترحيل سندات تلك الوردية (خصم مزدوج محتمل).
 *
 * الثبات في القاعدة (PostgreSQL وSQLite): لا UPDATE على الجدولين أبداً، ولا DELETE ما دام المستأجر موجوداً (حذف المستأجر المتسلسل يمرّ). التراجع يرفض متى وُجد أي صف.
 */
return new class extends Migration
{
    private const RECONCILIATIONS = 'fuel_shift_nozzle_reconciliations';
    private const REVIEWS = 'fuel_shift_meter_variance_reviews';

    public function up(): void
    {
        Schema::create(self::RECONCILIATIONS, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations');
            $table->foreignUuid('fuel_shift_id')->constrained('fuel_shifts');
            $table->foreignUuid('fuel_nozzle_id')->constrained('fuel_nozzles');
            $table->foreignUuid('fuel_product_id')->constrained('fuel_products');
            $table->bigInteger('metered_milliliters')->nullable();
            $table->bigInteger('direct_sale_milliliters')->default(0);
            $table->bigInteger('tanker_fill_milliliters')->default(0);
            $table->unsignedInteger('tanker_fill_count')->default(0);
            $table->bigInteger('draft_sale_milliliters')->default(0);
            $table->bigInteger('unexplained_milliliters')->nullable();
            $table->bigInteger('tolerance_milliliters')->default(0);
            $table->string('status', 20);
            $table->string('incompleteness', 32)->nullable();
            $table->timestamp('frozen_at');
            $table->timestamps();

            $table->unique(['fuel_shift_id', 'fuel_nozzle_id'], 'fuel_nozzle_reconciliation_unique');
            $table->index(['tenant_id', 'fuel_shift_id'], 'fuel_nozzle_reconciliation_shift_idx');
        });

        Schema::create(self::REVIEWS, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations');
            $table->foreignUuid('fuel_shift_id')->constrained('fuel_shifts');
            $table->foreignUuid('fuel_nozzle_id')->constrained('fuel_nozzles');
            $table->foreignUuid('fuel_shift_nozzle_reconciliation_id')->constrained(self::RECONCILIATIONS);
            $table->string('classification', 32);
            $table->text('note')->nullable();
            $table->foreignUuid('reviewed_by')->constrained('users');
            $table->timestamp('reviewed_at');
            $table->timestamps();

            $table->unique('fuel_shift_nozzle_reconciliation_id', 'fuel_meter_variance_review_unique');
            $table->index(['tenant_id', 'fuel_shift_id'], 'fuel_meter_variance_review_shift_idx');
        });

        Schema::table('fuel_shift_settlement_lines', function (Blueprint $table) {
            $table->bigInteger('tanker_milliliters')->nullable()->after('erp_milliliters');
        });

        $driver = DB::connection()->getDriverName();
        if ($driver === 'pgsql') {
            DB::statement("ALTER TABLE ".self::RECONCILIATIONS." ADD CONSTRAINT fuel_nozzle_reconciliation_shape CHECK (
                status IN ('balanced', 'within_tolerance', 'variance', 'incomplete')
                AND direct_sale_milliliters >= 0 AND tanker_fill_milliliters >= 0 AND draft_sale_milliliters >= 0 AND tolerance_milliliters >= 0
                AND (status = 'incomplete' OR (metered_milliliters IS NOT NULL AND unexplained_milliliters IS NOT NULL
                     AND unexplained_milliliters = metered_milliliters - direct_sale_milliliters - tanker_fill_milliliters))
                AND (status <> 'incomplete' OR (unexplained_milliliters IS NULL AND incompleteness IS NOT NULL))
            )");
            DB::statement("ALTER TABLE ".self::REVIEWS." ADD CONSTRAINT fuel_meter_variance_review_shape CHECK (
                classification IN ('unrecorded_direct_sale', 'unrecorded_tanker_fill', 'over_recorded_entry', 'reading_error', 'calibration_test', 'internal_use', 'loss_or_leak', 'other')
                AND (classification <> 'other' OR (note IS NOT NULL AND length(btrim(note)) > 0))
            )");
            foreach ([self::RECONCILIATIONS, self::REVIEWS] as $table) {
                DB::unprepared("CREATE OR REPLACE FUNCTION {$table}_guard() RETURNS trigger LANGUAGE plpgsql AS \$fn\$
                    BEGIN
                        IF TG_OP = 'UPDATE' THEN
                            RAISE EXCEPTION '{$table}: rows are immutable';
                        END IF;
                        IF EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
                            RAISE EXCEPTION '{$table}: rows cannot be deleted';
                        END IF;
                        RETURN OLD;
                    END
                    \$fn\$");
                DB::unprepared("CREATE TRIGGER {$table}_no_update BEFORE UPDATE ON {$table} FOR EACH ROW EXECUTE FUNCTION {$table}_guard()");
                DB::unprepared("CREATE TRIGGER {$table}_no_delete BEFORE DELETE ON {$table} FOR EACH ROW EXECUTE FUNCTION {$table}_guard()");
            }
        } elseif ($driver === 'sqlite') {
            DB::unprepared("CREATE TRIGGER fuel_nozzle_reconciliation_shape BEFORE INSERT ON ".self::RECONCILIATIONS."
                WHEN NEW.status NOT IN ('balanced', 'within_tolerance', 'variance', 'incomplete')
                    OR NEW.direct_sale_milliliters < 0 OR NEW.tanker_fill_milliliters < 0 OR NEW.draft_sale_milliliters < 0 OR NEW.tolerance_milliliters < 0
                    OR (NEW.status <> 'incomplete' AND (NEW.metered_milliliters IS NULL OR NEW.unexplained_milliliters IS NULL
                        OR NEW.unexplained_milliliters <> NEW.metered_milliliters - NEW.direct_sale_milliliters - NEW.tanker_fill_milliliters))
                    OR (NEW.status = 'incomplete' AND (NEW.unexplained_milliliters IS NOT NULL OR NEW.incompleteness IS NULL))
                BEGIN SELECT RAISE(ABORT, 'fuel_shift_nozzle_reconciliations: invalid shape'); END");
            DB::unprepared("CREATE TRIGGER fuel_meter_variance_review_shape BEFORE INSERT ON ".self::REVIEWS."
                WHEN NEW.classification NOT IN ('unrecorded_direct_sale', 'unrecorded_tanker_fill', 'over_recorded_entry', 'reading_error', 'calibration_test', 'internal_use', 'loss_or_leak', 'other')
                    OR (NEW.classification = 'other' AND (NEW.note IS NULL OR length(trim(NEW.note)) = 0))
                BEGIN SELECT RAISE(ABORT, 'fuel_shift_meter_variance_reviews: invalid shape'); END");
            foreach ([self::RECONCILIATIONS, self::REVIEWS] as $table) {
                DB::unprepared("CREATE TRIGGER {$table}_no_update BEFORE UPDATE ON {$table} BEGIN SELECT RAISE(ABORT, '{$table}: rows are immutable'); END");
                DB::unprepared("CREATE TRIGGER {$table}_no_delete BEFORE DELETE ON {$table} WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
                    BEGIN SELECT RAISE(ABORT, '{$table}: rows cannot be deleted'); END");
            }
        }
    }

    public function down(): void
    {
        foreach ([self::REVIEWS, self::RECONCILIATIONS] as $table) {
            if (Schema::hasTable($table) && DB::table($table)->exists()) {
                throw new RuntimeException("Rollback refused: {$table} contains meter reconciliation records.");
            }
        }
        if (Schema::hasColumn('fuel_shift_settlement_lines', 'tanker_milliliters') && DB::table('fuel_shift_settlement_lines')->whereNotNull('tanker_milliliters')->exists()) {
            throw new RuntimeException('Rollback refused: settlement lines carry tanker exclusion facts.');
        }

        Schema::table('fuel_shift_settlement_lines', function (Blueprint $table) {
            $table->dropColumn('tanker_milliliters');
        });
        if (DB::connection()->getDriverName() === 'pgsql') {
            foreach ([self::REVIEWS, self::RECONCILIATIONS] as $table) {
                DB::statement("DROP FUNCTION IF EXISTS {$table}_guard() CASCADE");
            }
        }
        Schema::dropIfExists(self::REVIEWS);
        Schema::dropIfExists(self::RECONCILIATIONS);
    }
};
