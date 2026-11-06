<?php

namespace App\Support;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;

/**
 * يُرمى حين يطلب مُصدِرٌ مفتاحاً بـscope يتجاوز صلاحياته (AIA-0.4 / D-08).
 *
 * يُرفض الطلب **كاملاً** (403) قبل إنشاء أي عميل أو مفتاح أو إعادة أي سرّ. الرسالة ترد
 * بأسماء الـ scopes المرفوضة فقط (قيم من السجل القانوني المعلن، لا بيانات مستأجر).
 * يرث `RuntimeException` عمداً ليُلتقط في CLI كخطأ مجال؛ وتصييره 403 عبر `render()`
 * يسبق تحويل `RuntimeException` إلى 422 في المسارات الأخرى.
 */
class PublicApiScopeCeilingException extends RuntimeException
{
    public const REASON = 'scope_exceeds_issuer_permissions';

    /** @param list<string> $deniedScopes */
    public function __construct(private readonly array $deniedScopes)
    {
        parent::__construct('لا يمكنك إصدار مفتاحٍ بنطاقاتٍ تتجاوز صلاحياتك: '.implode(', ', $deniedScopes).'.');
    }

    /** @return list<string> */
    public function deniedScopes(): array
    {
        return $this->deniedScopes;
    }

    public function render(Request $request): JsonResponse
    {
        return response()->json([
            'message'       => $this->getMessage(),
            'reason'        => self::REASON,
            'denied_scopes' => $this->deniedScopes,
        ], 403);
    }
}
