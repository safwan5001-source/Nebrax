<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

return new class extends Migration
{
    private const PRODUCT_CODE = 'fuel-stations';

    public function up(): void
    {
        $now = now('UTC');
        $product = DB::table('commercial_products')->where('code', self::PRODUCT_CODE)->first();

        if ($product === null) {
            $productId = (string) Str::uuid();
            DB::table('commercial_products')->insert([
                'id' => $productId,
                'code' => self::PRODUCT_CODE,
                'name' => 'إدارة محطات الوقود',
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        } else {
            $productId = $product->id;
        }

        $version = DB::table('commercial_product_versions')
            ->where('commercial_product_id', $productId)
            ->where('version', 1)
            ->first();

        if ($version === null) {
            $versionId = (string) Str::uuid();
            DB::table('commercial_product_versions')->insert([
                'id' => $versionId,
                'commercial_product_id' => $productId,
                'version' => 1,
                // النسخة تنشر core فقط؛ لا تُعطى قدرات المستقبل للتاجر أو العميل
                // قبل أن تكون مبنية ومختبرة في دوراتها المعتمدة.
                'published_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        } else {
            $versionId = $version->id;
        }

        $capabilities = DB::table('commercial_product_version_capabilities');
        if (! $capabilities
            ->where('commercial_product_version_id', $versionId)
            ->where('capability_key', 'fuel_stations.core')
            ->exists()) {
            $capabilities->insert([
                'id' => (string) Str::uuid(),
                'commercial_product_version_id' => $versionId,
                'capability_key' => 'fuel_stations.core',
                'created_at' => $now,
            ]);
        }
    }

    public function down(): void
    {
        // لا نحذف منتجاً أو نسخة أو قدرة تجارية عند rollback: قد تكون قد استُخدمت
        // في إسناد/تجربة/إلغاء وتاريخها جزء من سجل الاستحقاق غير القابل للتخمين.
    }
};
