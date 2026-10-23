<?php

namespace App\Providers;

use App\Events\PaymentAttemptCaptured;
use App\Listeners\PostCapturedPaymentAttempt;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;

/** يربط حدث الالتقاط بمستمع الترحيل (PAY-H2-02c). المستمع متزامن عمداً: الإنتاج `QUEUE_CONNECTION=sync` ولا عامل خلفية بعد. */
class PaymentPostingServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Event::listen(PaymentAttemptCaptured::class, PostCapturedPaymentAttempt::class);
    }
}
