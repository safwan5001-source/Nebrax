<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\AccountRoleMapping;
use App\Models\AccountRoleMappingEvent;
use App\Models\CashBankAccount;
use App\Models\FiscalYear;
use App\Models\JournalLine;
use App\Support\AccountingRoles;
use Illuminate\Database\Eloquent\Builder;

/**
 * ═══════════════════════════════════════════════════════════════
 *  ArApControlBalanceService — رصيد حسابات العملاء والموردين «كما في تاريخ» (FC-4)
 * ═══════════════════════════════════════════════════════════════
 *  قراءة فقط. لا يكتب ولا يعيد تصنيف قيداً ولا يمسّ ترحيلاً أو تسوية.
 *
 *  ═══ ما يحسبه — وما لا يحسبه ═══
 *  أربعة مفاهيم **ليست متكافئة** ولا يخلط هذا الصنف بينها:
 *   ① رصيد حساب (حسابات) الأستاذ الإجمالي للدور  ← **هذا ما يحسبه هذا الصنف وحده**.
 *   ② رصيد دفتر الطرف (العميل/المورد) = السطور الموسومة بطرف على أي حساب (`partnerStatement`).
 *   ③ المستندات غير المسدَّدة (فواتير/مشتريات) = `total − paid_amount` الآن (`aging`).
 *   ④ مركز ذمم «مطابَق وموثَّق» ← **غير موجود اليوم**، ولا يدّعيه هذا الصنف.
 *  مطابقة رقم ① مع الميزانية فحصُ اتساق دفتريّ داخلي فقط، لا مطابقة تجارية.
 *
 *  ═══ الأساس ═══
 *   • مجموعة حسابات كل دور = التعيين الحالي ∪ الحساب النظامي (1130/2110) ∪ كل حساب ورد في سجلّ تعيينات الدور
 *     (`account_role_mapping_events`). السبب واقعي: مسارات ترحيل كثيرة ما زالت تكتب على 1130/2110 مباشرةً
 *     (مرتجع المبيعات، الإشعارات، الأرصدة الافتتاحية…) فبعد أي إعادة تعيين يتوزّع رصيد الدور على أكثر من حساب.
 *   • تراكمي: `journal_entries.entry_date <= $asOf` بلا حدّ أدنى، قيود `posted` و`reversed` (الأصل والعاكس
 *     يتعادلان)، والمسودات خارج الدفتر أصلاً.
 *   • مؤسسيّ: كل الفروع بما فيها القيود بلا فرع. مقيَّد بالمستأجر عبر نطاق `JournalLine`.
 *   • الإشارة تتبع **الدور** لا طبيعة الحساب: عملاء = مدين − دائن، موردون = دائن − مدين.
 *
 *  ═══ التداخل ═══
 *  حسابٌ في مجموعتَي العملاء والموردين معاً يُنسب بنوعه (أصل ⇒ عملاء، التزام ⇒ موردون، وغيرهما يُستبعد من
 *  الطرفين) فلا يُعدّ مرتين — **ويُنتج دائماً «غير موثَّق»** ولو كان رصيده صفراً أو نوعه يسمح بنسبة قطعية:
 *  وجوده في المجموعتين دليلُ تعيينٍ خاطئ، والرقم المعروض نتيجةُ ترجيحٍ لا قراءةٌ.
 *
 *  ═══ ما يُفصح عنه ولا يُصنَّف خطأً ═══
 *   • الأرصدة المعاكسة (عميل دائن / مورد مدين): على مستوى الحساب وعلى مستوى الطرف (السطور الموسومة)،
 *     بلا إعادة تصنيف ولا أثر على التوثيق.
 *   • السطور بلا معرّف طرف على حسابات الدور: إفصاح منفصل (`untagged`)، لأن القيد اليدوي والتسوية مشروعان.
 *     لا يغيّر حالة التوثيق.
 *
 *  ═══ حدود التوثيق (`not_checked`) ═══
 *  «موثَّق» هنا = اجتياز فحوص سلامة حسابات الدور المعلنة في `checks` فقط.
 */
class ArApControlBalanceService
{
    public const ROLE_RECEIVABLE = 'accounts_receivable';
    public const ROLE_PAYABLE = 'accounts_payable';

    /** الدور ⇒ نوع الحساب المتوقَّع له. */
    private const ROLE_TYPES = [
        self::ROLE_RECEIVABLE => 'asset',
        self::ROLE_PAYABLE => 'liability',
    ];

    private const TYPE_LABELS_AR = [
        'asset' => 'أصول', 'liability' => 'التزامات', 'equity' => 'حقوق ملكية',
        'revenue' => 'إيرادات', 'expense' => 'مصروفات',
    ];

    /** أكواد حسابات النقد والبنك النظامية (تُعامل كنقد/بنك حتى لو لم تُربط بسجل خزينة). */
    private const CASH_BANK_SYSTEM_CODES = ['1110', '1120'];

    /** كواشف السلامة التي تحدّد حالة التوثيق، بترتيب ثابت. */
    private const DETECTORS = [
        'ar_ap_role_accounts_overlap', 'ar_ap_account_type_mismatch',
        'ar_ap_account_cash_bank', 'ar_ap_account_in_other_role',
    ];

    /** إفصاحات لا تغيّر حالة التوثيق (تظهر في `checks` بنتيجة `info`). */
    private const DISCLOSURE_CHECKS = ['ar_ap_untagged_lines', 'ar_ap_opposite_sign'];

    /** ما لا يغطّيه «التوثيق» عمداً — يُعلن في كل استجابة كي لا يُقرأ كمطابقة أو كمركز ذمم موثَّق. */
    private const NOT_CHECKED = [
        'partner_subledger_reconciliation',   // ② رصيد دفتر الطرف مقابل رصيد الأستاذ
        'open_documents_reconciliation',      // ③ الفواتير/المشتريات غير المسدَّدة مقابل الأستاذ
        'aging_report_agreement',             // أعمار الديون تستعمل حالة المستند الآن لا «كما في التاريخ»
        'manual_journal_content',             // محتوى القيود اليدوية ونسبتها للطرف
        'pre_mapping_activity',               // نشاط على حساب سابق لتعيينه للدور
        'direct_database_changes',            // تعديل مباشر لا يمرّ بسجل تعيينات الأدوار
    ];

    /** @return list<string> */
    public static function roleKeys(): array
    {
        return array_keys(self::ROLE_TYPES);
    }

    /**
     * @return array{
     *     as_of: string,
     *     roles: array<string, array<string,mixed>>,
     *     warnings: list<array<string,mixed>>,
     *     verification: array<string,mixed>,
     *     history: ?array<string,mixed>
     * }
     */
    public function balancesAsOf(string $asOf, ?FiscalYear $year = null): array
    {
        $s = $this->snapshot();
        $ids = array_keys($s['accounts']);

        $nets = $this->netsByAccount($asOf, $ids);

        // ── نسبة الحسابات إلى الأدوار (تداخل ⇒ بالنوع).
        $overlap = array_values(array_intersect(array_keys($s['sets'][self::ROLE_RECEIVABLE]), array_keys($s['sets'][self::ROLE_PAYABLE])));
        $counted = [self::ROLE_RECEIVABLE => [], self::ROLE_PAYABLE => []];
        $excludedFromBoth = [];
        foreach (self::roleKeys() as $roleKey) {
            foreach (array_keys($s['sets'][$roleKey]) as $id) {
                if (! in_array($id, $overlap, true)) {
                    $counted[$roleKey][$id] = true;
                    continue;
                }
                $type = $s['accounts'][$id]->type;
                if ($type === self::ROLE_TYPES[$roleKey]) {
                    $counted[$roleKey][$id] = true;
                } elseif (! in_array($type, ['asset', 'liability'], true)) {
                    $excludedFromBoth[$id] = true;   // لا نسبة قطعية: يُستبعد من الطرفين
                }
            }
        }

        $signed = fn (string $roleKey, string $id): int => $roleKey === self::ROLE_RECEIVABLE
            ? ($nets[$id]['d'] ?? 0) - ($nets[$id]['c'] ?? 0)
            : ($nets[$id]['c'] ?? 0) - ($nets[$id]['d'] ?? 0);

        $warnings = $this->warnings($s, $overlap, $counted, $excludedFromBoth);
        $classified = $this->verification($warnings, array_keys($nets));

        $roles = [];
        foreach (self::roleKeys() as $roleKey) {
            $mappedId = $s['mappings'][$roleKey] ?? null;
            $mapped = $mappedId !== null ? ($s['accounts'][$mappedId] ?? $s['mappedAccounts'][$mappedId] ?? null) : null;

            $accounts = [];
            foreach ($s['sets'][$roleKey] as $id => $sources) {
                $account = $s['accounts'][$id];
                $accounts[] = [
                    'account_id' => $id,
                    'code' => $account->code,
                    'name' => $account->name,
                    'type' => $account->type,
                    'is_active' => (bool) $account->is_active,
                    'is_group' => (bool) $account->is_group,
                    'sources' => $sources,
                    'counted' => isset($counted[$roleKey][$id]),
                    'balance' => $signed($roleKey, $id),
                ];
            }
            usort($accounts, fn (array $a, array $b) => strcmp((string) $a['code'], (string) $b['code']));   // ترتيب ثابت بالكود

            $countedIds = array_keys($counted[$roleKey]);
            $roles[$roleKey] = [
                'balance' => (int) array_sum(array_map(fn (string $id) => $signed($roleKey, $id), $countedIds)),
                'mapping_state' => match (true) {
                    $mappedId === null => 'unmapped',
                    $mapped === null => 'missing',
                    ! $mapped->is_active => 'inactive',
                    (bool) $mapped->is_group => 'group',
                    default => 'resolved',
                },
                'accounts' => $accounts,
                'current_account' => $mapped === null ? null : [
                    'account_id' => $mapped->id,
                    'code' => $mapped->code,
                    'name' => $mapped->name,
                    'balance' => $signed($roleKey, $mapped->id),
                ],
                'untagged' => $this->untagged($roleKey, $countedIds, $asOf),
                'opposite_sign' => $this->oppositeSign($roleKey, $accounts, $countedIds, $asOf),
            ];
        }

        return [
            'as_of' => $asOf,
            'roles' => $roles,
            'warnings' => $classified['warnings'],
            'verification' => $this->withDisclosureChecks($classified['verification'], $roles),
            'history' => $year === null ? null : $this->history($year, array_keys($counted[self::ROLE_RECEIVABLE] + $counted[self::ROLE_PAYABLE])),
        ];
    }

    // ── اللقطة ───────────────────────────────────────────────────────────────

    /**
     * @return array{
     *     mappings: array<string,string>, sets: array<string, array<string, list<string>>>,
     *     accounts: array<string, Account>, mappedAccounts: array<string, Account>,
     *     cashBank: array<string,bool>, otherRoles: array<string, list<string>>
     * }
     */
    private function snapshot(): array
    {
        $roleKeys = self::roleKeys();
        $mappings = AccountRoleMapping::query()->pluck('account_id', 'role_key')->all();
        $events = AccountRoleMappingEvent::query()->get(['role_key', 'previous_account_id', 'new_account_id']);

        $vatRoles = VatRoleIntegrityService::vatRoleKeys();
        $defaultCodes = array_map(AccountingRoles::legacyCodeFor(...), [...$roleKeys, ...$vatRoles]);
        $defaults = Account::query()->whereIn('code', $defaultCodes)->get()->keyBy('code');

        $sets = [];
        foreach ($roleKeys as $roleKey) {
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
            }
        }

        // حسابات تخدم دوراً آخر غير العملاء/الموردين: التعيين الحالي + سجلّ التعيينات، ولأدوار الضريبة الحساب النظامي أيضاً.
        $otherRoles = [];
        $mark = function (?string $id, string $roleKey) use (&$otherRoles): void {
            if ($id !== null && ! in_array($roleKey, $otherRoles[$id] ?? [], true)) {
                $otherRoles[$id][] = $roleKey;
            }
        };
        foreach ($mappings as $roleKey => $accountId) {
            if (! in_array($roleKey, $roleKeys, true)) {
                $mark($accountId, (string) $roleKey);
            }
        }
        foreach ($events as $event) {
            if (! in_array($event->role_key, $roleKeys, true)) {
                $mark($event->previous_account_id, (string) $event->role_key);
                $mark($event->new_account_id, (string) $event->role_key);
            }
        }
        foreach ($vatRoles as $vatRole) {
            $mark($defaults->get(AccountingRoles::legacyCodeFor($vatRole))?->id, $vatRole);
        }

        $setIds = array_values(array_unique([...array_keys($sets[self::ROLE_RECEIVABLE]), ...array_keys($sets[self::ROLE_PAYABLE])]));
        $accounts = Account::query()->whereIn('id', $setIds)->get()->keyBy('id')->all();

        // حساب معيَّن لا يوجد (محذوف): يخرج من المجموعة فلا سطور له، ويُعرض الدور بحالة «missing».
        foreach ($roleKeys as $roleKey) {
            $sets[$roleKey] = array_intersect_key($sets[$roleKey], $accounts);
        }

        $mappedIds = array_values(array_filter(array_map(fn (string $r) => $mappings[$r] ?? null, $roleKeys)));
        $mappedAccounts = Account::query()->whereIn('id', $mappedIds)->get()->keyBy('id')->all();

        $cashBank = array_fill_keys(CashBankAccount::query()->pluck('account_id')->filter()->all(), true);
        foreach (Account::query()->whereIn('code', self::CASH_BANK_SYSTEM_CODES)->pluck('id') as $id) {
            $cashBank[$id] = true;
        }

        return [
            'mappings' => $mappings,
            'sets' => $sets,
            'accounts' => $accounts,
            'mappedAccounts' => $mappedAccounts,
            'cashBank' => $cashBank,
            'otherRoles' => $otherRoles,
        ];
    }

    /** @return Builder<JournalLine> */
    private function lines(string $asOf): Builder
    {
        return JournalLine::query()
            ->join('journal_entries as e', 'e.id', '=', 'journal_lines.journal_entry_id')
            ->whereIn('e.status', ['posted', 'reversed'])
            ->whereDate('e.entry_date', '<=', $asOf);
    }

    /**
     * @param  list<string>  $accountIds
     * @return array<string, array{d:int, c:int}>
     */
    private function netsByAccount(string $asOf, array $accountIds): array
    {
        if ($accountIds === []) {
            return [];
        }

        return $this->lines($asOf)
            ->whereIn('journal_lines.account_id', $accountIds)
            ->selectRaw('journal_lines.account_id as account_id, SUM(journal_lines.debit) as d, SUM(journal_lines.credit) as c')
            ->groupBy('journal_lines.account_id')
            ->get()
            ->mapWithKeys(fn ($row) => [(string) $row->account_id => ['d' => (int) $row->d, 'c' => (int) $row->c]])
            ->all();
    }

    // ── التحذيرات والتوثيق ────────────────────────────────────────────────────

    /**
     * @param  list<string>  $overlap
     * @param  array<string, array<string,bool>>  $counted
     * @param  array<string,bool>  $excludedFromBoth
     * @return list<array<string,mixed>>
     */
    private function warnings(array $s, array $overlap, array $counted, array $excludedFromBoth): array
    {
        $warnings = [];
        $label = fn (string $roleKey): string => AccountingRoles::find($roleKey)['label_ar'];
        $ids = array_keys($s['accounts']);
        sort($ids);

        foreach ($ids as $id) {
            $account = $s['accounts'][$id];
            $code = $account->code;
            $rolesOfAccount = array_values(array_filter(self::roleKeys(), fn (string $r) => isset($s['sets'][$r][$id])));
            $base = ['account_id' => $id, 'account_code' => $code, 'account_name' => $account->name, 'roles' => $rolesOfAccount];

            if (in_array($id, $overlap, true)) {
                $assigned = match (true) {
                    isset($counted[self::ROLE_RECEIVABLE][$id]) => 'يُحتسب ضمن «'.$label(self::ROLE_RECEIVABLE).'» بنوعه',
                    isset($counted[self::ROLE_PAYABLE][$id]) => 'يُحتسب ضمن «'.$label(self::ROLE_PAYABLE).'» بنوعه',
                    default => 'نوعه ('.(self::TYPE_LABELS_AR[$account->type] ?? $account->type).') لا يسمح بنسبة قطعية فيُستبعد من الطرفين',
                };
                $warnings[] = [...$base, 'code' => 'ar_ap_role_accounts_overlap',
                    'message' => "الحساب {$code} ضمن مجموعتَي حسابات العملاء والموردين معاً — {$assigned} لئلا يُعدّ مرتين. وجوده في المجموعتين تعيينٌ خاطئ، والرقم المعروض ترجيحٌ لا قراءة قطعية."];
            }

            foreach (self::roleKeys() as $roleKey) {
                if (! isset($s['sets'][$roleKey][$id])) {
                    continue;
                }
                if (! isset($counted[$roleKey][$id]) && ! isset($excludedFromBoth[$id])) {
                    continue;   // تداخل نُسب إلى الدور الآخر: التحذير الأصلي هو التداخل
                }
                $required = self::ROLE_TYPES[$roleKey];
                if ($account->type !== $required) {
                    $warnings[] = [...$base, 'roles' => [$roleKey], 'code' => 'ar_ap_account_type_mismatch',
                        'message' => "حساب دور «{$label($roleKey)}» المتوقَّع من نوع «".self::TYPE_LABELS_AR[$required]."» — الحساب {$code} من نوع «".(self::TYPE_LABELS_AR[$account->type] ?? $account->type).'». الإشارة تتبع الدور لا الحساب.'];
                }
            }

            if (isset($s['cashBank'][$id])) {
                $warnings[] = [...$base, 'code' => 'ar_ap_account_cash_bank',
                    'message' => "الحساب {$code} حساب خزينة أو بنك — حركاته نقدية لا ذمم عملاء أو موردين، فالرصيد المعروض قد يضمّ مبالغ نقدية."];
            }

            if (isset($s['otherRoles'][$id])) {
                $names = implode('، ', array_map(fn (string $r) => AccountingRoles::find($r)['label_ar'] ?? $r, $s['otherRoles'][$id]));
                $warnings[] = [...$base, 'code' => 'ar_ap_account_in_other_role',
                    'message' => "الحساب {$code} معيَّن (حالياً أو سابقاً) لدور آخر هو «{$names}» — حركاته تتضمن مبالغ ليست ذمماً."];
            }
        }

        return $warnings;
    }

    /**
     * @param  list<array<string,mixed>>  $warnings
     * @param  list<string>  $movedAccountIds  حسابات لها سطور حتى التاريخ
     * @return array{warnings: list<array<string,mixed>>, verification: array<string,mixed>}
     */
    private function verification(array $warnings, array $movedAccountIds): array
    {
        $moved = array_flip($movedAccountIds);
        // التداخل يُنتج «غير موثَّق» دائماً (حتى لو رصيده صفر)؛ وغيره بحسب حركة الحساب حتى التاريخ.
        $annotated = array_map(fn (array $w) => [
            ...$w,
            'affects_totals' => $w['code'] === 'ar_ap_role_accounts_overlap' || isset($moved[$w['account_id']]),
        ], $warnings);

        $issues = count(array_filter($annotated, fn (array $w) => $w['affects_totals']));
        $notices = count($annotated) - $issues;
        $status = $issues > 0 ? 'unverified' : ($notices > 0 ? 'verified_with_notices' : 'verified');

        $checks = array_map(function (string $code) use ($annotated) {
            $forCode = array_filter($annotated, fn (array $w) => $w['code'] === $code);
            $result = $forCode === [] ? 'passed'
                : (array_filter($forCode, fn (array $w) => $w['affects_totals']) !== [] ? 'failed' : 'notice');

            return ['code' => $code, 'result' => $result];
        }, self::DETECTORS);

        return [
            'warnings' => $annotated,
            'verification' => [
                'verified' => $status === 'verified',
                'status' => $status,
                'issues' => $issues,
                'notices' => $notices,
                'basis' => 'ar_ap_role_account_integrity',
                'checks' => $checks,   // إفصاحات `info` تُلحَق في `withDisclosureChecks`
                'not_checked' => self::NOT_CHECKED,
            ],
        ];
    }

    // ── الإفصاحات ────────────────────────────────────────────────────────────

    /**
     * سطور حسابات الدور **بلا معرّف طرف**. إفصاح لا خطأ: القيد اليدوي والتسوية على حسابات الذمم مشروعان،
     * فلا يدخل في حالة التوثيق. الأرصدة الافتتاحية للأطراف موسومة بالطرف فلا تظهر هنا.
     *
     * @param  list<string>  $countedIds
     * @return array{lines:int, debit:int, credit:int, net:int}
     */
    private function untagged(string $roleKey, array $countedIds, string $asOf): array
    {
        $empty = ['lines' => 0, 'debit' => 0, 'credit' => 0, 'net' => 0];
        if ($countedIds === []) {
            return $empty;
        }

        $row = $this->lines($asOf)
            ->whereIn('journal_lines.account_id', $countedIds)
            ->whereNull('journal_lines.partner_id')
            ->selectRaw('COUNT(*) as n, COALESCE(SUM(journal_lines.debit), 0) as d, COALESCE(SUM(journal_lines.credit), 0) as c')
            ->first();

        $d = (int) ($row->d ?? 0);
        $c = (int) ($row->c ?? 0);

        return [
            'lines' => (int) ($row->n ?? 0),
            'debit' => $d,
            'credit' => $c,
            'net' => $roleKey === self::ROLE_RECEIVABLE ? $d - $c : $c - $d,
        ];
    }

    /**
     * أرصدة بعكس طبيعة الدور: على مستوى الحساب (رصيد الحساب سالب بإشارة الدور) وعلى مستوى الطرف
     * (صافي السطور الموسومة بالطرف على حسابات الدور). إفصاح فقط — لا إعادة تصنيف ولا أثر على التوثيق.
     *
     * @param  list<array<string,mixed>>  $accounts
     * @param  list<string>  $countedIds
     * @return array{accounts: list<array<string,mixed>>, partners: array{count:int, amount:int}}
     */
    private function oppositeSign(string $roleKey, array $accounts, array $countedIds, string $asOf): array
    {
        $byAccount = [];
        foreach ($accounts as $a) {
            if ($a['counted'] && $a['balance'] < 0) {
                $byAccount[] = ['account_id' => $a['account_id'], 'code' => $a['code'], 'balance' => $a['balance']];
            }
        }

        $partners = ['count' => 0, 'amount' => 0];
        if ($countedIds !== []) {
            $rows = $this->lines($asOf)
                ->whereIn('journal_lines.account_id', $countedIds)
                ->whereNotNull('journal_lines.partner_id')
                ->selectRaw('journal_lines.partner_id as partner_id, SUM(journal_lines.debit) as d, SUM(journal_lines.credit) as c')
                ->groupBy('journal_lines.partner_id')
                ->get();
            foreach ($rows as $row) {
                $net = $roleKey === self::ROLE_RECEIVABLE ? (int) $row->d - (int) $row->c : (int) $row->c - (int) $row->d;
                if ($net < 0) {
                    $partners['count']++;
                    $partners['amount'] += -$net;
                }
            }
        }

        return ['accounts' => $byAccount, 'partners' => $partners];
    }

    /**
     * هل تستقرّ الأرقام فعلاً؟ الرصيد تراكمي من أول الزمن، فقيدٌ مؤرَّخ في سنة سابقة **غير مقفلة** (أو في تاريخ لا
     * تغطّيه سنة مقفلة) ما زال يغيّر رقم نهاية هذه السنة، ولو أُقفلت هي نفسها. إفصاح لا مانع.
     *
     * @param  list<string>  $accountIds
     * @return array<string,mixed>
     */
    private function history(FiscalYear $year, array $accountIds): array
    {
        $start = $year->start_date->toDateString();

        $priorOpen = FiscalYear::query()
            ->whereDate('end_date', '<', $start)
            ->where('status', '!=', FiscalYear::STATUS_CLOSED)
            ->orderBy('start_date')
            ->get()
            ->map(fn (FiscalYear $y) => [
                'id' => $y->id,
                'name' => $y->name,
                'start_date' => $y->start_date->toDateString(),
                'end_date' => $y->end_date->toDateString(),
                'status' => $y->status,
            ])->all();

        $uncovered = false;
        if ($accountIds !== []) {
            $closed = FiscalYear::query()->where('status', FiscalYear::STATUS_CLOSED)->get(['start_date', 'end_date']);
            $query = JournalLine::query()
                ->join('journal_entries as e', 'e.id', '=', 'journal_lines.journal_entry_id')
                ->whereIn('e.status', ['posted', 'reversed'])
                ->whereDate('e.entry_date', '<', $start)
                ->whereIn('journal_lines.account_id', $accountIds);
            foreach ($closed as $c) {
                $query->whereNot(fn ($q) => $q
                    ->whereDate('e.entry_date', '>=', $c->start_date->toDateString())
                    ->whereDate('e.entry_date', '<=', $c->end_date->toDateString()));
            }
            $uncovered = $query->exists();
        }

        return [
            'year_status' => $year->status,
            'prior_open_years' => $priorOpen,
            'uncovered_prior_activity' => $uncovered,
            'balances_can_still_change' => $priorOpen !== [] || $uncovered,
        ];
    }

    /**
     * يُلحق إفصاحات `info` بقائمة الفحوص دون المساس بحالة التوثيق.
     *
     * @param  array<string,mixed>  $verification
     * @param  array<string, array<string,mixed>>  $roles
     * @return array<string,mixed>
     */
    private function withDisclosureChecks(array $verification, array $roles): array
    {
        $untagged = array_sum(array_map(fn (array $r) => $r['untagged']['lines'], $roles));
        $opposite = array_sum(array_map(fn (array $r) => count($r['opposite_sign']['accounts']) + $r['opposite_sign']['partners']['count'], $roles));
        $present = ['ar_ap_untagged_lines' => $untagged > 0, 'ar_ap_opposite_sign' => $opposite > 0];

        foreach (self::DISCLOSURE_CHECKS as $code) {
            $verification['checks'][] = ['code' => $code, 'result' => $present[$code] ? 'info' : 'passed'];
        }

        return $verification;
    }
}
