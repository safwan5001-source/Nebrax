<?php

namespace Tests\Unit;

use App\Services\DocumentCenter\DocumentFinancialValidator;
use Tests\TestCase;

class DocumentFinancialValidatorTest extends TestCase
{
    /** @test */
    public function documentFinancialAcceptsConsistentPurchaseMinorUnitEvidence(): void
    {
        $this->assertSame([], $this->validate($this->payload()));
    }

    /** @test */
    public function documentFinancialReportsUnsupportedTaxAndHeaderMismatchAsEvidence(): void
    {
        $payload = $this->payload();
        $payload['lines'][0]['tax_rate'] = '7';
        $payload['fields']['total_amount_minor'] = 11900;
        $issues = $this->validate($payload);

        $this->assertContains('tax_rate_unsupported', array_column($issues, 'code'));
        $this->assertContains('document_total_mismatch', array_column($issues, 'code'));
        $this->assertContains('blocking', array_column($issues, 'severity'));
    }

    /** @test */
    public function documentFinancialAllowsDiscountBelowGrossLineValueForMultipleUnits(): void
    {
        $payload = $this->payload(quantity: '2', price: 10000, discount: 15000, tax: 750, total: 5750);

        $this->assertSame([], $this->validate($payload));
    }

    /** @test */
    public function documentFinancialBlocksDiscountAboveGrossLineValue(): void
    {
        $payload = $this->payload(quantity: '2', price: 10000, discount: 20001, tax: 0, total: 0);

        $this->assertContains('discount_exceeds_line', array_column($this->validate($payload), 'code'));
    }

    /** @test */
    public function documentFinancialValidatesFractionalQuantityWithoutFloatMath(): void
    {
        $payload = $this->payload(quantity: '1.5', price: 10000, discount: 0, tax: 2250, total: 17250);

        $this->assertSame([], $this->validate($payload));
    }

    /** @test */
    public function documentFinancialBlocksIncorrectFractionalQuantityTotals(): void
    {
        $payload = $this->payload(quantity: '1.5', price: 10000, discount: 0, tax: 2250, total: 17300);

        $this->assertContains('line_total_mismatch', array_column($this->validate($payload), 'code'));
    }

    /** @test */
    public function documentFinancialValidatesInclusivePriceAfterDiscount(): void
    {
        $payload = $this->payload(quantity: '2', price: 10000, discount: 5000, tax: 1957, total: 15000, inclusive: true);

        $this->assertSame([], $this->validate($payload));
    }

    /** @test */
    public function documentFinancialBlocksInvalidOrZeroQuantities(): void
    {
        foreach (['0', '-1', 'one'] as $quantity) {
            $issues = $this->validate($this->payload(quantity: $quantity));
            $this->assertContains('line_total_mismatch', array_column($issues, 'code'));
        }
    }

    /** @test */
    public function documentFinancialReportsOverflowAsSafeEvidence(): void
    {
        $payload = $this->payload(quantity: '999999999999999999', price: PHP_INT_MAX, discount: 0, tax: 0, total: 0);

        $this->assertContains('financial_value_overflow', array_column($this->validate($payload), 'code'));
    }

    /** @test */
    public function documentFinancialAcceptsRoundingDifferenceWithinToleranceAndBlocksOutsideIt(): void
    {
        $within = $this->payload(quantity: '1', price: 100, discount: 0, tax: 15, total: 116);
        $outside = $this->payload(quantity: '1', price: 100, discount: 0, tax: 15, total: 117);

        $this->assertNotContains('line_total_mismatch', array_column($this->validate($within), 'code'));
        $this->assertContains('line_total_mismatch', array_column($this->validate($outside), 'code'));
    }

    /** @return array<string,mixed> */
    private function payload(string $quantity = '1', int $price = 10000, int $discount = 0, int $tax = 1500, int $total = 11500, bool $inclusive = false): array
    {
        $gross = match ($quantity) {
            '2' => $price * 2,
            '1.5' => intdiv($price * 3, 2),
            default => $price,
        };
        $subtotal = $inclusive ? $total - $tax : $gross - $discount;

        return [
            'fields' => [
                'currency' => 'SAR',
                'price_includes_tax' => $inclusive,
                'subtotal_minor' => $subtotal,
                'tax_amount_minor' => $tax,
                'total_amount_minor' => $total,
            ],
            'lines' => [[
                'quantity' => $quantity,
                'unit_price_minor' => $price,
                'discount_minor' => $discount,
                'tax_rate' => '15',
                'tax_amount_minor' => $tax,
                'total_minor' => $total,
            ]],
        ];
    }

    /** @param array<string,mixed> $payload */
    private function validate(array $payload): array
    {
        return app(DocumentFinancialValidator::class)->validate($payload, 'purchase_invoice');
    }
}
