<?php

namespace App\Providers;

use App\Events\PaymentAttemptCaptured;
use App\Listeners\PostCapturedPaymentAttempt;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

/** يربط حدث الالتقاط بمستمع الترحيل (PAY-H2-02c). المستمع متزامن عمداً: الإنتاج `QUEUE_CONNECTION=sync` ولا عامل خلفية بعد. */
class PaymentPostingServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Event::listen(PaymentAttemptCaptured::class, PostCapturedPaymentAttempt::class);

        // PAY-H2-02e: واجهة رابط الدفع العام — حدّ لكل (رمز، IP) وحدّ أوسع لكل IP (يمنع تخمين الرموز ومسح العناوين).
        RateLimiter::for('pay-link', fn (Request $request): array => [
            Limit::perMinute(20)->by('pay-link|'.substr((string) $request->route('token'), 0, 16).'|'.$request->ip()),
            Limit::perMinute(120)->by('pay-link-ip|'.$request->ip()),
        ]);
    }
}
