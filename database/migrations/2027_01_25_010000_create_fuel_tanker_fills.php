<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * TANKER-PR4 — سجل تعبئة صهريج (سند تعبئة): جدول إضافي واحد، لا تعديل لأي جدول قائم ولا Backfill.
 *
 * **سجل تشغيلي فقط — لا أثر مخزني ولا محاسبي:** لا حركة مخزون ولا قيد ولا فاتورة ولا تحصيل ولا عمولة، ولا مخزون داخلي للصهريج. عمود `inventory_status`
 * يعلن ذلك صراحةً (`pending_integration`): السند المسجَّل **ليس** حركة مخزنية مكتملة؛ التكامل المخزني شريحة لاحقة (PR-6) بعد اعتماد قواعده.
 *
 *  - الرقم الإلكتروني المتسلسل `number` (`FTF-YYYY-00001`) يولّده `GeneratesDocumentNumbers`؛ **مستقل** عن رقم السند الورقي `voucher_number` الذي يدخله الموظف.
 *  - **منع تكرار السند الورقي** على مستوى فريد في القاعدة: `(tenant_id, voucher_scope_key, voucher_key)`. `voucher_scope_key` يُشتق وقت التسجيل من سياسة
 *    `tanker_voucher_unique_scope` (محطة | مؤسسة | صاحب صهريج | بلا منع ⇒ مفتاح فريد لكل سجل). الأصفار البادئة تبقى في `voucher_key` (`04052 ≠ 4052`).
 *    **السند الملغى يبقى محجوزاً**: الصف لا يُحذف أبداً (مُشغّل قاعدة بيانات) فيبقى مفتاحه مشغولاً.
 *  - الكمية `quantity_milliliters` عدد صحيح موجب (mL)؛ لقطة السعة والتجاوز والتأكيد الصريح (المنفّذ والوقت) محفوظة مع السجل، ولقطة السياسات المطبَّقة.
 *  - `idempotency_key` فريد للمؤسسة + `request_fingerprint` لاكتشاف اختلاف المحتوى عند إعادة استخدام المفتاح.
 *  - غير قابل للتعديل: يُسمح فقط بالانتقال `recorded → voided` (مع سبب ومنفّذ ووقت). التحديث/الحذف المباشر يُرفضان في القاعدة (PostgreSQL وSQLite).
 *
 * المفاتيح الأجنبية للمراجع بـNO ACTION (لا RESTRICT): تمنع حذف معدّة/وردية/مستخدم عليها سندات، وتسمح بحذف المستأجر كاملاً (يُفحص نهاية العبارة بعد حذف السندات تتابعياً).
 *
 * الميزة خلف بوابة نشر منفصلة مغلقة افتراضياً (`fuel_stations.tanker_fills_enabled`). التراجع يرفض متى وُجد أي صف.
 */
return new class extends Migration
{
    private const TABLE = 'fuel_tanker_fills';

    /** أعمدة لا تتغيّر أبداً بعد الإنشاء (كل ما عدا حقول الإلغاء والطابع الزمني). */
    private const IMMUTABLE = [
        'id', 'tenant_id', 'branch_id', 'fuel_station_id', 'fuel_shift_id', 'fuel_pump_id', 'fuel_nozzle_id', 'fuel_tank_id', 'fuel_product_id',
        'fuel_tanker_owner_id', 'fuel_tanker_id', 'number', 'voucher_number', 'voucher_key', 'voucher_scope', 'voucher_scope_key',
        'quantity_milliliters', 'tanker_capacity_milliliters', 'capacity_overrun_milliliters', 'capacity_overrun_policy',
        'capacity_overrun_confirmed_by', 'capacity_overrun_confirmed_at', 'policy_snapshot', 'notes', 'inventory_status',
        'idempotency_key', 'request_fingerprint', 'recorded_by', 'recorded_at', 'created_at',
    ];

    public function up(): void
    {
        Schema::create(self::TABLE, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations');
            $table->foreignUuid('fuel_shift_id')->constrained('fuel_shifts');
            $table->foreignUuid('fuel_pump_id')->constrained('fuel_pumps');
            $table->foreignUuid('fuel_nozzle_id')->constrained('fuel_nozzles');
            $table->foreignUuid('fuel_tank_id')->constrained('fuel_tanks');
            $table->foreignUuid('fuel_product_id')->constrained('fuel_products');
            $table->foreignUuid('fuel_tanker_owner_id')->constrained('fuel_tanker_owners');
            $table->foreignUuid('fuel_tanker_id')->nullable()->constrained('fuel_tankers');

            $table->string('number'); // 255 كباقي المستندات: بادئة 20 + سنة + تسلسل + لاحقة 20 تبلغ 52 حرفاً (إعدادات الترقيم المسموحة).
            $table->string('voucher_number', 64);
            $table->string('voucher_key', 128); // مفتاح التطبيع (أحرف صغيرة بلا مسافات): قد يتضاعف طول `İ` عند التصغير (64 → 128).
            $table->string('voucher_scope', 16);
            $table->string('voucher_scope_key', 64);

            $table->bigInteger('quantity_milliliters');
            $table->bigInteger('tanker_capacity_milliliters')->nullable();
            $table->bigInteger('capacity_overrun_milliliters')->nullable();
            $table->string('capacity_overrun_policy', 32)->nullable();
            $table->foreignUuid('capacity_overrun_confirmed_by')->nullable()->constrained('users');
            $table->timestamp('capacity_overrun_confirmed_at')->nullable();
            $table->json('policy_snapshot');
            $table->text('notes')->nullable();

            $table->string('status', 16)->default('recorded');
            $table->string('inventory_status', 24)->default('pending_integration');
            $table->string('idempotency_key', 128);
            $table->char('request_fingerprint', 64);
            $table->foreignUuid('recorded_by')->constrained('users');
            $table->timestamp('recorded_at');
            $table->foreignUuid('voided_by')->nullable()->constrained('users');
            $table->timestamp('voided_at')->nullable();
            $table->text('void_reason')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'branch_id', 'number'], 'fuel_tanker_fill_number_unique');
            $table->unique(['tenant_id', 'idempotency_key'], 'fuel_tanker_fill_idempotency_unique');
            $table->unique(['tenant_id', 'voucher_scope_key', 'voucher_key'], 'fuel_tanker_fill_voucher_unique');
            // فحص تكرار السند (`tenant_id` + `voucher_key` عبر النطاقات): الفهرس الفريد أعلاه يبدأ بـ`voucher_scope_key` فلا يخدم هذا الاستعلام.
            $table->index(['tenant_id', 'voucher_key'], 'fuel_tanker_fill_voucher_lookup_idx');
            $table->index(['tenant_id', 'fuel_station_id', 'recorded_at'], 'fuel_tanker_fill_station_idx');
            $table->index(['tenant_id', 'fuel_shift_id'], 'fuel_tanker_fill_shift_idx');
            $table->index(['tenant_id', 'fuel_tanker_owner_id', 'recorded_at'], 'fuel_tanker_fill_owner_idx');
            $table->index(['tenant_id', 'fuel_nozzle_id'], 'fuel_tanker_fill_nozzle_idx');
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
            throw new RuntimeException('Rollback refused: fuel_tanker_fills contains tanker fill records.');
        }

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP FUNCTION IF EXISTS fuel_tanker_fills_guard_update() CASCADE');
            DB::statement('DROP FUNCTION IF EXISTS fuel_tanker_fills_guard_delete() CASCADE');
        }
        Schema::dropIfExists(self::TABLE);
    }

    private function postgresGuards(): void
    {
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

        $immutable = implode("\n                    OR ", array_map(
            // `json` في PostgreSQL بلا معامل مساواة: تُقارَن لقطة السياسات نصّاً.
            fn (string $c) => $c === 'policy_snapshot' ? 'NEW.policy_snapshot::text IS DISTINCT FROM OLD.policy_snapshot::text' : "NEW.{$c} IS DISTINCT FROM OLD.{$c}",
            self::IMMUTABLE,
        ));
        DB::unprepared(<<<SQL
            CREATE OR REPLACE FUNCTION fuel_tanker_fills_guard_update() RETURNS trigger LANGUAGE plpgsql AS \$fn\$
            BEGIN
                IF {$immutable} THEN
                    RAISE EXCEPTION 'fuel_tanker_fills: recorded fill fields are immutable';
                END IF;
                IF OLD.status = 'voided' AND (
                    NEW.status IS DISTINCT FROM OLD.status OR NEW.voided_by IS DISTINCT FROM OLD.voided_by
                    OR NEW.voided_at IS DISTINCT FROM OLD.voided_at OR NEW.void_reason IS DISTINCT FROM OLD.void_reason
                ) THEN
                    RAISE EXCEPTION 'fuel_tanker_fills: a voided fill cannot change';
                END IF;
                RETURN NEW;
            END
            \$fn\$
            SQL);
        DB::unprepared('CREATE TRIGGER fuel_tanker_fill_no_direct_update BEFORE UPDATE ON fuel_tanker_fills FOR EACH ROW EXECUTE FUNCTION fuel_tanker_fills_guard_update()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION fuel_tanker_fills_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
                    RAISE EXCEPTION 'fuel_tanker_fills: tanker fills cannot be deleted (voucher numbers stay reserved)';
                END IF;
                RETURN OLD;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER fuel_tanker_fill_no_delete BEFORE DELETE ON fuel_tanker_fills FOR EACH ROW EXECUTE FUNCTION fuel_tanker_fills_guard_delete()');
    }

    private function sqliteGuards(): void
    {
        $immutable = implode(' OR ', array_map(fn (string $c) => "OLD.{$c} IS NOT NEW.{$c}", self::IMMUTABLE));

        DB::unprepared(<<<SQL
            CREATE TRIGGER fuel_tanker_fill_shape BEFORE INSERT ON fuel_tanker_fills
            WHEN NEW.quantity_milliliters <= 0
                OR NEW.status NOT IN ('recorded', 'voided')
                OR NEW.inventory_status NOT IN ('pending_integration')
                OR NEW.voucher_scope NOT IN ('station', 'tenant', 'owner', 'none')
                OR (NEW.tanker_capacity_milliliters IS NOT NULL AND NEW.tanker_capacity_milliliters <= 0)
                OR (NEW.capacity_overrun_milliliters IS NOT NULL AND NEW.capacity_overrun_milliliters <= 0)
            BEGIN
                SELECT RAISE(ABORT, 'fuel_tanker_fills: invalid fill shape');
            END
            SQL);

        DB::unprepared(<<<SQL
            CREATE TRIGGER fuel_tanker_fill_no_direct_update BEFORE UPDATE ON fuel_tanker_fills
            WHEN {$immutable}
                OR (OLD.status = 'voided' AND (
                    NEW.status IS NOT OLD.status OR NEW.voided_by IS NOT OLD.voided_by
                    OR NEW.voided_at IS NOT OLD.voided_at OR NEW.void_reason IS NOT OLD.void_reason))
                OR (NEW.status = 'voided' AND (NEW.voided_by IS NULL OR NEW.voided_at IS NULL OR NEW.void_reason IS NULL))
                OR (NEW.status = 'recorded' AND (NEW.voided_by IS NOT NULL OR NEW.voided_at IS NOT NULL OR NEW.void_reason IS NOT NULL))
                OR NEW.status NOT IN ('recorded', 'voided')
            BEGIN
                SELECT RAISE(ABORT, 'fuel_tanker_fills: recorded fill fields are immutable');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER fuel_tanker_fill_no_delete BEFORE DELETE ON fuel_tanker_fills
            WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
            BEGIN
                SELECT RAISE(ABORT, 'fuel_tanker_fills: tanker fills cannot be deleted (voucher numbers stay reserved)');
            END
            SQL);
    }
};
