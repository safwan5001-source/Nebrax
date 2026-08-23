<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

return new class extends Migration
{
    private const PRODUCT_CODE = 'intelligent-document-center';
    private const CAPABILITY_KEY = 'document_center.core';

    public function up(): void
    {
        $now = now('UTC');
        $product = DB::table('commercial_products')->where('code', self::PRODUCT_CODE)->first();

        if ($product === null) {
            $productId = (string) Str::uuid();
            DB::table('commercial_products')->insert([
                'id' => $productId,
                'code' => self::PRODUCT_CODE,
                'name' => 'مركز المستندات الذكي',
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
                'published_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        } else {
            $versionId = $version->id;
        }

        $exists = DB::table('commercial_product_version_capabilities')
            ->where('commercial_product_version_id', $versionId)
            ->where('capability_key', self::CAPABILITY_KEY)
            ->exists();

        if (! $exists) {
            DB::table('commercial_product_version_capabilities')->insert([
                'id' => (string) Str::uuid(),
                'commercial_product_version_id' => $versionId,
                'capability_key' => self::CAPABILITY_KEY,
                'created_at' => $now,
            ]);
        }
    }

    public function down(): void
    {
        // Commercial history is intentionally retained, matching the established
        // product-registration migrations: assignments and grants may reference it.
    }
};
