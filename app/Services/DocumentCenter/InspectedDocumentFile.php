<?php

namespace App\Services\DocumentCenter;

final readonly class InspectedDocumentFile
{
    public function __construct(
        public string $originalName,
        public ?string $declaredMime,
        public string $detectedMime,
        public string $extension,
        public int $sizeBytes,
        public int $pageCount,
        public string $sha256,
    ) {
    }
}
