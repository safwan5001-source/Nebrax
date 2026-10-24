<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * AWJ-PAYMENTS-HZ-01 / PAY-H3-02c-2 (ADR-0008 D-04 الخيار ب) — سياسة ضريبة عمولة المزوّد لكل اتصال + مرجع الفاتورة الضريبية على التسوية. **إضافية فقط.**
 *
 * `payment_gateways.fee_tax_policy`: `reject` (الافتراضي = السلوك القائم حرفياً لكل اتصال قائم) | `input_vat` (ضريبة الرسوم مدخلات بفاتورة ضريبية صالحة).
 * **لا تفعيل قبل EXT-05**: الضبط والترحيل كلاهما محجوبان بـ`config('payments.fee_tax_opinion_ref')` الفارغ افتراضياً (طبقة الخدمة). القاعدة تحصر القيم المسموحة فقط.
 * `payment_gateway_settlements.fee_tax_invoice_ref`: مرجع فاتورة المزوّد الضريبية (إلزامي عند ترحيل ضريبة رسوم).
 */
return new class extends Migration
{
    private const NAME = 'payment_gateways_fee_tax_policy_guard';

    public function up(): void
    {
        Schema::table('payment_gateways', function (Blueprint $table) {
            $table->string('fee_tax_policy', 16)->default('reject');
        });
        Schema::table('payment_gateway_settlements', function (Blueprint $table) {
            $table->string('fee_tax_invoice_ref', 191)->nullable();
        });

        $rule = "NEW.fee_tax_policy NOT IN ('reject', 'input_vat')";
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('CREATE OR REPLACE FUNCTION '.self::NAME."() RETURNS trigger AS \$\$\nBEGIN\n    IF {$rule} THEN RAISE EXCEPTION 'pg_fee_tax_policy_invalid'; END IF;\n    RETURN NEW;\nEND;\n\$\$ LANGUAGE plpgsql");
            DB::unprepared('CREATE TRIGGER '.self::NAME.' BEFORE INSERT OR UPDATE ON payment_gateways FOR EACH ROW EXECUTE FUNCTION '.self::NAME.'()');

            return;
        }
        DB::unprepared('CREATE TRIGGER '.self::NAME."_i BEFORE INSERT ON payment_gateways FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'pg_fee_tax_policy_invalid') WHERE {$rule}; END");
        DB::unprepared('CREATE TRIGGER '.self::NAME."_u BEFORE UPDATE ON payment_gateways FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'pg_fee_tax_policy_invalid') WHERE {$rule}; END");
    }

    public function down(): void
    {
        if (DB::table('payment_gateways')->where('fee_tax_policy', '<>', 'reject')->exists() || DB::table('payment_gateway_settlements')->whereNotNull('fee_tax_invoice_ref')->exists()) {
            throw new RuntimeException('Rollback refused: a gateway has a non-default fee-tax policy or a settlement carries a fee-tax invoice. Fix forward instead.');
        }
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS '.self::NAME.' ON payment_gateways');
            DB::unprepared('DROP FUNCTION IF EXISTS '.self::NAME.'()');
        } else {
            DB::unprepared('DROP TRIGGER IF EXISTS '.self::NAME.'_i');
            DB::unprepared('DROP TRIGGER IF EXISTS '.self::NAME.'_u');
        }
        Schema::table('payment_gateway_settlements', fn (Blueprint $table) => $table->dropColumn('fee_tax_invoice_ref'));
        Schema::table('payment_gateways', fn (Blueprint $table) => $table->dropColumn('fee_tax_policy'));
    }
};
