<?php

namespace App\Support;

use App\Models\ImportJob;
use Illuminate\Http\UploadedFile;

/**
 * مدخلات ترحيل قطعة واحدة (IMP-H1-S2): كل ما يحتاجه محوّل المجال، مجموعاً بدل قائمة وسائط تتضخّم مع كل مجال.
 * قيمة غير قابلة للتعديل؛ الملفات مؤقتة مادّية يملك المحرّك تنظيفها.
 */
final class ImportChunk
{
    /**
     * @param  array<string, mixed>  $options  الخيارات المجمَّدة للتشغيلة.
     */
    public function __construct(
        public readonly ImportJob $job,
        public readonly UploadedFile $file,
        public readonly ?string $archiveTmpPath,
        public readonly array $options,
        public readonly int $offset,
        public readonly int $batchSize,
        public readonly ?string $userId,
        public readonly bool $costAuthorized,
    ) {}
}
