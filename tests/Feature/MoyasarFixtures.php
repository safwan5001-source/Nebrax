<?php

namespace Tests\Feature;

/**
 * عيّنات استجابات Moyasar بحسب أشكال وثائقها الرسمية (ADR-0005): فاتورة (id, status, amount, currency, url, payments[], metadata) ودفعة
 * (id, status, amount, invoice_id, source{response_code, transaction_url}) وأحداث الـwebhook (id, type, secret_token, live, data).
 * لا مفاتيح ولا أرقام بطاقات حقيقية: مفاتيح `*_test_*` وهمية وحقول بطاقة ممنوعة.
 */
final class MoyasarFixtures
{
    public const INVOICE_ID = 'efebc231-7795-4cfd-b69c-980fe4c02c49';

    public const SECRET_KEY = 'sk_test_fixture_secret_0001';

    public const PUBLISHABLE_KEY = 'pk_test_fixture_publishable_0001';

    public const WEBHOOK_SECRET = 'whs_fixture_token_0001';

    /** @param list<array<string, mixed>> $payments */
    public static function invoice(string $status = 'initiated', int $amount = 11500, array $payments = [], ?string $attemptId = null, string $id = self::INVOICE_ID, string $currency = 'SAR'): array
    {
        return [
            'id' => $id,
            'status' => $status,
            'amount' => $amount,
            'currency' => $currency,
            'description' => 'AWJ invoice:inv-1',
            'amount_format' => number_format($amount / 100, 2).' SAR',
            'url' => "https://checkout.moyasar.com/invoices/{$id}?lang=en",
            'callback_url' => null,
            'expired_at' => '2026-10-23T12:00:00.000Z',
            'created_at' => '2026-10-23T11:00:00.000Z',
            'updated_at' => '2026-10-23T11:05:00.000Z',
            'payments' => $payments,
            'metadata' => $attemptId === null ? [] : ['awj_attempt_id' => $attemptId, 'awj_payable_key' => 'invoice:inv-1'],
        ];
    }

    public static function payment(string $status, int $amount = 11500, string $id = 'a1b2c3d4-0000-4000-8000-000000000001', ?string $responseCode = null, string $invoiceId = self::INVOICE_ID): array
    {
        return [
            'id' => $id,
            'status' => $status,
            'amount' => $amount,
            'currency' => 'SAR',
            'invoice_id' => $invoiceId,
            'created_at' => '2026-10-23T11:02:00.000Z',
            'updated_at' => '2026-10-23T11:03:00.000Z',
            'captured_at' => in_array($status, ['paid', 'captured'], true) ? '2026-10-23T11:03:00.000Z' : null,
            'source' => array_filter([
                'type' => 'creditcard',
                'company' => 'mada',
                'response_code' => $responseCode,
                'transaction_url' => $status === 'initiated' ? 'https://api.moyasar.com/v1/transaction_url/3ds-challenge' : null,
            ], fn ($v) => $v !== null),
        ];
    }

    /** @return array<string, mixed> */
    public static function event(string $type = 'payment_paid', string $eventId = 'evt-0001', ?string $invoiceId = self::INVOICE_ID, string $token = self::WEBHOOK_SECRET, bool $live = false): array
    {
        return [
            'id' => $eventId,
            'type' => $type,
            'created_at' => '2026-10-23T11:03:01.000Z',
            'secret_token' => $token,
            'account_name' => 'AWJ Sandbox',
            'live' => $live,
            'data' => str_starts_with($type, 'card_auth')
                ? ['id' => 'ca-1', 'status' => 'authenticated', 'amount' => 11500, 'currency' => 'SAR']
                : array_merge(self::payment('paid', 11500, invoiceId: $invoiceId ?? self::INVOICE_ID), $invoiceId === null ? ['invoice_id' => null] : []),
        ];
    }
}
