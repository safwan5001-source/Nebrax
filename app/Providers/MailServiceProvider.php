<?php

namespace App\Providers;

use GuzzleHttp\Client as GuzzleHttpClient;
use Illuminate\Mail\Transport\ResendTransport;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\ServiceProvider;
use Resend\Client as ResendClient;
use Resend\Contracts\Client as ResendClientContract;
use Resend\Transporters\HttpTransporter;
use Resend\ValueObjects\ApiKey;
use Resend\ValueObjects\Transporter\BaseUri;
use Resend\ValueObjects\Transporter\Headers;

/**
 * AUTH-MAIL-PROD-3: يستبدل ناقل SMTP المحجوب على Railway (اتصال بمنفذ 587
 * محجوب — انتهاء مهلة ~٦٠ ثانية مثبَت بالسجلات) بواجهة Resend HTTPS الرسمية،
 * عبر ناقل `resend` المدمج أصلاً في Laravel (`Illuminate\Mail\Transport\
 * ResendTransport`) — بلا أي تغيير على AuthController أو AuthRecoveryService
 * أو AuthActionMail أو محتوى القالب؛ يستدعي كلٌّ منها `Mail::to()->send()`
 * كما هو تماماً، وLaravel يختار الناقل من `MAIL_MAILER` وحدها.
 *
 * `Resend::client()` الرسمي في حزمة resend/resend-php يبني عميل Guzzle بلا
 * أي مهلة زمنية مضبوطة، فطلبٌ عالق كان سيُعيد نفس تعليق SMTP (~٦٠ ثانية) على
 * طبقة HTTPS بدل SMTP. هذا المزوّد يبني نفس تركيب الناقل الرسمي حرفياً
 * (BaseUri + Headers + HttpTransporter من الحزمة نفسها) مع مهلتي اتصال/طلب
 * صريحتين فقط — بلا أي إعادة محاولة تلقائية (قد تُضاعف رسائل الاسترداد).
 *
 * التسجيل عبر `Resend\Contracts\Client` singleton منفصل — يسمح للاختبارات
 * بحقن ناقل HTTP وهمي (Guzzle MockHandler) دون لمس أي كود إنتاجي.
 */
class MailServiceProvider extends ServiceProvider
{
    private const CONNECT_TIMEOUT_SECONDS = 5;

    private const REQUEST_TIMEOUT_SECONDS = 10;

    public function register(): void
    {
        $this->app->singleton(ResendClientContract::class, function (): ResendClient {
            $apiKey = ApiKey::from((string) config('services.resend.key'));
            $baseUri = BaseUri::from(getenv('RESEND_BASE_URL') ?: 'api.resend.com');
            $headers = Headers::withAuthorization($apiKey);

            $http = new GuzzleHttpClient([
                'connect_timeout' => self::CONNECT_TIMEOUT_SECONDS,
                'timeout' => self::REQUEST_TIMEOUT_SECONDS,
            ]);

            return new ResendClient(new HttpTransporter($http, $baseUri, $headers));
        });
    }

    public function boot(): void
    {
        Mail::extend('resend', fn () => new ResendTransport($this->app->make(ResendClientContract::class)));
    }
}
