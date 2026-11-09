<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * P1-3b-2a — أعمدة تواريخ التسوية الأربعة (الجزء المخزَّن منها) + وسم مصدر بيع الوقود. **أعمدة وحراس فقط: لا كتابة لأي صف، لا Backfill، لا أثر محاسبي.**
 * الكاتب (محرك الترحيل) يأتي في شريحة لاحقة خلف البوابة المغلقة؛ هذه الشريحة تُثبّت المخطط والحراس والقارئ فقط.
 *
 * ═══ التواريخ الأربعة (التصميم المعتمد: AWJ_FUEL_SETTLEMENT_P1_3B_2_ENGINE_DESIGN.md §3) ═══
 *  1) التوريد الأصلي      ⇒ `supply_started_at` / `supply_ended_at` / `supply_business_date` على رأس التسوية (تُنسخ من الوردية لقطةً عند الإدراج).
 *  2) تاريخ الفاتورة      ⇒ `accounting_date` على الرأس + `invoices.invoice_date` القائم. **`accounting_date = supply_business_date` بقيد قاعدة** (D-P: فترة مفتوحة أو لا ترحيل،
 *                          لا تاريخ بديل؛ يُرفع القيد بهجرة لاحقة مع `post_current_date` بعد رأي ضريبي وقرار مالك فقط).
 *  3) لحظة الإصدار        ⇒ `invoices.issued_at` القائم (لا نسخة هنا: الرأس يُدرج قبل الفواتير ولا يقبل تحديثاً، وفاتورة لكل فوهة تعني N قيمة).
 *  4) تاريخ/لحظة القيد    ⇒ `journal_entries.entry_date` و`created_at` القائمان (لا نسخة).
 *  الرأس ثابت كلياً بمُشغّل P1-3a فالأعمدة الجديدة ثابتة بعد الإدراج دون مُشغّل إضافي على PostgreSQL (مقارنة JSON لكل الأعمدة)؛ وعلى SQLite يُعاد بناء مُشغّل التجميد
 *  ليشملها (قائمته مُلتقَطة وقت الإنشاء) — يحرسه الاختبار.
 *
 * ═══ الحراس ═══
 *  - الأعمدة الأربعة nullable جسدياً (SQLite لا يضيف عموداً NOT NULL بلا افتراضي)، **لكن إدراج رأس بلا أي منها مرفوض بمُشغّل** (كل شيء أو لا شيء، والبداية ≤ النهاية).
 *  - `accounting_date = supply_business_date` (CHECK على PostgreSQL، ومُشغّل إدراج على SQLite).
 *
 * ═══ `fuel_sales.source` ═══
 *  `station` (الافتراضي: كل بيع قائم) | `settlement` (بيع أنشأته التسوية). **ثابت بعد الإدراج** بمُشغّل؛ القيم مقيَّدة. غرضه: لا يُحسب بيع تسوية «بيعاً ERP» في معاينة التسوية
 *  (يُفرض في شريحة المحرك). لا عمود عكسي `settlement_line_id`: المؤشر موجود أصلاً في `fuel_shift_settlement_lines.fuel_sale_id` (فريد، FK)، والعكسي دائري ويستلزم إعادة بناء
 *  جدول على SQLite (تُسقط المُشغّلات). (انحراف معلن عن صف الخطة؛ لا فقد وظيفة.)
 *
 * التراجع يرفض متى وُجد أي رأس تسوية أو بيع `source = 'settlement'`.
 */
return new class extends Migration
{
    private const HEADER = 'fuel_shift_settlements';

    public function up(): void
    {
        Schema::table(self::HEADER, function (Blueprint $table) {
            $table->timestamp('supply_started_at')->nullable();
            $table->timestamp('supply_ended_at')->nullable();
            $table->date('supply_business_date')->nullable();
            $table->date('accounting_date')->nullable();
        });
        Schema::table('fuel_sales', function (Blueprint $table) {
            $table->string('source', 16)->default('station');
        });

        if (DB::getDriverName() === 'pgsql') {
            $this->createPostgres();
        } else {
            $this->createSqlite();
        }
    }

    public function down(): void
    {
        if (Schema::hasTable(self::HEADER) && DB::table(self::HEADER)->exists()) {
            throw new RuntimeException('لا يمكن التراجع: جدول رؤوس تسوية الورديات يحتوي صفوفاً (تواريخها الأربعة لا تُسقط بالتراجع).');
        }
        if (Schema::hasTable('fuel_sales') && Schema::hasColumn('fuel_sales', 'source') && DB::table('fuel_sales')->where('source', 'settlement')->exists()) {
            throw new RuntimeException('لا يمكن التراجع: توجد مبيعات وقود أنشأتها التسوية (source = settlement).');
        }

        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS fuel_shift_settlements_require_dates ON fuel_shift_settlements');
            DB::unprepared('DROP FUNCTION IF EXISTS fuel_settlement_require_dates() CASCADE');
            DB::unprepared('ALTER TABLE fuel_shift_settlements DROP CONSTRAINT IF EXISTS fuel_shift_settlements_dates_check');
            DB::unprepared('DROP TRIGGER IF EXISTS fuel_sales_source_guard ON fuel_sales');
            DB::unprepared('DROP FUNCTION IF EXISTS fuel_sales_source_guard() CASCADE');
            DB::unprepared('ALTER TABLE fuel_sales DROP CONSTRAINT IF EXISTS fuel_sales_source_check');
        } else {
            foreach (['fuel_shift_settlements_dates_insert', 'fuel_sales_source_insert', 'fuel_sales_source_update', 'fuel_shift_settlements_guard_update_frozen'] as $trigger) {
                DB::unprepared("DROP TRIGGER IF EXISTS {$trigger}");
            }
        }

        Schema::table(self::HEADER, function (Blueprint $table) {
            $table->dropColumn(['supply_started_at', 'supply_ended_at', 'supply_business_date', 'accounting_date']);
        });
        Schema::table('fuel_sales', function (Blueprint $table) {
            $table->dropColumn('source');
        });

        if (DB::getDriverName() !== 'pgsql') {
            $this->recreateSqliteFrozenTrigger();
        }
    }

    private function createPostgres(): void
    {
        DB::statement("ALTER TABLE fuel_shift_settlements ADD CONSTRAINT fuel_shift_settlements_dates_check CHECK (
            ((supply_started_at IS NULL) = (supply_ended_at IS NULL))
            AND ((supply_ended_at IS NULL) = (supply_business_date IS NULL))
            AND ((supply_business_date IS NULL) = (accounting_date IS NULL))
            AND (supply_started_at IS NULL OR supply_started_at <= supply_ended_at)
            AND accounting_date IS NOT DISTINCT FROM supply_business_date
        )");
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION fuel_settlement_require_dates() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NEW.supply_started_at IS NULL OR NEW.supply_ended_at IS NULL OR NEW.supply_business_date IS NULL OR NEW.accounting_date IS NULL THEN
                    RAISE EXCEPTION 'fuel_shift_settlements: supply dates and accounting_date are required on insert';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER fuel_shift_settlements_require_dates BEFORE INSERT ON fuel_shift_settlements FOR EACH ROW EXECUTE FUNCTION fuel_settlement_require_dates()');

        DB::statement("ALTER TABLE fuel_sales ADD CONSTRAINT fuel_sales_source_check CHECK (source IN ('station','settlement'))");
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION fuel_sales_source_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NEW.source IS DISTINCT FROM OLD.source THEN
                    RAISE EXCEPTION 'fuel_sales: source is fixed at insert and cannot change';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER fuel_sales_source_guard BEFORE UPDATE OF source ON fuel_sales FOR EACH ROW EXECUTE FUNCTION fuel_sales_source_guard()');
    }

    private function createSqlite(): void
    {
        // مُشغّل التجميد الأصلي ملتقِط لقائمة الأعمدة وقت إنشائه؛ يُعاد بناؤه ليشمل الأعمدة الأربعة الجديدة.
        DB::unprepared('DROP TRIGGER IF EXISTS fuel_shift_settlements_guard_update_frozen');
        $this->recreateSqliteFrozenTrigger();

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER fuel_shift_settlements_dates_insert BEFORE INSERT ON fuel_shift_settlements
            WHEN NEW.supply_started_at IS NULL OR NEW.supply_ended_at IS NULL OR NEW.supply_business_date IS NULL OR NEW.accounting_date IS NULL
              OR NEW.supply_started_at > NEW.supply_ended_at
              OR NEW.accounting_date IS NOT NEW.supply_business_date
            BEGIN
                SELECT RAISE(ABORT, 'fuel_shift_settlements: supply dates are required, start must not follow end, and accounting_date must equal supply_business_date');
            END
            SQL);

        DB::unprepared("CREATE TRIGGER fuel_sales_source_insert BEFORE INSERT ON fuel_sales WHEN NEW.source NOT IN ('station','settlement') BEGIN SELECT RAISE(ABORT, 'fuel_sales: invalid source'); END");
        DB::unprepared("CREATE TRIGGER fuel_sales_source_update BEFORE UPDATE OF source ON fuel_sales WHEN NEW.source IS NOT OLD.source OR NEW.source NOT IN ('station','settlement') BEGIN SELECT RAISE(ABORT, 'fuel_sales: source is fixed at insert and cannot change'); END");
    }

    /** نسخة مطابقة لمنطق P1-3a (الرأس ثابت كلياً عدا updated_at) على قائمة الأعمدة الحالية. */
    private function recreateSqliteFrozenTrigger(): void
    {
        $columns = array_values(array_diff(Schema::getColumnListing(self::HEADER), ['updated_at']));
        $changed = implode(' OR ', array_map(fn ($c) => "OLD.{$c} IS NOT NEW.{$c}", $columns));
        DB::unprepared("CREATE TRIGGER fuel_shift_settlements_guard_update_frozen BEFORE UPDATE ON fuel_shift_settlements WHEN {$changed} BEGIN SELECT RAISE(ABORT, 'fuel_shift_settlements: settlement records are immutable (only single-use resolution columns may transition)'); END");
    }
};
