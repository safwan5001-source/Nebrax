<?php

namespace App\Services\Accounting;

use App\Models\Invoice;
use App\Models\PosSession;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PosSessionService — جلسات نقطة البيع (الورديات)
 * ═══════════════════════════════════════════════════════════════
 *  - open():  يفتح جلسة برصيد افتتاحي (يُرفض إن وُجدت جلسة مفتوحة).
 *  - close(): يحسب المتوقع = الافتتاحي + المبيعات النقدية المرحّلة خلال
 *             الجلسة، ويسجّل المعدود والفرق ويغلق الجلسة.
 *
 *  سجلّ تشغيلي لمطابقة النقدية — لا يولّد أي قيد محاسبي (البيع نفسه
 *  يُرحَّل عبر InvoiceService). كل المبالغ بالهللات.
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

    public function close(PosSession $session, int $countedBalance): PosSession
    {
        if (! $session->isOpen()) {
            throw new RuntimeException('الجلسة مغلقة بالفعل.');
        }

        return DB::transaction(function () use ($session, $countedBalance) {
            // المبيعات النقدية المرحّلة خلال الجلسة (من فتحها حتى الآن).
            $cashSales = (int) Invoice::where('status', 'posted')
                ->where('payment_type', 'cash')
                ->where('created_at', '>=', $session->opened_at)
                ->sum('total');

            $expected = $session->opening_balance + $cashSales;

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

    protected function nextNumber(): string
    {
        $year  = Carbon::now()->year;
        $count = PosSession::whereYear('opened_at', $year)->count() + 1;

        return sprintf('POS-%s-%05d', $year, $count);
    }
}
