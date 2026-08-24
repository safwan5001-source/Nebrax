<?php

namespace App\Services\DocumentCenter;

use App\Models\Product;
use App\Services\Accounting\UnitConversion;
use RuntimeException;

final class DocumentUnitMatcher
{
    public function __construct(private readonly UnitConversion $units)
    {
    }

    /** @return array{candidate:?array<string,mixed>,issue:?array<string,string>} */
    public function match(?Product $product, ?string $unit): array
    {
        $unit = is_string($unit) ? trim($unit) : null;
        if ($unit === null || $unit === '') {
            return ['candidate' => null, 'issue' => ['code' => 'unit_unknown', 'severity' => 'blocking', 'message' => 'وحدة السطر غير متاحة للمطابقة.']];
        }
        if ($product === null) {
            return ['candidate' => null, 'issue' => ['code' => 'unit_conversion_missing', 'severity' => 'blocking', 'message' => 'لا يمكن التحقق من وحدة السطر قبل اقتراح منتج مرئي.']];
        }

        try {
            [$resolved, $factor] = $this->units->resolve($product, $unit);
        } catch (RuntimeException) {
            return ['candidate' => null, 'issue' => ['code' => 'unit_not_allowed_for_product', 'severity' => 'blocking', 'message' => 'الوحدة المستخرجة غير مسموحة لقالب وحدات المنتج المقترح.']];
        }

        return [
            'candidate' => [
                'candidate_type' => 'product_unit',
                'candidate_id' => $product->id,
                'score_basis_points' => 10000,
                'strategy' => 'unit_alias',
                'explanation_codes' => ['unit_alias_match'],
                'snapshot' => ['unit_name' => $resolved, 'conversion_factor' => $factor],
            ],
            'issue' => null,
        ];
    }
}
