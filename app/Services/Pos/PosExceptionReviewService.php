<?php

namespace App\Services\Pos;

use App\Models\PosException;
use App\Models\PosExceptionReview;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * دورة مراجعة خفيفة للاستثناءات (ليست إدارة قضايا كاملة — تلك Phase 3).
 *
 * لا تمسّ الدليل الأصلي (`PosSessionEvent`) ولا تحذفه: تنقل حالة الاستثناء
 * المشتقّ فقط، وتوثّق كل انتقال في `pos_exception_reviews` append-only فيبقى
 * تاريخ القرارات قابلاً للتدقيق ولا يُطمس فوق قرار سابق. إعادة الفتح صريحة ومسجّلة.
 */
final class PosExceptionReviewService
{
    /** الانتقالات المسموحة بين الحالات. */
    private const TRANSITIONS = [
        PosException::STATE_NEW => [PosException::STATE_REVIEWING, PosException::STATE_EXPLAINED, PosException::STATE_DISMISSED, PosException::STATE_NEEDS_INVESTIGATION],
        PosException::STATE_REVIEWING => [PosException::STATE_EXPLAINED, PosException::STATE_DISMISSED, PosException::STATE_NEEDS_INVESTIGATION, PosException::STATE_NEW],
        PosException::STATE_EXPLAINED => [PosException::STATE_REVIEWING, PosException::STATE_NEEDS_INVESTIGATION],
        PosException::STATE_DISMISSED => [PosException::STATE_REVIEWING, PosException::STATE_NEEDS_INVESTIGATION],
        PosException::STATE_NEEDS_INVESTIGATION => [PosException::STATE_REVIEWING, PosException::STATE_EXPLAINED, PosException::STATE_DISMISSED],
    ];

    /** الحالات التي تتطلب سبباً/توضيحاً مهيكلاً. */
    private const REASON_REQUIRED = [
        PosException::STATE_EXPLAINED,
        PosException::STATE_DISMISSED,
        PosException::STATE_NEEDS_INVESTIGATION,
    ];

    public function transition(PosException $exception, User $actor, string $toState, ?string $reason, ?string $note): PosException
    {
        if (! in_array($toState, PosException::STATES, true)) {
            throw new RuntimeException('حالة المراجعة غير معروفة.');
        }
        $from = $exception->review_state;
        if ($from === $toState) {
            throw new RuntimeException('الاستثناء في هذه الحالة بالفعل.');
        }
        $allowed = self::TRANSITIONS[$from] ?? [];
        if (! in_array($toState, $allowed, true)) {
            throw new RuntimeException('انتقال حالة المراجعة غير مسموح.');
        }
        $normalizedNote = is_string($note) ? trim($note) : '';
        if (in_array($toState, self::REASON_REQUIRED, true) && ($reason === null || trim($reason) === '') && $normalizedNote === '') {
            throw new RuntimeException('هذا القرار يتطلب سبباً أو توضيحاً.');
        }

        return DB::transaction(function () use ($exception, $actor, $from, $toState, $reason, $normalizedNote) {
            $fresh = PosException::query()->lockForUpdate()->findOrFail($exception->id);
            if ($fresh->review_state !== $from) {
                throw new RuntimeException('تغيّرت حالة الاستثناء أثناء المراجعة؛ أعد المحاولة.');
            }

            $fresh->forceFill([
                'review_state' => $toState,
                'reviewed_by' => $actor->id,
                'reviewed_at' => Carbon::now(),
                'review_reason' => $reason !== null && trim($reason) !== '' ? substr(trim($reason), 0, 80) : null,
                'review_note' => $normalizedNote !== '' ? substr($normalizedNote, 0, 2000) : null,
            ])->save();

            // سجلّ append-only لا يطمس القرار السابق؛ يوثّق المنفّذ والوقت والسبب.
            PosExceptionReview::create([
                'branch_id' => $fresh->branch_id,
                'pos_exception_id' => $fresh->id,
                'from_state' => $from,
                'to_state' => $toState,
                'reviewed_by' => $actor->id,
                'reason' => $reason !== null && trim($reason) !== '' ? substr(trim($reason), 0, 80) : null,
                'note' => $normalizedNote !== '' ? substr($normalizedNote, 0, 2000) : null,
                'created_at' => Carbon::now(),
            ]);

            return $fresh->fresh(['reviewer']);
        });
    }
}
