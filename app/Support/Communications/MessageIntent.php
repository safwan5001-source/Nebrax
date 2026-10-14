<?php

namespace App\Support\Communications;

use InvalidArgumentException;

/**
 * ADR-COMMS-01 §1 — «نيّة رسالة»: ما تُصدره الوحدة المستهلكة (OTP، فاتورة، طلب، حملة) دون أن تعرف المزوّد.
 *
 *  - `tenantId` إلزامي: لا نيّة بلا مستأجر، ومفتاح منع التكرار يُشتقّ منه فلا يتصادم بين الشركات.
 *  - `variables` قد تحمل رمز OTP أو بيانات شخصية: **لا تظهر في أي مخرجات تشخيصية** (`__debugInfo`، `describe()`).
 *  - لا قالب مصاغ هنا ولا نص نهائي؛ المحتوى يُركَّب لاحقاً من `templateKey` + `variables` ضمن حدود الفئة.
 *
 * الكائن لا يعرف Laravel ولا قاعدة البيانات ولا `TenantContext`.
 */
final readonly class MessageIntent
{
    /** `\z` لا `$`: الأخيرة تقبل سطراً جديداً لاحقاً فتمرّر مفتاحاً مشوّهاً. */
    public const KEY_PATTERN = '/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\z/';

    /**
     * @param  array<string, string>  $variables
     */
    public function __construct(
        public string $tenantId,
        public MessageClassification $classification,
        public MessageRecipient $recipient,
        public string $templateKey,
        public string $idempotencyKey,
        public string $source,
        public array $variables = [],
    ) {
        if (trim($tenantId) === '') {
            throw new InvalidArgumentException('A message intent requires a tenant id.');
        }

        foreach (['templateKey' => $templateKey, 'idempotencyKey' => $idempotencyKey, 'source' => $source] as $field => $value) {
            if (preg_match(self::KEY_PATTERN, $value) !== 1) {
                throw new InvalidArgumentException("Message intent {$field} must match ".self::KEY_PATTERN);
            }
        }

        foreach ($variables as $name => $value) {
            if (! is_string($name) || preg_match(self::KEY_PATTERN, $name) !== 1 || ! is_string($value)) {
                throw new InvalidArgumentException('Message intent variables must be a map of safe names to string values.');
            }
        }
    }

    public function channel(): CommunicationChannel
    {
        return $this->recipient->channel;
    }

    /** مفتاح منع التكرار المحصور بالمستأجر: نفس المفتاح في مستأجرين مختلفين يعطي قيمتين مختلفتين. */
    public function idempotencyHash(): string
    {
        return hash('sha256', $this->tenantId."\n".$this->idempotencyKey);
    }

    /** وصف آمن للسجلات: بلا متغيرات وبلا عنوان كامل. هو الشكل الوحيد المسموح لتضمين النيّة في نص. */
    public function describe(): string
    {
        return sprintf(
            'tenant=%s channel=%s class=%s template=%s source=%s recipient=%s',
            $this->tenantId,
            $this->channel()->value,
            $this->classification->value,
            $this->templateKey,
            $this->source,
            $this->recipient->masked(),
        );
    }

    /** @return array<string, string> */
    public function __debugInfo(): array
    {
        return ['intent' => $this->describe(), 'variables' => '[redacted]', 'idempotencyKey' => '[redacted]'];
    }
}
