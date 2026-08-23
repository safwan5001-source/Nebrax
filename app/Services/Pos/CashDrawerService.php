<?php

namespace App\Services\Pos;

use App\Models\Invoice;
use App\Models\PosSession;
use App\Models\PosSessionEvent;
use App\Models\User;
use App\Services\Pos\Hardware\CashDrawerAdapter;
use App\Services\Pos\Hardware\UnavailableCashDrawerAdapter;
use App\Tenancy\BranchContext;
use RuntimeException;
use Throwable;

/**
 * بوابة أجهزة درج POS. لا تنشئ فاتورة أو دفعة أو قيداً؛ تسجل فقط محاولة موصل
 * محلي بعد تحقق السياق. Driver الافتراضي غير مدعوم حتى تهيئة بيئة الأجهزة.
 */
final class CashDrawerService
{
    private CashDrawerAdapter $adapter;

    public function __construct(?CashDrawerAdapter $adapter = null)
    {
        $this->adapter = $adapter ?? new UnavailableCashDrawerAdapter();
    }

    /** @return array{status:'opened'|'unsupported'|'not_configured'|'failed',error_code:?string} */
    public function openManually(PosSession $session, User $actor, ?string $reason = null): array
    {
        if (! $actor->hasPermission('pos.cash_drawer.open')) {
            throw new RuntimeException('لا تملك صلاحية فتح درج نقطة البيع.');
        }

        return $this->attempt($session, $actor, 'manual', null, $reason);
    }

    /** لا يفشل البيع عند تعذر الجهاز؛ تسجّل النتيجة وتبقى الفاتورة والمدفوعات ذرية. */
    public function openAfterCashPayment(PosSession $session, ?User $actor, Invoice $invoice): array
    {
        return $this->attempt($session, $actor, 'automatic', $invoice, null);
    }

    /** @return array{status:'opened'|'unsupported'|'not_configured'|'failed',error_code:?string} */
    private function attempt(PosSession $session, ?User $actor, string $mode, ?Invoice $invoice, ?string $reason): array
    {
        $branchId = app(BranchContext::class)->id();
        if (! $session->isOpen() || $session->branch_id !== $branchId) {
            throw new RuntimeException('جلسة نقطة البيع ليست مفتوحة في الفرع النشط.');
        }
        if ($actor && (! $actor->canAccessBranch($branchId)
            || ($session->warehouse_id !== null && ! $actor->canAccessWarehouse($session->warehouse_id)))) {
            throw new RuntimeException('جلسة نقطة البيع أو مخزنها خارج نطاق صلاحياتك.');
        }

        try {
            $result = $this->adapter->open($session, [
                'mode' => $mode,
                'invoice_id' => $invoice?->id,
                'reason' => $reason,
            ]);
        } catch (Throwable) {
            // لا نكشف رسالة سائق محلي ولا نسمح لعطله بإعادة مسار البيع المالي.
            $result = ['status' => 'failed', 'error_code' => 'cash_drawer_adapter_error'];
        }

        PosSessionEvent::create([
            'branch_id' => $session->branch_id,
            'pos_session_id' => $session->id,
            'type' => PosSessionEvent::TYPE_CASH_DRAWER_OPEN_ATTEMPT,
            'actor_id' => $actor?->id,
            'payload' => [
                'mode' => $mode,
                'pos_device_id' => $session->pos_device_id,
                'shift_id' => $session->shift_id,
                'invoice_id' => $invoice?->id,
                'reason' => $reason,
                'status' => $result['status'],
                'error_code' => $result['error_code'],
            ],
            'created_at' => now(),
        ]);

        return $result;
    }
}
