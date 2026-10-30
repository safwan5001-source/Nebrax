<?php

namespace Tests\Feature;

/**
 * "This response must not reveal a price" without false positives.
 *
 * A bare `assertStringNotContainsString('700', $body)` is flaky: every public API response carries a random
 * `meta.request_id` whose hex digits can contain `700` by chance. This helper (1) drops `meta` and (2) matches the
 * amount only as a whole token, so ids, hashes and timestamps can never trip it while a real
 * `"amount_minor":700` / `"sale_price_minor":700` always does.
 */
trait AssertsNoAmountLeak
{
    /** @param  list<int|string>  $amounts */
    private function assertNoAmountLeak(string $content, array $amounts, string $message = ''): void
    {
        $decoded = json_decode($content, true);
        if (is_array($decoded)) {
            unset($decoded['meta']);
            $content = (string) json_encode($decoded, JSON_UNESCAPED_UNICODE);
        }

        foreach ($amounts as $amount) {
            $this->assertDoesNotMatchRegularExpression(
                '/(?<![0-9A-Za-z._-])'.preg_quote((string) $amount, '/').'(?![0-9A-Za-z._-])/',
                $content,
                trim("price {$amount} leaked. {$message}"),
            );
        }
    }
}
