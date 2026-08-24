<?php

namespace App\Services\DocumentCenter;

use App\Contracts\DocumentExtractionProvider;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Throwable;

final class OpenAIDocumentExtractionProvider implements DocumentExtractionProvider
{
    private const ENDPOINT = 'https://api.openai.com/v1/responses';

    public function key(): string
    {
        return 'openai';
    }

    public function validateConfiguration(DocumentProviderConfiguration $configuration): ProviderConfigurationValidationResult
    {
        $errors = [];
        if ($configuration->key !== $this->key()) {
            $errors[] = 'المزود المطلوب لا يطابق إعداد OpenAI.';
        }
        if ($configuration->apiKey === '') {
            $errors[] = 'مفتاح API مطلوب لمزود OpenAI.';
        }
        if ($configuration->model === '') {
            $errors[] = 'اسم النموذج مطلوب لمزود OpenAI.';
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
                'input' => 'Reply with exactly OK.',
                'max_output_tokens' => 16,
            ]);
            $this->assertSuccessful($response);

            return ProviderConnectionTestResult::passed('نجح اختبار اتصال OpenAI.');
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
                'input' => [[
                    'role' => 'user',
                    'content' => [
                        [
                            'type' => 'input_file',
                            'filename' => $request->fileName,
                            'file_data' => "data:{$request->mimeType};base64,{$request->base64Data}",
                            'detail' => 'auto',
                        ],
                        [
                            'type' => 'input_text',
                            'text' => DocumentExtractionNormalizer::instruction($request->requestedDocumentType, $request->defaultLanguage),
                        ],
                    ],
                ]],
                'text' => [
                    'format' => [
                        'type' => 'json_schema',
                        'name' => 'document_extraction',
                        'strict' => true,
                        'schema' => DocumentExtractionNormalizer::jsonSchema(),
                    ],
                ],
                'max_output_tokens' => 4096,
            ]);
            $this->assertSuccessful($response);
            $data = $response->json();
            $text = $this->outputText(is_array($data) ? $data : []);
            if ($text === '') {
                throw new DocumentProviderException('invalid_provider_response', 'أعاد OpenAI نتيجة استخراج غير مكتملة.', false);
            }

            return new ProviderExtractionResult(
                DocumentExtractionNormalizer::normalize($text, $this->key(), $request->configuration->model),
                $this->usage($data, 'input_tokens'),
                $this->usage($data, 'output_tokens'),
            );
        } catch (DocumentProviderException $exception) {
            throw $exception;
        } catch (Throwable) {
            throw new DocumentProviderException('provider_unavailable', 'تعذر الوصول إلى OpenAI لإكمال الاستخراج.', true);
        }
    }

    private function client(DocumentProviderConfiguration $configuration): \Illuminate\Http\Client\PendingRequest
    {
        return Http::acceptJson()
            ->withToken($configuration->apiKey)
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
            throw new DocumentProviderException('provider_authentication_failed', 'تعذر توثيق OpenAI بالمفتاح المحفوظ.', false);
        }
        if ($status === 429) {
            throw new DocumentProviderException('provider_rate_limited', 'تجاوز OpenAI حد الطلبات المؤقت.', true);
        }
        if ($status >= 500 || $status === 408) {
            throw new DocumentProviderException('provider_unavailable', 'خدمة OpenAI غير متاحة مؤقتاً.', true);
        }

        throw new DocumentProviderException('provider_request_rejected', 'رفض OpenAI طلب الاستخراج وفق الإعدادات الحالية.', false);
    }

    /** @param array<string, mixed> $data */
    private function outputText(array $data): string
    {
        if (is_string($data['output_text'] ?? null)) {
            return $data['output_text'];
        }

        foreach ($data['output'] ?? [] as $item) {
            if (! is_array($item)) {
                continue;
            }
            foreach ($item['content'] ?? [] as $content) {
                if (is_array($content) && is_string($content['text'] ?? null)) {
                    return $content['text'];
                }
            }
        }

        return '';
    }

    /** @param array<string, mixed> $data */
    private function usage(array $data, string $key): ?int
    {
        $value = $data['usage'][$key] ?? null;

        return is_int($value) && $value >= 0 ? $value : null;
    }
}
