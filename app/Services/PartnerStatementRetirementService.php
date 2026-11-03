<?php

namespace App\Services;

use App\Models\PartnerStatementReconciliation;
use App\Models\PartnerStatementReconciliationEvent;
use App\Models\PartnerStatementUnitClaim;
use App\Models\User;
use RuntimeException;

/**
 * إخراج مقارنة نهائية من الخدمة: إبطال (`closed → voided`) أو استبدال (`closed → superseded`) — IMP-PS-A3e. **لا أثر مالي**: حدث تدقيق + تغيير حالة المقارنة فقط؛ إفراج المطالبات تفعله **القاعدة** عند الانتقال
 * (مُشغّل `AFTER UPDATE` يضع `released_at = voided_at` لمطالبات المقارنة الفعّالة) فلا يسقط الإفراج بنسيان ولا بمسار خام. تُستدعى **داخل معاملة المُنادي** والمقارنة مقفولة `FOR UPDATE` (يضمنه المُنادي: `void()` و`replace()`
 * في `PartnerStatementLifecycleService` بعد القفل الاستشاري الواسع للطرف/الدور)، ولا تفتح معاملة ولا تأخذ أقفالاً. السبب والفاعل والوقت تُسجَّل على الحدث وعلى المقارنة معاً؛ تاريخ المراجعة والإغلاق يبقى كما هو.
 */
final class PartnerStatementRetirementService
{
    /**
     * @return int عدد المطالبات الفعّالة التي أُفرجت (يطابقها `claims_count` في الحدث، وتتحقق منه القاعدة)
     */
    public function retire(User $actor, PartnerStatementReconciliation $final, string $reason, ?string $replacementId): int
    {
        if ($final->status !== PartnerStatementReconciliation::STATUS_CLOSED) {
            throw new RuntimeException('لا يُخرَج من الخدمة إلا نهائي مُغلق.');
        }

        $superseding = $replacementId !== null;
        $released = PartnerStatementUnitClaim::query()->where('reconciliation_id', $final->id)->whereNull('released_at')->count();
        $last = PartnerStatementReconciliationEvent::query()->where('reconciliation_id', $final->id)->max('seq');
        $at = now();

        PartnerStatementReconciliationEvent::create([
            'reconciliation_id' => $final->id, 'seq' => ((int) $last) + 1,
            'action' => $superseding ? PartnerStatementReconciliationEvent::ACTION_SUPERSEDE : PartnerStatementReconciliationEvent::ACTION_VOID,
            'from_status' => PartnerStatementReconciliation::STATUS_CLOSED,
            'to_status' => $superseding ? PartnerStatementReconciliation::STATUS_SUPERSEDED : PartnerStatementReconciliation::STATUS_VOIDED,
            'run_id' => $final->reviewed_run_id, 'summary' => ['scope_key' => $final->scope_key, 'claims_released' => $released, 'closed_at' => optional($final->closed_at)->toIso8601String(), 'closed_by' => $final->closed_by],
            'reason' => $reason, 'created_by' => $actor->getKey(), 'claims_count' => $released, 'related_reconciliation_id' => $replacementId, 'created_at' => $at,
        ]);
        $final->update([
            'status' => $superseding ? PartnerStatementReconciliation::STATUS_SUPERSEDED : PartnerStatementReconciliation::STATUS_VOIDED,
            'voided_at' => $at, 'voided_by' => $actor->getKey(), 'void_reason' => $reason, 'superseded_by_id' => $replacementId,
        ]);

        return $released;
    }
}
