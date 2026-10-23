<?php

namespace App\Services;

use App\Support\AiActionException;
use App\Support\ProductImportActionSchema;

final class AiActionRegistry
{
    public const PRODUCT_IMPORT = 'product_import.v1';

    public function __construct(private readonly ProductImportActionSchema $productImportSchema) {}

    /**
     * `domain_permissions` و`application_key` هما **بوابات واجهة المجال المباشرة** نفسها (نفس صلاحيات RBAC
     * ونفس قدرة التطبيق) — لا بوابات أضعف لأن الطلب جاء عبر المساعد (IMP-H1-S7).
     * يحرس ذلك `AiActionTypeGatesTest`: نوعٌ يُسجَّل بلا بواباته يُفشل CI.
     *
     * @return array{type:string,schema_version:int,domain_permissions:list<string>,application_key:?string,scope:string}
     */
    public function definition(string $type): array
    {
        if ($type !== self::PRODUCT_IMPORT) {
            throw new AiActionException('action_type_unknown', 'نوع AI Action غير مسجّل.', 422);
        }

        return [
            'type' => self::PRODUCT_IMPORT,
            'schema_version' => 1,
            'domain_permissions' => ['products.manage'],
            // بلا قدرة تطبيق: مطابق لـ`products/import*` المباشرة التي لا تحمل حارس قدرة.
            'application_key' => null,
            'scope' => 'company_wide_with_branch_context',
        ];
    }

    /** @return list<string> */
    public function types(): array
    {
        return [self::PRODUCT_IMPORT];
    }

    /** @return array{row_count:int,error_count:int,needs_review_count:int} */
    public function validateProposal(string $type, array $proposal): array
    {
        $this->definition($type);

        return $this->productImportSchema->validate($proposal);
    }
}
