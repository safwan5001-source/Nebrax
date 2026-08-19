<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\AccountBalance;
use App\Models\Branch;
use App\Models\CashBankAccount;
use App\Models\User;
use App\Support\Rbac;
use App\Tenancy\BranchContext;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * يدير تعريفات الخزائن والبنوك وربطها بدليل الحسابات.
 * لا يكتب قيوداً؛ التحويل وحده يولّد القيد عبر CashBankTransferService.
 */
class CashBankAccountService
{
    private const TYPES = ['cash', 'bank'];
    private const SCOPES = ['all', 'role', 'user', 'branch'];

    /** يربط الحسابين النظاميين التاريخيين بالوحدة، ويعمل بأمان عند التكرار. */
    public function bootstrapDefaults(): void
    {
        DB::transaction(function () {
            foreach ([
                ['code' => '1110', 'type' => 'cash', 'name' => 'الخزينة الافتراضية'],
                ['code' => '1120', 'type' => 'bank', 'name' => 'الحساب البنكي الافتراضي'],
            ] as $default) {
                $account = Account::where('code', $default['code'])->lockForUpdate()->first();
                if (! $account || CashBankAccount::where('account_id', $account->id)->exists()) {
                    continue;
                }

                CashBankAccount::create([
                    'account_id' => $account->id,
                    'type' => $default['type'],
                    'name' => $default['name'],
                    'currency' => $account->currency,
                    'is_active' => $account->is_active,
                    'is_main' => ! CashBankAccount::where('type', $default['type'])->where('is_main', true)->exists(),
                    'deposit_scope' => 'all',
                    'withdraw_scope' => 'all',
                ]);
            }
        });
    }

    public function create(array $data, ?User $actor = null): CashBankAccount
    {
        $type = $data['type'];
        $this->assertType($type);
        $this->assertBankFields($data, $type);
        $this->assertScopeReference($data['deposit_scope'] ?? 'all', $data['deposit_scope_subject'] ?? null);
        $this->assertScopeReference($data['withdraw_scope'] ?? 'all', $data['withdraw_scope_subject'] ?? null);

        return DB::transaction(function () use ($data, $type, $actor) {
            $parent = $this->parentFor($type);
            $account = Account::create([
                'parent_id' => $parent->id,
                'code' => $this->nextAccountCode($type),
                'name' => $data['name'],
                'name_en' => $data['name_en'] ?? null,
                'type' => 'asset',
                'normal_balance' => 'debit',
                'is_group' => false,
                'is_system' => false,
                'currency' => $data['currency'] ?? 'SAR',
                'is_active' => $data['is_active'] ?? true,
            ]);

            AccountBalance::firstOrCreate(
                ['account_id' => $account->id],
                ['balance' => 0, 'total_debit' => 0, 'total_credit' => 0]
            );

            $entity = CashBankAccount::create([
                'account_id' => $account->id,
                'type' => $type,
                'name' => $data['name'],
                'bank_name' => $data['bank_name'] ?? null,
                'account_number' => $data['account_number'] ?? null,
                'currency' => $data['currency'] ?? 'SAR',
                'description' => $data['description'] ?? null,
                'is_active' => $data['is_active'] ?? true,
                'is_main' => ! CashBankAccount::where('type', $type)->where('is_main', true)->exists(),
                'deposit_scope' => $data['deposit_scope'] ?? 'all',
                'deposit_scope_subject' => $data['deposit_scope_subject'] ?? null,
                'withdraw_scope' => $data['withdraw_scope'] ?? 'all',
                'withdraw_scope_subject' => $data['withdraw_scope_subject'] ?? null,
                'created_by' => $actor?->id,
            ]);

            return $entity->load('account.balance');
        });
    }

    public function update(CashBankAccount $entity, array $data): CashBankAccount
    {
        $this->assertBankFields($data, $entity->type);
        $depositScope = $data['deposit_scope'] ?? $entity->deposit_scope;
        $depositSubject = array_key_exists('deposit_scope_subject', $data)
            ? $data['deposit_scope_subject']
            : ($depositScope === 'all' ? null : $entity->deposit_scope_subject);
        $withdrawScope = $data['withdraw_scope'] ?? $entity->withdraw_scope;
        $withdrawSubject = array_key_exists('withdraw_scope_subject', $data)
            ? $data['withdraw_scope_subject']
            : ($withdrawScope === 'all' ? null : $entity->withdraw_scope_subject);
        $this->assertScopeReference($depositScope, $depositSubject);
        $this->assertScopeReference($withdrawScope, $withdrawSubject);

        return DB::transaction(function () use ($entity, $data, $depositScope, $depositSubject, $withdrawScope, $withdrawSubject) {
            $account = $entity->account()->lockForUpdate()->firstOrFail();
            $entity = CashBankAccount::lockForUpdate()->findOrFail($entity->id);

            if ($account->lines()->exists() && array_key_exists('currency', $data) && $data['currency'] !== $entity->currency) {
                throw new RuntimeException('لا يمكن تغيير عملة خزينة أو حساب بنكي له حركات. أنشئ حساباً جديداً للعملة المطلوبة.');
            }

            $active = array_key_exists('is_active', $data) ? (bool) $data['is_active'] : $entity->is_active;
            if (! $active) {
                $this->assertCanDeactivate($entity);
                if ($entity->is_main) {
                    // لا يبقى النوع بلا افتراضي: ننقل الرئيسي قبل تعطيل المصدر.
                    $replacement = CashBankAccount::where('type', $entity->type)
                        ->where('is_active', true)->where('id', '!=', $entity->id)
                        ->orderBy('created_at')->lockForUpdate()->firstOrFail();
                    $entity->forceFill(['is_main' => false])->save();
                    $replacement->forceFill(['is_main' => true])->save();
                }
            }

            if ($account->is_system && array_key_exists('currency', $data) && $data['currency'] !== $account->currency) {
                throw new RuntimeException('لا يمكن تغيير عملة حساب نظامي. أنشئ خزينة أو حساباً بنكياً جديداً للعملة المطلوبة.');
            }
            if (! $account->is_system) {
                $account->update([
                    'name' => $data['name'],
                    'name_en' => $data['name_en'] ?? $account->name_en,
                    'currency' => $data['currency'] ?? $account->currency,
                    'is_active' => $active,
                ]);
            }

            $entity->update([
                'name' => $data['name'],
                'bank_name' => $data['bank_name'] ?? null,
                'account_number' => $data['account_number'] ?? null,
                'currency' => $data['currency'] ?? $entity->currency,
                'description' => $data['description'] ?? null,
                'is_active' => $active,
                'deposit_scope' => $depositScope,
                'deposit_scope_subject' => $depositSubject,
                'withdraw_scope' => $withdrawScope,
                'withdraw_scope_subject' => $withdrawSubject,
            ]);

            return $entity->fresh()->load('account.balance');
        });
    }

    public function makeMain(CashBankAccount $entity): CashBankAccount
    {
        if (! $entity->is_active) {
            throw new RuntimeException('لا يمكن تعيين خزينة أو حساب بنكي معطّل رئيسياً.');
        }

        return DB::transaction(function () use ($entity) {
            CashBankAccount::where('type', $entity->type)->where('id', '!=', $entity->id)->where('is_main', true)->update(['is_main' => false]);
            $entity->forceFill(['is_main' => true])->save();
            return $entity->fresh()->load('account.balance');
        });
    }

    public function deactivate(CashBankAccount $entity): CashBankAccount
    {
        return $this->update($entity, [
            'name' => $entity->name,
            'bank_name' => $entity->bank_name,
            'account_number' => $entity->account_number,
            'currency' => $entity->currency,
            'description' => $entity->description,
            'is_active' => false,
            'deposit_scope' => $entity->deposit_scope,
            'deposit_scope_subject' => $entity->deposit_scope_subject,
            'withdraw_scope' => $entity->withdraw_scope,
            'withdraw_scope_subject' => $entity->withdraw_scope_subject,
        ]);
    }

    public function delete(CashBankAccount $entity): void
    {
        DB::transaction(function () use ($entity) {
            $entity = CashBankAccount::with('account')->lockForUpdate()->findOrFail($entity->id);
            $account = $entity->account;

            if ($entity->is_main) {
                throw new RuntimeException('لا يمكن حذف الخزينة أو الحساب البنكي الرئيسي. عيّن بديلاً رئيسياً أولاً.');
            }
            if ($account->is_system || $account->lines()->exists() || $entity->outgoingTransfers()->exists() || $entity->incomingTransfers()->exists()) {
                throw new RuntimeException('لا يمكن حذف خزينة أو حساب بنكي له حركات أو مرتبط بحساب نظامي. عطّله بدلاً من ذلك.');
            }

            $entity->delete();
            $account->delete();
        });
    }

    public function resolveForPayment(?string $accountId, string $method): CashBankAccount
    {
        // اختبارات النواة وبعض الشركات القديمة تزرع الدليل مباشرة؛ التهيئة idempotent.
        $this->bootstrapDefaults();
        $type = $method === 'bank' ? 'bank' : 'cash';
        $entity = $accountId
            ? CashBankAccount::where('account_id', $accountId)->first()
            : CashBankAccount::where('type', $type)->where('is_main', true)->first();

        if (! $entity || $entity->type !== $type) {
            throw new RuntimeException('الخزينة أو الحساب البنكي المختار غير صالح لطريقة السند.');
        }
        if (! $entity->is_active || ! $entity->account()->where('is_active', true)->exists()) {
            throw new RuntimeException('الخزينة أو الحساب البنكي المختار معطّل.');
        }

        return $entity->load('account');
    }

    public function assertAllowed(CashBankAccount $entity, string $action, ?User $user): void
    {
        $branchId = app(BranchContext::class)->id();
        if (! $entity->allows($action, $user, $branchId)) {
            $label = $action === 'deposit' ? 'الإيداع' : 'السحب';
            throw new RuntimeException("لا تملك صلاحية {$label} في هذه الخزينة أو الحساب البنكي.");
        }
    }

    private function assertCanDeactivate(CashBankAccount $entity): void
    {
        if ($entity->is_main && ! CashBankAccount::where('type', $entity->type)->where('is_active', true)->where('id', '!=', $entity->id)->exists()) {
            throw new RuntimeException('لا يمكن تعطيل الحساب الرئيسي الوحيد من هذا النوع. أضف حساباً نشطاً بديلاً أولاً.');
        }
    }

    private function parentFor(string $type): Account
    {
        return Account::where('code', $type === 'cash' ? '111' : '112')->firstOrFail();
    }

    private function nextAccountCode(string $type): string
    {
        $prefix = $type === 'cash' ? '111' : '112';
        $parent = $this->parentFor($type);
        Account::whereKey($parent->id)->lockForUpdate()->first();

        $codes = Account::where('parent_id', $parent->id)->pluck('code');
        $next = $codes->map(fn (string $code) => (int) substr($code, strlen($prefix)))->max() ?? 0;
        return $prefix . ($next + 1);
    }

    private function assertType(string $type): void
    {
        if (! in_array($type, self::TYPES, true)) {
            throw new RuntimeException('نوع الحساب يجب أن يكون خزينة أو حساباً بنكياً.');
        }
    }

    private function assertBankFields(array $data, string $type): void
    {
        if ($type === 'bank' && (empty($data['bank_name']) || empty($data['account_number']))) {
            throw new RuntimeException('اسم البنك ورقم الحساب البنكي مطلوبان للحساب البنكي.');
        }
    }

    private function assertScopeReference(string $scope, ?string $subject): void
    {
        if (! in_array($scope, self::SCOPES, true)) {
            throw new RuntimeException('نطاق الصلاحية غير صالح.');
        }
        if ($scope === 'all' && $subject !== null) {
            throw new RuntimeException('نطاق الكل لا يقبل مرجع صلاحية إضافياً.');
        }
        if ($scope !== 'all' && empty($subject)) {
            throw new RuntimeException('نطاق الصلاحية المحدد يحتاج دوراً أو مستخدماً أو فرعاً.');
        }
        if ($scope === 'role' && ! array_key_exists((string) $subject, Rbac::MATRIX)) {
            throw new RuntimeException('الدور المحدد للصلاحية غير موجود.');
        }
        if ($scope === 'user' && ! User::whereKey($subject)->exists()) {
            throw new RuntimeException('المستخدم المحدد للصلاحية غير موجود في هذه المؤسسة.');
        }
        if ($scope === 'branch' && ! Branch::whereKey($subject)->exists()) {
            throw new RuntimeException('الفرع المحدد للصلاحية غير موجود في هذه المؤسسة.');
        }
    }
}
