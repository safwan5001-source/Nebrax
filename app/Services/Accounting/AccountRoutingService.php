<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\AccountRoleMapping;
use App\Models\AccountRoleMappingEvent;
use App\Models\Tenant;
use App\Models\User;
use App\Support\AccountingRoles;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * CRUD تعيينات توجيه الحسابات (Account Routing) لواجهة `/accounting-settings`
 * — مصدر البيانات لصفحة الإعدادات وحدها. لا علاقة له بـ`AccountRoleResolver`
 * (الذي يستهلكه لاحقاً ACC-3+ وقت الترحيل)؛ هذا مسار قراءة/كتابة إداري فقط.
 *
 * كل كتابة: تحقّق مسبق (الدور معروف وقابل للضبط، الحساب مملوك للمستأجر النشط
 * ونشط وغير تجميعي) ثم معاملة واحدة (قفل صفّ المستأجر لمنع سباق كتابة متزامنة
 * لنفس الدور) + سجل تدقيق ثابت. لا حذف فعلي لصفّ تعيين أبداً — «الحذف/الاستعادة»
 * يكتب القيمة الافتراضية صراحةً كتعيين جديد، فلا يوجد دور بلا تعيين بعد ACC-2
 * (Clean Seeded Cutover)؛ وهذا يمنع تحوّل «إعادة الضبط» إلى نفس الـfallback
 * الضمني الممنوع.
 */
class AccountRoutingService
{
    public function __construct(
        private TenantContext $tenantContext,
        private VatRoleIntegrityService $vatIntegrity,
    ) {}

    /**
     * @return array{roles: list<array<string, mixed>>, domains: array<string, array{label_ar:string,label_en:string}>, eligible_accounts: list<array<string, mixed>>}
     */
    public function list(): array
    {
        $mappings = AccountRoleMapping::query()->get()->keyBy('role_key');
        $eligibleAccounts = Account::query()
            ->where('is_active', true)
            ->where('is_group', false)
            ->orderBy('code')
            ->get(['id', 'code', 'name', 'name_en', 'type'])
            ->map(fn (Account $account) => [
                'id' => $account->id,
                'code' => $account->code,
                'name' => $account->name,
                'name_en' => $account->name_en,
                'type' => $account->type,
            ])
            ->all();

        $violations = $this->vatIntegrity->violationsByRole();
        $roles = [];
        foreach (AccountingRoles::keys() as $key) {
            $roles[] = $this->describeRoleFromMapping($key, $mappings->get($key), $violations[$key] ?? []);
        }

        return [
            'roles' => $roles,
            'domains' => AccountingRoles::domains(),
            'eligible_accounts' => $eligibleAccounts,
        ];
    }

    /** @return array<string, mixed> شكل صفّ الدور نفسه المُعاد من `list()`، لتحديث فوري في الواجهة. */
    public function setMapping(string $roleKey, string $accountId, ?User $actor): array
    {
        $this->assertConfigurableRole($roleKey);

        DB::transaction(function () use ($roleKey, $accountId, $actor) {
            $this->lockActiveTenant();

            // REM-05: الأهلية تُفحص بعد قفل المستأجر وداخل المعاملة نفسها، فلا يستطيع تعيينان متزامنان
            // (على PostgreSQL) حجز الحساب نفسه لدورين متعارضين — الثاني يرى التعيين الذي أتمّه الأول.
            $account = $this->assertEligibleAccount($accountId);
            $this->vatIntegrity->assertMappingAllowed($roleKey, $account);

            $previous = AccountRoleMapping::query()->where('role_key', $roleKey)->first();
            $previousAccount = $previous === null ? null : Account::query()->whereKey($previous->account_id)->first();

            AccountRoleMapping::query()->updateOrCreate(
                ['role_key' => $roleKey],
                ['account_id' => $account->id],
            );

            AccountRoleMappingEvent::create([
                'role_key' => $roleKey,
                'action' => $previous === null ? 'mapping_created' : 'mapping_changed',
                'actor_user_id' => $actor?->id,
                'previous_account_id' => $previous?->account_id,
                'previous_account_code' => $previousAccount?->code,
                'new_account_id' => $account->id,
                'new_account_code' => $account->code,
            ]);
        });

        return $this->describeRole($roleKey);
    }

    /**
     * "إعادة الضبط" تكتب صراحةً حساب الدور الافتراضي (بالكود القديم) كتعيين
     * جديد — لا حذف للصف ولا اعتماد على مسار fallback عند القراءة. تُبقي
     * الدور دائماً معيَّناً صراحةً، ولا تعني تعطيل الترحيل مهما كان السياق.
     *
     * @return array<string, mixed> شكل صفّ الدور نفسه المُعاد من `list()`.
     */
    public function reset(string $roleKey, ?User $actor): array
    {
        $this->assertConfigurableRole($roleKey);

        $code = AccountingRoles::legacyCodeFor($roleKey);
        $defaultAccount = Account::query()->where('code', $code)->first();

        if ($defaultAccount === null) {
            throw new RuntimeException("تعذّرت إعادة ضبط الدور «{$roleKey}»: الحساب الافتراضي بالكود {$code} غير موجود.");
        }
        if (! $defaultAccount->is_active || $defaultAccount->is_group) {
            throw new RuntimeException("تعذّرت إعادة ضبط الدور «{$roleKey}»: الحساب الافتراضي بالكود {$code} غير صالح للترحيل حالياً.");
        }

        DB::transaction(function () use ($roleKey, $defaultAccount, $actor) {
            $this->lockActiveTenant();

            // الافتراضي النظامي يستوفي قواعد النوع والنظافة دائماً؛ يُفحص التعارض وحده (دور آخر يشغله).
            $this->vatIntegrity->assertMappingAllowed($roleKey, $defaultAccount);

            $previous = AccountRoleMapping::query()->where('role_key', $roleKey)->first();
            $previousAccount = $previous === null ? null : Account::query()->whereKey($previous->account_id)->first();

            AccountRoleMapping::query()->updateOrCreate(
                ['role_key' => $roleKey],
                ['account_id' => $defaultAccount->id],
            );

            AccountRoleMappingEvent::create([
                'role_key' => $roleKey,
                'action' => 'mapping_reset',
                'actor_user_id' => $actor?->id,
                'previous_account_id' => $previous?->account_id,
                'previous_account_code' => $previousAccount?->code,
                'new_account_id' => $defaultAccount->id,
                'new_account_code' => $defaultAccount->code,
            ]);
        });

        return $this->describeRole($roleKey);
    }

    /** @return array<string, mixed> */
    private function describeRole(string $roleKey): array
    {
        $mapping = AccountRoleMapping::query()->where('role_key', $roleKey)->first();

        return $this->describeRoleFromMapping($roleKey, $mapping, $this->vatIntegrity->violationsByRole()[$roleKey] ?? []);
    }

    /**
     * @param  list<array{code:string,message:string}>  $violations
     * @return array<string, mixed>
     */
    private function describeRoleFromMapping(string $roleKey, ?AccountRoleMapping $mapping, array $violations = []): array
    {
        $meta = AccountingRoles::find($roleKey);

        return [
            'key' => $roleKey,
            'label_ar' => $meta['label_ar'],
            'label_en' => $meta['label_en'],
            'description_ar' => $meta['description_ar'],
            'description_en' => $meta['description_en'],
            'domain' => $meta['domain'],
            'legacy_code' => $meta['legacy_code'],
            'configurable' => $meta['configurable'],
            'mapping' => $this->mappingStateFor($roleKey, $mapping, $violations),
        ];
    }

    private function assertConfigurableRole(string $roleKey): void
    {
        if (! AccountingRoles::exists($roleKey)) {
            throw new RuntimeException("دور محاسبي غير معروف: «{$roleKey}».");
        }
        if (! AccountingRoles::isConfigurable($roleKey)) {
            throw new RuntimeException("هذا الدور غير قابل للتخصيص.");
        }
    }

    /**
     * الحساب مملوكٌ للمستأجر النشط (whereKey يمرّ عبر TenantScope فلا يُرجع
     * صفاً من مستأجر آخر لمجرّد معرفة UUID)، نشطٌ، وغير تجميعي.
     */
    private function assertEligibleAccount(string $accountId): Account
    {
        $account = Account::query()->whereKey($accountId)->first();
        if ($account === null) {
            throw new RuntimeException('الحساب غير موجود.');
        }
        if (! $account->is_active) {
            throw new RuntimeException('لا يمكن تعيين حساب معطَّل.');
        }
        if ($account->is_group) {
            throw new RuntimeException('لا يمكن تعيين حساب تجميعي — اختر حساباً تفصيلياً.');
        }

        return $account;
    }

    /** يقفل صفّ المستأجر النشط لمنع سباق كتابة متزامن على نفس تعيينات الأدوار. */
    private function lockActiveTenant(): void
    {
        $tenantId = $this->tenantContext->id();
        if ($tenantId !== null) {
            Tenant::whereKey($tenantId)->lockForUpdate()->firstOrFail();
        }
    }

    /**
     * `violations` (REM-05، إضافي): مخالفات تعيين قائم لقواعد الأدوار الضريبية. لا يغيّر `state` ولا
     * يمنع الترحيل — التعيين القديم المخالف يبقى صالحاً للترحيل ويُعلَّم فقط (D-4).
     *
     * @param  list<array{code:string,message:string}>  $violations
     * @return array{state:string, account: array<string,mixed>|null, is_default: bool, violations: list<array{code:string,message:string}>}
     */
    private function mappingStateFor(string $roleKey, ?AccountRoleMapping $mapping, array $violations = []): array
    {
        if ($mapping === null) {
            return ['state' => 'unmapped', 'account' => null, 'is_default' => false, 'violations' => []];
        }

        $account = Account::query()->whereKey($mapping->account_id)->first();
        if ($account === null || ! $account->is_active || $account->is_group) {
            return [
                'state' => 'invalid',
                'account' => $account === null ? null : $this->accountSummary($account),
                'is_default' => false,
                'violations' => $violations,
            ];
        }

        return [
            'state' => 'mapped',
            'account' => $this->accountSummary($account),
            'is_default' => $account->code === AccountingRoles::legacyCodeFor($roleKey),
            'violations' => $violations,
        ];
    }

    /** @return array<string, mixed> */
    private function accountSummary(Account $account): array
    {
        return [
            'id' => $account->id,
            'code' => $account->code,
            'name' => $account->name,
            'name_en' => $account->name_en,
            'is_active' => $account->is_active,
            'is_group' => $account->is_group,
        ];
    }
}
