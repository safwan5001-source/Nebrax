<?php

use App\Models\Account;
use App\Models\AccountRoleMapping;
use App\Models\Tenant;
use App\Support\AccountingRoles;
use App\Tenancy\TenantContext;
use Illuminate\Database\Migrations\Migration;

/**
 * DLV-ACCOUNTING-1 — يزرع حساب 1180 (مستحقات منصات التوصيل) وتعيين الدور
 * `platform_receivable_clearing` لكل مستأجر **موجود بالفعل**، بنفس آلية
 * هجرة `gateway_clearing`/`provider_fee_expense` حرفياً (2026_09_21_010000):
 * إضافي فقط، لا يمسّ `journal_lines` ولا بيانات تاريخية، ولا يطمس تعييناً
 * صريحاً موجوداً مسبقاً. المستأجر الجديد لا يحتاجها — `ChartOfAccountsSeeder`
 * يزرع الحساب والدور معاً.
 */
return new class extends Migration
{
    public function up(): void
    {
        $context = app(TenantContext::class);

        foreach (Tenant::query()->orderBy('id')->get() as $tenant) {
            $context->set($tenant->id);

            $this->ensureAccount($tenant->id, '1180', '11', 'مستحقات منصات التوصيل', 'Delivery Platform Receivable Clearing', 'asset');

            $roleKey = 'platform_receivable_clearing';
            if (! AccountRoleMapping::query()->where('role_key', $roleKey)->exists()) {
                $code = AccountingRoles::legacyCodeFor($roleKey);
                $account = Account::query()->where('code', $code)->first();
                if ($account !== null) {
                    AccountRoleMapping::create([
                        'tenant_id' => $tenant->id,
                        'role_key' => $roleKey,
                        'account_id' => $account->id,
                    ]);
                }
            }
        }

        $context->forget();
    }

    public function down(): void
    {
        $context = app(TenantContext::class);

        foreach (Tenant::query()->orderBy('id')->get() as $tenant) {
            $context->set($tenant->id);
            AccountRoleMapping::query()->where('role_key', 'platform_receivable_clearing')->delete();
        }

        $context->forget();
    }

    /**
     * **لا تستولي على حساب تجاريٍ قائم بنفس الكود:** مستأجر أنشأ حساباً مخصَّصاً
     * بالكود `1180` قبل هذه الهجرة (تجميعي، معطَّل، أو من نوع مختلف) لا يصلح
     * حساب مقاصة منصات توصيل؛ تعيين الدور إليه صامتاً كان سيحوّل تحصيلات
     * المنصة إلى حساب المستأجر الخاص دون علمه. الهجرة تفشل بصراحة لذلك
     * المستأجر بدل انتحال حسابه — تعيين الدور يبقى غائباً (فشل مغلق في
     * `AccountRoleResolver`) حتى يُحلّ التعارض يدوياً.
     */
    private function ensureAccount(
        string $tenantId,
        string $code,
        string $parentCode,
        string $nameAr,
        string $nameEn,
        string $type,
    ): void {
        $existing = Account::query()->where('code', $code)->first();
        if ($existing !== null) {
            if ($existing->is_group || $existing->type !== $type || ! $existing->is_active) {
                throw new RuntimeException(
                    "تعارض: الحساب بالكود {$code} لدى المستأجر {$tenantId} موجود مسبقاً بشكل لا يصلح حساب مقاصة ".
                    "(تجميعي أو معطَّل أو من نوع مختلف) — راجع الحساب يدوياً قبل إعادة تشغيل الهجرة."
                );
            }

            return;
        }

        $parent = Account::query()->where('code', $parentCode)->first();

        Account::create([
            'tenant_id' => $tenantId,
            'parent_id' => $parent?->id,
            'code' => $code,
            'name' => $nameAr,
            'name_en' => $nameEn,
            'type' => $type,
            'normal_balance' => in_array($type, ['asset', 'expense'], true) ? 'debit' : 'credit',
            'is_group' => false,
            'is_system' => true,
        ]);
    }
};
