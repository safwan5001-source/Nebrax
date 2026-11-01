<?php

namespace App\Services\Reporting;

use App\Models\User;
use App\Services\PartnerStatementImportService;
use App\Support\Rbac;
use LogicException;
use RuntimeException;

/**
 * مصدر مرشّحي مطابقة كشوف الأطراف — IMP-PARTNER-STATEMENTS PS-A2b. **قراءة فقط**: لا كتابة ولا قيد ولا مستند ولا رصيد، ولا استدعاء لأي خدمة ترحيل.
 *
 * القاعدة (خطة PS-A2 §2): المرشّحون يأتون من **المصدر نفسه الذي يقرؤه كشف حساب الطرف** (`ReportService::partnerStatement`: سطور قيود الطرف
 * `posted`+`reversed`، بتصفية الدور والفرع والفترة) — لا استعلام ثانٍ يتباعد عنه. هذه الخدمة تجمع صفوفه إلى **وحدات مستند** وتعلّم القيود المعكوسة.
 *
 * الحماية (فشل مغلق):
 *  - الفاعل مصادَق عليه فعلاً وهو نفسه المُمرَّر (`ReportService::branchIds` يقرأ المستخدم المصادَق؛ بلا مستخدم كان سيقرأ كل الفروع) — خارج ذلك `LogicException`.
 *  - صلاحيات: `partner_statements.view` ثم `PartnerStatementImportService::assertAccess` (نشاط الفاعل، `partners.view`، عملة المؤسسة، رؤية الطرف كما يفعل التقرير،
 *    دور الطرف، والفرع ضمن نطاق الفاعل) — رسالة واحدة موحَّدة لأي طرف غير متاح.
 *  - عزل المستأجر: كل الاستعلامات عبر نماذج `TenantScope`. لا يُعاد أي قيد خارج نطاق فروع الفاعل.
 *
 * القيود المعكوسة (P-4) بلا مضاعفة: `LedgerService::reverse` يترك الأصل `reversed` ويُنشئ قيد عكس `posted` بـ`reversal_of` ولا مصدر له. تُجمَّع سلسلة العكس
 * (والقيود ذات المصدر الواحد) في وحدة واحدة: عند اكتمال حلقاتها داخل النافذة وصافيها صفر ⇒ `neutralised` (غير قابلة للمطابقة ولا تدخل مجاميع المرشحين)؛ وإن غاب
 * طرف من السلسلة عن النافذة ⇒ `incomplete` (غير قابلة للمطابقة وتُعرض بسببها)؛ وإلا `active`. مجموع صافي كل الوحدات = ما يقرؤه الكشف نفسه (فحص ثابت).
 */
final class PartnerLedgerCandidates
{
    public const STATE_ACTIVE = 'active';

    public const STATE_NEUTRALISED = 'neutralised';

    public const STATE_INCOMPLETE = 'incomplete';

    public const STATE_ZERO_NET = 'zero_net';

    public function __construct(
        private readonly ReportService $reports,
        private readonly PartnerStatementImportService $access,
    ) {}

    /**
     * @param  array{partner_id: string, role: string, period_from: string, period_to: string, date_tolerance_days?: int, branch_id?: ?string}  $options
     * @return array{
     *   partner_id: string, role: string, period: array{from: string, to: string}, window: array{from: string, to: string},
     *   scope: array{kind: string, branch_ids: ?list<string>}, units: list<array<string, mixed>>,
     *   totals: array<string, int>, fingerprint: string
     * }
     */
    public function for(User $actor, array $options): array
    {
        $authenticated = auth()->user();
        if ($authenticated === null || (string) $authenticated->getKey() !== (string) $actor->getKey()) {
            throw new LogicException('مصدر المرشحين يتطلب الفاعل نفسه مصادَقاً عليه؛ لا قراءة بلا نطاق مستخدم.');
        }
        if (! Rbac::allows((string) $actor->role, 'partner_statements.view')) {
            throw new RuntimeException(PartnerStatementImportService::PARTNER_UNAVAILABLE);
        }

        $role = (string) $options['role'];
        $branchId = ($options['branch_id'] ?? null) === '' ? null : ($options['branch_id'] ?? null);
        $partner = $this->access->assertAccess(['partner_id' => (string) $options['partner_id'], 'role' => $role, 'branch_id' => $branchId], (string) $actor->getKey());

        $tolerance = max(0, min(PartnerStatementImportService::MAX_DATE_TOLERANCE_DAYS, (int) ($options['date_tolerance_days'] ?? PartnerStatementImportService::DEFAULT_DATE_TOLERANCE_DAYS)));
        $from = (string) $options['period_from'];
        $to = (string) $options['period_to'];
        $windowFrom = (new \DateTimeImmutable($from))->modify("-{$tolerance} days")->format('Y-m-d');
        $windowTo = (new \DateTimeImmutable($to))->modify("+{$tolerance} days")->format('Y-m-d');

        $filters = ['from' => $windowFrom, 'to' => $windowTo, 'partner_role' => $role];
        if ($branchId !== null) {
            $filters['branch_id'] = $branchId;
        }
        $statement = $this->reports->partnerStatement((string) $partner->getKey(), $filters);

        $units = $this->units($statement['rows'], $from, $to);
        $allowed = $actor->allowedBranchIds();
        $scope = match (true) {
            $branchId !== null => ['kind' => 'branch', 'branch_ids' => [$branchId]],
            $allowed === null => ['kind' => 'organization', 'branch_ids' => null],
            count($allowed) === 1 => ['kind' => 'branch', 'branch_ids' => array_values($allowed)],
            default => ['kind' => 'restricted_set', 'branch_ids' => array_values($allowed)],   // لا يُسمّى «المؤسسة» أبداً (D-PS-12)
        };

        $rowsNet = array_sum(array_map(fn (array $r): int => $r['debit'] - $r['credit'], $statement['rows']));
        $unitsNet = array_sum(array_map(fn (array $u): int => $u['net_minor'], $units));
        if ($rowsNet !== $unitsNet) {
            throw new LogicException('اختلال داخلي: مجموع صافي الوحدات لا يطابق صافي صفوف الكشف.');
        }

        $matchable = array_values(array_filter($units, fn (array $u): bool => $u['matchable']));

        return [
            'partner_id' => (string) $partner->getKey(), 'role' => $role,
            'period' => ['from' => $from, 'to' => $to], 'window' => ['from' => $windowFrom, 'to' => $windowTo],
            'scope' => $scope, 'units' => $units,
            'totals' => [
                'units' => count($units), 'matchable' => count($matchable),
                'neutralised' => count(array_filter($units, fn (array $u): bool => $u['state'] === self::STATE_NEUTRALISED)),
                'incomplete' => count(array_filter($units, fn (array $u): bool => $u['state'] === self::STATE_INCOMPLETE)),
                'matchable_debit_minor' => array_sum(array_map(fn (array $u): int => $u['debit_minor'], $matchable)),
                'matchable_credit_minor' => array_sum(array_map(fn (array $u): int => $u['credit_minor'], $matchable)),
                'rows_net_minor' => $rowsNet,
            ],
            'fingerprint' => $this->fingerprint($units),
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $rows  صفوف الكشف (مع مفاتيح PS-A2b الإضافية)
     * @return list<array<string, mixed>>
     */
    private function units(array $rows, string $periodFrom, string $periodTo): array
    {
        // القيد الواحد قد يحمل أكثر من سطر للطرف: نجمع لكل قيد أولاً.
        $entries = [];
        foreach ($rows as $row) {
            $id = (string) $row['entry_id'];
            $entries[$id] ??= [
                'entry_id' => $id, 'number' => $row['number'], 'date' => $row['date'], 'status' => $row['entry_status'], 'reversal_of' => $row['reversal_of'],
                'source' => $row['source'], 'debit' => 0, 'credit' => 0,
            ];
            $entries[$id]['debit'] += $row['debit'];
            $entries[$id]['credit'] += $row['credit'];
        }

        // اتحاد القيود: نفس المصدر، أو رابط عكس بين قيدين ظاهرين.
        $parent = array_combine(array_keys($entries), array_keys($entries)) ?: [];
        $find = function (string $x) use (&$parent, &$find): string {
            return $parent[$x] === $x ? $x : ($parent[$x] = $find($parent[$x]));
        };
        $union = function (string $a, string $b) use (&$parent, $find): void {
            $ra = $find($a);
            $rb = $find($b);
            if ($ra !== $rb) {
                $parent[$rb] = $ra;
            }
        };
        $bySource = [];
        foreach ($entries as $id => $entry) {
            if ($entry['source'] !== null) {
                $key = $entry['source']['kind'].'#'.$entry['source']['id'];
                isset($bySource[$key]) ? $union($bySource[$key], $id) : $bySource[$key] = $id;
            }
            if ($entry['reversal_of'] !== null && isset($entries[$entry['reversal_of']])) {
                $union($entry['reversal_of'], $id);
            }
        }

        $families = [];
        foreach (array_keys($entries) as $id) {
            $families[$find($id)][] = $id;
        }

        $units = [];
        foreach ($families as $ids) {
            $members = array_map(fn (string $id): array => $entries[$id], $ids);
            $reasons = [];
            foreach ($members as $m) {
                if ($m['reversal_of'] !== null && ! isset($entries[$m['reversal_of']])) {
                    $reasons[] = 'reversal_original_outside_window';
                }
                if ($m['status'] === 'reversed' && count(array_filter($members, fn (array $x): bool => $x['reversal_of'] === $m['entry_id'])) === 0) {
                    $reasons[] = 'reversal_outside_window';
                }
            }
            $reasons = array_values(array_unique($reasons));

            $debit = array_sum(array_column($members, 'debit'));
            $credit = array_sum(array_column($members, 'credit'));
            $net = $debit - $credit;
            $hasReversal = count(array_filter($members, fn (array $m): bool => $m['reversal_of'] !== null || $m['status'] === 'reversed')) > 0;
            $state = match (true) {
                $reasons !== [] => self::STATE_INCOMPLETE,
                $hasReversal && $net === 0 => self::STATE_NEUTRALISED,
                $net === 0 => self::STATE_ZERO_NET,
                default => self::STATE_ACTIVE,
            };

            $sourced = array_values(array_filter($members, fn (array $m): bool => $m['source'] !== null));
            $source = $sourced[0]['source'] ?? null;
            usort($members, fn (array $a, array $b): int => [$a['date'], $a['entry_id']] <=> [$b['date'], $b['entry_id']]);
            $date = $members[0]['date'];
            $matchable = $state === self::STATE_ACTIVE;

            $units[] = [
                'key' => $source !== null ? $source['kind'].'#'.$source['id'] : 'entry#'.$members[0]['entry_id'],
                'kind' => $source['kind'] ?? 'journal', 'source_id' => $source['id'] ?? null, 'label' => $source['label'] ?? null,
                'numbers' => array_map(fn (array $m) => $m['number'], $members),
                'entry_ids' => array_map(fn (array $m): string => $m['entry_id'], $members),
                'date' => $date, 'last_date' => end($members)['date'], 'in_period' => $date >= $periodFrom && $date <= $periodTo,
                'debit_minor' => $matchable ? max($net, 0) : $debit, 'credit_minor' => $matchable ? max(-$net, 0) : $credit,
                'net_minor' => $net, 'direction' => $net > 0 ? 'debit' : ($net < 0 ? 'credit' : 'none'),
                'allocations' => $source['allocations'] ?? [],
                'state' => $state, 'matchable' => $matchable, 'reasons' => $reasons,
            ];
        }

        usort($units, fn (array $a, array $b): int => [$a['date'], $a['key']] <=> [$b['date'], $b['key']]);

        return $units;
    }

    /** @param list<array<string, mixed>> $units */
    private function fingerprint(array $units): string
    {
        $canonical = array_map(fn (array $u): array => [$u['key'], $u['entry_ids'], $u['date'], $u['net_minor'], $u['state']], $units);

        return hash('sha256', json_encode($canonical, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
    }
}
