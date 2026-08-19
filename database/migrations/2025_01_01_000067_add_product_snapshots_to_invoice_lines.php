<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoice_lines', function (Blueprint $table) {
            // لقطة هوية المنتج تبقي المخرج التاريخي ثابتاً حتى لو تغيّرت بطاقة المنتج لاحقاً.
            $table->string('product_name_snapshot')->nullable()->after('product_id');
            $table->string('product_sku_snapshot')->nullable()->after('product_name_snapshot');
            $table->string('product_barcode_snapshot')->nullable()->after('product_sku_snapshot');
            // سعر الوحدة الصافي بالهللات؛ لا يُعاد اشتقاقه في المتصفح.
            $table->bigInteger('unit_price_before_tax')->nullable()->after('unit_price');
        });

        // السجلات السابقة لا يمكن استعادة قيمها وقت الإصدار إن كانت البطاقة تغيّرت،
        // لذا تثبّت أفضل قيمة متاحة عند الترقية وتبقى ثابتة بعدها. يُستخدم Query Builder
        // لا نموذج التطبيق، كي تظلّ الهجرة مستقلةً عن Global Scopes وتغيّر الكود اللاحق.
        DB::table('invoice_lines as lines')
            ->leftJoin('invoices', 'invoices.id', '=', 'lines.invoice_id')
            ->leftJoin('products', 'products.id', '=', 'lines.product_id')
            ->select([
                'lines.id as line_id', 'lines.description', 'lines.unit_price', 'lines.tax_rate',
                'invoices.tax_inclusive', 'products.name as product_name',
                'products.sku as product_sku', 'products.barcode as product_barcode',
            ])
            ->orderBy('lines.id')
            ->chunkById(200, function ($lines): void {
                foreach ($lines as $line) {
                    $price = (int) $line->unit_price;
                    $rate = (int) $line->tax_rate;
                    $inclusive = (bool) $line->tax_inclusive;
                    $tax = $inclusive && $price > 0 && $rate > 0
                        ? intdiv(2 * $price * $rate + (100 + $rate), 2 * (100 + $rate))
                        : 0;

                    DB::table('invoice_lines')->where('id', $line->line_id)->update([
                        'product_name_snapshot' => $line->product_name ?? $line->description,
                        'product_sku_snapshot' => $line->product_sku,
                        'product_barcode_snapshot' => $line->product_barcode,
                        'unit_price_before_tax' => $price - $tax,
                    ]);
                }
            }, 'lines.id', 'line_id');
    }

    public function down(): void
    {
        Schema::table('invoice_lines', function (Blueprint $table) {
            $table->dropColumn([
                'product_name_snapshot',
                'product_sku_snapshot',
                'product_barcode_snapshot',
                'unit_price_before_tax',
            ]);
        });
    }
};
