<?php

namespace App\Services\DocumentCenter;

use App\Models\Product;
use App\Models\ProductBarcode;

final class DocumentProductMatcher
{
    public function __construct(private readonly DocumentMatchScorer $scorer)
    {
    }

    /** @param array<string, mixed> $line
     *  @return list<array<string, mixed>>
     */
    public function candidates(array $line): array
    {
        $candidates = [];
        $barcode = $line['barcode'] ?? null;
        $sku = $line['sku'] ?? null;

        if ($this->scorer->normalize(is_string($barcode) ? $barcode : null) !== null) {
            Product::query()->where('barcode', $barcode)->get()->each(function (Product $product) use (&$candidates): void {
                $candidates[] = $this->candidate($product, 10000, 'exact_barcode');
            });
            ProductBarcode::query()->where('code', $barcode)->get()->each(function (ProductBarcode $barcode) use (&$candidates): void {
                $product = Product::query()->whereKey($barcode->product_id)->first();
                if ($product !== null) {
                    $candidates[] = $this->candidate($product, 10000, 'exact_barcode', $barcode->unit_name);
                }
            });
        }
        if ($this->scorer->normalize(is_string($sku) ? $sku : null) !== null) {
            Product::query()->where('sku', $sku)->get()->each(function (Product $product) use (&$candidates): void {
                $candidates[] = $this->candidate($product, 9800, 'exact_sku');
            });
        }
        if ($candidates === []) {
            Product::query()->orderBy('id')->get()->each(function (Product $product) use (&$candidates, $line): void {
                $match = $this->scorer->nameSimilarity(is_string($line['description'] ?? null) ? $line['description'] : null, $product->name);
                if ($match !== null) {
                    $candidates[] = $this->candidate($product, $match['score_basis_points'], $match['strategy']);
                }
            });
        }

        $unique = [];
        foreach ($candidates as $candidate) {
            $id = $candidate['candidate_id'];
            if (! isset($unique[$id]) || $candidate['score_basis_points'] > $unique[$id]['score_basis_points']) {
                $unique[$id] = $candidate;
            }
        }

        return array_values($unique);
    }

    /** @return array<string, mixed> */
    private function candidate(Product $product, int $score, string $strategy, ?string $barcodeUnit = null): array
    {
        return [
            'candidate_type' => Product::class,
            'candidate_id' => $product->id,
            'score_basis_points' => $score,
            'strategy' => $strategy,
            'explanation_codes' => [$strategy, ...(! $product->is_active ? ['inactive_candidate'] : [])],
            'snapshot' => ['name' => $product->name, 'sku' => $product->sku, 'unit' => $product->unit, 'barcode_unit' => $barcodeUnit, 'is_active' => $product->is_active],
        ];
    }
}
