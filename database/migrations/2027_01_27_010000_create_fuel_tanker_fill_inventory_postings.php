<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * TANKER-PR6A — **بنية** ربط سند تعبئة الصهريج بحركة المخزون الرسمية (ضوابط منع التكرار في القاعدة). **الجدول فارغ ولا كاتب له في هذه الشريحة:**
 * لا خصم كمية، لا خصم من `fuel_inventory_cost_states`، لا قيد، ولا لمس لحساب 1140 (قرار المالك: «لا خصم الآن — تجهيز البنية والضوابط فقط»).
 * الترحيل الفعلي (PR-6B بعد اعتماد المعالجة المحاسبية) هو أول من سيكتب هنا؛ نموذج `FuelTankerFillInventoryPosting` يرفض أي إنشاء/تعديل/حذف برمجياً حتى ذلك الحين.
 *
 * ما تضمنه القاعدة (لا التحقق البرمجي وحده):
 *  - **ترحيل واحد لكل سند:** `fuel_tanker_fill_id` فريد، وحركة المخزون وحركة مجمّع التكلفة فريدتان (حركة لا تُنسب لسندين).
 *  - **مفتاح idempotency فريد للمؤسسة:** إعادة الطلب أو انقطاع الاتصال لا يُنتج خصماً ثانياً.
 *  - **الكمية والتكلفة التاريخيتان ثابتتان:** تُثبَّتان عند الترحيل ولا تتغيّران؛ العكس لاحقاً بالقيمتين الأصليتين لا بإعادة تسعير.
 *  - **العكس مرة واحدة:** الانتقال الوحيد `posted → reversed` (حركتا عكس فريدتان + منفّذ ووقت وسبب)؛ لا إعادة فتح ولا حذف (سجل تدقيقي).
 *  - **تطابق مع السند:** الإدراج يشترط سنداً `recorded` من المؤسسة والمحطة والمنتج والكمية نفسها.
 *
 * التراجع يرفض متى وُجد أي صف. المفاتيح الأجنبية `NO ACTION` (تمنع حذف سند أو حركة عليها ترحيل، وتسمح بحذف المستأجر كاملاً كبقية جداول الوقود).
 */
return new class extends Migration
{
    private const TABLE = 'fuel_tanker_fill_inventory_postings';

    /** أعمدة هوية الترحيل: ثابتة بعد الإنشاء. */
    private const IMMUTABLE = [
        'id', 'tenant_id', 'branch_id', 'fuel_tanker_fill_id', 'fuel_station_id', 'fuel_product_id', 'warehouse_id',
        'stock_movement_id', 'cost_movement_id', 'quantity_milliliters', 'posted_cost_minor', 'idempotency_key',
        'posted_by', 'posted_at', 'created_at',
    ];

    public function up(): void
    {
        Schema::create(self::TABLE, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained();
            $table->foreignUuid('fuel_tanker_fill_id')->constrained('fuel_tanker_fills');
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations');
            $table->foreignUuid('fuel_product_id')->constrained('fuel_products');
            $table->foreignUuid('warehouse_id')->constrained('warehouses');

            $table->foreignUuid('stock_movement_id')->constrained('stock_movements');
            $table->foreignUuid('cost_movement_id')->constrained('fuel_inventory_cost_movements');
            $table->bigInteger('quantity_milliliters');
            $table->bigInteger('posted_cost_minor');
            $table->string('idempotency_key', 128);

            $table->string('status', 16)->default('posted');
            $table->foreignUuid('posted_by')->constrained('users');
            $table->timestamp('posted_at');
            $table->foreignUuid('reversal_stock_movement_id')->nullable()->constrained('stock_movements');
            $table->foreignUuid('reversal_cost_movement_id')->nullable()->constrained('fuel_inventory_cost_movements');
            $table->foreignUuid('reversed_by')->nullable()->constrained('users');
            $table->timestamp('reversed_at')->nullable();
            $table->text('reversal_reason')->nullable();
            $table->timestamps();

            $table->unique('fuel_tanker_fill_id', 'fuel_tanker_fill_posting_fill_unique');
            $table->unique('stock_movement_id', 'fuel_tanker_fill_posting_stock_unique');
            $table->unique('cost_movement_id', 'fuel_tanker_fill_posting_cost_unique');
            $table->unique('reversal_stock_movement_id', 'fuel_tanker_fill_posting_rev_stock_unique');
            $table->unique('reversal_cost_movement_id', 'fuel_tanker_fill_posting_rev_cost_unique');
            $table->unique(['tenant_id', 'idempotency_key'], 'fuel_tanker_fill_posting_idempotency_unique');
            $table->index(['tenant_id', 'fuel_station_id', 'status'], 'fuel_tanker_fill_posting_station_idx');
        });

        $driver = DB::connection()->getDriverName();
        if ($driver === 'pgsql') {
            $this->postgresGuards();
        } elseif ($driver === 'sqlite') {
            $this->sqliteGuards();
        }
    }

    public function down(): void
    {
        if (Schema::hasTable(self::TABLE) && DB::table(self::TABLE)->exists()) {
            throw new RuntimeException('Rollback refused: fuel_tanker_fill_inventory_postings contains posting records.');
        }

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP FUNCTION IF EXISTS fuel_tanker_fill_postings_guard_insert() CASCADE');
            DB::statement('DROP FUNCTION IF EXISTS fuel_tanker_fill_postings_guard_update() CASCADE');
            DB::statement('DROP FUNCTION IF EXISTS fuel_tanker_fill_postings_guard_delete() CASCADE');
        }
        Schema::dropIfExists(self::TABLE);
    }

    private function postgresGuards(): void
    {
        DB::statement("ALTER TABLE fuel_tanker_fill_inventory_postings
            ADD CONSTRAINT fuel_tanker_fill_posting_shape CHECK (
                quantity_milliliters > 0
                AND posted_cost_minor >= 0
                AND status IN ('posted', 'reversed')
                AND (status <> 'posted' OR (reversal_stock_movement_id IS NULL AND reversal_cost_movement_id IS NULL AND reversed_by IS NULL AND reversed_at IS NULL AND reversal_reason IS NULL))
                AND (status <> 'reversed' OR (reversal_stock_movement_id IS NOT NULL AND reversal_cost_movement_id IS NOT NULL AND reversed_by IS NOT NULL AND reversed_at IS NOT NULL AND reversal_reason IS NOT NULL))
            )");

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION fuel_tanker_fill_postings_guard_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NEW.status <> 'posted' THEN
                    RAISE EXCEPTION 'fuel_tanker_fill_inventory_postings: a posting is created as posted only';
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM fuel_tanker_fills f
                    WHERE f.id = NEW.fuel_tanker_fill_id AND f.tenant_id = NEW.tenant_id AND f.fuel_station_id = NEW.fuel_station_id
                        AND f.fuel_product_id = NEW.fuel_product_id AND f.quantity_milliliters = NEW.quantity_milliliters AND f.status = 'recorded'
                ) THEN
                    RAISE EXCEPTION 'fuel_tanker_fill_inventory_postings: posting must match a recorded fill of the same tenant, station, product and quantity';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER fuel_tanker_fill_posting_guard_insert BEFORE INSERT ON fuel_tanker_fill_inventory_postings FOR EACH ROW EXECUTE FUNCTION fuel_tanker_fill_postings_guard_insert()');

        $immutable = implode("\n                    OR ", array_map(fn (string $c) => "NEW.{$c} IS DISTINCT FROM OLD.{$c}", self::IMMUTABLE));
        DB::unprepared(<<<SQL
            CREATE OR REPLACE FUNCTION fuel_tanker_fill_postings_guard_update() RETURNS trigger LANGUAGE plpgsql AS \$fn\$
            BEGIN
                IF {$immutable} THEN
                    RAISE EXCEPTION 'fuel_tanker_fill_inventory_postings: posting identity, quantity and historical cost are immutable';
                END IF;
                IF OLD.status = 'reversed' AND (
                    NEW.status IS DISTINCT FROM OLD.status OR NEW.reversal_stock_movement_id IS DISTINCT FROM OLD.reversal_stock_movement_id
                    OR NEW.reversal_cost_movement_id IS DISTINCT FROM OLD.reversal_cost_movement_id OR NEW.reversed_by IS DISTINCT FROM OLD.reversed_by
                    OR NEW.reversed_at IS DISTINCT FROM OLD.reversed_at OR NEW.reversal_reason IS DISTINCT FROM OLD.reversal_reason
                ) THEN
                    RAISE EXCEPTION 'fuel_tanker_fill_inventory_postings: a reversed posting cannot change';
                END IF;
                RETURN NEW;
            END
            \$fn\$
            SQL);
        DB::unprepared('CREATE TRIGGER fuel_tanker_fill_posting_no_direct_update BEFORE UPDATE ON fuel_tanker_fill_inventory_postings FOR EACH ROW EXECUTE FUNCTION fuel_tanker_fill_postings_guard_update()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION fuel_tanker_fill_postings_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
                    RAISE EXCEPTION 'fuel_tanker_fill_inventory_postings: postings cannot be deleted (audit trail)';
                END IF;
                RETURN OLD;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER fuel_tanker_fill_posting_no_delete BEFORE DELETE ON fuel_tanker_fill_inventory_postings FOR EACH ROW EXECUTE FUNCTION fuel_tanker_fill_postings_guard_delete()');
    }

    private function sqliteGuards(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER fuel_tanker_fill_posting_shape BEFORE INSERT ON fuel_tanker_fill_inventory_postings
            WHEN NEW.quantity_milliliters <= 0 OR NEW.posted_cost_minor < 0 OR NEW.status <> 'posted'
                OR NEW.reversal_stock_movement_id IS NOT NULL OR NEW.reversal_cost_movement_id IS NOT NULL
                OR NEW.reversed_by IS NOT NULL OR NEW.reversed_at IS NOT NULL OR NEW.reversal_reason IS NOT NULL
                OR NOT EXISTS (
                    SELECT 1 FROM fuel_tanker_fills f
                    WHERE f.id = NEW.fuel_tanker_fill_id AND f.tenant_id = NEW.tenant_id AND f.fuel_station_id = NEW.fuel_station_id
                        AND f.fuel_product_id = NEW.fuel_product_id AND f.quantity_milliliters = NEW.quantity_milliliters AND f.status = 'recorded'
                )
            BEGIN
                SELECT RAISE(ABORT, 'fuel_tanker_fill_inventory_postings: invalid posting shape or no matching recorded fill');
            END
            SQL);

        $immutable = implode(' OR ', array_map(fn (string $c) => "OLD.{$c} IS NOT NEW.{$c}", self::IMMUTABLE));
        DB::unprepared(<<<SQL
            CREATE TRIGGER fuel_tanker_fill_posting_no_direct_update BEFORE UPDATE ON fuel_tanker_fill_inventory_postings
            WHEN {$immutable}
                OR NEW.status NOT IN ('posted', 'reversed')
                OR (OLD.status = 'reversed' AND (
                    NEW.status IS NOT OLD.status OR NEW.reversal_stock_movement_id IS NOT OLD.reversal_stock_movement_id
                    OR NEW.reversal_cost_movement_id IS NOT OLD.reversal_cost_movement_id OR NEW.reversed_by IS NOT OLD.reversed_by
                    OR NEW.reversed_at IS NOT OLD.reversed_at OR NEW.reversal_reason IS NOT OLD.reversal_reason))
                OR (NEW.status = 'reversed' AND (NEW.reversal_stock_movement_id IS NULL OR NEW.reversal_cost_movement_id IS NULL
                    OR NEW.reversed_by IS NULL OR NEW.reversed_at IS NULL OR NEW.reversal_reason IS NULL))
                OR (NEW.status = 'posted' AND (NEW.reversal_stock_movement_id IS NOT NULL OR NEW.reversal_cost_movement_id IS NOT NULL
                    OR NEW.reversed_by IS NOT NULL OR NEW.reversed_at IS NOT NULL OR NEW.reversal_reason IS NOT NULL))
            BEGIN
                SELECT RAISE(ABORT, 'fuel_tanker_fill_inventory_postings: posting identity, quantity and historical cost are immutable');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER fuel_tanker_fill_posting_no_delete BEFORE DELETE ON fuel_tanker_fill_inventory_postings
            WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
            BEGIN
                SELECT RAISE(ABORT, 'fuel_tanker_fill_inventory_postings: postings cannot be deleted (audit trail)');
            END
            SQL);
    }
};
