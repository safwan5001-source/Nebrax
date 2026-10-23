<?php

namespace App\Services;

use App\Contracts\GatewayAdapter;
use App\Contracts\RefundsPayments;
use App\Contracts\RedactsStoredWebhookBody;
use App\Contracts\VerifiesGatewayCredentials;
use App\Models\PaymentAttempt;
use App\Models\PaymentGateway;
use App\Support\InvalidPaymentWebhookException;
use App\Support\PaymentAttemptContext;
use App\Support\PaymentGatewayCapabilities;
use App\Support\PaymentGatewayException;
use App\Support\PaymentHostedCheckout;
use App\Support\PaymentProviderSnapshot;
use App\Support\PaymentRefundUnknownException;
use App\Support\PaymentRefundRejectedException;
use App\Support\PaymentProviderRefund;
use App\Support\PaymentRawWebhook;
use App\Support\PaymentVerifiedWebhook;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * محوّل Moyasar (PAY-H2-01a، ADR-0005): Sandbox فقط، فاتورة مستضافة (Invoices API → صفحة `checkout.moyasar.com`).
 *
 *  • **لا بطاقة في خادمنا**: يطلب فاتورة ويعيد رابط صفحة Moyasar؛ العميل يدفع هناك (3DS وmada وغيرها عند Moyasar).
 *  • **الحقيقة = استعلام API**: `fetchPayment` يقرأ الفاتورة ودفعاتها بالمفتاح السري ويحوّلها إلى لقطة رتيبة. لا يُصدَّق `callback`/`success_url`
 *    ولا جسم الـwebhook. معرّف المحاولة عند المزوّد هو **معرّف الفاتورة** (والـwebhook يعيد `data.invoice_id` لمطابقتها).
 *  • idempotency: لا مفتاح موثّق لإنشاء الفاتورة ⇒ تُبحث الفواتير بـ`metadata[awj_attempt_id]` قبل الإنشاء ويُعاد الموجود (نفس المحاولة ⇒ نفس الصفحة).
 *  • الـwebhook: Moyasar لا توثّق توقيع HMAC بل `secret_token` في الجسم ⇒ مقارنة بثبات زمني مع أسرار الاتصال (الحالي ثم السابق)، ورفض `live` في Sandbox،
 *    وتنقيح السرّ من الجسم المخزَّن. التزوير لا يمنح أثراً مالياً لأن الحدث لا يغيّر حالة بل يطلق `fetchPayment`.
 *
 * ما يلزم تثبيته في Sandbox الحقيقي ولا يُفترض هنا: شكل غلاف قائمة الفواتير، وهل تقبل فاتورة `failed` محاولة جديدة، وجسم `payment_paid` الفعلي.
 */
final class MoyasarAdapter implements GatewayAdapter, RedactsStoredWebhookBody, RefundsPayments, VerifiesGatewayCredentials
{
    public const PROVIDER = 'moyasar';

    /** مفتاح الـmetadata الذي يربط الفاتورة بمحاولة أَوْج (idempotency عند الاستئناف). */
    public const ATTEMPT_METADATA_KEY = 'awj_attempt_id';

    /** أقل مبلغ تقبله Moyasar للفاتورة (100 هللة = 1.00 ريال). */
    public const MIN_AMOUNT_MINOR = 100;

    /** أقصى انتظار لطلب متزامن آخر لنفس المحاولة (مدة القفل نفسها تُحسب من مهل الاتصال: `checkoutLockSeconds()`). */
    private const CHECKOUT_LOCK_WAIT_SECONDS = 20;

    public function __construct(private readonly MoyasarApiClient $client) {}

    public function provider(): string
    {
        return self::PROVIDER;
    }

    public function capabilities(): PaymentGatewayCapabilities
    {
        // `refunds`: مدعوم بالعقد وFixtures؛ استرداد Sandbox الحقيقي PENDING(EXT-01) فلا يُفعَّل مسار مستخدم قبل شريحته وضابطه.
        return new PaymentGatewayCapabilities(true, ['SAR'], self::MIN_AMOUNT_MINOR, true);
    }

    public function createCheckout(PaymentAttemptContext $context): PaymentHostedCheckout
    {
        if ($context->amountMinor < self::MIN_AMOUNT_MINOR) {
            throw new PaymentGatewayException('moyasar.amount_below_minimum', 'المبلغ أقل من الحد الأدنى لدى Moyasar (1.00 ريال).');
        }

        // قرار «ابحث ثم أنشئ» يُسلسَل لكل محاولة: طلبان متزامنان لنفس المحاولة المنشأة كانا يمرّان من البحث معاً فينشئان فاتورتين
        // (المنسّق يقفل المحاولة بعد الاستدعاء الخارجي لا قبله). القفل في الذاكرة المشتركة (Cache) لا قفل صف، لأنه يمتد عبر استدعاء شبكي.
        try {
            return Cache::lock('moyasar:checkout:'.$context->attemptId, $this->checkoutLockSeconds())
                ->block(self::CHECKOUT_LOCK_WAIT_SECONDS, fn () => $this->resumeOrCreate($context));
        } catch (LockTimeoutException) {
            throw new PaymentGatewayException('moyasar.checkout_busy', 'طلب دفع آخر لهذه المحاولة قيد الإنشاء؛ أعد المحاولة بعد لحظات.');
        }
    }

    /**
     * عمر القفل = أسوأ حالة للعملية كلها: بحث (مهلة × (محاولات القراءة + 1) + فواصل) ثم POST واحد، مع هامش.
     * قصره عن هذا يتيح لطلب متأخر أخذ القفل المنتهي والـPOST الأول ما زال جارياً فتتكرر الفاتورة.
     */
    private function checkoutLockSeconds(): int
    {
        $config = (array) config('payment_providers.moyasar');
        $timeout = max(1, (int) ($config['timeout_seconds'] ?? 15));
        $reads = max(0, (int) ($config['read_retries'] ?? 2)) + 1;
        $sleeps = (int) ceil(max(0, (int) ($config['retry_sleep_ms'] ?? 0)) * $reads / 1000);

        return $timeout * ($reads + 1) + $sleeps + 15;
    }

    private function resumeOrCreate(PaymentAttemptContext $context): PaymentHostedCheckout
    {
        // استئناف: محاولة سبق أن أُنشئت لها فاتورة (استجابة ضائعة/إعادة طلب) تعيد الصفحة نفسها دون فاتورة ثانية.
        foreach ($this->client->listInvoicesByAttempt($context->gateway, $context->attemptId) as $invoice) {
            if (($invoice['metadata'][self::ATTEMPT_METADATA_KEY] ?? null) !== $context->attemptId) {
                continue;
            }
            // فاتورة ميّتة غير مدفوعة (منتهية/ملغاة) لا تُبعث: صفحتها لا تقبل دفعاً بعد `expired_at`، فيُنشأ بدلها فاتورة جديدة لنفس المحاولة.
            // المدفوعة تُعاد دائماً (تُطابَق بالجلب)، وأول فاتورة حيّة تفوز عند وجود أكثر من واحدة.
            if ($this->isDeadUnpaid($invoice)) {
                continue;
            }
            $this->assertInvoiceMatches($invoice, $context);

            return $this->checkoutFrom($invoice, null);
        }

        $config = (array) config('payment_providers.moyasar');
        $expiresAt = CarbonImmutable::now('UTC')->addMinutes(max(5, (int) $config['checkout_ttl_minutes']));
        $payload = [
            'amount' => $context->amountMinor,
            'currency' => strtoupper($context->currency),
            'description' => 'AWJ '.$context->payableKey,
            'expired_at' => $expiresAt->toIso8601String(),
            'metadata' => [
                self::ATTEMPT_METADATA_KEY => $context->attemptId,
                'awj_payable_key' => $context->payableKey,
            ],
        ];
        foreach (['success_url', 'back_url'] as $key) {
            if (is_string($config[$key] ?? null) && $config[$key] !== '') {
                $payload[$key] = $config[$key];
            }
        }

        $created = $this->client->createInvoice($context->gateway, $payload);
        // الاستجابة نفسها تُفحص قبل عرض الرابط: فاتورة بمبلغ/عملة غير ما طلبناه لا يُرسَل إليها العميل (يُكتشف الفرق بعد الدفع فقط).
        $this->assertInvoiceMatches($created, $context);

        return $this->checkoutFrom($created, $expiresAt);
    }

    /** @param array<string, mixed> $invoice */
    private function isDeadUnpaid(array $invoice): bool
    {
        $status = strtolower((string) ($invoice['status'] ?? ''));
        if ($status === 'paid' || $status === 'refunded') {
            return false;
        }
        if (in_array($status, ['expired', 'canceled', 'voided'], true)) {
            return true;
        }
        $expiresAt = $this->parseTime($invoice['expired_at'] ?? null);

        return $expiresAt !== null && $expiresAt->lessThanOrEqualTo(CarbonImmutable::now('UTC'));
    }

    /** @param array<string, mixed> $invoice */
    private function assertInvoiceMatches(array $invoice, PaymentAttemptContext $context): void
    {
        if ($this->intOrNull($invoice['amount'] ?? null) !== $context->amountMinor
            || strtoupper((string) ($invoice['currency'] ?? '')) !== strtoupper($context->currency)) {
            throw new PaymentGatewayException('moyasar.invoice_conflict', 'فاتورة هذه المحاولة بمبلغ أو عملة مختلفة عن المطلوب.');
        }
    }

    public function verifyCredentials(PaymentGateway $gateway): void
    {
        $this->client->probeAccess($gateway);
    }

    public function fetchPayment(PaymentGateway $gateway, string $providerPaymentId): PaymentProviderSnapshot
    {
        $invoice = $this->client->fetchInvoice($gateway, $providerPaymentId);

        return $this->snapshotFrom($invoice, $providerPaymentId);
    }

    public function verifyWebhook(PaymentGateway $gateway, PaymentRawWebhook $webhook): PaymentVerifiedWebhook
    {
        $data = json_decode($webhook->body, true);
        if (! is_array($data)) {
            throw new InvalidPaymentWebhookException('malformed');
        }

        $token = $data['secret_token'] ?? null;
        $valid = false;
        if (is_string($token) && $token !== '') {
            foreach ($gateway->webhookSecretsForVerification() as $secret) {
                // لا اختصار بعد أول تطابق: زمن الفحص لا يكشف أي السرّين (الحالي/السابق) طابق.
                $valid = (is_string($secret) && $secret !== '' && hash_equals($secret, $token)) || $valid;
            }
        }
        // حدث حيّ على اتصال Sandbox (أو العكس) لا يخص هذا الاتصال، ولو حمل السرّ الصحيح.
        $live = $data['live'] ?? null;
        if (! $valid || ! is_bool($live) || $live !== ($gateway->environment === PaymentGateway::ENVIRONMENT_LIVE)) {
            throw new InvalidPaymentWebhookException('signature');
        }

        $eventId = $data['id'] ?? null;
        $type = $data['type'] ?? null;
        if (! is_string($eventId) || $eventId === '' || ! is_string($type) || $type === '') {
            throw new InvalidPaymentWebhookException('malformed');
        }

        // مطابقة المحاولة بمعرّف الفاتورة (مرجع المزوّد المحفوظ). أحداث بلا فاتورة (card_auth_* أو دفع مباشر) ⇒ بلا مرجع ⇒ unmatched.
        $invoiceId = null;
        if (str_starts_with($type, 'payment_') && is_array($data['data'] ?? null)) {
            $candidate = $data['data']['invoice_id'] ?? null;
            $invoiceId = is_string($candidate) && $candidate !== '' ? $candidate : null;
        }

        return new PaymentVerifiedWebhook($eventId, $type, $invoiceId);
    }

    public function redactForStorage(string $body): string
    {
        $data = json_decode($body, true);
        if (! is_array($data)) {
            return json_encode(['redacted' => true]);
        }

        // قائمة سماح لا حذف: جسم `payment_*` الفعلي هو كائن الدفعة وفيه `source` (رمز بطاقة، اسم حاملها، قناع الرقم) وقيم مصادقة 3DS.
        // نحفظ مغلّف التدقيق فقط (الحدث والفاتورة والحالة والمبلغ) ولا شيء عن مصدر الدفع؛ الحقيقة الكاملة تُجلب من API عند الحاجة.
        $envelope = array_intersect_key($data, array_flip(['id', 'type', 'created_at', 'live']));
        if (is_array($data['data'] ?? null)) {
            $envelope['data'] = array_intersect_key($data['data'], array_flip(['id', 'invoice_id', 'status', 'amount', 'currency']));
        }
        $envelope['redacted'] = true;

        $encoded = json_encode($envelope, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        return $encoded === false ? json_encode(['redacted' => true]) : $encoded;
    }

    // ───────────── تحويل الاستجابات (نقية) ─────────────

    /** @param array<string, mixed> $invoice */
    private function checkoutFrom(array $invoice, ?CarbonImmutable $fallbackExpiry): PaymentHostedCheckout
    {
        $id = $invoice['id'] ?? null;
        $url = is_string($invoice['url'] ?? null) ? $this->upgradeTrustedScheme($invoice['url']) : null;
        if (! is_string($id) || $id === '' || ! is_string($url) || ! $this->isTrustedCheckoutUrl($url)) {
            throw new PaymentGatewayException('moyasar.malformed_response', 'استجابة إنشاء الفاتورة غير صالحة.');
        }

        $expiresAt = $fallbackExpiry;
        if (is_string($invoice['expired_at'] ?? null)) {
            try {
                $expiresAt = CarbonImmutable::parse($invoice['expired_at'])->utc();
            } catch (Throwable) {
                // يبقى الافتراضي
            }
        }

        return new PaymentHostedCheckout($id, $url, $expiresAt);
    }

    /**
     * مثال استجابة Moyasar الموثّق يعيد رابط الدفع بـ`http://` على مضيفها نفسه. نرقّي المخطط إلى https **لمضيف موثوق فقط** قبل الفحص؛
     * مضيف غريب أو مخطط آخر يبقى كما هو فيُرفض. لا نقبل http أبداً ولا نكتبه في المحاولة.
     */
    private function upgradeTrustedScheme(string $url): string
    {
        $parts = parse_url($url);
        if (is_array($parts) && strtolower((string) ($parts['scheme'] ?? '')) === 'http' && $this->isTrustedCheckoutUrl('https'.substr($url, 4))) {
            return 'https'.substr($url, 4);
        }

        return $url;
    }

    /** رابط الدفع: https ومضيف ينتهي بنطاق Moyasar الموثّق، فلا يُوجَّه العميل إلى مضيف غريب لو تلفت الاستجابة. */
    private function isTrustedCheckoutUrl(string $url): bool
    {
        $parts = parse_url($url);
        if (! is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || ! is_string($parts['host'] ?? null)) {
            return false;
        }
        $host = strtolower($parts['host']);
        foreach ((array) config('payment_providers.moyasar.checkout_host_suffixes', []) as $suffix) {
            $suffix = strtolower((string) $suffix);
            if ($host === $suffix || str_ends_with($host, '.'.$suffix)) {
                return true;
            }
        }

        return false;
    }

    /**
     * فاتورة Moyasar + دفعاتها ⇒ لقطة. الأولوية: دفعة مُسدَّدة ⇒ captured؛ مفوَّضة ⇒ authorized؛ ثم حالة الفاتورة.
     * `refunded` دفعة يعني أنها سُدِّدت سابقاً ⇒ تُعدّ مُلتقَطة (يُحاسب الاسترداد في شريحة لاحقة). `failed`/`on_hold`/`initiated` للفاتورة تبقى
     * `pending_customer` (صفحة الدفع قد تقبل محاولة جديدة حتى الانتهاء؛ يُثبَّت في Sandbox) فلا تُغلق المحاولة محلياً بقراءة متفائلة أو متشائمة.
     *
     * @param  array<string, mixed>  $invoice
     */
    private function snapshotFrom(array $invoice, string $expectedId): PaymentProviderSnapshot
    {
        if (! is_string($invoice['id'] ?? null) || ! hash_equals($expectedId, $invoice['id'])) {
            throw new PaymentGatewayException('moyasar.reference_mismatch', 'مرجع الفاتورة لا يطابق المطلوب.');
        }
        $amount = $this->intOrNull($invoice['amount'] ?? null);
        $currency = strtoupper((string) ($invoice['currency'] ?? ''));
        if ($amount === null || $amount < 0 || strlen($currency) !== 3) {
            throw new PaymentGatewayException('moyasar.malformed_response', 'مبلغ أو عملة الفاتورة غير صالحة.');
        }

        $capturedMinor = 0;
        $refundedMinor = 0;
        $capturedAt = null;
        $authorized = false;
        $failureCode = null;
        $payments = is_array($invoice['payments'] ?? null) ? $invoice['payments'] : [];
        foreach ($payments as $payment) {
            if (! is_array($payment)) {
                continue;
            }
            $status = strtolower((string) ($payment['status'] ?? ''));
            $paymentAmount = $this->intOrNull($payment['amount'] ?? null) ?? 0;
            if (in_array($status, ['paid', 'captured', 'refunded'], true)) {
                // `captured` (الحقل الموثّق) هو المبلغ الملتقَط فعلاً وقد يقلّ عن `amount` في الالتقاط الجزئي. غيابه أو صفره على دفعة مسدَّدة
                // ⇒ المبلغ كاملاً (دفعة `paid` بلا التقاط جزئي)؛ ولا يتجاوز أبداً مبلغ الدفعة. قيمة صفر الفعلية تُثبَّت في Sandbox.
                $captured = $this->intOrNull($payment['captured'] ?? null);
                $capturedMinor += $captured !== null && $captured > 0 ? min($captured, $paymentAmount) : $paymentAmount;
                // المسترد التراكمي (حقل `refunded` الموثّق، عدد صحيح ≤ مبلغ الدفعة): حقيقة المزوّد لمطابقة الاسترداد؛ لا يتجاوز مبلغ الدفعة.
                $refundedMinor += min($this->intOrNull($payment['refunded'] ?? null) ?? 0, $paymentAmount);
                $stamp = $this->parseTime($payment['captured_at'] ?? $payment['updated_at'] ?? $payment['created_at'] ?? null);
                if ($stamp !== null && ($capturedAt === null || $stamp->greaterThan($capturedAt))) {
                    $capturedAt = $stamp;
                }
            } elseif ($status === 'authorized') {
                $authorized = true;
            } elseif ($status === 'failed') {
                $code = $payment['source']['response_code'] ?? null;
                $failureCode = is_string($code) && $code !== '' ? substr($code, 0, 64) : 'payment_failed';
            }
        }

        $invoiceStatus = strtolower((string) ($invoice['status'] ?? ''));
        if ($capturedMinor > 0) {
            $status = PaymentAttempt::STATUS_CAPTURED;
        } elseif ($invoiceStatus === 'paid') {
            // فاتورة «مدفوعة» بلا أي دفعة مسدَّدة في الاستجابة: لا نُقرّ التقاطاً بلا دليل ⇒ تُعاد المحاولة لاحقاً (المنسّق يعيد المطابقة).
            throw new PaymentGatewayException('moyasar.malformed_response', 'فاتورة مدفوعة بلا دفعة مسدَّدة في الاستجابة.');
        } elseif ($authorized) {
            $status = PaymentAttempt::STATUS_AUTHORIZED;
        } elseif ($invoiceStatus === 'expired') {
            $status = PaymentAttempt::STATUS_EXPIRED;
        } elseif (in_array($invoiceStatus, ['canceled', 'voided'], true)) {
            $status = PaymentAttempt::STATUS_CANCELLED;
        } else {
            $status = PaymentAttempt::STATUS_PENDING_CUSTOMER;
        }

        return new PaymentProviderSnapshot(
            $expectedId,
            $status,
            $amount,
            $currency,
            $capturedMinor,
            $status === PaymentAttempt::STATUS_CAPTURED ? ($capturedAt ?? CarbonImmutable::now('UTC')) : null,
            $failureCode,
            $refundedMinor,
        );
    }

    /**
     * استرداد دفعة (PAY-H3-01a، ADR-0007). `$providerPaymentId` مرجع المحاولة (فاتورة Moyasar): تُجلب الفاتورة (GET آمن) وتُحلّ منها **الدفعة المسدَّدة الوحيدة**
     * (صفر أو أكثر من واحدة ⇒ رفض قاطع غامض)، ويُتحقق من العملة والسقف (≤ الملتقط − المسترد حتى الآن) **قبل** الإرسال. ثم `POST` واحد بلا إعادة محاولة.
     * الخطأ قبل الإرسال أو رفض المزوّد (4xx/401/403/429/404) = `PaymentRefundRejectedException` (لم يُنفَّذ شيء)؛ انقطاع/مهلة/5xx/استجابة غير مفهومة
     * **بعد** الإرسال = `PaymentRefundUnknownException` (قد يكون نُفِّذ — يحسمه المطابِق بالتراكمي). الاستجابة تُفحص: المعرّف والعملة، و`refunded` عدد صحيح.
     */
    public function refundPayment(PaymentGateway $gateway, string $providerPaymentId, int $amountMinor): PaymentProviderRefund
    {
        if ($amountMinor <= 0) {
            throw new PaymentRefundRejectedException('moyasar.invalid_refund_amount', 'مبلغ الاسترداد يجب أن يكون موجباً.');
        }

        try {
            $invoice = $this->client->fetchInvoice($gateway, $providerPaymentId);
        } catch (PaymentGatewayException $e) {
            throw new PaymentRefundRejectedException($e->reason, $e->getMessage());
        }
        if (! is_string($invoice['id'] ?? null) || ! hash_equals($providerPaymentId, $invoice['id'])) {
            throw new PaymentRefundRejectedException('moyasar.reference_mismatch', 'مرجع الفاتورة لا يطابق المطلوب.');
        }

        $paid = [];
        foreach (is_array($invoice['payments'] ?? null) ? $invoice['payments'] : [] as $payment) {
            if (is_array($payment) && in_array(strtolower((string) ($payment['status'] ?? '')), ['paid', 'captured', 'refunded'], true)) {
                $paid[] = $payment;
            }
        }
        if (count($paid) !== 1) {
            throw new PaymentRefundRejectedException(
                $paid === [] ? 'moyasar.no_paid_payment' : 'moyasar.ambiguous_payment',
                $paid === [] ? 'لا توجد دفعة مسدَّدة لاستردادها.' : 'أكثر من دفعة مسدَّدة على الفاتورة؛ لا يُحسم الاسترداد آلياً.',
            );
        }
        $payment = $paid[0];
        $paymentId = $payment['id'] ?? null;
        $paymentAmount = $this->intOrNull($payment['amount'] ?? null);
        if (! is_string($paymentId) || $paymentId === '' || $paymentAmount === null || strtoupper((string) ($payment['currency'] ?? '')) !== strtoupper((string) ($invoice['currency'] ?? ''))) {
            throw new PaymentRefundRejectedException('moyasar.malformed_response', 'بيانات الدفعة غير صالحة للاسترداد.');
        }

        $captured = $this->intOrNull($payment['captured'] ?? null);
        $chargeable = $captured !== null && $captured > 0 ? min($captured, $paymentAmount) : $paymentAmount;
        $refundedBefore = min($this->intOrNull($payment['refunded'] ?? null) ?? 0, $paymentAmount);
        if ($amountMinor > $chargeable - $refundedBefore) {
            throw new PaymentRefundRejectedException('moyasar.refund_exceeds_available', 'مبلغ الاسترداد يتجاوز المتاح للاسترداد لدى المزوّد.');
        }

        try {
            $response = $this->client->refundPayment($gateway, $paymentId, $amountMinor);
        } catch (PaymentGatewayException $e) {
            // بعد الإرسال: انقطاع/5xx/استجابة غير مفهومة قد يعني أن الاسترداد نُفِّذ ⇒ غير معروف. غير ذلك رفض/اعتماد/حدّ طلبات ⇒ لم يُنفَّذ.
            throw in_array($e->reason, ['moyasar.unavailable', 'moyasar.malformed_response'], true)
                ? new PaymentRefundUnknownException($e->reason, $e->getMessage())
                : new PaymentRefundRejectedException($e->reason, $e->getMessage());
        }

        $refundedAfter = $this->intOrNull($response['refunded'] ?? null);
        $currency = strtoupper((string) ($response['currency'] ?? ''));
        if (! is_string($response['id'] ?? null) || ! hash_equals($paymentId, $response['id']) || $refundedAfter === null || $refundedAfter > $paymentAmount || strlen($currency) !== 3) {
            throw new PaymentRefundUnknownException('moyasar.malformed_response', 'استجابة الاسترداد غير مفهومة؛ قد يكون نُفِّذ.');
        }

        return new PaymentProviderRefund($paymentId, $refundedAfter, $currency, $this->parseTime($response['refunded_at'] ?? null));
    }

    private function intOrNull(mixed $value): ?int
    {
        if (is_int($value)) {
            return $value;
        }

        return is_string($value) && preg_match('/^\d{1,15}$/', $value) === 1 ? (int) $value : null;
    }

    private function parseTime(mixed $value): ?CarbonImmutable
    {
        if (! is_string($value) || $value === '') {
            return null;
        }
        try {
            return CarbonImmutable::parse($value)->utc();
        } catch (Throwable) {
            return null;
        }
    }
}
