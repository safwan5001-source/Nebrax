<?php

namespace Tests\Feature;

use App\Services\Accounting\InvoiceLinePrecision;
use RuntimeException;
use Tests\TestCase;

class InvoiceLinePrecisionTest extends TestCase
{
    /** @test */
    public function it_rounds_fractional_invoice_line_amounts_half_up_once_at_the_minor_unit_boundary(): void
    {
        $precision = app(InvoiceLinePrecision::class);

        $whole = $precision->fromItem(['quantity_numerator' => 1000, 'quantity_denominator' => 1000], 230);
        $this->assertSame(230, $whole['rounded_gross_minor']);

        $fraction = $precision->fromItem(['quantity_numerator' => 1234, 'quantity_denominator' => 1000], 230);
        $this->assertSame('283820', $fraction['pricing_numerator']);
        $this->assertSame(284, $fraction['rounded_gross_minor']);
        $this->assertSame('820', $fraction['rounding_remainder_numerator']);
        $this->assertSame(InvoiceLinePrecision::ROUNDING_HALF_UP, $fraction['rounding_policy']);

        $below = $precision->fromItem(['quantity_numerator' => 1, 'quantity_denominator' => 1000], 499);
        $half = $precision->fromItem(['quantity_numerator' => 1, 'quantity_denominator' => 2], 1);
        $above = $precision->fromItem(['quantity_numerator' => 1, 'quantity_denominator' => 1000], 501);
        $this->assertSame(0, $below['rounded_gross_minor']);
        $this->assertSame(1, $half['rounded_gross_minor']);
        $this->assertSame(1, $above['rounded_gross_minor']);
    }

    /** @test */
    public function it_rejects_partial_or_invalid_fractional_quantity_contracts(): void
    {
        $precision = app(InvoiceLinePrecision::class);

        $this->expectException(RuntimeException::class);
        $precision->fromItem(['quantity_numerator' => 1234], 230);
    }
}
