<?php

namespace App\Services\Accounting;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/** عميل HTTP منخفض المستوى. إعادة المحاولة مسؤولية سجل المحاولات الدائم لا هذا العميل. */
final class ZatcaHttpTransport
{
    public function __construct(private readonly ZatcaSubmissionEndpointResolver $endpoints) {}

    public function submit(
        ZatcaTransportCredential $credential,
        string $submissionType,
        string $invoiceHash,
        string $signedXml,
    ): ZatcaTransportResult {
        $this->assertPayload($invoiceHash, $signedXml);
        $endpoint = $this->endpoints->resolve($credential->environment, $submissionType);

        try {
            $response = Http::acceptJson()
                ->asJson()
                ->withBasicAuth($credential->csid, $credential->secret)
                ->withHeaders([
                    'accept-version' => 'v2',
                    'accept-language' => 'en',
                ])
                ->connectTimeout($this->positiveTimeout('connect_timeout_seconds', 5))
                ->timeout($this->positiveTimeout('timeout_seconds', 30))
                ->retry(0, 0, throw: false)
                ->post($endpoint, [
                    'invoiceHash' => $invoiceHash,
                    'invoice' => base64_encode($signedXml),
                ]);
        } catch (ConnectionException) {
            return new ZatcaTransportResult(
                'failed',
                null,
                'connection_failed',
                'تعذر الاتصال بخدمة ZATCA.',
                ['retryable' => true],
                true,
            );
        }

        return $this->normalize($response);
    }

    private function assertPayload(string $invoiceHash, string $signedXml): void
    {
        $decodedHash = base64_decode($invoiceHash, true);
        if ($decodedHash === false || strlen($decodedHash) !== 32) {
            throw new RuntimeException('بصمة فاتورة ZATCA يجب أن تكون SHA-256 بترميز Base64.');
        }
        if (trim($signedXml) === '') {
            throw new RuntimeException('XML الموقّع مطلوب قبل الإرسال إلى ZATCA.');
        }
    }

    private function positiveTimeout(string $key, int $default): int
    {
        $value = config("zatca.transport.{$key}", $default);

        return is_numeric($value) && (int) $value > 0 ? (int) $value : $default;
    }

    private function normalize(Response $response): ZatcaTransportResult
    {
        $httpStatus = $response->status();
        $decoded = $response->json();
        $payload = is_array($decoded) ? $decoded : [];
        $clearedInvoice = null;
        if (isset($payload['clearedInvoice'])
            && is_string($payload['clearedInvoice'])
            && base64_decode($payload['clearedInvoice'], true) !== false) {
            $clearedInvoice = $payload['clearedInvoice'];
        }
        $auditPayload = $this->sanitize($payload);
        $accepted = in_array($httpStatus, [200, 202], true);
        $retryable = $httpStatus === 408 || $httpStatus === 429 || $httpStatus >= 500;
        $status = $accepted ? 'accepted' : ($retryable ? 'failed' : 'rejected');
        $code = $this->responseCode($payload, $httpStatus);

        return new ZatcaTransportResult(
            $status,
            $httpStatus,
            $code,
            $accepted
                ? ($httpStatus === 202 ? 'قبلت ZATCA المستند مع تحذيرات.' : 'قبلت ZATCA المستند.')
                : ($retryable ? 'تعذر إكمال طلب ZATCA مؤقتاً.' : 'رفضت ZATCA طلب المستند.'),
            $auditPayload,
            $retryable,
            $clearedInvoice,
        );
    }

    /** @param array<string, mixed> $payload */
    private function responseCode(array $payload, int $httpStatus): string
    {
        foreach (['clearanceStatus', 'reportingStatus', 'status'] as $key) {
            if (isset($payload[$key]) && is_scalar($payload[$key])) {
                return mb_substr((string) $payload[$key], 0, 120);
            }
        }

        return "http_{$httpStatus}";
    }

    /** @param array<string, mixed> $payload @return array<string, mixed> */
    private function sanitize(array $payload, int $depth = 0): array
    {
        if ($depth >= 6) {
            return [];
        }

        $blocked = ['authorization', 'authenticationcertificate', 'binarysecuritytoken', 'secret',
            'privatekey', 'certificate', 'certificatechain', 'invoice', 'clearedinvoice'];
        $clean = [];

        foreach (array_slice($payload, 0, 100, true) as $key => $value) {
            $normalizedKey = preg_replace('/[^a-z0-9]/', '', mb_strtolower((string) $key));
            if (in_array($normalizedKey, $blocked, true)) {
                continue;
            }
            if (is_array($value)) {
                $clean[$key] = $this->sanitize($value, $depth + 1);
            } elseif (is_scalar($value) || $value === null) {
                $clean[$key] = is_string($value) ? mb_substr(strip_tags($value), 0, 4000) : $value;
            }
        }

        return $clean;
    }
}
