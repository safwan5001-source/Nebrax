<?php

namespace App\Support;

use Illuminate\Http\JsonResponse;
use RuntimeException;

/**
 * مستندٌ بالهوية نفسها محجوزٌ بالفعل (IMP-H5-S1a). يرث `RuntimeException` ⇒ تحوّله مسارات المجال إلى 422 / فشل صف مسمّى.
 * `reason` رمز ثابت؛ `existingType`/`existingId` المستند الذي يحمل الحجز (للمؤسسة نفسها دائماً: الفهرس الفريد مقيّد بالمستأجر).
 */
final class DuplicateDocumentException extends RuntimeException
{
    public function __construct(
        public readonly string $domain,
        public readonly ?string $existingType = null,
        public readonly ?string $existingId = null,
        public readonly string $reason = 'duplicate_document',
    ) {
        parent::__construct('يوجد مستند بالهوية نفسها (مورّد/مرجع/تاريخ/مبلغ) بالفعل؛ لا يُنشأ مكرراً.');
    }

    /** 422 بجسم ثابت `{message, reason}` لأي مسار لا يلتقطه `domain()` (مثل منشئ مسودات مركز المستندات)، دون أي معرّف داخلي. */
    public function render(): JsonResponse
    {
        return response()->json(['message' => $this->getMessage(), 'reason' => $this->reason], 422);
    }
}
