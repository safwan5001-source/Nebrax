<?php

namespace App\Services;

use Illuminate\Http\UploadedFile;
use Intervention\Image\Interfaces\ImageManagerInterface;
use RuntimeException;

/**
 * Produces the small, bounded product-image representations used by future
 * catalog consumers. Storage deliberately stays with ProductMediaService so
 * originals and derivatives always use the same tenant-aware abstraction.
 */
final class ProductMediaDerivativeService
{
    public const THUMBNAIL = 'thumbnail';
    public const CARD = 'card';

    public const THUMBNAIL_MAX_DIMENSION = 200;
    public const CARD_MAX_DIMENSION = 800;

    /** @var array<string, int> */
    private const MAX_DIMENSIONS = [
        self::THUMBNAIL => self::THUMBNAIL_MAX_DIMENSION,
        self::CARD => self::CARD_MAX_DIMENSION,
    ];

    public function __construct(private readonly ImageManagerInterface $images) {}

    /** @return list<string> */
    public static function names(): array
    {
        return array_keys(self::MAX_DIMENSIONS);
    }

    public static function maxDimension(string $name): int
    {
        if (! isset(self::MAX_DIMENSIONS[$name])) {
            throw new RuntimeException('Unknown product media derivative.');
        }

        return self::MAX_DIMENSIONS[$name];
    }

    /** @return array{extension:string,mime_type:string} */
    public static function formatForMime(?string $mimeType): array
    {
        return match (strtolower((string) $mimeType)) {
            'image/jpeg', 'image/jpg' => ['extension' => 'jpg', 'mime_type' => 'image/jpeg'],
            'image/png' => ['extension' => 'png', 'mime_type' => 'image/png'],
            'image/webp' => ['extension' => 'webp', 'mime_type' => 'image/webp'],
            default => throw new RuntimeException('Unsupported product image format for derivative generation.'),
        };
    }

    /**
     * Decode and encode one derivative at a time. The callback persists the
     * encoded bytes immediately, so a 5 MB upload never retains both decoded
     * derivative images in memory at once.
     *
     * @param callable(string, string, string): void $store name, bytes, MIME type
     * @return array<string, int> elapsed nanoseconds by derivative name
     */
    public function generate(UploadedFile $file, callable $store): array
    {
        $sourcePath = $file->getRealPath();
        if (! is_string($sourcePath) || $sourcePath === '') {
            throw new RuntimeException('Uploaded product image is unavailable for derivative generation.');
        }

        $format = self::formatForMime($file->getMimeType());
        $durations = [];

        foreach (self::MAX_DIMENSIONS as $name => $maxDimension) {
            $startedAt = hrtime(true);
            $image = $this->images->decodePath($sourcePath);

            // Intervention owns EXIF orientation handling; there is no custom
            // EXIF parser or mutation of the original upload.
            $image->orient()->scaleDown(width: $maxDimension, height: $maxDimension);

            $encoded = match ($format['mime_type']) {
                'image/jpeg' => $image->encodeUsingMediaType('image/jpeg', 85),
                'image/png' => $image->encodeUsingMediaType('image/png'),
                'image/webp' => $image->encodeUsingMediaType('image/webp', 82),
            };

            $store($name, (string) $encoded, $format['mime_type']);
            $durations[$name] = hrtime(true) - $startedAt;

            unset($encoded, $image);
        }

        return $durations;
    }
}
