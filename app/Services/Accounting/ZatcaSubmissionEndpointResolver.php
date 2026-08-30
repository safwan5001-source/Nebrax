<?php

namespace App\Services\Accounting;

use RuntimeException;

/** يثبت وجهة النقل على مضيف ZATCA الرسمي ويمنع العناوين الديناميكية/SSRF. */
final class ZatcaSubmissionEndpointResolver
{
    public function resolve(string $environment, string $submissionType): string
    {
        if (! in_array($submissionType, ['reporting', 'clearance'], true)) {
            throw new RuntimeException('نوع إرسال ZATCA غير صالح.');
        }

        $endpoint = config("zatca.submission_endpoints.{$environment}.{$submissionType}");
        if (! is_string($endpoint) || $endpoint === '') {
            throw new RuntimeException("لا توجد وجهة نقل ZATCA معتمدة لبيئة {$environment}.");
        }

        $parts = parse_url($endpoint);
        $expectedPath = match ($environment) {
            'simulation' => "/e-invoicing/simulation/invoices/{$submissionType}/single",
            'production' => "/e-invoicing/core/invoices/{$submissionType}/single",
            default => null,
        };
        if (($parts['scheme'] ?? null) !== 'https'
            || ($parts['host'] ?? null) !== 'gw-fatoora.zatca.gov.sa'
            || ($parts['path'] ?? null) !== $expectedPath
            || isset($parts['user'])
            || isset($parts['pass'])
            || isset($parts['query'])
            || isset($parts['fragment'])) {
            throw new RuntimeException('وجهة نقل ZATCA لا تطابق العنوان الرسمي المثبت.');
        }

        return $endpoint;
    }
}
