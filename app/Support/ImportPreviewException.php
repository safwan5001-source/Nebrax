<?php

namespace App\Support;

use DomainException;
use Illuminate\Http\JsonResponse;

/**
 * رفضٌ مرتبط بمعاينة الاستيراد (IMP-H1-S3b) برمزٍ ثابتٍ تترجمه الواجهة: `preview_required` · `preview_invalid` ·
 * `preview_expired` · `preview_consumed` · `preview_mismatch` · `options_frozen`. يرث `DomainException` (لا `RuntimeException`)
 * عمداً كي لا يبتلعه `ApiController::domain()` كـ422 نصّيّ بلا رمز؛ يُحوَّل هنا إلى 422 `{message, code}`.
 */
class ImportPreviewException extends DomainException
{
    public function __construct(public readonly string $reason, string $message)
    {
        parent::__construct($message);
    }

    public function render(): JsonResponse
    {
        return response()->json(['message' => $this->getMessage(), 'code' => $this->reason], 422);
    }
}
