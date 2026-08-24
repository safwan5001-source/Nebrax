<?php

namespace App\Services\DocumentCenter;

use App\Contracts\DocumentExtractionProvider;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Throwable;

final class AnthropicDocumentExtractionProvider implements DocumentExtractionProvider
{
    private const ENDPOINT = 'https://api.anthropic.com/v1/messages';
    private const API_VERSION = '2023-06-01';

    public function key(): string
    {
        return 'anthropic';
    }

    public function validateConfiguration(DocumentProviderConfiguration $configuration): ProviderConfigurationValidationResult
    {
        $errors = [];
        if ($configuration->key !== $this->key()) {
            $errors[] = 'المزود المطلوب لا يطابق إعداد Anthropic Claude.';
        }
        if ($configuration->apiKey === '') {
            $errors[] = 'مفتاح API مطلوب لمزود Anthropic Claude.';
        }
        if ($configuration->model === '') {
            $errors[] = 'اسم النموذج مطلوب لمزود Anthropic Claude.';
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
            $response = $this->client($configuration)->post(self::ENDPOINT, [
                'model' => $configuration->model,
                'max_tokens' => 16,
                'messages' => [['role' => 'user', 'content' => 'Reply with exactly OK.']],
            ]);
            $this->assertSuccessful($response);

            return ProviderConnectionTestResult::passed('نجح اختبار اتصال Anthropic Claude.');
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
            $response = $this->client($request->configuration)->post(self::ENDPOINT, [
                'model' => $request->configuration->model,
                'max_tokens' => 4096,
                'messages' => [[
                    'role' => 'user',
                    'content' => [
                        $this->documentPart($request),
                        ['type' => 'text', 'text' => DocumentExtractionNormalizer::instruction($request->requestedDocumentType, $request->defaultLanguage)],
                    ],
                ]],
                'tools' => [[
                    'name' => 'submit_document_extraction',
                    'description' => 'Submit only the extracted document evidence using the specified schema.',
                    'input_schema' => DocumentExtractionNormalizer::jsonSchema(),
                ]],
                'tool_choice' => ['type' => 'tool', 'name' => 'submit_document_extraction'],
            ]);
            $this->assertSuccessful($response);
            $data = $response->json();
            $input = $this->toolInput(is_array($data) ? $data : []);
            if ($input === null) {
                throw new DocumentProviderException('invalid_provider_response', 'أعاد Anthropic Claude نتيجة استخراج غير مكتملة.', false);
            }

            return new ProviderExtractionResult(
                DocumentExtractionNormalizer::normalize(json_encode($input, JSON_THROW_ON_ERROR), $this->key(), $request->configuration->model),
                $this->usage($data, 'input_tokens'),
                $this->usage($data, 'output_tokens'),
            );
        } catch (DocumentProviderException $exception) {
            throw $exception;
        } catch (Throwable) {
            throw new DocumentProviderException('provider_unavailable', 'تعذر الوصول إلى Anthropic Claude لإكمال الاستخراج.', true);
        }
    }

    /** @return array<string, mixed> */
    private function documentPart(DocumentExtractionRequest $request): array
    {
        if ($request->mimeType === 'application/pdf') {
            return [
                'type' => 'document',
                'source' => ['type' => 'base64', 'media_type' => $request->mimeType, 'data' => $request->base64Data],
            ];
        }

        if (! str_starts_with($request->mimeType, 'image/')) {
            throw new DocumentProviderException('unsupported_provider_file_type', 'نوع الملف غير مدعوم من Anthropic Claude.', false);
        }

        return [
            'type' => 'image',
            'source' => ['type' => 'base64', 'media_type' => $request->mimeType, 'data' => $request->base64Data],
        ];
    }

    private function client(DocumentProviderConfiguration $configuration): \Illuminate\Http\Client\PendingRequest
    {
        return Http::acceptJson()
            ->withHeaders([
                'x-api-key' => $configuration->apiKey,
                'anthropic-version' => self::API_VERSION,
            ])
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
            throw new DocumentProviderException('provider_authentication_failed', 'تعذر توثيق Anthropic Claude بالمفتاح المحفوظ.', false);
        }
        if ($status === 429) {
            throw new DocumentProviderException('provider_rate_limited', 'تجاوز Anthropic Claude حد الطلبات المؤقت.', true);
        }
        if ($status >= 500 || $status === 408) {
            throw new DocumentProviderException('provider_unavailable', 'خدمة Anthropic Claude غير متاحة مؤقتاً.', true);
        }

        throw new DocumentProviderException('provider_request_rejected', 'رفض Anthropic Claude طلب الاستخراج وفق الإعدادات الحالية.', false);
    }

    /** @param array<string, mixed> $data */
    private function toolInput(array $data): ?array
    {
        foreach ($data['content'] ?? [] as $content) {
            if (is_array($content) && $content['type'] === 'tool_use' && is_array($content['input'] ?? null)) {
                return $content['input'];
            }
        }

        return null;
    }

    /** @param array<string, mixed> $data */
    private function usage(array $data, string $key): ?int
    {
        $value = $data['usage'][$key] ?? null;

        return is_int($value) && $value >= 0 ? $value : null;
    }
}
