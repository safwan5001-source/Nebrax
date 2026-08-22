<?php

namespace App\Services\Accounting;

use App\Models\Invoice;
use App\Models\Payment;
use App\Models\PosSession;
use App\Tenancy\BranchContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PosSessionService — جلسات/ورديات نقطة البيع
 * ═══════════════════════════════════════════════════════════════
 *  - open(): يفتح جلسة برصيد افتتاحي (يُرفض إن وُجدت جلسة مفتوحة).
 *  - requireOpenForCheckout(): يقفل الجلسة ويتحقق من مسؤولها وفرعها قبل بيع POS.
 *  - close(): يحسب المتوقع من سندات القبض النقدية المنسوبة للجلسة نفسها.
 *
 * الجلسة سجل تشغيلي للمطابقة، وليست منشأ قيد مستقل. البيع وسنداته يرحّلان عبر
 * InvoiceService وPaymentService، ويرتبطان بالجلسة كي لا يخلط التقرير حركة نقدية
 * من جلسة أو خزينة أخرى لمجرد تطابق النافذة الزمنية. كل المبالغ بالهللات.
 */
class PosSessionService
{
    public function open(int $openingBalance, ?string $userId = null): PosSession
    {
        if (PosSession::where('status', 'open')->exists()) {
            throw new RuntimeException('توجد جلسة مفتوحة بالفعل — أغلقها أولاً.');
        }
        if ($openingBalance < 0) {
            throw new RuntimeException('الرصيد الافتتاحي لا يكون سالباً.');
        }

        return PosSession::create([
            'number'          => $this->nextNumber(),
            'status'          => 'open',
            'opening_balance' => $openingBalance,
            'opened_at'       => now(),
            'opened_by'       => $userId,
        ]);
    }

    /**
     * يقفل صف الجلسة داخل معاملة بيع POS، فيمنع أن تنزلق عملية بيع بعد الإقفال.
     * يتحقق كذلك من مسؤول الكاشير والفرع النشط؛ معرّف الجلسة لا يصبح تصريحاً
     * مستقلاً يمكن تمريره من متصفح آخر أو فرع مختلف.
     */
    public function requireOpenForCheckout(string $sessionId, ?string $userId): PosSession
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

        return $session;
    }

    public function close(PosSession $session, int $countedBalance): PosSession
    {
        if ($countedBalance < 0) {
            throw new RuntimeException('الرصيد المعدود لا يكون سالباً.');
        }

        return DB::transaction(function () use ($session, $countedBalance) {
            // القفل نفسه الذي يأخذه checkout() يحسم سباق الإقفال/البيع: إما يُلحق
            // البيع بالجلسة قبل العد، أو يرى البيع أن الجلسة أُغلقت فيُرفض.
            $session = PosSession::lockForUpdate()->findOrFail($session->id);
            if (! $session->isOpen()) {
                throw new RuntimeException('الجلسة مغلقة بالفعل.');
            }

            $cash = $this->cashMovement($session);
            $expected = $session->opening_balance + $cash['net'];

            $session->update([
                'status'           => 'closed',
                'closing_balance'  => $countedBalance,
                'expected_balance' => $expected,
                'difference'       => $countedBalance - $expected,
                'closed_at'        => now(),
            ]);

            return $session->fresh();
        });
    }

    /**
     * تقرير الوردية (X/Z): النقد المُستلَم من سندات القبض المنسوبة للجلسة +
     * المتوقّع + عدد فواتير POS. للجلسة المفتوحة يُحسب حتى الآن؛ للمغلقة من
     * المستندات المثبتة عليها، لا من نطاق زمني قد يلتقط معاملات غيرها.
     *
     * @return array{cash_sales:int, sales_count:int, average:int, expected:int}
     */
    public function report(PosSession $session): array
    {
        $cash = $this->cashMovement($session);
        $invoices = Invoice::where('pos_session_id', $session->id)
            ->where('status', 'posted');
        $salesTotal = (int) $invoices->sum('total');
        $count = (int) $invoices->count();

        return [
            'cash_sales'  => $cash['inflow'],
            'sales_count' => $count,
            'average'     => $count > 0 ? intdiv($salesTotal, $count) : 0,
            'expected'    => $session->opening_balance + $cash['net'],
        ];
    }

    /**
     * النقد الوارد/الصافي من سندات قبض نقدية مرحّلة تخص الجلسة. لا تستخدم
     * JournalLine ولا التاريخ؛ فذلك يخلط أثر جلسات أخرى أو قبضاً خارج POS.
     *
     * @return array{inflow:int, net:int}
     */
    protected function cashMovement(PosSession $session): array
    {
        $inflow = (int) Payment::where('pos_session_id', $session->id)
            ->where('status', 'posted')
            ->where('direction', 'received')
            ->where('method', 'cash')
            ->sum('amount');

        return ['inflow' => $inflow, 'net' => $inflow];
    }

    protected function nextNumber(): string
    {
        return PosSession::nextDocumentNumber('POS', Carbon::now()->toDateString());
    }
}
