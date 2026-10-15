<?php

namespace App\Services\Communications;

use App\Support\Communications\CommunicationsConfigurationException;

/**
 * AWJ-COMMS-03-A — سياسة الموزّع من الإعداد مع تحقق صارم وفشل مغلق (لا قيمة افتراضية صامتة عند الخطأ).
 */
final readonly class DispatchPolicy
{
    /**
     * @param  list<int>  $backoffSeconds
     */
    public function __construct(
        public int $leaseSeconds,
        public int $receiptWindowSeconds,
        public array $backoffSeconds,
    ) {
        if ($leaseSeconds < 30 || $leaseSeconds > 3600) {
            throw new CommunicationsConfigurationException('The dispatch lease must be between 30 and 3600 seconds.');
        }

        if ($receiptWindowSeconds < 3600 || $receiptWindowSeconds > 2592000) {
            throw new CommunicationsConfigurationException('The receipt window must be between 1 hour and 30 days.');
        }

        if ($backoffSeconds === [] || count($backoffSeconds) > 10 || ! array_is_list($backoffSeconds)) {
            throw new CommunicationsConfigurationException('The retry backoff must be a list of 1 to 10 delays.');
        }

        foreach ($backoffSeconds as $delay) {
            if (! is_int($delay) || $delay < 1 || $delay > 86400) {
                throw new CommunicationsConfigurationException('Every retry backoff delay must be 1..86400 seconds.');
            }
        }
    }

    public static function fromConfig(): self
    {
        $config = config('communications.dispatch');
        if (! is_array($config)) {
            throw new CommunicationsConfigurationException('The communications dispatch policy is not configured.');
        }

        $lease = $config['lease_seconds'] ?? null;
        $window = $config['receipt_window_seconds'] ?? null;
        $backoff = $config['backoff_seconds'] ?? null;
        if (! is_int($lease) || ! is_int($window) || ! is_array($backoff)) {
            throw new CommunicationsConfigurationException('The communications dispatch policy is invalid.');
        }

        return new self($lease, $window, $backoff);
    }

    /** تأخير ما قبل المحاولة التالية بعد إخفاق المحاولة رقم `$attemptNo` (تبدأ من 1). */
    public function backoffAfterAttempt(int $attemptNo): int
    {
        return $this->backoffSeconds[min(max($attemptNo, 1), count($this->backoffSeconds)) - 1];
    }
}
