<?php

use App\Models\Account;
use App\Models\AccountRoleMapping;
use App\Models\Tenant;
use App\Support\AccountingRoles;
use App\Tenancy\TenantContext;
use Illuminate\Database\Migrations\Migration;

return new class extends Migration
{
    public function up(): void
    {
        $context = app(TenantContext::class);

        foreach (Tenant::query()->orderBy('id')->get() as $tenant) {
            $context->set($tenant->id);

            $this->ensureAccount($tenant->id, '1170', '11', 'مستحقات بوابات الدفع', 'Payment Gateway Clearing', 'asset');
            $this->ensureAccount($tenant->id, '5510', '55', 'عمولات بوابات الدفع', 'Payment Gateway Fees', 'expense');

            foreach (['gateway_clearing', 'provider_fee_expense'] as $roleKey) {
                if (AccountRoleMapping::query()->where('role_key', $roleKey)->exists()) {
                    continue;
                }

                $code = AccountingRoles::legacyCodeFor($roleKey);
                $account = Account::query()->where('code', $code)->first();
                if ($account === null) {
                    continue;
                }

                AccountRoleMapping::create([
                    'tenant_id' => $tenant->id,
                    'role_key' => $roleKey,
                    'account_id' => $account->id,
                ]);
            }
        }

        $context->forget();
    }

    public function down(): void
    {
        $context = app(TenantContext::class);

        foreach (Tenant::query()->orderBy('id')->get() as $tenant) {
            $context->set($tenant->id);
            AccountRoleMapping::query()
                ->whereIn('role_key', ['gateway_clearing', 'provider_fee_expense'])
                ->delete();
        }

        $context->forget();
    }

    private function ensureAccount(
        string $tenantId,
        string $code,
        string $parentCode,
        string $nameAr,
        string $nameEn,
        string $type,
    ): void {
        if (Account::query()->where('code', $code)->exists()) {
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
