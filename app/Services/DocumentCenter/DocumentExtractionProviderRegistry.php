<?php

namespace App\Services\DocumentCenter;

use App\Contracts\DocumentExtractionProvider;
use InvalidArgumentException;

final class DocumentExtractionProviderRegistry
{
    /** @var array<string, DocumentExtractionProvider> */
    private array $providers;

    public function __construct(
        OpenAIDocumentExtractionProvider $openAi,
        AnthropicDocumentExtractionProvider $anthropic,
        GoogleGeminiDocumentExtractionProvider $googleGemini,
    ) {
        $this->providers = [
            $openAi->key() => $openAi,
            $anthropic->key() => $anthropic,
            $googleGemini->key() => $googleGemini,
        ];
    }

    public function resolve(string $key): DocumentExtractionProvider
    {
        if (! array_key_exists($key, $this->providers)) {
            throw new InvalidArgumentException('Document extraction provider is not registered.');
        }

        return $this->providers[$key];
    }

    /** @return list<string> */
    public function keys(): array
    {
        return array_keys($this->providers);
    }
}
