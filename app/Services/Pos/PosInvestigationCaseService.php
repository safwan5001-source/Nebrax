<?php

namespace App\Services\Pos;

use App\Models\PosCaseActivity;
use App\Models\PosCaseEvidenceLink;
use App\Models\PosCaseNote;
use App\Models\PosException;
use App\Models\PosInvestigationCase;
use App\Models\PosSessionEvent;
use App\Models\User;
use App\Tenancy\BranchScope;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * خدمة دورة حياة قضية التحقيق: إنشاء/ترقية من استثناء، ربط/فك ربط أدلة (idempotent)،
 * تعيين، انتقال حالة متحكَّم، حسم، إعادة فتح صريحة، وAUR مجمَّع بلا ازدواج.
 *
 * كل فعل يكتب صفّاً append-only في `pos_case_activities`. لا كتابة محاسبية من هنا مطلقاً:
 * `confirmed_loss_minor`/`recovered_amount_minor` بيانات قرار تحقيق فقط.
 */
final class PosInvestigationCaseService
{
    /** الانتقالات المسموحة عبر changeStatus (لا تشمل إعادة الفتح من closed — انظر reopen()). */
    private const TRANSITIONS = [
        PosInvestigationCase::STATUS_OPEN => [
            PosInvestigationCase::STATUS_INVESTIGATING, PosInvestigationCase::STATUS_AWAITING_INFORMATION,
            PosInvestigationCase::STATUS_EXPLAINED, PosInvestigationCase::STATUS_CONTROL_FAILURE,
            PosInvestigationCase::STATUS_CONFIRMED_LOSS, PosInvestigationCase::STATUS_DISMISSED,
            PosInvestigationCase::STATUS_CLOSED,
        ],
        PosInvestigationCase::STATUS_INVESTIGATING => [
            PosInvestigationCase::STATUS_OPEN, PosInvestigationCase::STATUS_AWAITING_INFORMATION,
            PosInvestigationCase::STATUS_EXPLAINED, PosInvestigationCase::STATUS_CONTROL_FAILURE,
            PosInvestigationCase::STATUS_CONFIRMED_LOSS, PosInvestigationCase::STATUS_DISMISSED,
            PosInvestigationCase::STATUS_CLOSED,
        ],
        PosInvestigationCase::STATUS_AWAITING_INFORMATION => [
            PosInvestigationCase::STATUS_INVESTIGATING, PosInvestigationCase::STATUS_EXPLAINED,
            PosInvestigationCase::STATUS_CONTROL_FAILURE, PosInvestigationCase::STATUS_CONFIRMED_LOSS,
            PosInvestigationCase::STATUS_DISMISSED, PosInvestigationCase::STATUS_CLOSED,
        ],
        PosInvestigationCase::STATUS_EXPLAINED => [PosInvestigationCase::STATUS_INVESTIGATING, PosInvestigationCase::STATUS_CLOSED],
        PosInvestigationCase::STATUS_CONTROL_FAILURE => [PosInvestigationCase::STATUS_INVESTIGATING, PosInvestigationCase::STATUS_CLOSED],
        PosInvestigationCase::STATUS_CONFIRMED_LOSS => [PosInvestigationCase::STATUS_INVESTIGATING, PosInvestigationCase::STATUS_CLOSED],
        PosInvestigationCase::STATUS_DISMISSED => [PosInvestigationCase::STATUS_INVESTIGATING, PosInvestigationCase::STATUS_CLOSED],
        PosInvestigationCase::STATUS_CLOSED => [],
    ];

    /** @return array{case: PosInvestigationCase, duplicates: array<int, PosInvestigationCase>} */
    public function create(User $actor, array $data): array
    {
        return DB::transaction(function () use ($actor, $data) {
            $openedAt = isset($data['opened_at']) ? Carbon::parse($data['opened_at']) : Carbon::now();
            $branchId = $data['branch_id'] ?? null;

            $duplicates = $this->findPossibleDuplicates($data['subject_user_id'] ?? null, $data['pos_session_id'] ?? null);

            $case = new PosInvestigationCase();
            if ($branchId !== null) {
                $case->branch_id = $branchId;
            }
            $case->number = PosInvestigationCase::nextDocumentNumber('LP', $openedAt->toDateString(), $branchId ?? false);
            $case->fill([
                'title' => $data['title'],
                'summary' => $data['summary'] ?? null,
                'status' => PosInvestigationCase::STATUS_OPEN,
                'priority' => $data['priority'] ?? PosInvestigationCase::PRIORITY_NORMAL,
                'owner_id' => $data['owner_id'] ?? null,
                'opened_by' => $actor->id,
                'opened_at' => $openedAt,
                'last_activity_at' => Carbon::now(),
                'subject_user_id' => $data['subject_user_id'] ?? null,
                'pos_session_id' => $data['pos_session_id'] ?? null,
                'cart_id' => $data['cart_id'] ?? null,
                'correlation_id' => $data['correlation_id'] ?? null,
            ]);
            $case->save();

            $this->recordActivity($case, $actor, PosCaseActivity::ACTION_CREATED, [
                'title' => $case->title, 'priority' => $case->priority,
            ]);

            if (! empty($data['owner_id'])) {
                $this->recordActivity($case, $actor, PosCaseActivity::ACTION_ASSIGNED, ['owner_id' => $data['owner_id']]);
            }

            return ['case' => $case->fresh(), 'duplicates' => $duplicates];
        });
    }

    /** ترقية استثناء إلى قضية جديدة: يُنشئ القضية بسياق الاستثناء ويربطه مباشرة. لا يعدّل الاستثناء. */
    public function promoteException(User $actor, PosException $exception, array $data): array
    {
        $this->assertActorCanAccessEvidenceBranch($actor, $exception->branch_id, 'استثناء');

        return DB::transaction(function () use ($actor, $exception, $data) {
            $payload = array_merge([
                'title' => $data['title'] ?? $this->defaultTitleFor($exception),
                'branch_id' => $exception->branch_id,
                'subject_user_id' => $exception->subject_user_id,
                'pos_session_id' => $exception->pos_session_id,
                'cart_id' => $exception->cart_id,
            ], $data);

            $result = $this->create($actor, $payload);
            $this->linkException($actor, $result['case'], $exception, $data['rationale'] ?? 'ترقية من استثناء رقابي', PosCaseEvidenceLink::TYPE_EXCEPTION);

            return ['case' => $result['case']->fresh(), 'duplicates' => $result['duplicates']];
        });
    }

    /** ربط استثناء بقضية قائمة — idempotent: رابط نشط مكرر لا يُنشأ صفّاً ثانياً. */
    public function linkException(User $actor, PosInvestigationCase $case, PosException $exception, ?string $rationale, string $linkType = PosCaseEvidenceLink::TYPE_EXCEPTION): PosCaseEvidenceLink
    {
        if ($exception->tenant_id !== $case->tenant_id) {
            throw new RuntimeException('لا يمكن ربط استثناء من مستأجر آخر.');
        }
        $this->assertActorCanAccessEvidenceBranch($actor, $exception->branch_id, 'استثناء');

        return DB::transaction(function () use ($actor, $case, $exception, $rationale, $linkType) {
            $existing = PosCaseEvidenceLink::query()->withoutGlobalScope(BranchScope::class)
                ->where('case_id', $case->id)
                ->where('pos_exception_id', $exception->id)
                ->whereNull('unlinked_at')
                ->first();
            if ($existing) {
                return $existing;
            }

            $link = PosCaseEvidenceLink::create([
                'branch_id' => $case->branch_id,
                'case_id' => $case->id,
                'pos_exception_id' => $exception->id,
                'cart_id' => $exception->cart_id,
                'correlation_id' => null,
                'link_type' => $linkType,
                'rationale' => $rationale,
                'linked_by' => $actor->id,
                'linked_at' => Carbon::now(),
            ]);

            $this->recordActivity($case, $actor, PosCaseActivity::ACTION_EVIDENCE_LINKED, [
                'link_type' => 'exception', 'pos_exception_id' => $exception->id,
            ]);
            $this->recalculateAmountUnderReview($case);
            $this->touchActivity($case);

            return $link;
        });
    }

    /** ربط حدث دليل مباشرة (بلا استثناء مشتقّ) — استخدام يدوي صريح من المحقِّق. */
    public function linkEvent(User $actor, PosInvestigationCase $case, PosSessionEvent $event, ?string $rationale): PosCaseEvidenceLink
    {
        if ($event->tenant_id !== $case->tenant_id) {
            throw new RuntimeException('لا يمكن ربط حدث من مستأجر آخر.');
        }
        $this->assertActorCanAccessEvidenceBranch($actor, $event->branch_id, 'حدث');

        return DB::transaction(function () use ($actor, $case, $event, $rationale) {
            $existing = PosCaseEvidenceLink::query()->withoutGlobalScope(BranchScope::class)
                ->where('case_id', $case->id)
                ->where('pos_session_event_id', $event->id)
                ->whereNull('unlinked_at')
                ->first();
            if ($existing) {
                return $existing;
            }

            $link = PosCaseEvidenceLink::create([
                'branch_id' => $case->branch_id,
                'case_id' => $case->id,
                'pos_session_event_id' => $event->id,
                'cart_id' => $event->cart_id,
                'correlation_id' => $event->correlation_id,
                'link_type' => PosCaseEvidenceLink::TYPE_EVENT,
                'rationale' => $rationale,
                'linked_by' => $actor->id,
                'linked_at' => Carbon::now(),
            ]);

            $this->recordActivity($case, $actor, PosCaseActivity::ACTION_EVIDENCE_LINKED, [
                'link_type' => 'event', 'pos_session_event_id' => $event->id,
            ]);
            $this->recalculateAmountUnderReview($case);
            $this->touchActivity($case);

            return $link;
        });
    }

    public function unlink(User $actor, PosInvestigationCase $case, PosCaseEvidenceLink $link, ?string $rationale): PosCaseEvidenceLink
    {
        if ($link->case_id !== $case->id) {
            throw new RuntimeException('الرابط لا يخص هذه القضية.');
        }
        if ($link->unlinked_at !== null) {
            throw new RuntimeException('الرابط مفكوك بالفعل.');
        }

        return DB::transaction(function () use ($actor, $case, $link, $rationale) {
            $link->forceFill(['unlinked_by' => $actor->id, 'unlinked_at' => Carbon::now()])->save();

            $this->recordActivity($case, $actor, PosCaseActivity::ACTION_EVIDENCE_UNLINKED, [
                'pos_exception_id' => $link->pos_exception_id, 'pos_session_event_id' => $link->pos_session_event_id,
            ], $rationale);
            $this->recalculateAmountUnderReview($case);
            $this->touchActivity($case);

            return $link->fresh();
        });
    }

    public function assign(User $actor, PosInvestigationCase $case, ?string $ownerId): PosInvestigationCase
    {
        return DB::transaction(function () use ($actor, $case, $ownerId) {
            $previous = $case->owner_id;
            if ($previous === $ownerId) {
                throw new RuntimeException('القضية مسندة بالفعل لهذا المستخدم.');
            }

            $case->forceFill(['owner_id' => $ownerId])->save();

            $this->recordActivity(
                $case, $actor,
                $previous === null ? PosCaseActivity::ACTION_ASSIGNED : PosCaseActivity::ACTION_REASSIGNED,
                ['from_owner_id' => $previous, 'to_owner_id' => $ownerId],
            );
            $this->touchActivity($case);

            return $case->fresh();
        });
    }

    public function changePriority(User $actor, PosInvestigationCase $case, string $priority): PosInvestigationCase
    {
        if (! in_array($priority, PosInvestigationCase::PRIORITIES, true)) {
            throw new RuntimeException('أولوية غير معروفة.');
        }

        return DB::transaction(function () use ($actor, $case, $priority) {
            $previous = $case->priority;
            if ($previous === $priority) {
                throw new RuntimeException('القضية بهذه الأولوية بالفعل.');
            }
            $case->forceFill(['priority' => $priority])->save();

            $this->recordActivity($case, $actor, PosCaseActivity::ACTION_PRIORITY_CHANGED, [
                'from' => $previous, 'to' => $priority,
            ]);
            $this->touchActivity($case);

            return $case->fresh();
        });
    }

    public function addNote(User $actor, PosInvestigationCase $case, string $body, string $category): PosCaseNote
    {
        return DB::transaction(function () use ($actor, $case, $body, $category) {
            $note = PosCaseNote::create([
                'branch_id' => $case->branch_id,
                'case_id' => $case->id,
                'author_id' => $actor->id,
                'category' => $category,
                'body' => $body,
                'created_at' => Carbon::now(),
            ]);

            $this->recordActivity($case, $actor, PosCaseActivity::ACTION_NOTE_ADDED, ['category' => $category]);
            $this->touchActivity($case);

            return $note;
        });
    }

    /**
     * انتقال حالة متحكَّم. حالات الحسم (`OUTCOME_STATUSES`) تتطلب سبباً/ملخصاً. `confirmed_loss`
     * لا يُشتقّ آلياً أبداً — قيمته تأتي فقط من `$confirmedLossMinor` الذي يمرره المتحكّم بعد
     * تحقق صلاحية `pos.investigations.resolve`، ولا علاقة له بـ `PosRiskSnapshot`.
     */
    public function changeStatus(
        User $actor,
        PosInvestigationCase $case,
        string $toStatus,
        ?string $reason,
        ?string $note,
        ?int $confirmedLossMinor = null,
        ?int $recoveredAmountMinor = null,
    ): PosInvestigationCase {
        if (! in_array($toStatus, PosInvestigationCase::STATUSES, true)) {
            throw new RuntimeException('حالة غير معروفة.');
        }
        $from = $case->status;
        if ($from === $toStatus) {
            throw new RuntimeException('القضية في هذه الحالة بالفعل.');
        }
        $allowed = self::TRANSITIONS[$from] ?? [];
        if (! in_array($toStatus, $allowed, true)) {
            throw new RuntimeException('انتقال الحالة غير مسموح. استخدم إعادة الفتح الصريحة للقضايا المغلقة.');
        }
        $normalizedNote = is_string($note) ? trim($note) : '';
        $normalizedReason = is_string($reason) ? trim($reason) : '';
        if (in_array($toStatus, PosInvestigationCase::OUTCOME_STATUSES, true) && $normalizedReason === '' && $normalizedNote === '') {
            throw new RuntimeException('هذا القرار يتطلب سبباً أو ملخص حسم.');
        }
        if ($recoveredAmountMinor !== null && $confirmedLossMinor !== null && $recoveredAmountMinor > $confirmedLossMinor) {
            throw new RuntimeException('المبلغ المسترد لا يتجاوز الخسارة المؤكَّدة.');
        }
        if ($toStatus === PosInvestigationCase::STATUS_CONFIRMED_LOSS && $confirmedLossMinor === null) {
            throw new RuntimeException('حسم الخسارة المؤكَّدة يتطلب تحديد مبلغها.');
        }

        return DB::transaction(function () use ($actor, $case, $from, $toStatus, $normalizedReason, $normalizedNote, $confirmedLossMinor, $recoveredAmountMinor) {
            $fresh = PosInvestigationCase::query()->lockForUpdate()->findOrFail($case->id);
            if ($fresh->status !== $from) {
                throw new RuntimeException('تغيّرت حالة القضية أثناء الحسم؛ أعد المحاولة.');
            }

            $isClosing = $toStatus === PosInvestigationCase::STATUS_CLOSED;
            $isOutcome = in_array($toStatus, PosInvestigationCase::OUTCOME_STATUSES, true);

            $update = ['status' => $toStatus];
            if ($confirmedLossMinor !== null) {
                $update['confirmed_loss_minor'] = $confirmedLossMinor;
            }
            if ($recoveredAmountMinor !== null) {
                $update['recovered_amount_minor'] = $recoveredAmountMinor;
            }
            if ($isOutcome) {
                // إغلاق قضية محسومة سلفاً (confirmed_loss/control_failure/explained/dismissed
                // → closed) لا يطمس تلك النتيجة ولا وقت حسمها: `closed` حالة نهائية لا تصنيف
                // نتيجة بديل، والملخص اليومي يفلتر بـ `outcome`/`resolved_at` فتختفي الخسارة
                // المؤكَّدة صامتاً من مقاييسه لو استُبدلت. سبب/ملاحظة الإغلاق نفسه يبقيان
                // موثَّقين في نشاط resolution_recorded أدناه بلا فقدان معلومة.
                $hasPriorOutcome = $isClosing && $fresh->outcome !== null;
                if (! $hasPriorOutcome) {
                    $update['outcome'] = $toStatus;
                    $update['resolution_reason'] = $normalizedReason !== '' ? substr($normalizedReason, 0, 80) : null;
                    $update['resolution_summary'] = $normalizedNote !== '' ? substr($normalizedNote, 0, 2000) : null;
                    $update['resolved_at'] = Carbon::now();
                }
            }
            if ($isClosing) {
                $update['closed_at'] = Carbon::now();
            }

            $fresh->forceFill($update)->save();

            $this->recordActivity(
                $fresh, $actor,
                $isClosing ? PosCaseActivity::ACTION_RESOLUTION_RECORDED : PosCaseActivity::ACTION_STATUS_CHANGED,
                ['from' => $from, 'to' => $toStatus],
                $normalizedReason !== '' ? $normalizedReason : ($normalizedNote !== '' ? $normalizedNote : null),
            );
            if ($confirmedLossMinor !== null || $recoveredAmountMinor !== null) {
                $this->recordActivity($fresh, $actor, PosCaseActivity::ACTION_AMOUNT_OUTCOME_UPDATED, [
                    'confirmed_loss_minor' => $confirmedLossMinor, 'recovered_amount_minor' => $recoveredAmountMinor,
                ]);
            }
            $this->touchActivity($fresh, false);

            return $fresh->fresh();
        });
    }

    /** إعادة فتح صريحة لقضية مغلقة فقط — انتقال مستقل عن changeStatus، مسجَّل ومُسبَّب دوماً. */
    public function reopen(User $actor, PosInvestigationCase $case, string $reason): PosInvestigationCase
    {
        if (trim($reason) === '') {
            throw new RuntimeException('إعادة الفتح تتطلب سبباً.');
        }
        if ($case->status !== PosInvestigationCase::STATUS_CLOSED) {
            throw new RuntimeException('لا يمكن إعادة فتح إلا قضية مغلقة.');
        }

        return DB::transaction(function () use ($actor, $case, $reason) {
            $fresh = PosInvestigationCase::query()->lockForUpdate()->findOrFail($case->id);
            if ($fresh->status !== PosInvestigationCase::STATUS_CLOSED) {
                throw new RuntimeException('تغيّرت حالة القضية أثناء إعادة الفتح؛ أعد المحاولة.');
            }

            $fresh->forceFill([
                'status' => PosInvestigationCase::STATUS_INVESTIGATING,
                'closed_at' => null,
                'resolved_at' => null,
            ])->save();

            $this->recordActivity($fresh, $actor, PosCaseActivity::ACTION_REOPENED, [
                'from' => PosInvestigationCase::STATUS_CLOSED, 'to' => PosInvestigationCase::STATUS_INVESTIGATING,
            ], substr(trim($reason), 0, 2000));
            $this->touchActivity($fresh, false);

            return $fresh->fresh();
        });
    }

    /**
     * AUR على مستوى القضية = مجموع `ABS(amount)` لمعرّفات أحداث فريدة (اتحاد `amount_event_ids`
     * لاستثناءات مرتبطة نشطة + معرّفات أحداث مرتبطة مباشرة تحمل مبلغاً) — بلا ازدواج عبر أدلة متداخلة.
     */
    public function recalculateAmountUnderReview(PosInvestigationCase $case): int
    {
        $eventIds = [];

        PosCaseEvidenceLink::query()->withoutGlobalScope(BranchScope::class)
            ->where('case_id', $case->id)
            ->whereNull('unlinked_at')
            ->whereNotNull('pos_exception_id')
            ->with('exception:id,amount_event_ids')
            ->get()
            ->each(function (PosCaseEvidenceLink $link) use (&$eventIds) {
                foreach ((array) ($link->exception?->amount_event_ids ?? []) as $id) {
                    $eventIds[$id] = true;
                }
            });

        PosCaseEvidenceLink::query()->withoutGlobalScope(BranchScope::class)
            ->where('case_id', $case->id)
            ->whereNull('unlinked_at')
            ->whereNotNull('pos_session_event_id')
            ->pluck('pos_session_event_id')
            ->each(function ($id) use (&$eventIds) {
                $eventIds[$id] = true;
            });

        $total = 0;
        if ($eventIds !== []) {
            $total = (int) PosSessionEvent::query()->withoutGlobalScope(BranchScope::class)
                ->whereIn('id', array_keys($eventIds))->sum(DB::raw('ABS(amount)'));
        }

        $case->forceFill(['amount_under_review_minor' => $total])->save();

        return $total;
    }

    /** @return array<int, PosInvestigationCase> قضايا مفتوحة قائمة لنفس الموضوع/الجلسة — تحذير لا اندماج تلقائي. */
    public function findPossibleDuplicates(?string $subjectUserId, ?string $posSessionId): array
    {
        if ($subjectUserId === null && $posSessionId === null) {
            return [];
        }
        $activeStatuses = [
            PosInvestigationCase::STATUS_OPEN, PosInvestigationCase::STATUS_INVESTIGATING,
            PosInvestigationCase::STATUS_AWAITING_INFORMATION,
        ];

        return PosInvestigationCase::query()->withoutGlobalScope(BranchScope::class)
            ->whereIn('status', $activeStatuses)
            ->where(function ($q) use ($subjectUserId, $posSessionId) {
                if ($subjectUserId !== null) {
                    $q->orWhere('subject_user_id', $subjectUserId);
                }
                if ($posSessionId !== null) {
                    $q->orWhere('pos_session_id', $posSessionId);
                }
            })
            ->limit(10)->get()->all();
    }

    private function defaultTitleFor(PosException $exception): string
    {
        return trim(sprintf('%s — %s', $exception->rule_key, $exception->category));
    }

    /**
     * مستخدم مقيَّد بفروع لا يُسمح له بربط/ترقية دليل من فرع خارج نطاقه —
     * وإلا يصل إلى تفاصيل رقابية عبر timeline لا يراها عبر مسارات القراءة المعزولة.
     * غير المقيَّد (`allowedBranchIds() === null`) يمرّ لكل فروع المستأجر.
     */
    private function assertActorCanAccessEvidenceBranch(User $actor, ?string $branchId, string $label): void
    {
        if ($branchId !== null && ! $actor->canAccessBranch($branchId)) {
            throw new RuntimeException("لا يمكن ربط {$label} خارج نطاق فروعك.");
        }
    }

    private function recordActivity(PosInvestigationCase $case, User $actor, string $action, array $meta = [], ?string $note = null): void
    {
        PosCaseActivity::create([
            'branch_id' => $case->branch_id,
            'case_id' => $case->id,
            'action' => $action,
            'actor_id' => $actor->id,
            'meta' => $meta,
            'note' => $note,
            'created_at' => Carbon::now(),
        ]);
    }

    private function touchActivity(PosInvestigationCase $case, bool $refreshInstance = true): void
    {
        PosInvestigationCase::query()->whereKey($case->id)->update(['last_activity_at' => Carbon::now()]);
        if ($refreshInstance) {
            $case->last_activity_at = Carbon::now();
        }
    }
}
