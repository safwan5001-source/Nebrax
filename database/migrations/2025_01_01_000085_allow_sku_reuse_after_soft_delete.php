<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * رمز المنتج فريد بين المنتجات الحية في نطاق الكتالوج الذي يراه المستخدم.
 *
 * - في وضع فصل المنتجات: لكل فرع كتالوج مستقل، فيجوز نفس الرمز في فرع آخر.
 * - المنتجات بلا فرع هي كتالوج مؤسسي/قديم مرئي للجميع، ولها فهرس مستقل.
 * - التحقق في الطلب يحمي التعارض بين منتج مؤسسي ومنتج فرعي، لأن SQL يعامل
 *   NULL كقيمة غير مساوية في الفهارس المركبة.
 *
 * الفهارس الجزئية مدعومة في SQLite وPostgreSQL معاً، وتحرر الرمز بعد الحذف
 * الناعم من دون إضعاف تفرد المنتجات الحية.
 */
return new class extends Migration
{
    public function up(): void
    {
        // في PostgreSQL الاسم يمثل قيداً يملك فهرساً تابعاً، فلا يصح حذف
        // الفهرس بـ DROP INDEX. Schema::dropUnique يترجمها إلى DROP CONSTRAINT
        // هناك وإلى إعادة بناء الجدول الآمنة في SQLite.
        Schema::table('products', function (Blueprint $table) {
            $table->dropUnique('products_tenant_id_sku_unique');
        });

        DB::statement(
            'CREATE UNIQUE INDEX products_tenant_id_branch_id_sku_active_unique '
            . 'ON products (tenant_id, branch_id, sku) '
            . 'WHERE deleted_at IS NULL AND branch_id IS NOT NULL'
        );
        DB::statement(
            'CREATE UNIQUE INDEX products_tenant_id_sku_active_unbranched_unique '
            . 'ON products (tenant_id, sku) '
            . 'WHERE deleted_at IS NULL AND branch_id IS NULL'
        );
    }

    public function down(): void
    {
        // أي تكرار موجود، حتى لو كان أحد السجلين محذوفاً ناعماً، لا يصلح مع
        // القيد التاريخي `(tenant_id, sku)`. نرفض rollback كي لا نغير بيانات.
        $hasReusedSku = DB::table('products')
            ->whereNotNull('sku')
            ->groupBy('tenant_id', 'sku')
            ->havingRaw('COUNT(*) > 1')
            ->exists();

        if ($hasReusedSku) {
            throw new \RuntimeException(
                'لا يمكن التراجع عن فهارس SKU: توجد رموز أعيد استخدامها في كتالوجات الفروع أو بعد الحذف الناعم.'
            );
        }

        DB::statement('DROP INDEX IF EXISTS products_tenant_id_branch_id_sku_active_unique');
        DB::statement('DROP INDEX IF EXISTS products_tenant_id_sku_active_unbranched_unique');

        Schema::table('products', function (Blueprint $table) {
            $table->unique(['tenant_id', 'sku']);
        });
    }
};
