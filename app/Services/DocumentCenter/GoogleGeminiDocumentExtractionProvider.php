<?php

namespace App\Services\DocumentCenter;

use App\Contracts\DocumentExtractionProvider;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Throwable;

final class GoogleGeminiDocumentExtractionProvider implements DocumentExtractionProvider
{
    private const BASE_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

    public function key(): string
    {
        return 'google_gemini';
    }

    public function validateConfiguration(DocumentProviderConfiguration $configuration): ProviderConfigurationValidationResult
    {
        $errors = [];
        if ($configuration->key !== $this->key()) {
            $errors[] = 'المزود المطلوب لا يطابق إعداد Google Gemini.';
        }
        if ($configuration->apiKey === '') {
            $errors[] = 'مفتاح API مطلوب لمزود Google Gemini.';
        }
        if ($configuration->model === '') {
            $errors[] = 'اسم النموذج مطلوب لمزود Google Gemini.';
        }

        return $errors === [] ? ProviderConfigurationValidationResult::success() : ProviderConfigurationValidationResult::failure($errors);
    }

    public function testConnection(DocumentProviderConfiguration $configuration): ProviderConnectionTestResult
    {
        $validation = $this->validateConfiguration($configuration);
        if (! $validation->valid) {
            return ProviderConnectionTestResult::failed($validation->errors[0]);
        }
        if (! DocumentProviderNetworkGate::allowsExternalRequests()) {
            return ProviderConnectionTestResult::failed(DocumentProviderNetworkGate::blockedMessage());
        }

        try {
            $response = $this->client($configuration)->post($this->endpoint($configuration), [
                'contents' => [['parts' => [['text' => 'Reply with exactly OK.']]]],
                'generationConfig' => ['maxOutputTokens' => 16],
            ]);
            $this->assertSuccessful($response);

            return ProviderConnectionTestResult::passed('نجح اختبار اتصال Google Gemini.');
        } catch (DocumentProviderException $exception) {
            return ProviderConnectionTestResult::failed($exception->safeMessage);
        }
    }

    public function extract(DocumentExtractionRequest $request): ProviderExtractionResult
    {
        $validation = $this->validateConfiguration($request->configuration);
        if (! $validation->valid) {
            throw new DocumentProviderException('provider_not_configured', $validation->errors[0], false);
        }
        DocumentProviderNetworkGate::assertAllowed();

        try {
            $response = $this->client($request->configuration)->post($this->endpoint($request->configuration), [
                'contents' => [[
                    'parts' => [
                        ['inlineData' => ['mimeType' => $request->mimeType, 'data' => $request->base64Data]],
                        ['text' => DocumentExtractionNormalizer::instruction($request->requestedDocumentType, $request->defaultLanguage)],
                    ],
                ]],
                'generationConfig' => [
                    'maxOutputTokens' => 4096,
                    'responseMimeType' => 'application/json',
                    'responseSchema' => DocumentExtractionNormalizer::jsonSchema(),
                ],
            ]);
            $this->assertSuccessful($response);
            $data = $response->json();
            $text = $this->outputText(is_array($data) ? $data : []);
            if ($text === '') {
                throw new DocumentProviderException('invalid_provider_response', 'أعاد Google Gemini نتيجة استخراج غير مكتملة.', false);
            }

            return new ProviderExtractionResult(
                DocumentExtractionNormalizer::normalize($text, $this->key(), $request->configuration->model),
                $this->usage($data, 'promptTokenCount'),
                $this->usage($data, 'candidatesTokenCount'),
            );
        } catch (DocumentProviderException $exception) {
            throw $exception;
        } catch (Throwable) {
            throw new DocumentProviderException('provider_unavailable', 'تعذر الوصول إلى Google Gemini لإكمال الاستخراج.', true);
        }
    }

    private function endpoint(DocumentProviderConfiguration $configuration): string
    {
        return self::BASE_ENDPOINT . '/' . rawurlencode($configuration->model) . ':generateContent';
    }

    private function client(DocumentProviderConfiguration $configuration): \Illuminate\Http\Client\PendingRequest
    {
        return Http::acceptJson()
            ->withHeaders(['x-goog-api-key' => $configuration->apiKey])
            ->connectTimeout($configuration->connectionTimeoutSeconds)
            ->timeout($configuration->processingTimeoutSeconds)
            ->retry(0, 0, throw: false);
    }

    private function assertSuccessful(Response $response): void
    {
        if ($response->successful()) {
            return;
        }

        $status = $response->status();
        if ($status === 401 || $status === 403) {
            throw new DocumentProviderException('provider_authentication_failed', 'تعذر توثيق Google Gemini بالمفتاح المحفوظ.', false);
        }
        if ($status === 429) {
            throw new DocumentProviderException('provider_rate_limited', 'تجاوز Google Gemini حد الطلبات المؤقت.', true);
        }
        if ($status >= 500 || $status === 408) {
            throw new DocumentProviderException('provider_unavailable', 'خدمة Google Gemini غير متاحة مؤقتاً.', true);
        }

        throw new DocumentProviderException('provider_request_rejected', 'رفض Google Gemini طلب الاستخراج وفق الإعدادات الحالية.', false);
    }

    /** @param array<string, mixed> $data */
    private function outputText(array $data): string
    {
        foreach ($data['candidates'][0]['content']['parts'] ?? [] as $part) {
            if (is_array($part) && is_string($part['text'] ?? null)) {
                return $part['text'];
            }
        }

        return '';
    }

    /** @param array<string, mixed> $data */
    private function usage(array $data, string $key): ?int
    {
        $value = $data['usageMetadata'][$key] ?? null;

        return is_int($value) && $value >= 0 ? $value : null;
    }
}
