<?php

namespace App\Services\Accounting;

use App\Models\Invoice;
use App\Models\Payment;
use App\Models\PosCashMovement;
use App\Models\PosDevice;
use App\Models\PosSession;
use App\Models\PosSessionEvent;
use App\Models\ReturnDocument;
use App\Models\Shift;
use App\Models\User;
use App\Models\Warehouse;
use App\Tenancy\BranchContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * جلسات/ورديات نقطة البيع ومطابقة الدرج.
 *
 * حركات الدرج هنا تشغيلية داخل الصندوق فقط: لا تمثل قبضاً أو صرفاً خارجياً، ولا
 * تنشئ قيداً محاسبياً. التحصيل والصرف والتحويل المالي تبقى حصراً في وحداتها.
 * كل المبالغ بالهللات.
 */
class PosSessionService
{
    public function open(
        int $openingBalance,
        string $deviceId,
        ?string $shiftId = null,
        ?string $userId = null,
        ?User $actor = null,
    ): PosSession {
        if ($openingBalance < 0) {
            throw new RuntimeException('الرصيد الافتتاحي لا يكون سالباً.');
        }

        return DB::transaction(function () use ($openingBalance, $deviceId, $shiftId, $userId, $actor) {
            $device = PosDevice::lockForUpdate()->findOrFail($deviceId);
            $branchId = app(BranchContext::class)->id();
            if ($device->branch_id !== $branchId) {
                throw new RuntimeException('جهاز نقطة البيع لا يخص الفرع النشط.');
            }
            if (! $device->is_active) {
                throw new RuntimeException('لا يمكن فتح وردية على جهاز نقطة بيع معطّل.');
            }

            $warehouse = Warehouse::whereKey($device->warehouse_id)->first();
            if (! $warehouse || ! $warehouse->is_active) {
                throw new RuntimeException('مستودع جهاز نقطة البيع غير متاح.');
            }
            if ($warehouse->branch_id !== null && $warehouse->branch_id !== $branchId) {
                throw new RuntimeException('مستودع جهاز نقطة البيع لا يخص الفرع النشط.');
            }
            if ($actor && (! $actor->canAccessBranch($branchId) || ! $actor->canAccessWarehouse($warehouse->id))) {
                throw new RuntimeException('جهاز نقطة البيع أو مستودعه خارج نطاق صلاحياتك.');
            }

            $shift = $this->resolveShift($shiftId, $branchId);
            if (PosSession::where('pos_device_id', $device->id)->where('status', 'open')->exists()) {
                throw new RuntimeException('توجد وردية مفتوحة على جهاز نقطة البيع المحدد — أغلقها أولاً.');
            }

            return PosSession::create([
                'number'          => $this->nextNumber(),
                'status'          => 'open',
                'opening_balance' => $openingBalance,
                'opened_at'       => now(),
                'opened_by'       => $userId,
                'pos_device_id'   => $device->id,
                'warehouse_id'    => $warehouse->id,
                'shift_id'        => $shift?->id,
            ]);
        });
    }

    /** يقفل الجلسة داخل معاملة البيع ويتحقق من مسؤولها وفرعها وصلاحية مخزنها. */
    public function requireOpenForCheckout(string $sessionId, ?string $userId, ?User $actor = null): PosSession
    {
        $session = PosSession::lockForUpdate()->findOrFail($sessionId);

        if (! $session->isOpen()) {
            throw new RuntimeException('جلسة نقطة البيع مغلقة ولا تقبل عملية بيع جديدة.');
        }
        if ($session->opened_by !== null && $session->opened_by !== $userId) {
            throw new RuntimeException('جلسة نقطة البيع تخص كاشيراً آخر.');
        }

        $branchId = app(BranchContext::class)->id();
        if ($session->branch_id !== $branchId) {
            throw new RuntimeException('جلسة نقطة البيع لا تخص الفرع النشط.');
        }
        if ($actor && (! $actor->canAccessBranch($branchId)
            || ($session->warehouse_id !== null && ! $actor->canAccessWarehouse($session->warehouse_id)))) {
            throw new RuntimeException('جلسة نقطة البيع أو مخزنها خارج نطاق صلاحياتك.');
        }

        return $session;
    }

    /**
     * يسجّل إدخالاً أو إخراجاً مادياً من درج الكاشير المفتوح. لا يمثل حركة مالية
     * خارج المنشأة ولا يعدّل حساب الصندوق؛ لذلك لا ينشئ قيداً أو سند دفع.
     */
    public function recordCashMovement(PosSession $session, string $type, int $amount, string $reason, User $actor): PosCashMovement
    {
        if (! in_array($type, PosCashMovement::TYPES, true)) {
            throw new RuntimeException('نوع حركة الدرج غير صالح.');
        }
        if ($amount <= 0) {
            throw new RuntimeException('مبلغ حركة الدرج يجب أن يكون موجباً.');
        }
        $reason = trim($reason);
        if ($reason === '') {
            throw new RuntimeException('سبب حركة الدرج مطلوب.');
        }

        return DB::transaction(function () use ($session, $type, $amount, $reason, $actor) {
            $session = PosSession::lockForUpdate()->findOrFail($session->id);
            $this->assertDrawerActor($session, $actor);
            if ($type === PosCashMovement::TYPE_CASH_OUT
                && $amount > $session->opening_balance + $this->cashMovement($session)['net']) {
                throw new RuntimeException('لا يمكن إخراج مبلغ يتجاوز الرصيد المتوقع داخل درج الجلسة.');
            }

            $movement = PosCashMovement::create([
                'branch_id'      => $session->branch_id,
                'pos_session_id' => $session->id,
                'type'           => $type,
                'amount'         => $amount,
                'reason'         => $reason,
                'recorded_by'    => $actor->id,
                'created_at'     => now(),
            ]);

            $this->recordEvent($session, $type === PosCashMovement::TYPE_CASH_IN
                ? PosSessionEvent::TYPE_CASH_IN_RECORDED
                : PosSessionEvent::TYPE_CASH_OUT_RECORDED, $actor, [
                    'cash_movement_id' => $movement->id,
                    'type' => $type,
                    'amount' => $amount,
                    'reason' => $reason,
                ]);

            return $movement->fresh('recordedBy');
        });
    }

    public function close(PosSession $session, int $countedBalance, ?string $userId = null): PosSession
    {
        if ($countedBalance < 0) {
            throw new RuntimeException('الرصيد المعدود لا يكون سالباً.');
        }

        return DB::transaction(function () use ($session, $countedBalance, $userId) {
            // القفل نفسه الذي يأخذه checkout() وحركة الدرج يحسم سباق الإقفال مع البيع أو السحب.
            $session = PosSession::lockForUpdate()->findOrFail($session->id);
            if (! $session->isOpen()) {
                throw new RuntimeException('الجلسة مغلقة بالفعل.');
            }

            $cash = $this->cashMovement($session);
            $expected = $session->opening_balance + $cash['net'];
            $difference = $countedBalance - $expected;
            $requiresAcknowledgement = $difference !== 0;

            $session->update([
                'status'                           => 'closed',
                'closing_balance'                  => $countedBalance,
                'expected_balance'                 => $expected,
                'difference'                       => $difference,
                'difference_status'                => $requiresAcknowledgement ? 'pending' : 'not_required',
                'difference_acknowledged_by'       => null,
                'difference_acknowledged_at'       => null,
                'difference_acknowledgement_note'  => null,
                'closed_at'                        => now(),
                'closed_by'                        => $userId,
            ]);

            if ($requiresAcknowledgement) {
                $actor = $userId ? User::find($userId) : null;
                $this->recordEvent($session, PosSessionEvent::TYPE_CLOSING_DIFFERENCE_REQUIRES_ACKNOWLEDGEMENT, $actor, [
                    'counted_balance' => $countedBalance,
                    'expected_balance' => $expected,
                    'difference' => $difference,
                ]);
            }

            return $session->fresh();
        });
    }

    /** اعتماد إداري للفرق يقر بالحالة فقط؛ لا ينشئ تسوية أو قيداً محاسبياً. */
    public function acknowledgeDifference(PosSession $session, string $note, User $actor): PosSession
    {
        $note = trim($note);
        if ($note === '') {
            throw new RuntimeException('ملاحظة اعتماد فرق الإغلاق مطلوبة.');
        }
        if (! $actor->hasPermission('pos.variance.approve')) {
            throw new RuntimeException('لا تملك صلاحية اعتماد فرق إغلاق نقطة البيع.');
        }

        return DB::transaction(function () use ($session, $note, $actor) {
            $session = PosSession::lockForUpdate()->findOrFail($session->id);
            if ($session->status !== 'closed') {
                throw new RuntimeException('لا يمكن اعتماد فرق جلسة لم تُغلق بعد.');
            }
            if ((int) $session->difference === 0 || $session->difference_status === 'not_required') {
                throw new RuntimeException('لا يوجد فرق إغلاق يتطلب اعتماداً.');
            }
            if ($session->difference_status === 'acknowledged') {
                throw new RuntimeException('فرق الإغلاق معتمد بالفعل.');
            }

            $session->update([
                'difference_status'               => 'acknowledged',
                'difference_acknowledged_by'      => $actor->id,
                'difference_acknowledged_at'      => now(),
                'difference_acknowledgement_note' => $note,
            ]);

            $this->recordEvent($session, PosSessionEvent::TYPE_CLOSING_DIFFERENCE_ACKNOWLEDGED, $actor, [
                'difference' => (int) $session->difference,
                'note' => $note,
            ]);

            return $session->fresh();
        });
    }

    /**
     * تقرير X/Z يقرأ مستندات الجلسة الثابتة لا نافذةً زمنية: نقد البيع يدخل،
     * وردّ النقد المرحّل يخرج، وحركات الدرج التشغيلية لا تمسّ القيود.
     *
     * @return array{cash_sales:int,cash_refunds:int,cash_in:int,cash_out:int,sales_count:int,returns_count:int,returns_total:int,net_sales:int,average:int,expected:int}
     */
    public function report(PosSession $session): array
    {
        $cash = $this->cashMovement($session);
        $invoices = Invoice::where('pos_session_id', $session->id)->where('status', 'posted');
        $salesTotal = (int) $invoices->sum('total');
        $count = (int) $invoices->count();
        $returns = ReturnDocument::where('pos_session_id', $session->id)
            ->where('type', 'sales')
            ->where('status', 'posted');
        $returnsTotal = (int) $returns->sum('total');
        $returnsCount = (int) $returns->count();

        return [
            'cash_sales' => $cash['cash_sales'],
            'cash_refunds' => $cash['cash_refunds'],
            'cash_in' => $cash['cash_in'],
            'cash_out' => $cash['cash_out'],
            'sales_count' => $count,
            'returns_count' => $returnsCount,
            'returns_total' => $returnsTotal,
            'net_sales' => $salesTotal - $returnsTotal,
            'average' => $count > 0 ? intdiv($salesTotal, $count) : 0,
            'expected' => $session->opening_balance + $cash['net'],
        ];
    }

    /** @return array{cash_sales:int,cash_refunds:int,cash_in:int,cash_out:int,net:int} */
    protected function cashMovement(PosSession $session): array
    {
        $cashSales = (int) Payment::where('pos_session_id', $session->id)
            ->where('status', 'posted')
            ->where('direction', 'received')
            ->where('method', 'cash')
            ->sum('amount');
        $cashRefunds = (int) ReturnDocument::where('pos_session_id', $session->id)
            ->where('type', 'sales')
            ->where('status', 'posted')
            ->where('payment_type', 'cash')
            ->sum('total');
        $cashIn = (int) PosCashMovement::where('pos_session_id', $session->id)
            ->where('type', PosCashMovement::TYPE_CASH_IN)
            ->sum('amount');
        $cashOut = (int) PosCashMovement::where('pos_session_id', $session->id)
            ->where('type', PosCashMovement::TYPE_CASH_OUT)
            ->sum('amount');

        return [
            'cash_sales' => $cashSales,
            'cash_refunds' => $cashRefunds,
            'cash_in' => $cashIn,
            'cash_out' => $cashOut,
            'net' => $cashSales + $cashIn - $cashOut - $cashRefunds,
        ];
    }

    /** يسجل أثر المرتجع في السجل فقط؛ القيد والمخزون مرّرا مسبقاً عبر ReturnService. */
    public function recordReturn(PosSession $session, ReturnDocument $return, User $actor): void
    {
        $this->assertDrawerActor($session, $actor);
        if (! $return->isPosted() || $return->pos_session_id !== $session->id) {
            throw new RuntimeException('المرتجع المرحّل لا يخص جلسة نقطة البيع المحددة.');
        }

        $this->recordEvent($session, PosSessionEvent::TYPE_RETURN_RECORDED, $actor, [
            'return_id' => $return->id,
            'return_number' => $return->number,
            'original_id' => $return->original_id,
            'payment_type' => $return->payment_type,
            'amount' => (int) $return->total,
        ]);
    }

    private function assertDrawerActor(PosSession $session, User $actor): void
    {
        if (! $session->isOpen()) {
            throw new RuntimeException('لا يمكن تسجيل حركة درج بعد إغلاق الجلسة.');
        }
        if ($session->opened_by !== null && $session->opened_by !== $actor->id) {
            throw new RuntimeException('حركة الدرج تخص كاشير الجلسة المفتوحة فقط.');
        }

        $branchId = app(BranchContext::class)->id();
        if ($session->branch_id !== $branchId || ! $actor->canAccessBranch($branchId)) {
            throw new RuntimeException('جلسة نقطة البيع لا تخص الفرع النشط أو صلاحياتك.');
        }
        if ($session->warehouse_id !== null && ! $actor->canAccessWarehouse($session->warehouse_id)) {
            throw new RuntimeException('مخزن جلسة نقطة البيع خارج نطاق صلاحياتك.');
        }
    }

    /** @param array<string,mixed> $payload */
    private function recordEvent(PosSession $session, string $type, ?User $actor, array $payload): PosSessionEvent
    {
        return PosSessionEvent::create([
            'branch_id' => $session->branch_id,
            'pos_session_id' => $session->id,
            'type' => $type,
            'actor_id' => $actor?->id,
            'payload' => $payload,
            'created_at' => now(),
        ]);
    }

    private function resolveShift(?string $shiftId, ?string $branchId): ?Shift
    {
        if ($shiftId === null) {
            return null;
        }

        $shift = Shift::whereKey($shiftId)->first();
        if (! $shift) {
            throw new RuntimeException('وردية العمل غير موجودة أو لا تخص الفرع النشط.');
        }
        if (! $shift->is_active) {
            throw new RuntimeException('وردية العمل المحددة معطّلة.');
        }
        if ($shift->branch_id !== null && $shift->branch_id !== $branchId) {
            throw new RuntimeException('وردية العمل لا تخص الفرع النشط.');
        }

        return $shift;
    }

    protected function nextNumber(): string
    {
        return PosSession::nextDocumentNumber('POS', Carbon::now()->toDateString());
    }
}
