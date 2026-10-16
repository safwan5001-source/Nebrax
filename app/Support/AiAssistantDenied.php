<?php

namespace App\Support;

use RuntimeException;

/**
 * رفضٌ مُنظَّم من بوابة المساعد الذكي: رمز ثابت + حالة HTTP + نصّ عربي. الرمز هو
 * العقد الذي تبني عليه الواجهة؛ النصّ للعرض فقط. لا يحمل أي بيانات من المستخدم
 * أو من المزوّد، فلا تتسرّب عبره أسرار ولا نصوص.
 */
final class AiAssistantDenied extends RuntimeException
{
    /** @var array<string, array{0:int, 1:string}> */
    private const CATALOG = [
        'platform_disabled'         => [503, 'المساعد الذكي غير مفعّل على مستوى المنصة.'],
        'provider_unavailable'      => [503, 'مزوّد المساعد الذكي غير متاح.'],
        'actor_unavailable'         => [403, 'تعذّر التحقق من هوية المستخدم الحالية.'],
        'actor_inactive'            => [403, 'الحساب غير مفعّل.'],
        'tenant_inactive'           => [403, 'الاشتراك غير مفعّل.'],
        'permission_denied'         => [403, 'ليس لديك صلاحية استخدام المساعد الذكي.'],
        'tenant_not_enabled'        => [403, 'المساعد الذكي غير مفعّل لهذه المؤسسة.'],
        'consent_required'          => [403, 'لا توجد موافقة من المؤسسة على فئة البيانات المطلوبة.'],
        'data_category_unavailable' => [403, 'فئة البيانات المطلوبة غير متاحة في هذه المرحلة.'],
        'branch_scope_forbidden'    => [403, 'نطاق الفرع المطلوب غير مسموح لك.'],
        'warehouse_scope_forbidden' => [403, 'نطاق المخزن المطلوب غير مسموح لك.'],
        'tool_not_registered'       => [403, 'الأداة المطلوبة غير مسجّلة.'],
        'tool_permission_denied'    => [403, 'ليس لديك صلاحية استخدام هذه الأداة.'],
        'too_many_tool_calls'       => [422, 'عدد استدعاءات الأدوات يتجاوز الحدّ المسموح.'],
        'internal_error'            => [500, 'تعذّر إكمال الطلب.'],
    ];

    public ?string $requestId = null;

    private function __construct(public readonly string $reason, public readonly int $status, string $message)
    {
        parent::__construct($message);
    }

    public static function for(string $reason): self
    {
        [$status, $message] = self::CATALOG[$reason] ?? self::CATALOG['internal_error'];

        return new self(isset(self::CATALOG[$reason]) ? $reason : 'internal_error', $status, $message);
    }
}
