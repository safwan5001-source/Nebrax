<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * P1-3a — أساس تسوية ورديات محطات الوقود: جداول إضافية فقط + حراس قاعدة بيانات. لا تعديل لأي جدول قائم (عدا `partners.system_kind` في هجرة منفصلة)،
 * ولا Backfill، ولا كتابة لأي صف هنا. **لا يكتب أي مسار في P1-3a في هذه الجداول** (الكاتب `FuelShiftSettlementService` يأتي مع P1-3b خلف البوابة)؛
 * اختبارات P1-3a تدرج صفوفاً بـSQL خام لإثبات الحراس.
 *
 * ═══ الجداول ═══
 *  - `fuel_shift_settlements`            رأس تسوية واحد لكل وردية.
 *  - `fuel_shift_settlement_lines`       سطر لكل فوهة (M / Q_erp / Q_res / السعر / الحالة).
 *  - `fuel_shift_settlement_collections` تخصيص كل دفعة (طريقة ← فاتورة مستهدفة ← سند).
 *  - `fuel_shift_settlement_variances`   سجل الفروق (عجز/زيادة/محجوز) — منفصل عن الذمم، ولا قيد له.
 *  - `fuel_shift_settlement_resolutions` سجل إلحاقي لحسم ما حُجب (جديد دائماً، لا يُعدَّل).
 *  - `fuel_cost_pool_open_histories`     تاريخ مفتوح لمجمّع التكلفة (مخزن × منتج) يُفتح عند كل حجب ويُغلق بالحسم.
 *  - `fuel_station_walk_in_partners`     ربط محطة ↔ عميلها النقدي (قيدان فريدان).
 *
 * ═══ الثبات (في القاعدة لا في التطبيق وحده) ═══
 *  - حقائق التسوية (الرأس، التخصيصات، الحسم، ربط العميل) **غير قابلة للتعديل** أبداً.
 *  - ثلاثة جداول تقبل **انتقالاً أحادي الاتجاه مرة واحدة** لأعمدة محدّدة بعينها (NULL ← قيمة) وكل ما عداها ثابت:
 *      lines.{resolution_id, fuel_sale_id} · variances.{allocated_collection_id} · open_histories.{resolution_id, resolved_at}.
 *  - لا DELETE ما دام المستأجر موجوداً (حذف المستأجر المتسلسل يمرّ لأن صفه يزول أولاً، كنمط `fuel_station_audit_events`).
 *  - إدراج صف يتحقق من اتساق المستأجر/الفرع/الوردية/المحطة مع أبيه (فلا سطر لتسوية مستأجر آخر ولو بـSQL خام).
 *  - المفاتيح الأجنبية بين هذه الجداول NO ACTION (لا cascade) كي لا يتصادم حذف المستأجر المتسلسل مع الحراس.
 *
 * التراجع يرفض متى وُجد أي صف في أي من الجداول.
 */
return new class extends Migration
{
    /** @var array<string, list<string>> الجداول وأعمدة الانتقال الأحادي المسموحة لكل منها (فارغ = ثابت كلياً). */
    private const TRANSITIONS = [
        'fuel_shift_settlements' => [],
        'fuel_shift_settlement_lines' => ['resolution_id', 'fuel_sale_id'],
        'fuel_shift_settlement_collections' => [],
        'fuel_shift_settlement_variances' => ['allocated_collection_id'],
        'fuel_shift_settlement_resolutions' => [],
        'fuel_cost_pool_open_histories' => ['resolution_id', 'resolved_at'],
        'fuel_station_walk_in_partners' => [],
    ];

    public function up(): void
    {
        Schema::create('fuel_shift_settlements', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations');
            $table->foreignUuid('fuel_shift_id')->constrained('fuel_shifts');
            // posted: رُحّلت فواتير · allocation_only: لا بقية لكن خُصِّصت مبالغ على فواتير ERP قائمة · no_residual: لا بقية ولا تخصيص · withheld: حُجب كل شيء
            $table->string('status', 24);
            $table->string('sales_basis', 16)->default('per_invoice');
            $table->string('preview_hash', 64);
            $table->string('tax_mode', 16)->nullable();
            $table->json('policy_snapshot');
            $table->bigInteger('metered_milliliters');
            $table->bigInteger('erp_milliliters');
            $table->bigInteger('residual_milliliters');
            $table->bigInteger('settled_invoice_total_minor')->default(0);
            $table->bigInteger('pending_value_minor')->default(0); // تقدير معلّق للمحجوب، ليس التزاماً
            $table->bigInteger('reference_total_minor')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('settled_at');
            $table->timestamps();

            $table->unique(['tenant_id', 'fuel_shift_id'], 'fuel_shift_settlements_shift_unique');
            $table->index(['tenant_id', 'fuel_station_id', 'status'], 'fuel_shift_settlements_station_status_index');
        });

        Schema::create('fuel_shift_settlement_resolutions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained();
            $table->foreignUuid('fuel_shift_settlement_id')->constrained('fuel_shift_settlements');
            $table->string('kind', 32); // withheld_resolved | correction
            $table->json('payload');
            $table->string('note', 500)->nullable();
            $table->foreignUuid('resolved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('resolved_at');
            $table->timestamps();

            $table->index(['tenant_id', 'fuel_shift_settlement_id'], 'fuel_settlement_resolutions_settlement_index');
        });

        Schema::create('fuel_shift_settlement_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained();
            $table->foreignUuid('fuel_shift_settlement_id')->constrained('fuel_shift_settlements');
            $table->foreignUuid('fuel_nozzle_id')->constrained('fuel_nozzles');
            $table->foreignUuid('fuel_product_id')->constrained('fuel_products');
            $table->foreignUuid('warehouse_id')->constrained('warehouses');
            $table->bigInteger('metered_milliliters');
            $table->bigInteger('erp_milliliters');
            $table->bigInteger('residual_milliliters');
            $table->bigInteger('price_per_liter_minor')->nullable();
            $table->string('tax_mode', 16)->nullable();
            $table->bigInteger('expected_gross_minor')->nullable();
            $table->string('state', 40);
            $table->string('withheld_reason', 40)->nullable();
            $table->bigInteger('pending_value_minor')->nullable();
            // تنتقلان مرة واحدة NULL ← قيمة حين يُحسم سطر محجوب (P1-3c) أو حين يُنشأ بيع التسوية.
            $table->foreignUuid('fuel_sale_id')->nullable()->constrained('fuel_sales');
            $table->foreignUuid('resolution_id')->nullable()->constrained('fuel_shift_settlement_resolutions');
            $table->timestamps();

            $table->unique(['fuel_shift_settlement_id', 'fuel_nozzle_id'], 'fuel_settlement_lines_nozzle_unique');
            $table->unique('fuel_sale_id', 'fuel_settlement_lines_sale_unique');
            $table->index(['tenant_id', 'warehouse_id', 'fuel_product_id'], 'fuel_settlement_lines_pool_index');
        });

        Schema::create('fuel_shift_settlement_collections', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained();
            $table->foreignUuid('fuel_shift_settlement_id')->constrained('fuel_shift_settlements');
            $table->foreignUuid('payment_method_id')->constrained('payment_methods');
            $table->foreignUuid('invoice_id')->constrained('invoices');
            $table->foreignUuid('payment_id')->constrained('payments');
            $table->foreignUuid('fuel_sale_payment_receipt_id')->nullable()->constrained('fuel_sale_payment_receipts');
            $table->string('target_kind', 24); // erp_walk_in | settlement | resolved_withheld
            $table->bigInteger('amount_minor');
            $table->foreignUuid('resolution_id')->nullable()->constrained('fuel_shift_settlement_resolutions');
            $table->timestamps();

            $table->unique(['fuel_shift_settlement_id', 'payment_method_id', 'invoice_id'], 'fuel_settlement_collections_target_unique');
            $table->unique('payment_id', 'fuel_settlement_collections_payment_unique');
            $table->unique('fuel_sale_payment_receipt_id', 'fuel_settlement_collections_receipt_unique');
        });

        Schema::create('fuel_shift_settlement_variances', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained();
            $table->foreignUuid('fuel_shift_settlement_id')->constrained('fuel_shift_settlements');
            // العجز إجماليّ لا يُنسب إلى طريقة (لا يوجد «متوقع لكل طريقة» يُشتقّ منه): payment_method_id/settlement_type = NULL له وحده.
            // الزيادة والمحجوز لكل طريقة لأنهما يُشتقّان من U_m المتبقي لكل طريقة.
            $table->foreignUuid('payment_method_id')->nullable()->constrained('payment_methods');
            $table->string('settlement_type', 8)->nullable(); // cash | bank
            $table->string('kind', 24); // shortage | surplus | held_for_withheld
            $table->bigInteger('amount_minor');
            // held_for_withheld ← allocated: انتقال أحادي حين يُحسم الحجب ويُنشأ التخصيص.
            $table->foreignUuid('allocated_collection_id')->nullable()->constrained('fuel_shift_settlement_collections');
            $table->timestamps();

            $table->unique(['fuel_shift_settlement_id', 'payment_method_id', 'kind'], 'fuel_settlement_variances_kind_unique');
        });

        Schema::create('fuel_cost_pool_open_histories', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations');
            $table->foreignUuid('warehouse_id')->constrained('warehouses');
            $table->foreignUuid('fuel_product_id')->constrained('fuel_products');
            $table->foreignUuid('fuel_shift_settlement_line_id')->constrained('fuel_shift_settlement_lines');
            $table->string('reason', 40); // withheld_cost_pool_changed | withheld_pool_history_open | withheld_period_boundary
            $table->timestamp('opened_at');
            $table->foreignUuid('resolution_id')->nullable()->constrained('fuel_shift_settlement_resolutions');
            $table->timestamp('resolved_at')->nullable();
            $table->timestamps();

            $table->unique('fuel_shift_settlement_line_id', 'fuel_cost_pool_histories_line_unique');
            $table->index(['tenant_id', 'warehouse_id', 'fuel_product_id', 'resolved_at'], 'fuel_cost_pool_histories_pool_index');
        });

        Schema::create('fuel_station_walk_in_partners', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations');
            $table->foreignUuid('partner_id')->constrained('partners');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique('fuel_station_id', 'fuel_station_walk_in_station_unique');
            $table->unique('partner_id', 'fuel_station_walk_in_partner_unique');
        });

        // عجز واحد إجماليّ لكل تسوية (فهرس عادي لا يمنع تكراره لأن NULL ≠ NULL).
        DB::statement("CREATE UNIQUE INDEX fuel_settlement_variances_one_shortage ON fuel_shift_settlement_variances (fuel_shift_settlement_id) WHERE kind = 'shortage'");

        if (DB::getDriverName() === 'pgsql') {
            $this->createPostgresChecks();
            $this->createPostgresGuards();
        } else {
            $this->createSqliteGuards();
        }
    }

    public function down(): void
    {
        foreach (array_keys(self::TRANSITIONS) as $table) {
            if (Schema::hasTable($table) && DB::table($table)->exists()) {
                throw new RuntimeException("لا يمكن التراجع: الجدول {$table} يحتوي صفوفاً (سجلات تسوية الورديات لا تُسقط بالتراجع).");
            }
        }

        // الأبناء قبل الآباء. الحراس (المشغّلات) تسقط مع جداولها.
        Schema::dropIfExists('fuel_station_walk_in_partners');
        Schema::dropIfExists('fuel_cost_pool_open_histories');
        Schema::dropIfExists('fuel_shift_settlement_variances');
        Schema::dropIfExists('fuel_shift_settlement_collections');
        Schema::dropIfExists('fuel_shift_settlement_lines');
        Schema::dropIfExists('fuel_shift_settlement_resolutions');
        Schema::dropIfExists('fuel_shift_settlements');

        if (DB::getDriverName() === 'pgsql') {
            foreach (['fuel_settlement_guard_update', 'fuel_settlement_guard_delete', 'fuel_settlement_check_child', 'fuel_settlement_check_header', 'fuel_settlement_check_walk_in'] as $fn) {
                DB::statement("DROP FUNCTION IF EXISTS {$fn}() CASCADE");
            }
        }
    }

    private function createPostgresChecks(): void
    {
        DB::statement("ALTER TABLE fuel_shift_settlements ADD CONSTRAINT fuel_shift_settlements_check CHECK (
            status IN ('posted','allocation_only','no_residual','withheld')
            AND sales_basis IN ('per_invoice')
            AND metered_milliliters >= 0 AND erp_milliliters >= 0 AND residual_milliliters >= 0
            AND metered_milliliters = erp_milliliters + residual_milliliters
            AND settled_invoice_total_minor >= 0 AND pending_value_minor >= 0
        )");
        DB::statement("ALTER TABLE fuel_shift_settlement_lines ADD CONSTRAINT fuel_shift_settlement_lines_check CHECK (
            state IN ('no_residual','posted','withheld_cost_pool_changed','withheld_pool_history_open','withheld_period_boundary')
            AND metered_milliliters >= 0 AND erp_milliliters >= 0 AND residual_milliliters >= 0
            AND metered_milliliters = erp_milliliters + residual_milliliters
            AND (price_per_liter_minor IS NULL OR price_per_liter_minor >= 0)
            AND (expected_gross_minor IS NULL OR expected_gross_minor >= 0)
            AND (pending_value_minor IS NULL OR pending_value_minor >= 0)
            AND ((state LIKE 'withheld\\_%') = (withheld_reason IS NOT NULL))
        )");
        DB::statement("ALTER TABLE fuel_shift_settlement_collections ADD CONSTRAINT fuel_shift_settlement_collections_check CHECK (
            amount_minor > 0 AND target_kind IN ('erp_walk_in','settlement','resolved_withheld')
        )");
        DB::statement("ALTER TABLE fuel_shift_settlement_variances ADD CONSTRAINT fuel_shift_settlement_variances_check CHECK (
            amount_minor > 0 AND kind IN ('shortage','surplus','held_for_withheld')
            AND (settlement_type IS NULL OR settlement_type IN ('cash','bank'))
            AND ((kind = 'shortage') = (payment_method_id IS NULL)) AND ((kind = 'shortage') = (settlement_type IS NULL))
            AND (allocated_collection_id IS NULL OR kind = 'held_for_withheld')
        )");
        DB::statement("ALTER TABLE fuel_shift_settlement_resolutions ADD CONSTRAINT fuel_shift_settlement_resolutions_check CHECK (
            kind IN ('withheld_resolved','correction')
        )");
        DB::statement("ALTER TABLE fuel_cost_pool_open_histories ADD CONSTRAINT fuel_cost_pool_open_histories_check CHECK (
            reason IN ('withheld_cost_pool_changed','withheld_pool_history_open','withheld_period_boundary')
            AND ((resolution_id IS NULL) = (resolved_at IS NULL))
        )");
    }

    private function createPostgresGuards(): void
    {
        // تحديث: يُسمح فقط بتحويل أعمدة الانتقال (وسائط المشغّل) من NULL إلى قيمة مرة واحدة؛ وكل عمود آخر (عدا updated_at) ثابت.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION fuel_settlement_guard_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
            DECLARE
                allowed text[] := COALESCE(TG_ARGV, ARRAY[]::text[]);
                o jsonb := to_jsonb(OLD);
                n jsonb := to_jsonb(NEW);
                col text;
            BEGIN
                FOREACH col IN ARRAY allowed LOOP
                    IF o -> col <> 'null'::jsonb AND (n -> col) IS DISTINCT FROM (o -> col) THEN
                        RAISE EXCEPTION '%: column % is single-use and already set', TG_TABLE_NAME, col;
                    END IF;
                END LOOP;
                IF ((n - allowed) - 'updated_at') IS DISTINCT FROM ((o - allowed) - 'updated_at') THEN
                    RAISE EXCEPTION '%: settlement records are immutable (only single-use resolution columns may transition)', TG_TABLE_NAME;
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION fuel_settlement_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
                    RAISE EXCEPTION '%: settlement records cannot be deleted', TG_TABLE_NAME;
                END IF;
                RETURN OLD;
            END
            $fn$
            SQL);

        // رأس التسوية: الوردية من المستأجر والفرع والمحطة نفسها.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION fuel_settlement_check_header() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM fuel_shifts s
                    WHERE s.id = NEW.fuel_shift_id AND s.tenant_id = NEW.tenant_id AND s.branch_id = NEW.branch_id AND s.fuel_station_id = NEW.fuel_station_id
                ) THEN
                    RAISE EXCEPTION 'fuel_shift_settlements: shift does not belong to the same tenant, branch and station';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);

        // الابن: أبوه (جدول ومفتاح بوسيطَي المشغّل) من المستأجر والفرع نفسيهما.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION fuel_settlement_check_child() RETURNS trigger LANGUAGE plpgsql AS $fn$
            DECLARE
                parent_id text := to_jsonb(NEW) ->> TG_ARGV[1];
                ok integer;
            BEGIN
                EXECUTE format('SELECT 1 FROM %I p WHERE p.id = ($1)::uuid AND p.tenant_id = $2 AND p.branch_id = $3', TG_ARGV[0])
                    INTO ok USING parent_id, NEW.tenant_id, NEW.branch_id;
                IF ok IS NULL THEN
                    RAISE EXCEPTION '%: parent % does not belong to the same tenant and branch', TG_TABLE_NAME, TG_ARGV[0];
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);

        // العميل النقدي: المحطة من المستأجر والفرع نفسيهما والطرف من المستأجر نفسه، عميلٌ نشط الأصل، وموسوم نظامياً.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION fuel_settlement_check_walk_in() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM fuel_stations s WHERE s.id = NEW.fuel_station_id AND s.tenant_id = NEW.tenant_id AND s.branch_id = NEW.branch_id) THEN
                    RAISE EXCEPTION 'fuel_station_walk_in_partners: station does not belong to the same tenant and branch';
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM partners p
                    WHERE p.id = NEW.partner_id AND p.tenant_id = NEW.tenant_id AND p.system_kind = 'fuel_walk_in' AND p.type IN ('customer','both')
                ) THEN
                    RAISE EXCEPTION 'fuel_station_walk_in_partners: partner must be a same-tenant customer flagged system_kind=fuel_walk_in';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);

        foreach (self::TRANSITIONS as $table => $columns) {
            $args = implode(', ', array_map(fn ($c) => "'{$c}'", $columns));
            DB::unprepared("CREATE TRIGGER {$table}_guard_update BEFORE UPDATE ON {$table} FOR EACH ROW EXECUTE FUNCTION fuel_settlement_guard_update({$args})");
            DB::unprepared("CREATE TRIGGER {$table}_guard_delete BEFORE DELETE ON {$table} FOR EACH ROW EXECUTE FUNCTION fuel_settlement_guard_delete()");
        }

        DB::unprepared('CREATE TRIGGER fuel_shift_settlements_check_insert BEFORE INSERT ON fuel_shift_settlements FOR EACH ROW EXECUTE FUNCTION fuel_settlement_check_header()');
        foreach ([
            'fuel_shift_settlement_lines' => ['fuel_shift_settlements', 'fuel_shift_settlement_id'],
            'fuel_shift_settlement_collections' => ['fuel_shift_settlements', 'fuel_shift_settlement_id'],
            'fuel_shift_settlement_variances' => ['fuel_shift_settlements', 'fuel_shift_settlement_id'],
            'fuel_shift_settlement_resolutions' => ['fuel_shift_settlements', 'fuel_shift_settlement_id'],
            'fuel_cost_pool_open_histories' => ['fuel_shift_settlement_lines', 'fuel_shift_settlement_line_id'],
        ] as $table => [$parent, $key]) {
            DB::unprepared("CREATE TRIGGER {$table}_check_insert BEFORE INSERT ON {$table} FOR EACH ROW EXECUTE FUNCTION fuel_settlement_check_child('{$parent}', '{$key}')");
        }
        DB::unprepared('CREATE TRIGGER fuel_station_walk_in_partners_check_insert BEFORE INSERT ON fuel_station_walk_in_partners FOR EACH ROW EXECUTE FUNCTION fuel_settlement_check_walk_in()');
    }

    private function createSqliteGuards(): void
    {
        foreach (self::TRANSITIONS as $table => $transition) {
            $columns = array_values(array_diff(Schema::getColumnListing($table), ['updated_at']));
            $frozen = array_values(array_diff($columns, $transition));

            // أي عمود غير انتقالي تغيّر ⇒ رفض.
            if ($frozen !== []) {
                $changed = implode(' OR ', array_map(fn ($c) => "OLD.{$c} IS NOT NEW.{$c}", $frozen));
                DB::unprepared("CREATE TRIGGER {$table}_guard_update_frozen BEFORE UPDATE ON {$table} WHEN {$changed} BEGIN SELECT RAISE(ABORT, '{$table}: settlement records are immutable (only single-use resolution columns may transition)'); END");
            }
            // عمود انتقالي سبق ضبطه لا يتغيّر ثانية.
            foreach ($transition as $column) {
                DB::unprepared("CREATE TRIGGER {$table}_guard_update_{$column} BEFORE UPDATE ON {$table} WHEN OLD.{$column} IS NOT NULL AND NEW.{$column} IS NOT OLD.{$column} BEGIN SELECT RAISE(ABORT, '{$table}: column {$column} is single-use and already set'); END");
            }
            DB::unprepared("CREATE TRIGGER {$table}_guard_delete BEFORE DELETE ON {$table} WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) BEGIN SELECT RAISE(ABORT, '{$table}: settlement records cannot be deleted'); END");
        }

        DB::unprepared("CREATE TRIGGER fuel_shift_settlements_check_insert BEFORE INSERT ON fuel_shift_settlements WHEN NOT EXISTS (SELECT 1 FROM fuel_shifts s WHERE s.id = NEW.fuel_shift_id AND s.tenant_id = NEW.tenant_id AND s.branch_id = NEW.branch_id AND s.fuel_station_id = NEW.fuel_station_id) BEGIN SELECT RAISE(ABORT, 'fuel_shift_settlements: shift does not belong to the same tenant, branch and station'); END");

        foreach ([
            'fuel_shift_settlement_lines' => ['fuel_shift_settlements', 'fuel_shift_settlement_id'],
            'fuel_shift_settlement_collections' => ['fuel_shift_settlements', 'fuel_shift_settlement_id'],
            'fuel_shift_settlement_variances' => ['fuel_shift_settlements', 'fuel_shift_settlement_id'],
            'fuel_shift_settlement_resolutions' => ['fuel_shift_settlements', 'fuel_shift_settlement_id'],
            'fuel_cost_pool_open_histories' => ['fuel_shift_settlement_lines', 'fuel_shift_settlement_line_id'],
        ] as $table => [$parent, $key]) {
            DB::unprepared("CREATE TRIGGER {$table}_check_insert BEFORE INSERT ON {$table} WHEN NOT EXISTS (SELECT 1 FROM {$parent} p WHERE p.id = NEW.{$key} AND p.tenant_id = NEW.tenant_id AND p.branch_id = NEW.branch_id) BEGIN SELECT RAISE(ABORT, '{$table}: parent {$parent} does not belong to the same tenant and branch'); END");
        }

        DB::unprepared("CREATE TRIGGER fuel_station_walk_in_partners_check_insert BEFORE INSERT ON fuel_station_walk_in_partners WHEN NOT EXISTS (SELECT 1 FROM fuel_stations s WHERE s.id = NEW.fuel_station_id AND s.tenant_id = NEW.tenant_id AND s.branch_id = NEW.branch_id) OR NOT EXISTS (SELECT 1 FROM partners p WHERE p.id = NEW.partner_id AND p.tenant_id = NEW.tenant_id AND p.system_kind = 'fuel_walk_in' AND p.type IN ('customer','both')) BEGIN SELECT RAISE(ABORT, 'fuel_station_walk_in_partners: station and partner must belong to the same tenant and the partner must be flagged system_kind=fuel_walk_in'); END");
    }
};
