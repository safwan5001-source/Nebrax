<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * COM-7-P2A — ربط نطاق (hostname) بمتجر Commerce، هو سلطة حسم Tenant/Storefront
 * الوحيدة في الإنتاج (القرار §3-7). جدولٌ إضافي بحت.
 *
 * `hostname` **فريدٌ عالمياً لا لكل مستأجر** — هو مدخل الحسم نفسه، فلا يصح أن
 * يحلّ نفس الاسم إلى مستأجرين (القرار §4). التطبيع (بلا مخطط/مسار/منفذ،
 * أحرف صغيرة) يتم حصراً عبر `App\Support\HostnameNormalizer` قبل التخزين
 * (مُطبَّق في `StorefrontDomain::setHostnameAttribute()`) — فالتفرّد النصي
 * البسيط هنا كافٍ فعلاً.
 *
 * لا `soft deletes` على هذا الجدول (خلافاً لـ`storefronts`): سجلّ ربط حالي لا
 * سجلّ تدقيق، وحذفه الفعلي يحرّر الاسم فوراً — أبسط من فهرس جزئي لا يخدم غرضاً
 * هنا (لا إعادة استخدام تاريخية مقصودة لاسم نطاق).
 *
 * الفهرس الجزئي `WHERE is_primary AND is_active` (بنفس نمط
 * `branches_one_main_per_tenant`) يفرض «نطاقٌ أساسي نشطٌ واحد كحدّ أقصى لكل
 * متجر» (القرار §5) على مستوى القاعدة — مدعوم في PostgreSQL وSQLite معاً.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('storefront_domains', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('storefront_id')->constrained('storefronts')->cascadeOnDelete();
            $table->string('hostname', 253);
            // أصغر مفردات مدافَع عنها: نوعا النطاق الوحيدان في العقد المعتمد
            // (القرار §3) — قابل للتوسعة بترحيل عادي لاحقاً كأي enum آخر هنا.
            $table->enum('type', ['awj_subdomain', 'custom']);
            $table->boolean('is_primary')->default(false);
            $table->boolean('is_active')->default(true);
            $table->enum('verification_status', ['pending', 'verified', 'failed'])->default('pending');
            $table->timestamps();

            $table->unique('hostname');
            $table->index(['storefront_id', 'is_active']);
            $table->index('tenant_id');
        });

        DB::statement(
            'CREATE UNIQUE INDEX storefront_domains_one_primary_active_per_storefront '
            . 'ON storefront_domains (storefront_id) WHERE is_primary = true AND is_active = true'
        );
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS storefront_domains_one_primary_active_per_storefront');

        Schema::dropIfExists('storefront_domains');
    }
};
