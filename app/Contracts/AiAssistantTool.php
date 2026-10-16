<?php

namespace App\Contracts;

use App\Models\User;

/**
 * أداة مسجَّلة للمساعد. السجلّ مغلق (`AiAssistantToolRegistry`) وفارغ في AI-01.
 *
 * العقد لمرحلة لاحقة: كل استدعاء يعاد تفويضه (فاعل طازج + صلاحية الأداة +
 * فئة البيانات + النطاق) قبل `execute`، ولا يُمرَّر لها معرّف مستأجر من النموذج.
 */
interface AiAssistantTool
{
    public function name(): string;

    /** صلاحية RBAC الإضافية اللازمة لهذه الأداة (فوق `ai.assistant.use`). */
    public function requiredPermission(): string;

    /** فئة البيانات التي تنقلها نتيجة الأداة إلى المزوّد. */
    public function dataCategory(): string;

    /** هل للأداة بُعد مخزن؟ إن لم يكن، يُرفض طلبٌ يحدّد مخازن صراحةً بدل تجاهلها بصمت. */
    public function supportsWarehouseScope(): bool;

    /**
     * يتحقق من معطيات الأداة ضد **مخططها المغلق** ويُرجعها مُطبَّعة. مفتاح مجهول أو قيمة خارج الحدود
     * يرمي `InvalidArgumentException` (تُحوَّل إلى `invalid_tool_arguments`). يُستدعى بعد التفويض لا قبله.
     *
     * @param  array<string,mixed>  $arguments
     * @return array<string,mixed>
     * @throws \InvalidArgumentException
     */
    public function validate(array $arguments): array;

    /**
     * بيانات وصفية للتدقيق (أعداد/أعلام من `AiAuditRecorder::META_KEYS` فقط) مشتقة من النتيجة —
     * ممنوع أن تحمل أرقاماً مالية أو أسماء.
     *
     * @param  array<string,mixed>  $result
     * @return array<string,int|bool|string>
     */
    public function auditMeta(array $result): array;

    /**
     * @param  array<string,mixed>  $arguments  مُتحقَّق منها بـ`validate()`.
     * @param  array{mode:string, ids:list<string>}  $branchScope
     * @param  array{mode:string, ids:list<string>}  $warehouseScope
     * @return array<string,mixed>
     */
    public function execute(User $actor, array $arguments, array $branchScope, array $warehouseScope): array;
}
