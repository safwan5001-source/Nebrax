<?php

namespace App\Services;

use Illuminate\Http\JsonResponse;
use RuntimeException;

/**
 * فشل تخزين مرفق. لا يحمل أي سرّ أو بنية طلب؛ الرسالة آمنة للعرض، والسبب الأصلي
 * محفوظ في `previous` للسجلات فقط. يُعرض 503 لأن الخلل في خدمة التخزين لا في الطلب.
 */
final class AttachmentStorageException extends RuntimeException
{
    public function render(): JsonResponse
    {
        return response()->json([
            'message' => 'تعذّر حفظ الملف مؤقتاً. لم يُحفظ أي شيء، يمكنك إعادة المحاولة.',
            'code' => 'storage_unavailable',
        ], 503);
    }
}
