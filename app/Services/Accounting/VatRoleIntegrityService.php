<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\AccountRoleMapping;
use App\Models\AccountRoleMappingEvent;
use App\Models\CashBankAccount;
use App\Models\CashBankTransfer;
use App\Models\InventoryOpening;
use App\Models\JournalLine;
use App\Models\Payment;
use App\Models\PayrollRun;
use App\Models\StockMovement;
use App\Models\StockPermit;
use App\Models\Stocktake;
use App\Support\AccountingRoles;
use Illuminate\Support\Carbon;

/**
 * REM-05 / ACC-01 — سلامة دورَي ضريبة القيمة المضافة (`tax_input` / `tax_output`).
 *
 * **كتابة (قبل التعيين، داخل معاملة `AccountRoutingService` وبعد قفل صفّ المستأجر):**
 * `assertMappingAllowed()` يرفض الحساب غير المؤهَّل برمز سبب ثابت (⇒ HTTP 422):
 *   1. النوع: المخرجات = التزامات، المدخلات = أصول (D-1).
 *   2. الحسابان الضريبيان مختلفان، ولا يُعاد استعمال حساب دور ضريبي لآخر (D-2).
 *   3. ليس خزينة/حساباً بنكياً، وليس معيَّناً حالياً لدور آخر (D-2).
 *   4. نظيف (بلا أي سطر قيد) ما لم يكن حساباً نظامياً (1150/2120) أو سبق أن ارتبط بالدور نفسه (D-3).
 *   وأيّ دور آخر لا يُعيَّن لحسابٍ محجوزٍ للضريبة (نظامي أو في تاريخ دورٍ ضريبي).
 *
 * **قراءة (D-4/D-5):** `violationsByRole()` يُظهر مخالفات التعيينات القائمة دون تعديلها،
 * و`reportScope()` يعيد مجموعة حسابات كل دور = التعيين الحالي ∪ الحساب النظامي ∪ كل حساب
 * ورد في سجلّ تعيينات الدور، مع كشف التداخل والتلوّث. لا يكتب هذا الصنف شيئاً أبداً.
 */
class VatRoleIntegrityService
{
    /** الدور الضريبي ⇒ نوع الحساب الوحيد المسموح له. */
    public const ROLE_TYPES = ['tax_output' => 'liability', 'tax_input' => 'asset'];

    private const TYPE_LABELS_AR = [
        'asset' => 'أصول', 'liability' => 'التزامات', 'equity' => 'حقوق ملكية',
        'revenue' => 'إيرادات', 'expense' => 'مصروفات',
    ];

    /** أكواد حسابات النقد والبنك النظامية (تُعامل كنقد/بنك حتى لو لم تُربط بسجل خزينة). */
    private const CASH_BANK_SYSTEM_CODES = ['1110', '1120'];

    /**
     * مصادر قيود لا تُنتج ضريبة قيمة مضافة بطبيعتها؛ ظهور سطرٍ منها على حساب ضريبي دليلُ تلوّثٍ محتمل.
     * قائمة منع ضيّقة عمداً (لا قائمة سماح) كي لا يُتّهم مستأجرٌ سليم بسبب مصدر مشروع لم نذكره.
     */
    private const NON_VAT_SOURCE_TYPES = [
        Payment::class, PayrollRun::class, StockMovement::class, StockPermit::class,
        Stocktake::class, InventoryOpening::class, CashBankTransfer::class,
    ];

    /** @return list<string> */
    public static function vatRoleKeys(): array
    {
        return array_keys(self::ROLE_TYPES);
    }

    public static function isVatRole(string $roleKey): bool
    {
        return isset(self::ROLE_TYPES[$roleKey]);
    }

    /**
     * يرفض (VatRoleMappingException) إن كان الحساب غير مؤهَّل للدور. يُستدعى بعد قفل صفّ المستأجر
     * وداخل المعاملة نفسها، فيرى التعيينات التي أتمّتها معاملةٌ متزامنة سبقته.
     */
    public function assertMappingAllowed(string $roleKey, Account $target): void
    {
        $violations = $this->evaluate($roleKey, $target, $this->snapshot(), forWrite: true);
        if ($violations !== []) {
            throw new VatRoleMappingException($violations[0]['message'], $violations[0]['code']);
        }
    }

    /**
     * مخالفات التعيينات الحالية (بلا شرط النظافة الذي يخصّ الكتابة وحدها).
     *
     * @return array<string, list<array{code:string,message:string}>> role_key ⇒ مخالفات
     */
    public function violationsByRole(): array
    {
        $snapshot = $this->snapshot();
        $result = [];
        foreach ($snapshot['mappings'] as $roleKey => $accountId) {
            $account = $snapshot['accounts'][$accountId] ?? null;
            if ($account === null) {
                continue;
            }
            $violations = $this->evaluate((string) $roleKey, $account, $snapshot, forWrite: false);
            if ($violations !== []) {
                $result[(string) $roleKey] = $violations;
            }
        }

        return $result;
    }

    /**
     * نطاق تقرير الضريبة: حسابات كل دور (للجمع)، تحذيرات التداخل/التلوّث، وشرح مصدر كل حساب.
     * الحساب المتداخل بين الدورين يُنسب بنوعه (أصل ⇒ مدخلات، التزام ⇒ مخرجات)، وغيرهما يُستبعد؛
     * وفي الحالتين يُسجَّل تحذير فلا يُعرض الإجمالي كأنه موثَّق.
     *
     * @param  list<string>|null  $branchIds
     * @return array{
     *     input_ids: list<string>, output_ids: list<string>,
     *     accounts: array{input: list<array<string,mixed>>, output: list<array<string,mixed>>},
     *     warnings: list<array<string,mixed>>
     * }
     */
    public function reportScope(?string $from = null, ?string $to = null, ?array $branchIds = null): array
    {
        $s = $this->snapshot();
        $inputSet = array_keys($s['sets']['tax_input']);
        $outputSet = array_keys($s['sets']['tax_output']);
        $overlap = array_values(array_intersect($inputSet, $outputSet));
        $warnings = [];

        foreach ($overlap as $id) {
            $warnings[] = $this->warning('vat_role_accounts_overlap', null, $s['accounts'][$id] ?? null, $id,
                'الحساب {code} ضمن مجموعة حسابات ضريبة المدخلات والمخرجات معاً — يُنسب بنوعه ولا يُعتدّ بالإجمالي كموثَّق.');
        }

        // النسبة النهائية: المتداخل يُنسب بنوعه، وما لا يطابق أيّ نوع يُستبعد من الجمع.
        $inputIds = array_values(array_filter($inputSet, fn (string $id) => ! in_array($id, $overlap, true)
            || ($s['accounts'][$id]->type ?? null) === 'asset'));
        $outputIds = array_values(array_filter($outputSet, fn (string $id) => ! in_array($id, $overlap, true)
            || ($s['accounts'][$id]->type ?? null) === 'liability'));

        foreach (self::vatRoleKeys() as $roleKey) {
            foreach ($s['sets'][$roleKey] as $id => $sources) {
                $account = $s['accounts'][$id] ?? null;
                if ($account === null) {
                    continue;
                }
                if (! in_array($id, $overlap, true) && $account->type !== self::ROLE_TYPES[$roleKey]) {
                    $warnings[] = $this->warning('vat_account_type_mismatch', $roleKey, $account, $id,
                        'الحساب {code} نوعه «'.(self::TYPE_LABELS_AR[$account->type] ?? $account->type).'» ولا يطابق نوع دور «'.AccountingRoles::find($roleKey)['label_ar'].'».');
                }
                if (isset($s['cashBank'][$id])) {
                    $warnings[] = $this->warning('vat_account_cash_bank', $roleKey, $account, $id,
                        'الحساب {code} خزينة/حساب بنكي ضمن حسابات دور «'.AccountingRoles::find($roleKey)['label_ar'].'» — حركاته قد تتضمن مبالغ غير ضريبية.');
                }
                foreach ($s['mappings'] as $otherRole => $mappedId) {
                    if ($mappedId === $id && ! self::isVatRole((string) $otherRole)) {
                        $warnings[] = $this->warning('vat_account_mapped_to_other_role', $roleKey, $account, $id,
                            'الحساب {code} معيَّن أيضاً للدور «'.AccountingRoles::find((string) $otherRole)['label_ar'].'» — حركاته قد تتضمن مبالغ غير ضريبية.');
                    }
                }
            }
        }

        $warnings = [...$warnings, ...$this->preMappingActivityWarnings($s), ...$this->nonVatSourceWarnings($s, $from, $to, $branchIds)];

        $describe = fn (array $ids, string $roleKey) => array_map(fn (string $id) => [
            'account_id' => $id,
            'code' => $s['accounts'][$id]->code ?? null,
            'name' => $s['accounts'][$id]->name ?? null,
            'sources' => $s['sets'][$roleKey][$id] ?? [],
        ], $ids);

        return [
            'input_ids' => $inputIds,
            'output_ids' => $outputIds,
            'accounts' => [
                'input' => $describe($inputIds, 'tax_input'),
                'output' => $describe($outputIds, 'tax_output'),
            ],
            'warnings' => $warnings,
        ];
    }

    // ── قواعد الأهلية ────────────────────────────────────────────────────────

    /** @return list<array{code:string,message:string}> */
    private function evaluate(string $roleKey, Account $account, array $s, bool $forWrite): array
    {
        $code = $account->code;
        $violations = [];

        if (! self::isVatRole($roleKey)) {
            if (isset($s['reserved'][$account->id])) {
                $violations[] = [
                    'code' => 'account_reserved_for_vat',
                    'message' => "الحساب {$code} محجوز لدور ضريبة القيمة المضافة (نظامي أو سبق استعماله فيه) ولا يُعيَّن لدور آخر.",
                ];
            }

            return $violations;
        }

        $label = AccountingRoles::find($roleKey)['label_ar'];
        $required = self::ROLE_TYPES[$roleKey];
        if ($account->type !== $required) {
            $violations[] = [
                'code' => 'vat_type_mismatch',
                'message' => "حساب دور «{$label}» يجب أن يكون من نوع «".self::TYPE_LABELS_AR[$required]."» — الحساب {$code} من نوع «".(self::TYPE_LABELS_AR[$account->type] ?? $account->type).'».',
            ];
        }

        $otherRole = $roleKey === 'tax_input' ? 'tax_output' : 'tax_input';
        $otherLabel = AccountingRoles::find($otherRole)['label_ar'];
        if (($s['mappings'][$otherRole] ?? null) === $account->id) {
            $violations[] = [
                'code' => 'vat_roles_must_differ',
                'message' => "حسابا ضريبة المدخلات والمخرجات يجب أن يكونا مختلفين — الحساب {$code} معيَّن حالياً لدور «{$otherLabel}».",
            ];
        } elseif (isset($s['sets'][$otherRole][$account->id])) {
            $violations[] = [
                'code' => 'vat_account_reserved_by_other_vat_role',
                'message' => "الحساب {$code} مرتبط (نظامياً أو تاريخياً) بدور «{$otherLabel}» ولا يُعاد استعماله لدور ضريبي آخر.",
            ];
        }

        if (isset($s['cashBank'][$account->id])) {
            $violations[] = [
                'code' => 'vat_cash_bank_account',
                'message' => "لا يُقبل حساب خزينة أو بنك ({$code}) لدور ضريبي — حركاته تتضمن مبالغ غير ضريبية.",
            ];
        }

        foreach ($s['mappings'] as $mappedRole => $mappedId) {
            if ($mappedId === $account->id && $mappedRole !== $roleKey && $mappedRole !== $otherRole) {
                $violations[] = [
                    'code' => 'vat_account_in_other_role',
                    'message' => "الحساب {$code} معيَّن لدور «".AccountingRoles::find((string) $mappedRole)['label_ar'].'» — الأدوار الضريبية تتطلب حساباً مخصصاً لها.',
                ];
                break;
            }
        }

        if ($forWrite && ! isset($s['sets'][$roleKey][$account->id]) && JournalLine::query()->where('account_id', $account->id)->exists()) {
            $violations[] = [
                'code' => 'vat_account_not_clean',
                'message' => "الحساب {$code} عليه حركات مسبقة ولا يُقبل حساباً ضريبياً جديداً — اختر حساباً جديداً نظيفاً أو الحساب النظامي.",
            ];
        }

        return $violations;
    }

    // ── كشف التلوّث ──────────────────────────────────────────────────────────

    /**
     * حسابٌ ضريبي غير نظامي سبقت حركتُه ارتباطَه بالدور (أو لا أثر تدقيق لارتباطه) ⇒ رصيده قد يضمّ حركات غير ضريبية.
     *
     * @return list<array<string,mixed>>
     */
    private function preMappingActivityWarnings(array $s): array
    {
        $candidates = [];
        foreach (self::vatRoleKeys() as $roleKey) {
            foreach (array_keys($s['sets'][$roleKey]) as $id) {
                $account = $s['accounts'][$id] ?? null;
                if ($account !== null && ! $this->isSystemVatAccount($account)) {
                    $candidates[$id][] = $roleKey;
                }
            }
        }
        if ($candidates === []) {
            return [];
        }

        $firstLine = JournalLine::query()
            ->join('journal_entries as e', 'e.id', '=', 'journal_lines.journal_entry_id')
            ->whereIn('journal_lines.account_id', array_keys($candidates))
            ->selectRaw('journal_lines.account_id as account_id, MIN(e.created_at) as first_at')
            ->groupBy('journal_lines.account_id')
            ->pluck('first_at', 'account_id');

        $warnings = [];
        foreach ($candidates as $id => $roles) {
            if (! isset($firstLine[$id])) {
                continue; // لا حركة ⇒ لا تلوّث.
            }
            foreach ($roles as $roleKey) {
                $associatedAt = $s['firstAssociation'][$roleKey][$id] ?? null;
                if ($associatedAt === null) {
                    $warnings[] = $this->warning('vat_account_unaudited_history', $roleKey, $s['accounts'][$id], $id,
                        'الحساب {code} ضمن حسابات دور «'.AccountingRoles::find($roleKey)['label_ar'].'» دون أثر تدقيق لارتباطه وعليه حركات — لا يمكن إثبات أنها كلها ضريبية.');
                } elseif (Carbon::parse($firstLine[$id])->lt($associatedAt)) {
                    $warnings[] = $this->warning('vat_account_pre_mapping_activity', $roleKey, $s['accounts'][$id], $id,
                        'الحساب {code} عليه حركات سابقة لارتباطه بدور «'.AccountingRoles::find($roleKey)['label_ar'].'» — رصيده قد يضمّ مبالغ غير ضريبية.');
                }
            }
        }

        return $warnings;
    }

    /**
     * سطور على حساب ضريبي من مصادر لا تنتج ضريبة بطبيعتها، ضمن فترة التقرير وفروعه.
     *
     * @param  list<string>|null  $branchIds
     * @return list<array<string,mixed>>
     */
    private function nonVatSourceWarnings(array $s, ?string $from, ?string $to, ?array $branchIds): array
    {
        $ids = array_values(array_unique([...array_keys($s['sets']['tax_input']), ...array_keys($s['sets']['tax_output'])]));
        if ($ids === []) {
            return [];
        }

        $rows = JournalLine::query()
            ->join('journal_entries as e', 'e.id', '=', 'journal_lines.journal_entry_id')
            ->whereIn('journal_lines.account_id', $ids)
            ->whereIn('e.status', ['posted', 'reversed'])
            ->whereIn('e.source_type', self::NON_VAT_SOURCE_TYPES)
            ->when($from, fn ($q) => $q->whereDate('e.entry_date', '>=', $from))
            ->when($to, fn ($q) => $q->whereDate('e.entry_date', '<=', $to))
            ->when($branchIds, fn ($q) => $q->whereIn('journal_lines.branch_id', $branchIds))
            ->selectRaw('journal_lines.account_id as account_id, COUNT(*) as lines_count')
            ->groupBy('journal_lines.account_id')
            ->get();

        $warnings = [];
        foreach ($rows as $row) {
            $roleKey = isset($s['sets']['tax_input'][$row->account_id]) ? 'tax_input' : 'tax_output';
            $warnings[] = $this->warning('vat_account_non_vat_source', $roleKey, $s['accounts'][$row->account_id] ?? null, (string) $row->account_id,
                'على الحساب {code} حركات من مصادر لا تُنتج ضريبة قيمة مضافة (دفعات/رواتب/مخزون/تحويلات) ضمن الفترة — الإجمالي غير موثَّق.');
        }

        return $warnings;
    }

    // ── مساعدات ──────────────────────────────────────────────────────────────

    private function isSystemVatAccount(Account $account): bool
    {
        return $account->is_system
            && in_array($account->code, array_map(AccountingRoles::legacyCodeFor(...), self::vatRoleKeys()), true);
    }

    /** @return array<string,mixed> */
    private function warning(string $code, ?string $roleKey, ?Account $account, string $accountId, string $template): array
    {
        $accountCode = $account?->code;

        return [
            'code' => $code,
            'role_key' => $roleKey,
            'account_id' => $accountId,
            'account_code' => $accountCode,
            'message' => str_replace('{code}', (string) $accountCode, $template),
        ];
    }

    /**
     * لقطة مقروءة مرة واحدة: التعيينات الحالية، مجموعة حسابات كل دور ضريبي (مع مصدر العضوية)،
     * أول ارتباط لكل حساب بدوره، حسابات النقد/البنك، والحسابات المحجوزة للضريبة.
     * كل الاستعلامات عبر نماذج تحمل TenantScope — لا قراءة عابرة للمستأجر.
     *
     * @return array{
     *     mappings: array<string,string>, sets: array<string, array<string, list<string>>>,
     *     firstAssociation: array<string, array<string, Carbon>>, accounts: array<string, Account>,
     *     cashBank: array<string,true>, reserved: array<string,true>
     * }
     */
    private function snapshot(): array
    {
        $vatRoles = self::vatRoleKeys();
        $mappings = AccountRoleMapping::query()->pluck('account_id', 'role_key')->all();
        $events = AccountRoleMappingEvent::query()
            ->whereIn('role_key', $vatRoles)
            ->get(['role_key', 'previous_account_id', 'new_account_id', 'created_at']);
        $defaults = Account::query()
            ->whereIn('code', array_map(AccountingRoles::legacyCodeFor(...), $vatRoles))
            ->get()->keyBy('code');

        $sets = [];
        $firstAssociation = [];
        foreach ($vatRoles as $roleKey) {
            $sets[$roleKey] = [];
            $add = function (?string $id, string $source) use (&$sets, $roleKey): void {
                if ($id !== null && ! in_array($source, $sets[$roleKey][$id] ?? [], true)) {
                    $sets[$roleKey][$id][] = $source;
                }
            };
            $add($mappings[$roleKey] ?? null, 'current');
            $add($defaults->get(AccountingRoles::legacyCodeFor($roleKey))?->id, 'system_default');
            foreach ($events->where('role_key', $roleKey) as $event) {
                $add($event->previous_account_id, 'history');
                $add($event->new_account_id, 'history');
                if ($event->new_account_id !== null) {
                    $first = $firstAssociation[$roleKey][$event->new_account_id] ?? null;
                    if ($first === null || $event->created_at->lt($first)) {
                        $firstAssociation[$roleKey][$event->new_account_id] = $event->created_at;
                    }
                }
            }
        }

        $accountIds = array_values(array_unique([
            ...array_values($mappings),
            ...array_keys($sets['tax_input']),
            ...array_keys($sets['tax_output']),
        ]));
        $accounts = Account::query()->whereIn('id', $accountIds)->get()->keyBy('id')->all();

        $cashBank = array_fill_keys(CashBankAccount::query()->pluck('account_id')->filter()->all(), true);
        foreach (Account::query()->whereIn('code', self::CASH_BANK_SYSTEM_CODES)->pluck('id') as $id) {
            $cashBank[$id] = true;
        }

        return [
            'mappings' => $mappings,
            'sets' => $sets,
            'firstAssociation' => $firstAssociation,
            'accounts' => $accounts,
            'cashBank' => $cashBank,
            'reserved' => array_fill_keys([...array_keys($sets['tax_input']), ...array_keys($sets['tax_output'])], true),
        ];
    }
}
