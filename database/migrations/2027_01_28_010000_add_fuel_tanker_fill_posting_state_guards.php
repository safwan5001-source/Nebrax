<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * TANKER-PR6B-2 — **تجهيز** قاعدة البيانات لانتقال سند تعبئة الصهريج `pending_integration → posted → reversed` مستقبلاً، **دون أن يكتب أي مسار هذه الحالات الآن**.
 * مُشغّلات/قيود فقط (PostgreSQL وSQLite): لا عمود جديد، لا صف يُدرَج أو يُعدَّل، ولا سند قائم يتغيّر (كلها `pending_integration` وتبقى كذلك). لا خصم مخزون ولا قيد
 * ولا مجمّع تكلفة ولا فاتورة/ضريبة/ذمة؛ والبوابة `FUEL_TANKER_INVENTORY_POSTING_ENABLED` مغلقة وغير مقروءة. الكاتب المستقبلي (PR-6B-3) هو أول من يدرج في جدول الترحيل.
 *
 * ما تفرضه القاعدة (لا التحقق البرمجي وحده):
 *  - **`posted` لا يكون إلا بصف ترحيل مطابق:** حالة السند تنتقل بمُشغّلات متزامنة من جدول الترحيل نفسه (إدراج ترحيل ⇒ السند `posted`؛ عكسه ⇒ `reversed`) فلا يختلف الاثنان؛
 *    وتحديث مباشر للسند يُقبل فقط إن وُجد الترحيل المقابل بحالته.
 *  - **لا قفز ولا رجوع:** المسموح `pending_integration → posted → reversed` فقط؛ `pending → reversed` أو الرجوع لحالة أسبق مرفوض.
 *  - **لا إلغاء (void) لسند مرحَّل `posted`** (قيد CHECK + مُشغّل)؛ العكس والإلغاء عمليتان منفصلتان (الإلغاء بعد العكس مسموح لأن المخزون عاد). الإدراج يقفل صف السند
 *    `FOR NO KEY UPDATE` فيتسلسل مع `lockForUpdate` في `FuelTankerFillService::void` (سباق ترحيل↔إلغاء لا يفلت منه أحد).
 *  - **ربط الحركات:** حركة المخزون (مؤسسة/مخزن المحطة/منتج الوقود/`out`/الكمية) وحركة مجمّع التكلفة (`issue`/الكمية/التكلفة التاريخية/نفس حركة المخزون)؛ وللعكس حركتان
 *    مختلفتان عن الأصل ومطابقتان للكمية والتكلفة الأصليتين (لا إعادة تسعير) ولا تُستعمل أي حركة لترحيل آخر.
 *  - **سقف الكمية 2,147,483,647 مل:** `stock_movements.quantity` عدد صحيح 32 بت؛ ترحيل أكبر منه يُرفض بدل أن يفيض.
 *  - **الدفتر التشغيلي (القائم، لا دفتر موازٍ):** نوعا `tanker_fill` و`tanker_fill_reversal` لا يُدرجان إلا مقابل ترحيل مطابق (مصدره السند، كمية سالبة/موجبة، الحركة الرسمية نفسها)،
 *    وصف واحد لكل (سند، نوع). **لا يُنشأ أي صف هنا.**
 *
 * التراجع يرفض متى وُجد سند خارج `pending_integration` أو أي ترحيل أو أي صف دفتر من النوعين (لا يُمحى سجل مخزني/مالي حقيقي)، ثم يعيد حراس PR-4/PR-6A حرفياً.
 */
return new class extends Migration
{
    private const FILLS = 'fuel_tanker_fills';
    private const POSTINGS = 'fuel_tanker_fill_inventory_postings';
    private const LEDGER = 'fuel_operational_ledgers';

    /** سقف `stock_movements.quantity` (integer 32 بت). */
    private const MAX_STOCK_QUANTITY = 2147483647;

    /** أعمدة السند الثابتة — كما في PR-4 **بعد إخراج `inventory_status`** (يحكمها منطق الانتقال أدناه). */
    private const FILL_IMMUTABLE = [
        'id', 'tenant_id', 'branch_id', 'fuel_station_id', 'fuel_shift_id', 'fuel_pump_id', 'fuel_nozzle_id', 'fuel_tank_id', 'fuel_product_id',
        'fuel_tanker_owner_id', 'fuel_tanker_id', 'number', 'voucher_number', 'voucher_key', 'voucher_scope', 'voucher_scope_key',
        'quantity_milliliters', 'tanker_capacity_milliliters', 'capacity_overrun_milliliters', 'capacity_overrun_policy',
        'capacity_overrun_confirmed_by', 'capacity_overrun_confirmed_at', 'policy_snapshot', 'notes',
        'idempotency_key', 'request_fingerprint', 'recorded_by', 'recorded_at', 'created_at',
    ];

    /** أعمدة السند الثابتة كما كانت في PR-4 (مع `inventory_status`) — للتراجع. */
    private const FILL_IMMUTABLE_V4 = [
        'id', 'tenant_id', 'branch_id', 'fuel_station_id', 'fuel_shift_id', 'fuel_pump_id', 'fuel_nozzle_id', 'fuel_tank_id', 'fuel_product_id',
        'fuel_tanker_owner_id', 'fuel_tanker_id', 'number', 'voucher_number', 'voucher_key', 'voucher_scope', 'voucher_scope_key',
        'quantity_milliliters', 'tanker_capacity_milliliters', 'capacity_overrun_milliliters', 'capacity_overrun_policy',
        'capacity_overrun_confirmed_by', 'capacity_overrun_confirmed_at', 'policy_snapshot', 'notes', 'inventory_status',
        'idempotency_key', 'request_fingerprint', 'recorded_by', 'recorded_at', 'created_at',
    ];

    private const POSTING_IMMUTABLE = [
        'id', 'tenant_id', 'branch_id', 'fuel_tanker_fill_id', 'fuel_station_id', 'fuel_product_id', 'warehouse_id',
        'stock_movement_id', 'cost_movement_id', 'quantity_milliliters', 'posted_cost_minor', 'idempotency_key',
        'posted_by', 'posted_at', 'created_at',
    ];

    public function up(): void
    {
        $driver = DB::connection()->getDriverName();
        if ($driver === 'pgsql') {
            $this->postgresUp();
        } elseif ($driver === 'sqlite') {
            $this->sqliteUp();
        }
    }

    public function down(): void
    {
        if (DB::table(self::FILLS)->where('inventory_status', '<>', 'pending_integration')->exists()
            || DB::table(self::POSTINGS)->exists()
            || DB::table(self::LEDGER)->whereIn('movement_type', ['tanker_fill', 'tanker_fill_reversal'])->exists()) {
            throw new RuntimeException('Rollback refused: tanker fill posting history exists (posted/reversed fills, postings or tanker ledger rows).');
        }

        $driver = DB::connection()->getDriverName();
        if ($driver === 'pgsql') {
            $this->postgresDown();
        } elseif ($driver === 'sqlite') {
            $this->sqliteDown();
        }
    }

    // ═════════════════════════════ PostgreSQL ═════════════════════════════

    private function postgresUp(): void
    {
        // ── السند: القيد والحراس ──
        DB::statement('ALTER TABLE fuel_tanker_fills DROP CONSTRAINT fuel_tanker_fill_shape');
        DB::statement("ALTER TABLE fuel_tanker_fills
            ADD CONSTRAINT fuel_tanker_fill_shape CHECK (
                quantity_milliliters > 0
                AND status IN ('recorded', 'voided')
                AND inventory_status IN ('pending_integration', 'posted', 'reversed')
                AND NOT (status = 'voided' AND inventory_status = 'posted')
                AND voucher_scope IN ('station', 'tenant', 'owner', 'none')
                AND (tanker_capacity_milliliters IS NULL OR tanker_capacity_milliliters > 0)
                AND (capacity_overrun_milliliters IS NULL OR capacity_overrun_milliliters > 0)
                AND (status = 'recorded' OR (voided_by IS NOT NULL AND voided_at IS NOT NULL AND void_reason IS NOT NULL))
                AND (status = 'voided' OR (voided_by IS NULL AND voided_at IS NULL AND void_reason IS NULL))
            )");

        // السند يُنشأ `pending_integration` دائماً (القيد أعلاه صار يقبل الحالات الثلاث فلا بد من منع الإدراج المباشر لغيرها).
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION fuel_tanker_fills_guard_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NEW.inventory_status <> 'pending_integration' THEN
                    RAISE EXCEPTION 'fuel_tanker_fills: a fill is created pending_integration only';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER fuel_tanker_fill_guard_insert BEFORE INSERT ON fuel_tanker_fills FOR EACH ROW EXECUTE FUNCTION fuel_tanker_fills_guard_insert()');

        DB::unprepared($this->pgFillUpdateFunction($this->pgImmutable(self::FILL_IMMUTABLE, 'policy_snapshot'), withTransitions: true));

        // ── الترحيل: القيد والحراس ──
        DB::statement('ALTER TABLE fuel_tanker_fill_inventory_postings DROP CONSTRAINT fuel_tanker_fill_posting_shape');
        $cap = self::MAX_STOCK_QUANTITY;
        DB::statement("ALTER TABLE fuel_tanker_fill_inventory_postings
            ADD CONSTRAINT fuel_tanker_fill_posting_shape CHECK (
                quantity_milliliters > 0
                AND quantity_milliliters <= {$cap}
                AND posted_cost_minor >= 0
                AND status IN ('posted', 'reversed')
                AND (status <> 'posted' OR (reversal_stock_movement_id IS NULL AND reversal_cost_movement_id IS NULL AND reversed_by IS NULL AND reversed_at IS NULL AND reversal_reason IS NULL))
                AND (status <> 'reversed' OR (reversal_stock_movement_id IS NOT NULL AND reversal_cost_movement_id IS NOT NULL AND reversed_by IS NOT NULL AND reversed_at IS NOT NULL AND reversal_reason IS NOT NULL))
                AND (reversal_stock_movement_id IS NULL OR reversal_stock_movement_id <> stock_movement_id)
                AND (reversal_cost_movement_id IS NULL OR reversal_cost_movement_id <> cost_movement_id)
            )");

        DB::unprepared($this->pgPostingInsertFunction());
        DB::unprepared($this->pgPostingUpdateFunction());

        // المزامنة: حالة السند تتبع جدول الترحيل داخل القاعدة نفسها (لا مسار تطبيقي يستطيع إفراقها).
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION fuel_tanker_fill_postings_sync_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                UPDATE fuel_tanker_fills SET inventory_status = 'posted'
                WHERE id = NEW.fuel_tanker_fill_id AND tenant_id = NEW.tenant_id;
                RETURN NULL;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER fuel_tanker_fill_posting_sync_insert AFTER INSERT ON fuel_tanker_fill_inventory_postings FOR EACH ROW EXECUTE FUNCTION fuel_tanker_fill_postings_sync_insert()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION fuel_tanker_fill_postings_sync_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF OLD.status = 'posted' AND NEW.status = 'reversed' THEN
                    UPDATE fuel_tanker_fills SET inventory_status = 'reversed'
                    WHERE id = NEW.fuel_tanker_fill_id AND tenant_id = NEW.tenant_id;
                END IF;
                RETURN NULL;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER fuel_tanker_fill_posting_sync_update AFTER UPDATE ON fuel_tanker_fill_inventory_postings FOR EACH ROW EXECUTE FUNCTION fuel_tanker_fill_postings_sync_update()');

        // ── الدفتر التشغيلي القائم: نوعا الصهريج لا يُدرجان إلا مقابل ترحيل مطابق ──
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION fuel_operational_ledgers_guard_tanker_fill() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NEW.movement_type = 'tanker_fill' THEN
                    IF NEW.source_type IS DISTINCT FROM 'App\Models\FuelTankerFill' OR NEW.source_id IS NULL OR NOT EXISTS (
                        SELECT 1 FROM fuel_tanker_fill_inventory_postings p
                        JOIN fuel_tanker_fills f ON f.id = p.fuel_tanker_fill_id
                        WHERE p.fuel_tanker_fill_id = NEW.source_id AND p.tenant_id = NEW.tenant_id AND p.fuel_station_id = NEW.fuel_station_id
                            AND p.fuel_product_id = NEW.fuel_product_id AND p.warehouse_id = NEW.warehouse_id
                            AND p.stock_movement_id IS NOT DISTINCT FROM NEW.stock_movement_id
                            AND NEW.quantity_milliliters = -p.quantity_milliliters AND f.fuel_tank_id = NEW.fuel_tank_id
                    ) THEN
                        RAISE EXCEPTION 'fuel_operational_ledgers: a tanker_fill entry requires a matching inventory posting';
                    END IF;
                ELSIF NEW.movement_type = 'tanker_fill_reversal' THEN
                    IF NEW.source_type IS DISTINCT FROM 'App\Models\FuelTankerFill' OR NEW.source_id IS NULL OR NOT EXISTS (
                        SELECT 1 FROM fuel_tanker_fill_inventory_postings p
                        JOIN fuel_tanker_fills f ON f.id = p.fuel_tanker_fill_id
                        WHERE p.fuel_tanker_fill_id = NEW.source_id AND p.tenant_id = NEW.tenant_id AND p.fuel_station_id = NEW.fuel_station_id
                            AND p.fuel_product_id = NEW.fuel_product_id AND p.warehouse_id = NEW.warehouse_id AND p.status = 'reversed'
                            AND p.reversal_stock_movement_id IS NOT DISTINCT FROM NEW.stock_movement_id
                            AND NEW.quantity_milliliters = p.quantity_milliliters AND f.fuel_tank_id = NEW.fuel_tank_id
                    ) THEN
                        RAISE EXCEPTION 'fuel_operational_ledgers: a tanker_fill_reversal entry requires a matching reversed inventory posting';
                    END IF;
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER fuel_operational_ledger_guard_tanker_fill BEFORE INSERT ON fuel_operational_ledgers FOR EACH ROW EXECUTE FUNCTION fuel_operational_ledgers_guard_tanker_fill()');
        DB::statement("CREATE UNIQUE INDEX fuel_ledger_tanker_fill_type_unique ON fuel_operational_ledgers (tenant_id, source_id, movement_type) WHERE movement_type IN ('tanker_fill', 'tanker_fill_reversal')");
    }

    private function postgresDown(): void
    {
        DB::statement('DROP INDEX IF EXISTS fuel_ledger_tanker_fill_type_unique');
        DB::unprepared('DROP TRIGGER IF EXISTS fuel_operational_ledger_guard_tanker_fill ON fuel_operational_ledgers');
        DB::statement('DROP FUNCTION IF EXISTS fuel_operational_ledgers_guard_tanker_fill()');

        DB::unprepared('DROP TRIGGER IF EXISTS fuel_tanker_fill_posting_sync_update ON fuel_tanker_fill_inventory_postings');
        DB::unprepared('DROP TRIGGER IF EXISTS fuel_tanker_fill_posting_sync_insert ON fuel_tanker_fill_inventory_postings');
        DB::statement('DROP FUNCTION IF EXISTS fuel_tanker_fill_postings_sync_update()');
        DB::statement('DROP FUNCTION IF EXISTS fuel_tanker_fill_postings_sync_insert()');

        // حراس PR-6A حرفياً (الدوال بأسمائها نفسها فتبقى المُشغّلات مرتبطة).
        DB::statement('ALTER TABLE fuel_tanker_fill_inventory_postings DROP CONSTRAINT fuel_tanker_fill_posting_shape');
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
        $immutable = $this->pgImmutable(self::POSTING_IMMUTABLE);
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

        // حراس PR-4 حرفياً.
        DB::unprepared('DROP TRIGGER IF EXISTS fuel_tanker_fill_guard_insert ON fuel_tanker_fills');
        DB::statement('DROP FUNCTION IF EXISTS fuel_tanker_fills_guard_insert()');
        DB::unprepared($this->pgFillUpdateFunction($this->pgImmutable(self::FILL_IMMUTABLE_V4, 'policy_snapshot'), withTransitions: false));
        DB::statement('ALTER TABLE fuel_tanker_fills DROP CONSTRAINT fuel_tanker_fill_shape');
        DB::statement("ALTER TABLE fuel_tanker_fills
            ADD CONSTRAINT fuel_tanker_fill_shape CHECK (
                quantity_milliliters > 0
                AND status IN ('recorded', 'voided')
                AND inventory_status IN ('pending_integration')
                AND voucher_scope IN ('station', 'tenant', 'owner', 'none')
                AND (tanker_capacity_milliliters IS NULL OR tanker_capacity_milliliters > 0)
                AND (capacity_overrun_milliliters IS NULL OR capacity_overrun_milliliters > 0)
                AND (status = 'recorded' OR (voided_by IS NOT NULL AND voided_at IS NOT NULL AND void_reason IS NOT NULL))
                AND (status = 'voided' OR (voided_by IS NULL AND voided_at IS NULL AND void_reason IS NULL))
            )");
    }

    /** `json` في PostgreSQL بلا معامل مساواة: لقطة السياسات تُقارَن نصّاً. */
    private function pgImmutable(array $columns, ?string $jsonColumn = null): string
    {
        return implode("\n                    OR ", array_map(
            fn (string $c) => $c === $jsonColumn ? "NEW.{$c}::text IS DISTINCT FROM OLD.{$c}::text" : "NEW.{$c} IS DISTINCT FROM OLD.{$c}",
            $columns,
        ));
    }

    private function pgFillUpdateFunction(string $immutable, bool $withTransitions): string
    {
        $transitions = $withTransitions ? <<<'PLPGSQL'
IF NEW.inventory_status IS DISTINCT FROM OLD.inventory_status THEN
                    IF OLD.inventory_status = 'pending_integration' AND NEW.inventory_status = 'posted' THEN
                        IF NOT EXISTS (
                            SELECT 1 FROM fuel_tanker_fill_inventory_postings p
                            WHERE p.fuel_tanker_fill_id = OLD.id AND p.tenant_id = OLD.tenant_id AND p.status = 'posted'
                        ) THEN
                            RAISE EXCEPTION 'fuel_tanker_fills: posted requires a matching posted inventory posting';
                        END IF;
                    ELSIF OLD.inventory_status = 'posted' AND NEW.inventory_status = 'reversed' THEN
                        IF NOT EXISTS (
                            SELECT 1 FROM fuel_tanker_fill_inventory_postings p
                            WHERE p.fuel_tanker_fill_id = OLD.id AND p.tenant_id = OLD.tenant_id AND p.status = 'reversed'
                        ) THEN
                            RAISE EXCEPTION 'fuel_tanker_fills: reversed requires a matching reversed inventory posting';
                        END IF;
                    ELSE
                        RAISE EXCEPTION 'fuel_tanker_fills: illegal inventory_status transition % -> %', OLD.inventory_status, NEW.inventory_status;
                    END IF;
                END IF;
                IF NEW.status = 'voided' AND OLD.status <> 'voided' AND NEW.inventory_status = 'posted' THEN
                    RAISE EXCEPTION 'fuel_tanker_fills: a fill with an active inventory posting cannot be voided (reverse it first)';
                END IF;

PLPGSQL : '';

        return <<<SQL
            CREATE OR REPLACE FUNCTION fuel_tanker_fills_guard_update() RETURNS trigger LANGUAGE plpgsql AS \$fn\$
            BEGIN
                IF {$immutable} THEN
                    RAISE EXCEPTION 'fuel_tanker_fills: recorded fill fields are immutable';
                END IF;
                {$transitions}
                IF OLD.status = 'voided' AND (
                    NEW.status IS DISTINCT FROM OLD.status OR NEW.voided_by IS DISTINCT FROM OLD.voided_by
                    OR NEW.voided_at IS DISTINCT FROM OLD.voided_at OR NEW.void_reason IS DISTINCT FROM OLD.void_reason
                ) THEN
                    RAISE EXCEPTION 'fuel_tanker_fills: a voided fill cannot change';
                END IF;
                RETURN NEW;
            END
            \$fn\$
            SQL;
    }

    private function pgPostingInsertFunction(): string
    {
        return <<<'SQL'
            CREATE OR REPLACE FUNCTION fuel_tanker_fill_postings_guard_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NEW.status <> 'posted' THEN
                    RAISE EXCEPTION 'fuel_tanker_fill_inventory_postings: a posting is created as posted only';
                END IF;
                -- يتسلسل مع lockForUpdate في FuelTankerFillService::void: أيّهما سبق حسم الآخر، والفحص التالي يقرأ آخر حالة ملتزَمة.
                PERFORM 1 FROM fuel_tanker_fills WHERE id = NEW.fuel_tanker_fill_id AND tenant_id = NEW.tenant_id FOR NO KEY UPDATE;
                IF NOT EXISTS (
                    SELECT 1 FROM fuel_tanker_fills f
                    WHERE f.id = NEW.fuel_tanker_fill_id AND f.tenant_id = NEW.tenant_id AND f.branch_id = NEW.branch_id
                        AND f.fuel_station_id = NEW.fuel_station_id AND f.fuel_product_id = NEW.fuel_product_id
                        AND f.quantity_milliliters = NEW.quantity_milliliters AND f.status = 'recorded' AND f.inventory_status = 'pending_integration'
                ) THEN
                    RAISE EXCEPTION 'fuel_tanker_fill_inventory_postings: posting must match a recorded pending_integration fill of the same tenant, branch, station, product and quantity';
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM fuel_stations s WHERE s.id = NEW.fuel_station_id AND s.tenant_id = NEW.tenant_id AND s.warehouse_id = NEW.warehouse_id
                ) THEN
                    RAISE EXCEPTION 'fuel_tanker_fill_inventory_postings: posting warehouse must be the station warehouse';
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM stock_movements sm JOIN fuel_products fp ON fp.product_id = sm.product_id AND fp.tenant_id = sm.tenant_id
                    WHERE sm.id = NEW.stock_movement_id AND sm.tenant_id = NEW.tenant_id AND sm.warehouse_id = NEW.warehouse_id
                        AND sm.type = 'out' AND sm.quantity = NEW.quantity_milliliters AND fp.id = NEW.fuel_product_id
                ) THEN
                    RAISE EXCEPTION 'fuel_tanker_fill_inventory_postings: stock movement must be an out movement of the same warehouse, product and quantity';
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM fuel_inventory_cost_movements cm
                    WHERE cm.id = NEW.cost_movement_id AND cm.tenant_id = NEW.tenant_id AND cm.warehouse_id = NEW.warehouse_id
                        AND cm.fuel_product_id = NEW.fuel_product_id AND cm.stock_movement_id = NEW.stock_movement_id
                        AND cm.movement_type = 'issue' AND cm.quantity_milliliters = NEW.quantity_milliliters AND cm.posted_cost_minor = NEW.posted_cost_minor
                ) THEN
                    RAISE EXCEPTION 'fuel_tanker_fill_inventory_postings: cost movement must be the issue movement of the same stock movement, quantity and cost';
                END IF;
                IF EXISTS (
                    SELECT 1 FROM fuel_tanker_fill_inventory_postings o
                    WHERE o.reversal_stock_movement_id IN (NEW.stock_movement_id) OR o.reversal_cost_movement_id IN (NEW.cost_movement_id)
                ) THEN
                    RAISE EXCEPTION 'fuel_tanker_fill_inventory_postings: a reversal movement cannot be reused as a posting movement';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL;
    }

    private function pgPostingUpdateFunction(): string
    {
        $immutable = $this->pgImmutable(self::POSTING_IMMUTABLE);

        return <<<SQL
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
                IF OLD.status = 'posted' AND NEW.status = 'reversed' THEN
                    PERFORM 1 FROM fuel_tanker_fills WHERE id = OLD.fuel_tanker_fill_id AND tenant_id = OLD.tenant_id FOR NO KEY UPDATE;
                    IF NOT EXISTS (
                        SELECT 1 FROM stock_movements sm JOIN fuel_products fp ON fp.product_id = sm.product_id AND fp.tenant_id = sm.tenant_id
                        WHERE sm.id = NEW.reversal_stock_movement_id AND sm.tenant_id = NEW.tenant_id AND sm.warehouse_id = NEW.warehouse_id
                            AND sm.type IN ('in', 'adjustment') AND sm.quantity = NEW.quantity_milliliters AND fp.id = NEW.fuel_product_id
                    ) THEN
                        RAISE EXCEPTION 'fuel_tanker_fill_inventory_postings: reversal stock movement must restore the same warehouse, product and quantity';
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM fuel_inventory_cost_movements cm
                        WHERE cm.id = NEW.reversal_cost_movement_id AND cm.tenant_id = NEW.tenant_id AND cm.warehouse_id = NEW.warehouse_id
                            AND cm.fuel_product_id = NEW.fuel_product_id AND cm.stock_movement_id = NEW.reversal_stock_movement_id
                            AND cm.quantity_milliliters = NEW.quantity_milliliters AND cm.posted_cost_minor = NEW.posted_cost_minor
                    ) THEN
                        RAISE EXCEPTION 'fuel_tanker_fill_inventory_postings: reversal cost movement must carry the original quantity and historical cost';
                    END IF;
                    IF EXISTS (
                        SELECT 1 FROM fuel_tanker_fill_inventory_postings o
                        WHERE o.id <> OLD.id AND (o.stock_movement_id = NEW.reversal_stock_movement_id OR o.cost_movement_id = NEW.reversal_cost_movement_id)
                    ) THEN
                        RAISE EXCEPTION 'fuel_tanker_fill_inventory_postings: a posting movement cannot be reused as a reversal movement';
                    END IF;
                END IF;
                RETURN NEW;
            END
            \$fn\$
            SQL;
    }

    // ═════════════════════════════ SQLite ═════════════════════════════

    private function sqliteUp(): void
    {
        // ── السند ── (مُشغّل الإدراج القائم يبقى: يقبل `pending_integration` وحده فلا حاجة لتعديله)
        DB::unprepared('DROP TRIGGER IF EXISTS fuel_tanker_fill_no_direct_update');
        DB::unprepared($this->sqliteFillUpdateTrigger(self::FILL_IMMUTABLE, withTransitions: true));

        // ── الترحيل ──
        DB::unprepared('DROP TRIGGER IF EXISTS fuel_tanker_fill_posting_shape');
        $cap = self::MAX_STOCK_QUANTITY;
        DB::unprepared(<<<SQL
            CREATE TRIGGER fuel_tanker_fill_posting_shape BEFORE INSERT ON fuel_tanker_fill_inventory_postings
            WHEN NEW.quantity_milliliters <= 0 OR NEW.quantity_milliliters > {$cap} OR NEW.posted_cost_minor < 0 OR NEW.status <> 'posted'
                OR NEW.reversal_stock_movement_id IS NOT NULL OR NEW.reversal_cost_movement_id IS NOT NULL
                OR NEW.reversed_by IS NOT NULL OR NEW.reversed_at IS NOT NULL OR NEW.reversal_reason IS NOT NULL
                OR NOT EXISTS (
                    SELECT 1 FROM fuel_tanker_fills f
                    WHERE f.id = NEW.fuel_tanker_fill_id AND f.tenant_id = NEW.tenant_id AND f.branch_id = NEW.branch_id
                        AND f.fuel_station_id = NEW.fuel_station_id AND f.fuel_product_id = NEW.fuel_product_id
                        AND f.quantity_milliliters = NEW.quantity_milliliters AND f.status = 'recorded' AND f.inventory_status = 'pending_integration'
                )
                OR NOT EXISTS (
                    SELECT 1 FROM fuel_stations s WHERE s.id = NEW.fuel_station_id AND s.tenant_id = NEW.tenant_id AND s.warehouse_id = NEW.warehouse_id
                )
                OR NOT EXISTS (
                    SELECT 1 FROM stock_movements sm JOIN fuel_products fp ON fp.product_id = sm.product_id AND fp.tenant_id = sm.tenant_id
                    WHERE sm.id = NEW.stock_movement_id AND sm.tenant_id = NEW.tenant_id AND sm.warehouse_id = NEW.warehouse_id
                        AND sm.type = 'out' AND sm.quantity = NEW.quantity_milliliters AND fp.id = NEW.fuel_product_id
                )
                OR NOT EXISTS (
                    SELECT 1 FROM fuel_inventory_cost_movements cm
                    WHERE cm.id = NEW.cost_movement_id AND cm.tenant_id = NEW.tenant_id AND cm.warehouse_id = NEW.warehouse_id
                        AND cm.fuel_product_id = NEW.fuel_product_id AND cm.stock_movement_id = NEW.stock_movement_id
                        AND cm.movement_type = 'issue' AND cm.quantity_milliliters = NEW.quantity_milliliters AND cm.posted_cost_minor = NEW.posted_cost_minor
                )
                OR EXISTS (
                    SELECT 1 FROM fuel_tanker_fill_inventory_postings o
                    WHERE o.reversal_stock_movement_id = NEW.stock_movement_id OR o.reversal_cost_movement_id = NEW.cost_movement_id
                )
            BEGIN
                SELECT RAISE(ABORT, 'fuel_tanker_fill_inventory_postings: invalid posting shape or no matching recorded fill / bound movements');
            END
            SQL);

        DB::unprepared('DROP TRIGGER IF EXISTS fuel_tanker_fill_posting_no_direct_update');
        $immutable = implode(' OR ', array_map(fn (string $c) => "OLD.{$c} IS NOT NEW.{$c}", self::POSTING_IMMUTABLE));
        DB::unprepared(<<<SQL
            CREATE TRIGGER fuel_tanker_fill_posting_no_direct_update BEFORE UPDATE ON fuel_tanker_fill_inventory_postings
            WHEN {$immutable}
                OR NEW.status NOT IN ('posted', 'reversed')
                OR (OLD.status = 'reversed' AND (
                    NEW.status IS NOT OLD.status OR NEW.reversal_stock_movement_id IS NOT OLD.reversal_stock_movement_id
                    OR NEW.reversal_cost_movement_id IS NOT OLD.reversal_cost_movement_id OR NEW.reversed_by IS NOT OLD.reversed_by
                    OR NEW.reversed_at IS NOT OLD.reversed_at OR NEW.reversal_reason IS NOT OLD.reversal_reason))
                OR (NEW.status = 'reversed' AND (NEW.reversal_stock_movement_id IS NULL OR NEW.reversal_cost_movement_id IS NULL
                    OR NEW.reversed_by IS NULL OR NEW.reversed_at IS NULL OR NEW.reversal_reason IS NULL
                    OR NEW.reversal_stock_movement_id = NEW.stock_movement_id OR NEW.reversal_cost_movement_id = NEW.cost_movement_id))
                OR (NEW.status = 'posted' AND (NEW.reversal_stock_movement_id IS NOT NULL OR NEW.reversal_cost_movement_id IS NOT NULL
                    OR NEW.reversed_by IS NOT NULL OR NEW.reversed_at IS NOT NULL OR NEW.reversal_reason IS NOT NULL))
                OR (OLD.status = 'posted' AND NEW.status = 'reversed' AND (
                    NOT EXISTS (
                        SELECT 1 FROM stock_movements sm JOIN fuel_products fp ON fp.product_id = sm.product_id AND fp.tenant_id = sm.tenant_id
                        WHERE sm.id = NEW.reversal_stock_movement_id AND sm.tenant_id = NEW.tenant_id AND sm.warehouse_id = NEW.warehouse_id
                            AND sm.type IN ('in', 'adjustment') AND sm.quantity = NEW.quantity_milliliters AND fp.id = NEW.fuel_product_id
                    )
                    OR NOT EXISTS (
                        SELECT 1 FROM fuel_inventory_cost_movements cm
                        WHERE cm.id = NEW.reversal_cost_movement_id AND cm.tenant_id = NEW.tenant_id AND cm.warehouse_id = NEW.warehouse_id
                            AND cm.fuel_product_id = NEW.fuel_product_id AND cm.stock_movement_id = NEW.reversal_stock_movement_id
                            AND cm.quantity_milliliters = NEW.quantity_milliliters AND cm.posted_cost_minor = NEW.posted_cost_minor
                    )
                    OR EXISTS (
                        SELECT 1 FROM fuel_tanker_fill_inventory_postings o
                        WHERE o.id <> OLD.id AND (o.stock_movement_id = NEW.reversal_stock_movement_id OR o.cost_movement_id = NEW.reversal_cost_movement_id)
                    )))
            BEGIN
                SELECT RAISE(ABORT, 'fuel_tanker_fill_inventory_postings: posting identity, quantity and historical cost are immutable');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER fuel_tanker_fill_posting_sync_insert AFTER INSERT ON fuel_tanker_fill_inventory_postings
            BEGIN
                UPDATE fuel_tanker_fills SET inventory_status = 'posted'
                WHERE id = NEW.fuel_tanker_fill_id AND tenant_id = NEW.tenant_id;
            END
            SQL);
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER fuel_tanker_fill_posting_sync_update AFTER UPDATE ON fuel_tanker_fill_inventory_postings
            WHEN OLD.status = 'posted' AND NEW.status = 'reversed'
            BEGIN
                UPDATE fuel_tanker_fills SET inventory_status = 'reversed'
                WHERE id = NEW.fuel_tanker_fill_id AND tenant_id = NEW.tenant_id;
            END
            SQL);

        // ── الدفتر التشغيلي ──
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER fuel_operational_ledger_guard_tanker_fill BEFORE INSERT ON fuel_operational_ledgers
            WHEN (NEW.movement_type = 'tanker_fill' AND (
                    NEW.source_type IS NOT 'App\Models\FuelTankerFill' OR NEW.source_id IS NULL OR NOT EXISTS (
                        SELECT 1 FROM fuel_tanker_fill_inventory_postings p
                        JOIN fuel_tanker_fills f ON f.id = p.fuel_tanker_fill_id
                        WHERE p.fuel_tanker_fill_id = NEW.source_id AND p.tenant_id = NEW.tenant_id AND p.fuel_station_id = NEW.fuel_station_id
                            AND p.fuel_product_id = NEW.fuel_product_id AND p.warehouse_id = NEW.warehouse_id
                            AND p.stock_movement_id IS NEW.stock_movement_id
                            AND NEW.quantity_milliliters = -p.quantity_milliliters AND f.fuel_tank_id = NEW.fuel_tank_id)))
                OR (NEW.movement_type = 'tanker_fill_reversal' AND (
                    NEW.source_type IS NOT 'App\Models\FuelTankerFill' OR NEW.source_id IS NULL OR NOT EXISTS (
                        SELECT 1 FROM fuel_tanker_fill_inventory_postings p
                        JOIN fuel_tanker_fills f ON f.id = p.fuel_tanker_fill_id
                        WHERE p.fuel_tanker_fill_id = NEW.source_id AND p.tenant_id = NEW.tenant_id AND p.fuel_station_id = NEW.fuel_station_id
                            AND p.fuel_product_id = NEW.fuel_product_id AND p.warehouse_id = NEW.warehouse_id AND p.status = 'reversed'
                            AND p.reversal_stock_movement_id IS NEW.stock_movement_id
                            AND NEW.quantity_milliliters = p.quantity_milliliters AND f.fuel_tank_id = NEW.fuel_tank_id)))
            BEGIN
                SELECT RAISE(ABORT, 'fuel_operational_ledgers: tanker fill entries require a matching inventory posting');
            END
            SQL);
        DB::statement("CREATE UNIQUE INDEX fuel_ledger_tanker_fill_type_unique ON fuel_operational_ledgers (tenant_id, source_id, movement_type) WHERE movement_type IN ('tanker_fill', 'tanker_fill_reversal')");
    }

    private function sqliteDown(): void
    {
        DB::statement('DROP INDEX IF EXISTS fuel_ledger_tanker_fill_type_unique');
        DB::unprepared('DROP TRIGGER IF EXISTS fuel_operational_ledger_guard_tanker_fill');
        DB::unprepared('DROP TRIGGER IF EXISTS fuel_tanker_fill_posting_sync_update');
        DB::unprepared('DROP TRIGGER IF EXISTS fuel_tanker_fill_posting_sync_insert');

        // حراس PR-6A حرفياً.
        DB::unprepared('DROP TRIGGER IF EXISTS fuel_tanker_fill_posting_shape');
        DB::unprepared('DROP TRIGGER IF EXISTS fuel_tanker_fill_posting_no_direct_update');
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
        $immutable = implode(' OR ', array_map(fn (string $c) => "OLD.{$c} IS NOT NEW.{$c}", self::POSTING_IMMUTABLE));
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

        // حراس PR-4 حرفياً.
        DB::unprepared('DROP TRIGGER IF EXISTS fuel_tanker_fill_no_direct_update');
        DB::unprepared($this->sqliteFillUpdateTrigger(self::FILL_IMMUTABLE_V4, withTransitions: false));
    }

    private function sqliteFillUpdateTrigger(array $immutableColumns, bool $withTransitions): string
    {
        $immutable = implode(' OR ', array_map(fn (string $c) => "OLD.{$c} IS NOT NEW.{$c}", $immutableColumns));

        $transitions = $withTransitions ? <<<'SQLITE'

                OR NEW.inventory_status NOT IN ('pending_integration', 'posted', 'reversed')
                OR (NEW.inventory_status IS NOT OLD.inventory_status AND NOT (
                    (OLD.inventory_status = 'pending_integration' AND NEW.inventory_status = 'posted' AND EXISTS (
                        SELECT 1 FROM fuel_tanker_fill_inventory_postings p
                        WHERE p.fuel_tanker_fill_id = OLD.id AND p.tenant_id = OLD.tenant_id AND p.status = 'posted'))
                    OR (OLD.inventory_status = 'posted' AND NEW.inventory_status = 'reversed' AND EXISTS (
                        SELECT 1 FROM fuel_tanker_fill_inventory_postings p
                        WHERE p.fuel_tanker_fill_id = OLD.id AND p.tenant_id = OLD.tenant_id AND p.status = 'reversed'))))
                OR (NEW.status = 'voided' AND OLD.status IS NOT 'voided' AND NEW.inventory_status = 'posted')
SQLITE : '';

        return <<<SQL
            CREATE TRIGGER fuel_tanker_fill_no_direct_update BEFORE UPDATE ON fuel_tanker_fills
            WHEN {$immutable}
                OR (OLD.status = 'voided' AND (
                    NEW.status IS NOT OLD.status OR NEW.voided_by IS NOT OLD.voided_by
                    OR NEW.voided_at IS NOT OLD.voided_at OR NEW.void_reason IS NOT OLD.void_reason))
                OR (NEW.status = 'voided' AND (NEW.voided_by IS NULL OR NEW.voided_at IS NULL OR NEW.void_reason IS NULL))
                OR (NEW.status = 'recorded' AND (NEW.voided_by IS NOT NULL OR NEW.voided_at IS NOT NULL OR NEW.void_reason IS NOT NULL))
                OR NEW.status NOT IN ('recorded', 'voided'){$transitions}
            BEGIN
                SELECT RAISE(ABORT, 'fuel_tanker_fills: recorded fill fields are immutable');
            END
            SQL;
    }
};
