<?php

namespace Tests\Unit;

use App\Services\DocumentCenter\DocumentFinancialValidator;
use Tests\TestCase;

class DocumentFinancialValidatorTest extends TestCase
{
    /** @test */
    public function documentFinancialAcceptsConsistentPurchaseMinorUnitEvidence(): void
    {
        $issues = app(DocumentFinancialValidator::class)->validate($this->payload());

        $this->assertSame([], $issues);
    }

    /** @test */
    public function documentFinancialReportsUnsupportedTaxAndHeaderMismatchAsEvidence(): void
    {
        $payload = $this->payload();
        $payload['lines'][0]['tax_rate'] = '7';
        $payload['fields']['total_amount_minor'] = 11900;
        $issues = app(DocumentFinancialValidator::class)->validate($payload);

        $this->assertContains('tax_rate_unsupported', array_column($issues, 'code'));
        $this->assertContains('document_total_mismatch', array_column($issues, 'code'));
        $this->assertContains('blocking', array_column($issues, 'severity'));
    }

    /** @return array<string,mixed> */
    private function payload(): array
    {
        return [
            'document_type' => 'purchase_invoice',
            'fields' => [
                'currency' => 'SAR',
                'price_includes_tax' => false,
                'tax_amount_minor' => 1500,
                'total_amount_minor' => 11500,
            ],
            'lines' => [[
                'quantity' => '1',
                'unit_price_minor' => 10000,
                'discount_minor' => 0,
                'tax_rate' => '15',
                'tax_amount_minor' => 1500,
                'total_minor' => 11500,
            ]],
        ];
    }
}
