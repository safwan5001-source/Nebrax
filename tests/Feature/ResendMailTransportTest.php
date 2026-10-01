<?php

namespace Tests\Feature;

use GuzzleHttp\Client as GuzzleHttpClient;
use GuzzleHttp\Exception\ConnectException;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Request as Psr7Request;
use GuzzleHttp\Psr7\Response as Psr7Response;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Resend\Client as ResendClient;
use Resend\Contracts\Client as ResendClientContract;
use Resend\Transporters\HttpTransporter;
use Resend\ValueObjects\ApiKey;
use Resend\ValueObjects\Transporter\BaseUri;
use Resend\ValueObjects\Transporter\Headers;
use ReflectionClass;
use Tests\TestCase;

/**
 * AUTH-MAIL-PROD-3 — يثبت أن ناقل `resend` (المُسجَّل في MailServiceProvider)
 * يستخدم فعلاً واجهة Resend عبر HTTPS، بمهلتين صريحتين، وأن فشل الشبكة لا
 * يُسرّب شيئاً ولا يكسر السلوك المحايد لمسار نسيان كلمة المرور. لا Mail::fake()
 * هنا عمداً — الهدف فحص الناقل الحقيقي حتى طبقة HTTP، ببديل Guzzle وهمي فقط.
 */
class ResendMailTransportTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const FAKE_KEY = 're_test_not_a_real_key';

    protected function setUp(): void
    {
        parent::setUp();
        config(['mail.default' => 'resend']);
        config(['services.resend.key' => self::FAKE_KEY]);
    }

    private function tenantUrl(string $slug, string $path): string
    {
        return "http://{$slug}.awj.app/api/{$path}";
    }

    /**
     * يحقن ناقل HTTP وهمياً بنفس تركيب MailServiceProvider الحقيقي ويعيد سجل
     * الطلبات. `ArrayObject` لا مصفوفة عادية: Middleware::history() يعدّل
     * الحاوية بالمرجع من داخل إغلاقات تعيش بعد عودة هذه الدالة، ومصفوفة
     * عادية تُعاد بالقيمة تُنسخ في تلك اللحظة فتبقى فارغة عند المستدعي مهما
     * أُرسل لاحقاً.
     */
    private function bindMockResendHttp(MockHandler $mock): \ArrayObject
    {
        $history = new \ArrayObject();
        $stack = HandlerStack::create($mock);
        $stack->push(Middleware::history($history));

        $http = new GuzzleHttpClient(['handler' => $stack]);
        $baseUri = BaseUri::from('api.resend.com');
        $headers = Headers::withAuthorization(ApiKey::from(self::FAKE_KEY));

        $this->app->instance(
            ResendClientContract::class,
            new ResendClient(new HttpTransporter($http, $baseUri, $headers))
        );
        // MailManager يخزّن الناقل المبنيّ للاسم 'resend' مؤقتاً؛ بلا هذا
        // السطر يُعاد استخدام عميل حقيقي (أو وهمي سابق) بُني قبل هذا الاستبدال
        // — مثلاً أثناء بريد التحقق الذي يرسله registerTenant() في الإعداد.
        app('mail.manager')->forgetMailers();

        return $history;
    }

    /** @test */
    public function the_real_resend_client_is_configured_with_short_connect_and_request_timeouts(): void
    {
        // لا نستبدل الحاوية هنا: نتحقق من العميل الحقيقي الذي يبنيه
        // MailServiceProvider::register() ذاته — إثبات أن الإعداد الفعلي لا
        // يُعلَّق ٦٠ ثانية مثل SMTP، بلا انتظار مهلة حقيقية في الاختبار.
        $client = app(ResendClientContract::class);

        $transporterProp = (new ReflectionClass($client))->getProperty('transporter');
        $transporterProp->setAccessible(true);
        $transporter = $transporterProp->getValue($client);

        $httpProp = (new ReflectionClass($transporter))->getProperty('client');
        $httpProp->setAccessible(true);
        $http = $httpProp->getValue($transporter);

        $config = $http->getConfig();
        $this->assertSame(5, $config['connect_timeout']);
        $this->assertSame(10, $config['timeout']);
    }

    /** @test */
    public function a_valid_tenant_forgot_password_sends_exactly_one_https_request_to_resend(): void
    {
        // يُستبدَل ناقل HTTP الحقيقي *قبل* التسجيل — بريد التحقق الذي يرسله
        // registerTenant() يمر عبر 'resend' أيضاً بما أن mail.default مضبوطة
        // في setUp()؛ بلا هذا السبق كان سيخرج نداء شبكة حقيقي بمفتاح وهمي.
        $history = $this->bindMockResendHttp(new MockHandler([
            new Psr7Response(200, ['Content-Type' => 'application/json'], json_encode(['id' => 'verify-message-id'])),
            new Psr7Response(200, ['Content-Type' => 'application/json'], json_encode(['id' => 'test-message-id'])),
        ]));

        $this->registerTenant('alpha', 'owner@alpha.test');
        $this->assertCount(1, $history); // بريد التحقق عند التسجيل — وحده حتى الآن.

        $this->postJson($this->tenantUrl('alpha', 'forgot-password'), ['email' => 'owner@alpha.test'])
            ->assertOk()
            ->assertJsonPath('message', 'إذا كان الحساب موجوداً لهذا البريد، فقد أُرسلت تعليمات الاسترداد.');

        $this->assertCount(2, $history); // التحقق + الاسترداد

        /** @var Psr7Request $request */
        $request = $history[1]['request'];
        $this->assertSame('POST', $request->getMethod());
        $this->assertSame('api.resend.com', $request->getUri()->getHost());
        $this->assertSame('https', $request->getUri()->getScheme());
        $this->assertSame('/emails', $request->getUri()->getPath());
        $this->assertSame('Bearer '.self::FAKE_KEY, $request->getHeaderLine('Authorization'));

        $body = json_decode((string) $request->getBody(), true);
        $this->assertStringContainsString('owner@alpha.test', is_array($body['to']) ? implode(',', $body['to']) : $body['to']);
        $this->assertStringContainsString('استرداد كلمة المرور', $body['subject']);
        $this->assertStringContainsString('http://alpha.awj.app/reset-password?token=', $body['html']);

        $this->assertDatabaseHas('auth_action_tokens', ['type' => 'password_reset']);
    }

    /** @test */
    public function no_tenant_context_makes_no_provider_call(): void
    {
        $history = $this->bindMockResendHttp(new MockHandler([
            new Psr7Response(200, ['Content-Type' => 'application/json'], json_encode(['id' => 'verify-message-id'])),
        ]));
        $this->registerTenant('alpha', 'owner@alpha.test');
        $baseline = count($history);

        $this->postJson('/api/forgot-password', ['email' => 'owner@alpha.test'])
            ->assertOk()
            ->assertJsonPath('message', 'إذا كان الحساب موجوداً لهذا البريد، فقد أُرسلت تعليمات الاسترداد.');

        $this->assertCount($baseline, $history);
        $this->assertDatabaseMissing('auth_action_tokens', ['type' => 'password_reset']);
    }

    /** @test */
    public function a_cross_tenant_email_makes_no_provider_call_and_issues_no_token(): void
    {
        $history = $this->bindMockResendHttp(new MockHandler([
            new Psr7Response(200, ['Content-Type' => 'application/json'], json_encode(['id' => 'verify-a'])),
            new Psr7Response(200, ['Content-Type' => 'application/json'], json_encode(['id' => 'verify-b'])),
        ]));
        $this->registerTenant('company-a', 'a@alpha.test');
        $this->registerTenant('company-b', 'b@beta.test');
        $baseline = count($history);

        // بريد مستأجر B عبر مضيف مستأجر A — لا مطابقة، لا نداء، لا توكن.
        $this->postJson($this->tenantUrl('company-a', 'forgot-password'), ['email' => 'b@beta.test'])
            ->assertOk();

        $this->assertCount($baseline, $history);
        $this->assertDatabaseMissing('auth_action_tokens', ['type' => 'password_reset']);
    }

    /** @test */
    public function conflicting_host_and_origin_tenants_still_fail_closed_with_no_provider_call(): void
    {
        $history = $this->bindMockResendHttp(new MockHandler([
            new Psr7Response(200, ['Content-Type' => 'application/json'], json_encode(['id' => 'verify-a'])),
            new Psr7Response(200, ['Content-Type' => 'application/json'], json_encode(['id' => 'verify-b'])),
        ]));
        $this->registerTenant('company-a', 'a@alpha.test');
        $this->registerTenant('company-b', 'b@beta.test');
        $baseline = count($history);

        $this->postJson($this->tenantUrl('company-a', 'forgot-password'), [
            'email' => 'a@alpha.test',
        ], ['Origin' => 'https://company-b.awj.app'])->assertStatus(404);

        $this->assertCount($baseline, $history);
    }

    /**
     * فشل النقل يبقى داخلياً: الاستجابة العامة تظل محايدة رغم فشل الإرسال
     * الفعلي، والتوكن (الصادر قبل محاولة الإرسال) يبقى في قاعدة البيانات —
     * بلا أي كشف لوجود الحساب عبر الاستجابة. `AuthController::forgotPassword`
     * يبلّغ عن الاستثناء عبر `report()` القائم أصلاً (غير مسّ هنا) لا عبر أي
     * تسجيل إضافي.
     *
     * @test
     */
    public function a_provider_connection_failure_keeps_the_public_response_neutral(): void
    {
        // بريد التحقق عند التسجيل ينجح (استجابة 200 أولى)؛ الفشل المحاكى
        // مخصَّص فقط لمحاولة إرسال بريد الاسترداد التالية.
        $this->bindMockResendHttp(new MockHandler([
            new Psr7Response(200, ['Content-Type' => 'application/json'], json_encode(['id' => 'verify-message-id'])),
            new ConnectException(
                'cURL error 28: Connection timed out after 10000 milliseconds',
                new Psr7Request('POST', 'https://api.resend.com/emails')
            ),
        ]));
        $this->registerTenant('alpha', 'owner@alpha.test');

        $res = $this->postJson($this->tenantUrl('alpha', 'forgot-password'), ['email' => 'owner@alpha.test']);

        $res->assertOk()->assertJsonPath('message', 'إذا كان الحساب موجوداً لهذا البريد، فقد أُرسلت تعليمات الاسترداد.');
        $this->assertStringNotContainsString(self::FAKE_KEY, $res->getContent());
        $this->assertDatabaseHas('auth_action_tokens', ['type' => 'password_reset']);
    }

    /** @test */
    public function a_timeout_style_failure_is_handled_exactly_like_any_other_provider_failure(): void
    {
        // نفس مسار الفشل أعلاه بالضبط — الفارق فقط في نص الاستثناء المحاكى
        // (مهلة اتصال لا رفض خادم)، فلا حاجة لانتظار مهلة حقيقية في الاختبار.
        $this->bindMockResendHttp(new MockHandler([
            new Psr7Response(200, ['Content-Type' => 'application/json'], json_encode(['id' => 'verify-message-id'])),
            new ConnectException(
                'Connection could not be established with host "api.resend.com": Connection timed out',
                new Psr7Request('POST', 'https://api.resend.com/emails')
            ),
        ]));
        $this->registerTenant('alpha', 'owner@alpha.test');

        $res = $this->postJson($this->tenantUrl('alpha', 'forgot-password'), ['email' => 'owner@alpha.test']);

        $res->assertOk()->assertJsonPath('message', 'إذا كان الحساب موجوداً لهذا البريد، فقد أُرسلت تعليمات الاسترداد.');
        $this->assertDatabaseHas('auth_action_tokens', ['type' => 'password_reset']);
    }
}
