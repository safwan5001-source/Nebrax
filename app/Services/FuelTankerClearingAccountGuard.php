<?php

namespace App\Services;

use App\Models\Account;
use App\Models\AccountRoleMapping;
use App\Models\AccountRoleMappingEvent;
use App\Models\CashBankAccount;
use App\Support\AccountingRoles;

/**
 * TANKER-PR6B-1 — حارس الحساب الوسيط لترحيل سندات التعبئة (`tanker_issue_clearing_account_id`). **قراءة فقط**: لا يكتب ولا ينشئ حساباً ولا يقفل صفاً.
 *
 * يُرجع رمز المخالفة (أو `null` إن صلح الحساب). القواعد (قرار المالك): حساب **أصل** نشط غير تجميعي من المستأجر الحالي، **لا يساوي** حساب مخزون
 * (مجموعة حسابات مخزون الوقود: الدور ∪ الافتراضي النظامي ∪ السجل ∪ تجاوزات المحطات الحالية والسابقة) ولا نقداً/بنكاً (كيانات الخزائن + 1110/1120) ولا حساب ضريبة
 * (دورا المدخلات والمخرجات: التعيين ∪ الافتراضي النظامي ∪ السجل) ولا حساباً مخصَّصاً لأي دور محاسبي آخر (تعيين حالي أو افتراضي نظامي — فلا يختلط بالعملاء والموردين والإيراد…).
 * لا اختيار افتراضي صامت: الحارس لا يقترح ولا يبحث عن 1145.
 */
class FuelTankerClearingAccountGuard
{
    public const NOT_FOUND = 'not_found';
    public const GROUP = 'group';
    public const INACTIVE = 'inactive';
    public const NOT_ASSET = 'not_asset';
    public const INVENTORY_ACCOUNT = 'inventory_account';
    public const CASH_OR_BANK = 'cash_or_bank';
    public const TAX_ACCOUNT = 'tax_account';
    public const RESERVED_ROLE = 'reserved_role';

    /** @var list<string> */
    public const REASONS = [self::NOT_FOUND, self::GROUP, self::INACTIVE, self::NOT_ASSET, self::INVENTORY_ACCOUNT, self::CASH_OR_BANK, self::TAX_ACCOUNT, self::RESERVED_ROLE];

    /** حسابات النقد والبنك النظامية القديمة (المستندات التاريخية تظل تُرحَّل عليها). */
    private const CASH_BANK_SYSTEM_CODES = ['1110', '1120'];

    public function __construct(private FuelInventoryLedgerReconciliation $reconciliation) {}

    /** يعيد الحساب (من نطاق المستأجر الحالي) أو `null` إن لم يوجد — للعرض بعد التحقق. */
    public function find(string $accountId): ?Account
    {
        return Account::query()->whereKey($accountId)->first();
    }

    public function violation(string $accountId): ?string
    {
        $account = $this->find($accountId);
        if ($account === null) {
            return self::NOT_FOUND;
        }
        if ($account->is_group) {
            return self::GROUP;
        }
        if (! $account->is_active) {
            return self::INACTIVE;
        }
        if ($account->type !== 'asset') {
            return self::NOT_ASSET;
        }
        if (array_key_exists($account->id, $this->reconciliation->inventoryAccountSet()['accounts'])) {
            return self::INVENTORY_ACCOUNT;
        }
        if (in_array($account->id, $this->cashBankIds(), true)) {
            return self::CASH_OR_BANK;
        }
        if (in_array($account->id, $this->taxIds(), true)) {
            return self::TAX_ACCOUNT;
        }
        if (in_array($account->id, $this->roleReservedIds(), true)) {
            return self::RESERVED_ROLE;
        }

        return null;
    }

    /** @return list<string> */
    private function cashBankIds(): array
    {
        $ids = CashBankAccount::query()->pluck('account_id')->filter()->all();
        foreach (Account::query()->whereIn('code', self::CASH_BANK_SYSTEM_CODES)->pluck('id') as $id) {
            $ids[] = $id;
        }

        return array_values(array_unique(array_map('strval', $ids)));
    }

    /** @return list<string> */
    private function taxIds(): array
    {
        $roles = ['tax_input', 'tax_output'];
        $ids = AccountRoleMapping::query()->whereIn('role_key', $roles)->pluck('account_id')->all();
        foreach (AccountRoleMappingEvent::query()->whereIn('role_key', $roles)->get(['previous_account_id', 'new_account_id']) as $event) {
            $ids[] = $event->previous_account_id;
            $ids[] = $event->new_account_id;
        }
        $codes = array_values(array_filter(array_map(AccountingRoles::legacyCodeFor(...), $roles)));
        foreach (Account::query()->whereIn('code', $codes)->pluck('id') as $id) {
            $ids[] = $id;
        }

        return array_values(array_unique(array_map('strval', array_filter($ids))));
    }

    /** كل حساب معيَّن حالياً لأي دور محاسبي أو هو الافتراضي النظامي لأحد الأدوار. @return list<string> */
    private function roleReservedIds(): array
    {
        $ids = AccountRoleMapping::query()->pluck('account_id')->all();
        $codes = array_values(array_filter(array_map(AccountingRoles::legacyCodeFor(...), AccountingRoles::keys())));
        foreach (Account::query()->whereIn('code', $codes)->pluck('id') as $id) {
            $ids[] = $id;
        }

        return array_values(array_unique(array_map('strval', array_filter($ids))));
    }
}
