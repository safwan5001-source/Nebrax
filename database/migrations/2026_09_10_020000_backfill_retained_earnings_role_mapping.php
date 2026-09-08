<?php

use App\Models\Tenant;
use App\Services\Accounting\AccountRoleMappingSeeder;
use App\Tenancy\TenantContext;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * FISCAL-2 — يزرع تعيين الدور الجديد `retained_earnings` (الافتراضي 3120) لكل
 * مستأجر قائم، بنفس آلية ACC-2 حرفياً: `AccountRoleMappingSeeder` **إضافيّ
 * فقط** يملأ الأدوار الناقصة ولا يطمس تعييناً صريحاً قائماً، فالهجرة
 * idempotent وإعادة تشغيلها بلا أثر.
 *
 * المستأجر الجديد لا يحتاجها: `ChartOfAccountsSeeder::seed()` يستدعي الزارع
 * نفسه، والزارع يقرأ `AccountingRoles::keys()` فيلتقط الدور الجديد تلقائياً.
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
        // لا تراجع: التعيين قد يكون استُبدل بقرار مالك حقيقي بعد هذا الإصدار،
        // وحذفه رجوعاً يفقد ذلك القرار. نفس تعليل هجرة ACC-2.
    }
};
