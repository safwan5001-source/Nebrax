<?php

namespace App\Support;

final class InspectedProductImage
{
    public function __construct(
        public readonly string $mimeType,
        public readonly string $extension,
        public readonly int $size,
        public readonly string $sha256,
        public readonly int $width,
        public readonly int $height,
    ) {}
}
