<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * حد البيع الأدنى سياسةٌ جديدة: يحمي الافتراض الجديد المستأجرين الجدد، لكن
     * المستأجرين القائمين كانوا يبيعون بلا الحارس. تثبيت `false` لهم هنا يمنع
     * ترقيةً تعطل فواتير قائمة من دون قرار واعٍ عبر إعدادات المبيعات.
     */
    public function up(): void
    {
        Schema::table('invoice_lines', function (Blueprint $table) {
            // لقطات تدقيق: لا نعيد قراءة حد المنتج عند مراجعة فاتورة قديمة.
            $table->bigInteger('min_sale_price_snapshot')->nullable()->after('unit_price_before_tax');
            $table->string('min_sale_price_override_reason', 500)->nullable()->after('min_sale_price_snapshot');
            $table->foreignUuid('min_sale_price_overridden_by')->nullable()
                ->after('min_sale_price_override_reason')
                ->constrained('users')->nullOnDelete();
        });

        foreach (DB::table('tenants')->get(['id', 'settings']) as $tenant) {
            $settings = $this->decode($tenant->settings);
            if (array_key_exists('enforce_min_sale_price', $settings['sales'] ?? [])) {
                continue;
            }

            $settings['sales']['enforce_min_sale_price'] = false;
            DB::table('tenants')->where('id', $tenant->id)
                ->update(['settings' => json_encode($settings, JSON_UNESCAPED_UNICODE)]);
        }
    }

    public function down(): void
    {
        Schema::table('invoice_lines', function (Blueprint $table) {
            $table->dropForeign(['min_sale_price_overridden_by']);
            $table->dropColumn([
                'min_sale_price_snapshot',
                'min_sale_price_override_reason',
                'min_sale_price_overridden_by',
            ]);
        });

        foreach (DB::table('tenants')->get(['id', 'settings']) as $tenant) {
            $settings = $this->decode($tenant->settings);
            if (! array_key_exists('enforce_min_sale_price', $settings['sales'] ?? [])) {
                continue;
            }

            unset($settings['sales']['enforce_min_sale_price']);
            if ($settings['sales'] === []) {
                unset($settings['sales']);
            }
            DB::table('tenants')->where('id', $tenant->id)
                ->update(['settings' => json_encode($settings, JSON_UNESCAPED_UNICODE)]);
        }
    }

    /** `settings` عمود json — قد يصل نصّاً أو مصفوفةً حسب السائق. */
    private function decode(mixed $raw): array
    {
        if (is_array($raw)) {
            return $raw;
        }

        return json_decode((string) $raw, true) ?: [];
    }
};
