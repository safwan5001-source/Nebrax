<?php

namespace App\Console\Commands;

use App\Services\PaymentRefundReconciler;
use App\Services\PaymentRefundService;
use Illuminate\Console\Command;

/** يطابق استردادات البوابة غير المعروفة ويستعيد الإرسال اليتيم (ADR-0007 §5-4). لا يؤكّد وحده ولا ترحيل محاسبي. آمن للتكرار والتزامن. */
class ReconcilePaymentRefundsCommand extends Command
{
    protected $signature = 'payments:reconcile-refunds {--limit=100 : أقصى عدد استردادات لكل فئة} {--unknown-grace='.PaymentRefundService::UNKNOWN_GRACE_MINUTES.' : مهلة unknown بالدقائق} {--orphan-grace='.PaymentRefundService::ORPHAN_GRACE_MINUTES.' : مهلة submitting اليتيم بالدقائق}';

    protected $description = 'يطابق استردادات البوابة غير المعروفة ويستعيد الإرسال اليتيم (لا تأكيد آلي ولا ترحيل)';

    public function handle(PaymentRefundReconciler $reconciler): int
    {
        $summary = $reconciler->run(max(1, (int) $this->option('limit')), max(0, (int) $this->option('unknown-grace')), max(0, (int) $this->option('orphan-grace')));
        $this->line(json_encode($summary, JSON_UNESCAPED_UNICODE));

        return self::SUCCESS;
    }
}
