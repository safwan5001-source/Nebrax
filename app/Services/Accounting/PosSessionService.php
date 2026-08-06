<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\JournalLine;
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
            // المتوقّع = الافتتاحي + صافي حركة الصندوق (1110) خلال الجلسة —
            // يشمل النقد الوارد من السندات والصادر (مصروفات/مرتجعات) فيصمد لكل الوسائل.
            $cash = $this->cashMovement($session->opened_at, now());
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
     * تقرير الوردية (X/Z): النقد المُستلَم (وارد 1110) + المتوقّع + عدد المبيعات.
     * للجلسة المفتوحة يُحسب حتى الآن؛ للمغلقة حتى وقت الإغلاق. لا يمسّ القيود.
     *
     * @return array{cash_sales:int, sales_count:int, average:int, expected:int}
     */
    public function report(PosSession $session): array
    {
        $end  = $session->closed_at ?? now();
        $cash = $this->cashMovement($session->opened_at, $end);

        // عدد المبيعات ومتوسّط قيمتها (فواتير مرحّلة خلال النافذة).
        $invoices   = \App\Models\Invoice::where('status', 'posted')
            ->where('created_at', '>=', $session->opened_at)
            ->where('created_at', '<=', $end);
        $salesTotal = (int) $invoices->sum('total');
        $count      = (int) $invoices->count();

        return [
            'cash_sales'  => $cash['inflow'], // النقد الوارد للدرج
            'sales_count' => $count,
            'average'     => $count > 0 ? intdiv($salesTotal, $count) : 0,
            'expected'    => $session->opening_balance + $cash['net'],
        ];
    }

    /**
     * صافي/وارد حركة حساب الصندوق (1110) خلال نافذة زمنية (قيود مرحّلة).
     *
     * @return array{inflow:int, net:int}
     */
    protected function cashMovement($openedAt, $end): array
    {
        $accountId = Account::where('code', '1110')->value('id');
        if (! $accountId) {
            return ['inflow' => 0, 'net' => 0];
        }

        $row = JournalLine::where('account_id', $accountId)
            ->whereHas('entry', fn ($q) => $q->where('status', 'posted')
                ->where('created_at', '>=', $openedAt)
                ->where('created_at', '<=', $end))
            ->selectRaw('COALESCE(SUM(debit), 0) as inflow, COALESCE(SUM(debit) - SUM(credit), 0) as net')
            ->first();

        return ['inflow' => (int) $row->inflow, 'net' => (int) $row->net];
    }

    protected function nextNumber(): string
    {
        $year  = Carbon::now()->year;
        $count = PosSession::whereYear('opened_at', $year)->count() + 1;

        return sprintf('POS-%s-%05d', $year, $count);
    }
}
