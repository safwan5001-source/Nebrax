<?php

use App\Models\Account;
use App\Models\AccountRoleMapping;
use App\Models\Tenant;
use App\Support\AccountingRoles;
use App\Tenancy\TenantContext;
use Illuminate\Database\Migrations\Migration;

/**
 * AWJ-PAYMENTS-HZ-01 / PAY-H3-02c (ADR-0008 D-22) — يزرع حسابَي 1171 (احتياطي لدى بوابات الدفع) و5520 (تعديلات مزوّد الدفع) وتعيين الدورين
 * `gateway_reserve` و`provider_adjustment` لكل مستأجر **موجود بالفعل**، بآلية هجرة 2026_10_28_010000 حرفياً: إضافي فقط، لا يمسّ
 * `journal_lines` ولا بيانات تاريخية، ولا يطمس تعييناً صريحاً قائماً، ويفشل بصراحة إن كان الكود محجوزاً لحساب مستأجر غير نظامي (لا انتحال).
 * المستأجر الجديد لا يحتاجها — `ChartOfAccountsSeeder` يزرع الحساب والدور معاً.
 */
return new class extends Migration
{
    private const ROLES = ['gateway_reserve', 'provider_adjustment'];

    public function up(): void
    {
        $context = app(TenantContext::class);

        foreach (Tenant::query()->orderBy('id')->get() as $tenant) {
            $context->set($tenant->id);

            $this->ensureAccount($tenant->id, '1171', '11', 'احتياطي لدى بوابات الدفع', 'Payment Gateway Reserve', 'asset');
            $this->ensureAccount($tenant->id, '5520', '55', 'تعديلات مزوّد الدفع', 'Payment Provider Adjustments', 'expense');

            foreach (self::ROLES as $roleKey) {
                if (AccountRoleMapping::query()->where('role_key', $roleKey)->exists()) {
                    continue;
                }
                $account = Account::query()->where('code', AccountingRoles::legacyCodeFor($roleKey))->first();
                if ($account !== null) {
                    AccountRoleMapping::create(['tenant_id' => $tenant->id, 'role_key' => $roleKey, 'account_id' => $account->id]);
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
            AccountRoleMapping::query()->whereIn('role_key', self::ROLES)->delete();
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
            // `is_system` حصراً هو الدليل القاطع: حسابٌ نشط غير تجميعي من النوع
            // الصحيح قد يكون مع ذلك حساب المستأجر الخاص به بالمصادفة، لا حساب
            // المقاصة الذي يفترضه هذا الدور. لا نقبل إلا الحساب الذي تولّى
            // زرعه النظام نفسه (`ChartOfAccountsSeeder`/هذه الهجرة) — أي شيء
            // آخر تعارضٌ صريح يُفشل الهجرة بدل انتحال حساب المستأجر.
            if (! $existing->is_system || $existing->is_group || $existing->type !== $type || ! $existing->is_active) {
                throw new RuntimeException(
                    "تعارض: الحساب بالكود {$code} لدى المستأجر {$tenantId} موجود مسبقاً ولا يمكن تأكيد أنه حساب ".
                    "الدور الذي زرعه النظام (تجميعي، أو معطَّل، أو من نوع مختلف، أو ليس حساباً نظامياً) — ".
                    "راجع الحساب يدوياً قبل إعادة تشغيل الهجرة."
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
