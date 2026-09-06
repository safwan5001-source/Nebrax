<?php

use App\Models\Tenant;
use App\Services\Accounting\AccountRoleMappingSeeder;
use App\Tenancy\TenantContext;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * ACC-2 — Clean Seeded Cutover: يزرع تعييناً صريحاً لكل دور محاسبي دلالي إلى
 * حساب المستأجر الافتراضي (بالكود القديم)، لكل مستأجر **موجود بالفعل** قبل
 * هذا الإصدار. إضافي فقط — لا يمسّ `journal_lines` ولا `accounts` ولا أي
 * بيانات تاريخية، ولا يطمس تعييناً صريحاً موجوداً مسبقاً (`AccountRoleMappingSeeder`
 * يملأ الأدوار الناقصة حصراً). آمن لإعادة التشغيل (idempotent) — لا يُعيد
 * زرع مستأجرٍ مُهيَّأ بالفعل.
 */
return new class extends Migration
{
    public function up(): void
    {
        $seeder = app(AccountRoleMappingSeeder::class);
        $tenantContext = app(TenantContext::class);

        Tenant::query()->orderBy('id')->each(function (Tenant $tenant) use ($seeder) {
            DB::transaction(function () use ($tenant, $seeder) {
                $seeder->seedDefaults($tenant->id);
            });
        });

        $tenantContext->forget();
    }

    public function down(): void
    {
        // لا تراجع: تعيينات صريحة مطابقة تماماً للسلوك القديم بالكود، وقد تكون
        // استُبدلت بقرارات مالك حقيقية بعد هذا الإصدار — حذفها رجوعاً سيفقد تلك
        // القرارات. جدول `account_role_mappings` نفسه يُحذف مع مهاجرة الإنشاء.
    }
};
