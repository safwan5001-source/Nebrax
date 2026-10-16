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

    /**
     * @param  array<string,mixed>  $arguments  مُتحقَّق منها ضد مخطط الأداة نفسها.
     * @param  array{mode:string, ids:list<string>}  $branchScope
     * @param  array{mode:string, ids:list<string>}  $warehouseScope
     * @return array<string,mixed>
     */
    public function execute(User $actor, array $arguments, array $branchScope, array $warehouseScope): array;
}
