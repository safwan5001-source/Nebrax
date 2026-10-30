<?php

namespace Tests\Feature;

use PHPUnit\Framework\AssertionFailedError;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/** The leak helper must ignore random ids yet always catch a real amount. */
class AssertsNoAmountLeakTest extends TestCase
{
    use AssertsNoAmountLeak;

    #[Test]
    public function a_request_id_that_happens_to_contain_the_digits_is_not_a_leak(): void
    {
        $body = json_encode(['error' => ['code' => 'unauthenticated'], 'meta' => ['request_id' => '641c1700a9-7000-4e1f']]);

        $this->assertNoAmountLeak($body, [700, 1000, 7000]);
        $this->addToAssertionCount(1);
    }

    #[Test]
    public function a_real_amount_is_always_caught_in_every_shape_the_apis_use(): void
    {
        foreach ([
            ['data' => ['price' => ['amount_minor' => 700, 'currency' => 'SAR']]],
            ['data' => [['sale_price_minor' => 700]]],
            ['data' => ['items' => [['unit_price' => ['amount_minor' => 700]]]], 'meta' => ['request_id' => 'abc']],
        ] as $payload) {
            try {
                $this->assertNoAmountLeak((string) json_encode($payload), [700]);
                $this->fail('a leaked amount must be detected');
            } catch (AssertionFailedError $e) {
                $this->assertStringContainsString('price 700 leaked', $e->getMessage());
            }
        }
    }

    #[Test]
    public function a_longer_number_containing_the_digits_is_a_different_value(): void
    {
        $this->assertNoAmountLeak((string) json_encode(['data' => ['total' => 17000, 'n' => 7001]]), [700]);
        $this->addToAssertionCount(1);
    }
}
