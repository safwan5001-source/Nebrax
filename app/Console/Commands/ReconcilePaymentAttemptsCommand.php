<?php

namespace App\Console\Commands;

use App\Services\PaymentAttemptReconciler;
use Illuminate\Console\Command;

/** يطابق محاولات الدفع المتأخرة مع المزوّد (ADR-0004 §5). آمن للتكرار والتزامن (إيجار ذرّي لكل محاولة). لا ترحيل محاسبي. */
class ReconcilePaymentAttemptsCommand extends Command
{
    protected $signature = 'payments:reconcile-attempts {--limit=100 : أقصى عدد محاولات في التشغيل} {--min-age=5 : أقل عمر/تأخر بالدقائق}';

    protected $description = 'يطابق محاولات الدفع المتأخرة مع المزوّد ويلتقط المتعثّر (لا ترحيل)';

    public function handle(PaymentAttemptReconciler $reconciler): int
    {
        $summary = $reconciler->run(max(1, (int) $this->option('limit')), max(0, (int) $this->option('min-age')));
        $this->line(json_encode($summary, JSON_UNESCAPED_UNICODE));

        return self::SUCCESS;
    }
}
