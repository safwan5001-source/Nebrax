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
 *  - **المطالَب به = ما استعملته قرارات المراجعة فعلاً (قرار المالك، 2026-11-02) — لا كل قيود الفترة:** confirm/override ⇒ قيود الوحدات التي اعتمدها المراجع صراحةً · link_pair ⇒ قيد العضو المحدَّد صراحةً
 *    فقط (لا العضو الآخر) · dismiss ⇒ لا مطالبة (لا قيد مرتبط). قيد داخل الفترة **غائب عن الكشف** (`missing_in_statement`) **لا يُحجز**: يبقى مستثنىً ظاهراً في ملخص حدث الإغلاق ويصلح لمطابقة فترة أخرى.
 *    **هوية القيد لا تُستنتج من مبلغ أو تاريخ:** مصدرها وحدة اختارها المراجع (مفتاح مستند) مربوطة بقيودها ببصمة الدفتر المقيَّدة بالقرار والمُعاد فحصها عند الإغلاق، أو معرّفا قيدَي الزوج المخزَّنان في قرار link_pair
 *    ومثبتان بـ`reversal_of`. أي قرار لا تتحدد هويته أو لا يثبت (وحدة غائبة/غير نشطة/بلا قيود، زوج لا يطابق الأستاذ) ⇒ يُرفض الإغلاق (`claim_identity_unproven`) ولا يُخمَّن.
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
     * المجموعة المُطالَب بها: قيود القرارات الفعّالة وحدها (انظر وصف الصنف). **فشل مغلق** عند أي هوية غير محددة أو غير مثبتة.
     *
     * @param  list<array<string, mixed>>  $units  وحدات الدفتر الحاضرة (بـ`entries`) — المطابقة لبصمة التشغيلة (فحصتها الخدمة المنادية)
     * @param  array<string, PartnerStatementReviewDecision>  $effective  القرارات الفعّالة `line_id ⇒ قرار`
     * @return array<string, array{basis: string, line_id: string, number: string}>  `entry_id ⇒ مطالبة`
     */
    public function claimSet(array $units, array $effective): array
    {
        $byKey = [];
        foreach ($units as $unit) {
            $byKey[$unit['key']] = $unit;
        }

        $set = [];
        foreach ($effective as $lineId => $decision) {
            $entries = match ($decision->action) {
                PartnerStatementReviewDecision::ACTION_CONFIRM, PartnerStatementReviewDecision::ACTION_OVERRIDE => $this->decidedEntries($decision, $byKey),
                PartnerStatementReviewDecision::ACTION_LINK_PAIR => [$this->chosenPairEntry($decision, $byKey)],
                default => [],   // dismiss: لا قيد مرتبط ⇒ لا مطالبة
            };
            foreach ($entries as $entry) {
                $id = (string) $entry['entry_id'];
                if (isset($set[$id])) {
                    // مستحيل بحراسة الاستعمال المزدوج؛ فحص دفاعي يفشل مغلقاً بدل مطالبة غامضة.
                    throw new PartnerStatementReviewException('claim_entry_used_twice', 'قيد مُسند لسطرَي كشف بقرارين فعّالين.', 409, ['entry_id' => $id]);
                }
                $set[$id] = ['basis' => PartnerStatementUnitClaim::BASIS_DECISION, 'line_id' => (string) $lineId, 'number' => (string) $entry['number']];
            }
        }
        ksort($set);

        return $set;
    }

    /**
     * قيود داخل الفترة لم يُطالَب بها (لا قرار استعملها): استثناء يُعرض في ملخص الإغلاق لا يُحجز. عدد + عيّنة محدودة.
     *
     * @param  list<array<string, mixed>>  $units
     * @param  array<string, mixed>  $set
     * @return array{count: int, sample: list<array<string, string>>}
     */
    public function unclaimedInPeriod(array $units, string $periodFrom, string $periodTo, array $set): array
    {
        $found = [];
        foreach ($units as $unit) {
            foreach ($unit['entries'] as $entry) {
                if ($entry['date'] >= $periodFrom && $entry['date'] <= $periodTo && ! isset($set[(string) $entry['entry_id']])) {
                    $found[(string) $entry['entry_id']] = ['entry_id' => (string) $entry['entry_id'], 'number' => (string) $entry['number'], 'date' => (string) $entry['date'], 'unit_key' => (string) $unit['key'], 'state' => (string) $unit['state']];
                }
            }
        }
        ksort($found);

        return ['count' => count($found), 'sample' => array_slice(array_values($found), 0, self::SAMPLE)];
    }

    /**
     * confirm/override: قيود الوحدات التي اعتمدها المراجع. **الهوية مسجَّلة مع القرار** (`claim_entry_ids`، وقت القرار على الدفتر المقيَّد ببصمته): يجب أن تكون موجودة، وأن تساوي تماماً قيود الوحدات المعتمدة في الدفتر الحاضر
     * (التشغيلة حديثة فالبصمة واحدة)، وكل وحدة نشطة وقابلة للمطابقة ولها قيود. القرار القديم بلا هوية لا يُطالَب بقيوده (يُعاد القرار). حارس القاعدة يطبّق الانتماء نفسه على كل مطالبة.
     *
     * @param  array<string, array<string, mixed>>  $byKey
     * @return list<array<string, mixed>>
     */
    private function decidedEntries(PartnerStatementReviewDecision $decision, array $byKey): array
    {
        $keys = array_values(array_unique(array_map('strval', $decision->unit_keys ?? [])));
        if ($keys === []) {
            throw $this->unproven('قرار بلا وحدات محددة.', $decision);
        }
        $current = [];
        foreach ($keys as $key) {
            $unit = $byKey[$key] ?? null;
            if ($unit === null || ($unit['state'] ?? null) !== 'active' || ! ($unit['matchable'] ?? false) || ($unit['entries'] ?? []) === []) {
                throw $this->unproven('وحدة قرار فعّال غائبة أو غير نشطة أو بلا قيود مثبتة في الدفتر الحاضر.', $decision, ['unit_key' => $key, 'state' => $unit['state'] ?? null]);
            }
            foreach ($unit['entries'] as $entry) {
                $current[(string) $entry['entry_id']] = $entry;
            }
        }

        $recorded = $decision->claim_entry_ids;
        if (! is_array($recorded) || $recorded === []) {
            throw $this->unproven('القرار لا يحمل هوية القيود المعتمدة (قرار سابق لتسجيلها): أعد القرار نفسه ليُسجَّلها.', $decision, ['reason' => 'decision_entry_identity_missing']);
        }
        $recordedIds = array_values(array_unique(array_map('strval', $recorded)));
        $currentIds = array_keys($current);
        sort($recordedIds);
        sort($currentIds);
        if ($recordedIds !== $currentIds) {
            throw $this->unproven('قيود الوحدات المعتمدة في الدفتر الحاضر لا تطابق الهوية المسجَّلة مع القرار.', $decision, ['reason' => 'decision_entry_identity_mismatch']);
        }

        return array_values($current);
    }

    /**
     * link_pair: قيد العضو المحدَّد صراحةً فقط. يُثبَّت من الأستاذ الحاضر: الوحدة زوج معكوس (`neutralised`) من قيدين، معرّفا القيدين المخزَّنان في القرار هما قيداها، والعكس يشير بـ`reversal_of` إلى الأصل.
     *
     * @param  array<string, array<string, mixed>>  $byKey
     * @return array<string, mixed>
     */
    private function chosenPairEntry(PartnerStatementReviewDecision $decision, array $byKey): array
    {
        $unit = $byKey[$decision->unit_keys[0] ?? ''] ?? null;
        $original = (string) $decision->pair_original_entry_id;
        $reversal = (string) $decision->pair_reversal_entry_id;
        $member = $decision->pair_member;
        if ($unit === null || ($unit['state'] ?? null) !== 'neutralised' || ! in_array($member, PartnerStatementReviewDecision::MEMBERS, true) || $original === '' || $reversal === '') {
            throw $this->unproven('زوج معكوس مرتبط لم يعد مثبتاً في الدفتر الحاضر.', $decision, ['unit_key' => $decision->unit_keys[0] ?? null]);
        }
        $byId = [];
        foreach ($unit['entries'] ?? [] as $entry) {
            $byId[(string) $entry['entry_id']] = $entry;
        }
        if (count($byId) !== 2 || ! isset($byId[$original], $byId[$reversal]) || ($byId[$reversal]['reversal_of'] ?? null) !== $original || ($byId[$original]['reversal_of'] ?? null) !== null) {
            throw $this->unproven('قيدا الزوج المخزَّنان في القرار لا يطابقان قيود الوحدة ورابط العكس في الأستاذ.', $decision, ['unit_key' => $decision->unit_keys[0] ?? null]);
        }

        return $byId[$member === PartnerStatementReviewDecision::MEMBER_ORIGINAL ? $original : $reversal];
    }

    /** @param array<string, mixed> $details */
    private function unproven(string $message, PartnerStatementReviewDecision $decision, array $details = []): PartnerStatementReviewException
    {
        return new PartnerStatementReviewException('claim_identity_unproven', $message.' لا يُغلق نهائياً قرارٌ تتطلب مطالبته قيداً غير محدد الهوية؛ أعد المطابقة والمراجعة.', 409, ['line_id' => $decision->line_id, 'action' => $decision->action] + $details);
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
     * @param  array<string, array{basis: string, line_id: string, number: string}>  $set
     * @return array{decision: int, total: int}
     */
    public function write(PartnerStatementReconciliation $reconciliation, array $set): array
    {
        $now = now();
        $rows = [];
        foreach ($set as $entryId => $claim) {
            $rows[] = [
                'id' => (string) Str::uuid(), 'tenant_id' => (string) $this->tenant->id(), 'reconciliation_id' => $reconciliation->id, 'partner_id' => $reconciliation->partner_id,
                'role' => $reconciliation->role, 'journal_entry_id' => $entryId, 'basis' => $claim['basis'], 'line_id' => $claim['line_id'], 'claimed_at' => $now, 'released_at' => null,
            ];
        }
        foreach (array_chunk($rows, self::INSERT_CHUNK) as $chunk) {
            PartnerStatementUnitClaim::insert($chunk);
        }

        return ['decision' => count($rows), 'total' => count($rows)];
    }

    /** عدد المطالبات الفعّالة (غير المفرَج عنها) لمقارنة. */
    public function activeCountFor(string $reconciliationId): int
    {
        return PartnerStatementUnitClaim::query()->where('reconciliation_id', $reconciliationId)->whereNull('released_at')->count();
    }

    /** عدد مطالبات مقارنة كلها (التاريخ: الفعّالة والمفرَج عنها). */
    public function countFor(string $reconciliationId): int
    {
        return PartnerStatementUnitClaim::query()->where('reconciliation_id', $reconciliationId)->count();
    }
}
