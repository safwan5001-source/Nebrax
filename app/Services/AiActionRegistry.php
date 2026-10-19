<?php

namespace App\Services;

use App\Support\AiActionException;
use App\Support\ProductImportActionSchema;

final class AiActionRegistry
{
    public const PRODUCT_IMPORT = 'product_import.v1';

    public function __construct(private readonly ProductImportActionSchema $productImportSchema) {}

    /** @return array{type:string,schema_version:int,domain_permission:string,scope:string} */
    public function definition(string $type): array
    {
        if ($type !== self::PRODUCT_IMPORT) {
            throw new AiActionException('action_type_unknown', 'نوع AI Action غير مسجّل.', 422);
        }

        return [
            'type' => self::PRODUCT_IMPORT,
            'schema_version' => 1,
            'domain_permission' => 'products.manage',
            'scope' => 'company_wide_with_branch_context',
        ];
    }

    /** @return array{row_count:int,error_count:int,needs_review_count:int} */
    public function validateProposal(string $type, array $proposal): array
    {
        $this->definition($type);

        return $this->productImportSchema->validate($proposal);
    }
}
