<?php

namespace App\Services;

use App\Models\PartnerStatementReconciliation;
use App\Models\PartnerStatementReviewDecision;
use App\Models\PartnerStatementUnitClaim;
use App\Models\Tenant;
use App\Support\PartnerStatementReviewException;
use App\Tenancy\TenantContext;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * مطالبات المقارنة النهائية بالحركات — IMP-PS-A3d (D-PS-12/14، خطة PS-A2 §5.2–5.5). **لا أثر مالي**: يقرأ وحدات الدفتر المُمرَّرة له (من `PartnerLedgerCandidates` عبر خدمة المطابقة) ويكتب جدول المطالبات وحده.
 *
 *  - **المجموعة المُطالَب بها ليست مجموعة البحث:** (أ) كل قيد تاريخه **داخل** فترة الكشف (أي حالة وحدته: نشطة/معكوسة/ناقصة)، و(ب) كل قيد استعملته **قرارات المراجعة** الفعّالة
 *    (confirm/override = كل قيود الوحدة، link_pair = قيد العضو المختار وحده، dismiss/clear = لا شيء). مرشّحو نافذة التسامح غير المستعملة لا يُطالَب بهم، فتتجاور فترتان بلا تعارض.
 *  - **التعارض الحقيقي** = قيد له مطالبة فعّالة (`released_at IS NULL`) من مقارنة أخرى لنفس الطرف والدور، **مهما اختلفت الفترة أو الفرع**؛ يمنعه الفحص تحت القفل ثم الفهرس الفريد الجزئي (حتى بـSQL خام).
 *  - **تداخل الفترات وحده تحذير** (D-PS-14): قائمة النهائيات المتداخلة فترةً والمتقاطعة نطاقاً (مؤسسة تتقاطع مع الكل؛ فرع مع نفسه ومع المؤسسة) يجب أن يُقرّ بها المُغلِق بمطابقة تامة.
 *  - **التسلسل:** قفل استشاري واسع على (مستأجر، طرف، دور) يسلسل كل إغلاق لهذا الطرف، ثم **قفل صف المستأجر** — المِرساة نفسها التي يقفلها `LedgerService` قبل أي ترحيل/عكس (عبر حارس التاريخ)
 *    و`FiscalCloseService` — فلا يُثبَّت قيد جديد بين قراءة الدفتر والالتزام، ولا يتغيّر `LedgerService` ولا قاعدة الأستاذ. (القفل الاستشاري للمراجعة وحده لا يحمي الأستاذ.)
 */
final class PartnerStatementClaimService
{
    public const SAMPLE = 20;

    private const INSERT_CHUNK = 500;

    private const LOOKUP_CHUNK = 500;

    public function __construct(private readonly TenantContext $tenant) {}

    // ═══════════════════════════════ الأقفال (داخل معاملة) ═══════════════════════════════

    /** قفل واسع لكل (مستأجر، طرف، دور): كل إغلاق لهذا الطرف يتسلسل (فترات متداخلة تتعارض عبر الحركات المشتركة). */
    public function lockPartnerScope(string $partnerId, string $role): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::select('select pg_advisory_xact_lock(hashtextextended(?, 0))', ['partner-statement-final:'.$this->tenant->id().':'.$partnerId.':'.$role]);
        }
    }

    /**
     * مِرساة المستأجر: الصف الذي يقفله كل ترحيل/عكس قيد قبل أي كتابة (`AccountingDateGuard`). أخذه من معاملة الإغلاق **قبل قراءة الدفتر** يضمن: ترحيل جارٍ يُرى (أو ينتظر)،
     * وترحيل لاحق ينتظر الالتزام. على SQLite يسقط القفل (كاتب واحد).
     */
    public function lockLedgerAnchor(): void
    {
        Tenant::query()->whereKey((string) $this->tenant->id())->lockForUpdate()->first();
    }

    // ═══════════════════════════════ النطاق ═══════════════════════════════

    /**
     * مفتاح نطاق الإغلاق من النطاق الفعلي للتشغيلة: `org` للمؤسسة كاملة، أو معرّف الفرع الواحد. مجموعة فروع مقيَّدة لا تُغلق (لا نطاق صادق لها، D-PS-12).
     *
     * @param  array{kind: string, branch_ids: ?list<string>}  $scope
     */
    public function scopeKey(array $scope): string
    {
        return match ($scope['kind']) {
            'organization' => PartnerStatementReconciliation::SCOPE_ORGANIZATION,
            'branch' => (string) ($scope['branch_ids'][0] ?? ''),
            default => throw new PartnerStatementReviewException('scope_not_closable', 'لا يُغلَق نهائياً إلا نطاق مؤسسة كاملة أو فرع واحد؛ اختر فرعاً واحداً (مستخدم مقيَّد بعدّة فروع بلا تصفية فرع لا يملك نطاقاً صادقاً).', 422, ['scope_kind' => $scope['kind']]),
        };
    }

    /**
     * النهائيات (`closed`) لنفس الطرف والدور التي تتداخل فترتها مع فترة المقارنة ويتقاطع نطاقها مع نطاقها. مقروءة تحت القفل الواسع.
     *
     * @return Collection<int, PartnerStatementReconciliation>
     */
    public function overlappingFinals(PartnerStatementReconciliation $reconciliation, string $scopeKey): Collection
    {
        return PartnerStatementReconciliation::query()
            ->where('partner_id', $reconciliation->partner_id)->where('role', $reconciliation->role)
            ->where('status', PartnerStatementReconciliation::STATUS_CLOSED)->where('id', '<>', $reconciliation->id)
            ->whereDate('period_from', '<=', $reconciliation->period_to->toDateString())->whereDate('period_to', '>=', $reconciliation->period_from->toDateString())
            ->get()
            ->filter(fn (PartnerStatementReconciliation $other): bool => $scopeKey === PartnerStatementReconciliation::SCOPE_ORGANIZATION
                || $other->scope_key === PartnerStatementReconciliation::SCOPE_ORGANIZATION || $other->scope_key === $scopeKey)
            ->sortBy('id')->values();
    }

    /** @return array<string, mixed> */
    public function present(PartnerStatementReconciliation $other): array
    {
        return [
            'id' => $other->id, 'period_from' => $other->period_from->toDateString(), 'period_to' => $other->period_to->toDateString(),
            'scope_key' => $other->scope_key, 'closed_at' => optional($other->closed_at)->toIso8601String(),
        ];
    }

    // ═══════════════════════════════ مجموعة المطالبات ═══════════════════════════════

    /**
     * @param  list<array<string, mixed>>  $units  وحدات الدفتر الحاضرة (بـ`entries`)
     * @param  array<string, PartnerStatementReviewDecision>  $effective  القرارات الفعّالة `line_id ⇒ قرار`
     * @return array<string, array{basis: string, line_id: ?string, number: string}>  `entry_id ⇒ مطالبة`
     */
    public function claimSet(array $units, string $periodFrom, string $periodTo, array $effective): array
    {
        $set = [];
        $byKey = [];
        foreach ($units as $unit) {
            $byKey[$unit['key']] = $unit;
            foreach ($unit['entries'] as $entry) {
                if ($entry['date'] >= $periodFrom && $entry['date'] <= $periodTo) {
                    $set[(string) $entry['entry_id']] = ['basis' => PartnerStatementUnitClaim::BASIS_PERIOD, 'line_id' => null, 'number' => (string) $entry['number']];
                }
            }
        }

        foreach ($effective as $lineId => $decision) {
            $entries = [];
            if (in_array($decision->action, [PartnerStatementReviewDecision::ACTION_CONFIRM, PartnerStatementReviewDecision::ACTION_OVERRIDE], true)) {
                foreach ($decision->unit_keys as $key) {
                    $unit = $byKey[$key] ?? null;
                    if ($unit === null) {
                        throw new PartnerStatementReviewException('claim_unit_missing', 'وحدة قرار فعّال لم تعد ضمن مرشحي الدفتر؛ أعد المطابقة والمراجعة.', 409, ['unit_key' => $key]);
                    }
                    array_push($entries, ...$unit['entries']);
                }
            } elseif ($decision->action === PartnerStatementReviewDecision::ACTION_LINK_PAIR) {
                // قيد العضو المختار وحده — العضو الآخر لا يُطالَب به إلا إن وقع داخل الفترة (يُغطّى أعلاه).
                $entryId = $decision->pair_member === PartnerStatementReviewDecision::MEMBER_ORIGINAL ? $decision->pair_original_entry_id : $decision->pair_reversal_entry_id;
                $unit = $byKey[$decision->unit_keys[0] ?? ''] ?? null;
                $found = $unit === null ? [] : array_values(array_filter($unit['entries'], fn (array $e): bool => $e['entry_id'] === $entryId));
                if ($found === []) {
                    throw new PartnerStatementReviewException('claim_unit_missing', 'زوج معكوس مرتبط لم يعد ضمن مرشحي الدفتر؛ أعد المطابقة والمراجعة.', 409, ['unit_key' => $decision->unit_keys[0] ?? null]);
                }
                $entries = $found;
            }
            foreach ($entries as $entry) {
                $id = (string) $entry['entry_id'];
                if (($set[$id]['basis'] ?? null) === PartnerStatementUnitClaim::BASIS_DECISION && $set[$id]['line_id'] !== $lineId) {
                    // مستحيل بحراسة الاستعمال المزدوج؛ فحص دفاعي يفشل مغلقاً بدل مطالبة غامضة.
                    throw new PartnerStatementReviewException('claim_entry_used_twice', 'قيد مُسند لسطرَي كشف بقرارين فعّالين.', 409, ['entry_id' => $id]);
                }
                $set[$id] = ['basis' => PartnerStatementUnitClaim::BASIS_DECISION, 'line_id' => $lineId, 'number' => (string) $entry['number']];
            }
        }

        ksort($set);

        return $set;
    }

    /**
     * مطالبات فعّالة من مقارنات أخرى لنفس الطرف والدور على قيود المجموعة.
     *
     * @param  array<string, array{number: string}>  $set
     * @return list<array{entry_id: string, number: string, reconciliation_id: string}>
     */
    public function conflicts(PartnerStatementReconciliation $reconciliation, array $set): array
    {
        $found = [];
        foreach (array_chunk(array_keys($set), self::LOOKUP_CHUNK) as $chunk) {
            $rows = PartnerStatementUnitClaim::query()
                ->where('partner_id', $reconciliation->partner_id)->where('role', $reconciliation->role)
                ->whereNull('released_at')->where('reconciliation_id', '<>', $reconciliation->id)
                ->whereIn('journal_entry_id', $chunk)->get(['journal_entry_id', 'reconciliation_id']);
            foreach ($rows as $row) {
                $found[] = ['entry_id' => (string) $row->journal_entry_id, 'number' => $set[$row->journal_entry_id]['number'], 'reconciliation_id' => (string) $row->reconciliation_id];
            }
        }
        usort($found, fn (array $a, array $b): int => [$a['reconciliation_id'], $a['entry_id']] <=> [$b['reconciliation_id'], $b['entry_id']]);

        return $found;
    }

    /**
     * يكتب المطالبات (داخل معاملة الإغلاق). الفهرس الفريد الجزئي شبكة أمان؛ الفحص السابق تحت القفل يجعل مخالفته غير قابلة للبلوغ في المسار العادي.
     *
     * @param  array<string, array{basis: string, line_id: ?string, number: string}>  $set
     * @return array{period: int, decision: int, total: int}
     */
    public function write(PartnerStatementReconciliation $reconciliation, array $set): array
    {
        $now = now();
        $counts = [PartnerStatementUnitClaim::BASIS_PERIOD => 0, PartnerStatementUnitClaim::BASIS_DECISION => 0];
        $rows = [];
        foreach ($set as $entryId => $claim) {
            $counts[$claim['basis']]++;
            $rows[] = [
                'id' => (string) Str::uuid(), 'tenant_id' => (string) $this->tenant->id(), 'reconciliation_id' => $reconciliation->id, 'partner_id' => $reconciliation->partner_id,
                'role' => $reconciliation->role, 'journal_entry_id' => $entryId, 'basis' => $claim['basis'], 'line_id' => $claim['line_id'], 'claimed_at' => $now, 'released_at' => null,
            ];
        }
        foreach (array_chunk($rows, self::INSERT_CHUNK) as $chunk) {
            PartnerStatementUnitClaim::insert($chunk);
        }

        return ['period' => $counts[PartnerStatementUnitClaim::BASIS_PERIOD], 'decision' => $counts[PartnerStatementUnitClaim::BASIS_DECISION], 'total' => count($rows)];
    }

    /** عدد مطالبات مقارنة (للعرض والتحقق). */
    public function countFor(string $reconciliationId): int
    {
        return PartnerStatementUnitClaim::query()->where('reconciliation_id', $reconciliationId)->count();
    }
}
