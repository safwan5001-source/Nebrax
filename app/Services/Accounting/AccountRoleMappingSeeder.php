<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\AccountRoleMapping;
use App\Support\AccountingRoles;
use App\Tenancy\TenantContext;
use RuntimeException;

/**
 * يزرع تعييناً صريحاً لكل دور محاسبي دلالي (`AccountingRoles`) إلى حساب
 * المستأجر الافتراضي (بالكود القديم) — **Clean Seeded Cutover**: لا مستأجر
 * (قائم عبر backfill، أو جديد عند التسجيل) يبقى بلا تعيين صريح لأي دور.
 *
 * **إضافي فقط، لا هدّام:** يملأ الأدوار الناقصة حصراً؛ لا يلمس تعييناً صريحاً
 * موجوداً بالفعل (لا يطمس قراراً سابقاً للمالك). آمن لإعادة التشغيل idempotent
 * — يُستدعى من مسار تسجيل مستأجر جديد ومن الـbackfill التاريخي معاً.
 */
class AccountRoleMappingSeeder
{
    public function __construct(private TenantContext $tenantContext) {}

    public function seedDefaults(string $tenantId): void
    {
        // يضبط السياق صراحةً بدل الاعتماد على حالة المستدعي — يجعل الاستدعاء
        // من الـbackfill (حلقة على كل المستأجرين) ومن التسجيل سواءً بسواء.
        $this->tenantContext->set($tenantId);

        $existingRoleKeys = AccountRoleMapping::query()->pluck('role_key')->all();

        foreach (AccountingRoles::keys() as $roleKey) {
            if (in_array($roleKey, $existingRoleKeys, true)) {
                continue;
            }

            $code = AccountingRoles::legacyCodeFor($roleKey);
            $account = Account::query()->where('code', $code)->first();

            if ($account === null) {
                throw new RuntimeException(
                    "تعذّر تهيئة تعيين الدور «{$roleKey}»: الحساب الافتراضي بالكود {$code} غير موجود لدى المستأجر {$tenantId}."
                );
            }

            AccountRoleMapping::create([
                'tenant_id' => $tenantId,
                'role_key' => $roleKey,
                'account_id' => $account->id,
            ]);
        }
    }
}
