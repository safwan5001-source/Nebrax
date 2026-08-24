<?php

namespace App\Services\DocumentCenter;

final class DocumentExtractionRequest
{
    public function __construct(
        public readonly string $providerKey,
        public readonly DocumentProviderConfiguration $configuration,
        public readonly string $fileName,
        public readonly string $mimeType,
        public readonly string $base64Data,
        public readonly int $pageCount,
        public readonly string $requestedDocumentType,
        public readonly string $defaultLanguage,
    ) {
    }
}
