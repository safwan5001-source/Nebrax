<?php

namespace App\Services\DocumentCenter;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\RequestException;
use Illuminate\Http\Client\Response;
use Throwable;

/**
 * Safe Gemini connection-test taxonomy. Never copies upstream bodies, headers, or secrets.
 */
final class GeminiConnectionDiagnostic
{
    public const API_KEY_MISSING = 'gemini_api_key_missing';

    public const MODEL_MISSING = 'gemini_model_missing';

    public const NETWORK_DISABLED = 'gemini_provider_network_disabled';

    public const AUTH_FAILED = 'gemini_auth_failed';

    public const PERMISSION_DENIED = 'gemini_permission_denied';

    public const MODEL_UNAVAILABLE = 'gemini_model_unavailable';

    public const RATE_LIMITED = 'gemini_rate_limited';

    public const TIMEOUT = 'gemini_timeout';

    public const UPSTREAM_UNAVAILABLE = 'gemini_upstream_unavailable';

    public const INVALID_RESPONSE = 'gemini_invalid_response';

    public const CONNECTION_FAILED = 'gemini_connection_failed';

    /** @var array<string, string> */
    private const MESSAGES = [
        self::API_KEY_MISSING => 'مفتاح Gemini غير محفوظ.',
        self::MODEL_MISSING => 'اسم نموذج Gemini مطلوب.',
        self::NETWORK_DISABLED => 'اتصالات مزودي الذكاء الاصطناعي معطلة في مرحلة التأسيس الحالية.',
        self::AUTH_FAILED => 'مفتاح Gemini غير صالح أو تم رفضه.',
        self::PERMISSION_DENIED => 'لا يملك المفتاح صلاحية استخدام Gemini API.',
        self::MODEL_UNAVAILABLE => 'النموذج المحدد غير متاح لهذا المفتاح.',
        self::RATE_LIMITED => 'تم تجاوز حصة Gemini أو حد الطلبات.',
        self::TIMEOUT => 'انتهت مهلة الاتصال بـ Gemini.',
        self::UPSTREAM_UNAVAILABLE => 'تعذر الوصول إلى خدمة Gemini مؤقتًا.',
        self::INVALID_RESPONSE => 'أعاد Gemini استجابة غير مكتملة أو غير متوقعة.',
        self::CONNECTION_FAILED => 'تعذر إكمال اختبار اتصال Gemini.',
    ];

    /** @var list<string> */
    private const CODES = [
        self::API_KEY_MISSING,
        self::MODEL_MISSING,
        self::NETWORK_DISABLED,
        self::AUTH_FAILED,
        self::PERMISSION_DENIED,
        self::MODEL_UNAVAILABLE,
        self::RATE_LIMITED,
        self::TIMEOUT,
        self::UPSTREAM_UNAVAILABLE,
        self::INVALID_RESPONSE,
        self::CONNECTION_FAILED,
    ];

    /** @var array<string, string> */
    private const GOOGLE_STATUS_CODES = [
        'UNAUTHENTICATED' => self::AUTH_FAILED,
        'PERMISSION_DENIED' => self::PERMISSION_DENIED,
        'NOT_FOUND' => self::MODEL_UNAVAILABLE,
        'RESOURCE_EXHAUSTED' => self::RATE_LIMITED,
        'DEADLINE_EXCEEDED' => self::TIMEOUT,
        'UNAVAILABLE' => self::UPSTREAM_UNAVAILABLE,
    ];

    /** @var array<string, string> */
    private const GOOGLE_REASON_CODES = [
        'API_KEY_INVALID' => self::AUTH_FAILED,
        'API_KEY_INVALID_EXPIRED' => self::AUTH_FAILED,
        'API_KEY_SERVICE_BLOCKED' => self::PERMISSION_DENIED,
    ];

    /** @return list<string> */
    public static function codes(): array
    {
        return self::CODES;
    }

    public static function isKnown(string $code): bool
    {
        return in_array($code, self::CODES, true);
    }

    public static function message(string $code): string
    {
        return self::MESSAGES[$code] ?? self::MESSAGES[self::CONNECTION_FAILED];
    }

    public static function failed(string $code, ?int $httpStatus = null): ProviderConnectionTestResult
    {
        $safeCode = self::isKnown($code) ? $code : self::CONNECTION_FAILED;

        return ProviderConnectionTestResult::failed(self::message($safeCode), $safeCode, self::boundedHttpStatus($httpStatus));
    }

    public static function passed(): ProviderConnectionTestResult
    {
        return ProviderConnectionTestResult::passed('نجح اختبار اتصال Google Gemini.');
    }

    public static function fromResponse(Response $response): ProviderConnectionTestResult
    {
        if ($response->successful()) {
            return self::fromSuccessfulResponse($response);
        }

        $httpStatus = $response->status();
        $payload = $response->json();
        $error = is_array($payload) && is_array($payload['error'] ?? null) ? $payload['error'] : [];

        $reasonCode = self::allowlistedReason($error);
        if ($reasonCode !== null) {
            return self::failed($reasonCode, $httpStatus);
        }

        $statusName = is_string($error['status'] ?? null) ? $error['status'] : null;
        if (is_string($statusName) && isset(self::GOOGLE_STATUS_CODES[$statusName])) {
            return self::failed(self::GOOGLE_STATUS_CODES[$statusName], $httpStatus);
        }

        return self::failed(self::fromHttpStatus($httpStatus), $httpStatus);
    }

    public static function fromThrowable(Throwable $exception): ProviderConnectionTestResult
    {
        if ($exception instanceof RequestException && $exception->response instanceof Response) {
            return self::fromResponse($exception->response);
        }

        if ($exception instanceof ConnectionException || self::looksLikeTimeout($exception)) {
            return self::failed(self::looksLikeTimeout($exception) ? self::TIMEOUT : self::UPSTREAM_UNAVAILABLE);
        }

        return self::failed(self::CONNECTION_FAILED);
    }

    public static function redact(string $text, string $secret): string
    {
        if ($secret === '' || mb_strlen($secret) < 8 || ! str_contains($text, $secret)) {
            return $text;
        }

        return str_replace($secret, '[redacted]', $text);
    }

    public static function redactResult(ProviderConnectionTestResult $result, string $secret): ProviderConnectionTestResult
    {
        $message = self::redact($result->message, $secret);
        $errorCode = $result->errorCode === null ? null : self::redact($result->errorCode, $secret);
        if ($errorCode !== null && ! self::isKnown($errorCode)) {
            $errorCode = self::CONNECTION_FAILED;
            $message = self::message($errorCode);
        }

        if ($message === $result->message && $errorCode === $result->errorCode) {
            return $result;
        }

        return $result->ok
            ? ProviderConnectionTestResult::passed($message)
            : ProviderConnectionTestResult::failed($message, $errorCode, $result->httpStatus);
    }

    private static function fromSuccessfulResponse(Response $response): ProviderConnectionTestResult
    {
        $payload = $response->json();
        if (! is_array($payload) || ! self::hasOutputText($payload)) {
            return self::failed(self::INVALID_RESPONSE, $response->status());
        }

        return self::passed();
    }

    /** @param array<string, mixed> $error */
    private static function allowlistedReason(array $error): ?string
    {
        $details = $error['details'] ?? null;
        if (! is_array($details)) {
            return null;
        }

        foreach ($details as $detail) {
            if (! is_array($detail) || ! is_string($detail['reason'] ?? null)) {
                continue;
            }
            $reason = $detail['reason'];
            if (isset(self::GOOGLE_REASON_CODES[$reason])) {
                return self::GOOGLE_REASON_CODES[$reason];
            }
        }

        return null;
    }

    private static function fromHttpStatus(int $status): string
    {
        return match (true) {
            $status === 401 => self::AUTH_FAILED,
            $status === 403 => self::PERMISSION_DENIED,
            $status === 404 => self::MODEL_UNAVAILABLE,
            $status === 408 => self::TIMEOUT,
            $status === 429 => self::RATE_LIMITED,
            $status >= 500 => self::UPSTREAM_UNAVAILABLE,
            default => self::CONNECTION_FAILED,
        };
    }

    /** @param array<string, mixed> $data */
    private static function hasOutputText(array $data): bool
    {
        foreach ($data['candidates'][0]['content']['parts'] ?? [] as $part) {
            if (is_array($part) && is_string($part['text'] ?? null) && trim($part['text']) !== '') {
                return true;
            }
        }

        return false;
    }

    private static function looksLikeTimeout(Throwable $exception): bool
    {
        $haystack = $exception->getMessage();
        $previous = $exception->getPrevious();
        if ($previous instanceof Throwable) {
            $haystack .= ' '.$previous->getMessage();
        }

        return (bool) preg_match('/timed?\s*out|timeout|cURL error 28|Idle timeout/i', $haystack);
    }

    private static function boundedHttpStatus(?int $httpStatus): ?int
    {
        if ($httpStatus === null || $httpStatus < 100 || $httpStatus > 599) {
            return null;
        }

        return $httpStatus;
    }
}
