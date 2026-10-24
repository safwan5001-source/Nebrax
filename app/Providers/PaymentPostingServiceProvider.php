<?php

namespace App\Providers;

use App\Events\CommercePaymentAttemptCaptured;
use App\Events\PaymentAttemptCaptured;
use App\Events\PaymentRefundConfirmed;
use App\Listeners\CompleteCommerceOnlinePayment;
use App\Listeners\PostCapturedPaymentAttempt;
use App\Listeners\PostConfirmedPaymentRefund;
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
        // PAY-H4-04a: التقاط محاولة طلب متجر ⇒ تثبيت النية مدفوعة (متزامن؛ شبكة الأمان `payments:complete-commerce-captures`). لا ترحيل محاسبي.
        Event::listen(CommercePaymentAttemptCaptured::class, CompleteCommerceOnlinePayment::class);
        // PAY-H3-01c: ترحيل A5 لاسترداد بوابة مؤكَّد (متزامن كذلك؛ شبكة الأمان `payments:post-refunds`).
        Event::listen(PaymentRefundConfirmed::class, PostConfirmedPaymentRefund::class);

        // PAY-H2-02e: واجهة رابط الدفع العام — حدّ لكل (رمز، IP) وحدّ أوسع لكل IP (يمنع تخمين الرموز ومسح العناوين).
        // الرد 429 يُبنى هنا بالرؤوس الواقية نفسها: المحدِّد (ThrottleRequests) ذو أولوية في ترتيب الوسطاء فيعمل قبل `HardenPaymentLinkResponse`.
        $tooMany = fn (Request $request, array $headers) => response()->json(
            ['error' => ['code' => 'too_many_requests', 'message' => 'محاولات كثيرة؛ أعد المحاولة بعد قليل.']],
            429,
            $headers + ['Cache-Control' => 'no-store, private', 'Referrer-Policy' => 'no-referrer', 'X-Robots-Tag' => 'noindex, nofollow'],
        );
        RateLimiter::for('pay-link', fn (Request $request): array => [
            Limit::perMinute(20)->by('pay-link|'.substr((string) $request->route('token'), 0, 16).'|'.$request->ip())->response($tooMany),
            Limit::perMinute(120)->by('pay-link-ip|'.$request->ip())->response($tooMany),
        ]);
    }
}
