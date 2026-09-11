<?php

namespace App\Services\Accounting;

use App\Models\CashBankAccount;
use App\Models\Payment;
use App\Models\PaymentGateway;
use App\Models\PaymentGatewaySettlement;
use App\Models\PaymentGatewaySettlementItem;
use App\Models\User;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

final class PaymentGatewaySettlementService
{
    public function __construct(
        private readonly TenantContext $tenantContext,
        private readonly LedgerService $ledger,
        private readonly AccountRoleResolver $accountRoles,
        private readonly CashBankAccountService $cashBankAccounts,
    ) {
    }

    public function post(array $input, ?User $actor = null): PaymentGatewaySettlement
    {
        $tenantId = $this->requireTenant();

        $gatewayId = (string) ($input['payment_gateway_id'] ?? '');
        $cashBankId = (string) ($input['cash_bank_account_id'] ?? '');
        $ref = trim((string) ($input['provider_settlement_ref'] ?? ''));
        $date = (string) ($input['settlement_date'] ?? now()->toDateString());
        $itemsInput = $input['items'] ?? [];

        if ($gatewayId === '' || $cashBankId === '' || $ref === '') {
            throw new DomainException('Gateway settlement requires a gateway, bank destination, and provider reference.');
        }
        if (! is_array($itemsInput) || $itemsInput === []) {
            throw new DomainException('Gateway settlement requires at least one matched payment.');
        }

        $net = $this->money($input['net_bank_amount'] ?? null, 'net bank amount');
        $feeExTax = $this->money($input['provider_fee_ex_tax'] ?? 0, 'provider fee');
        $feeTax = $this->money($input['provider_fee_tax'] ?? 0, 'provider fee tax');
        $deductions = $this->money($input['provider_deductions'] ?? 0, 'provider deductions');
        $credits = $this->money($input['provider_credits'] ?? 0, 'provider credits');

        if ($feeTax > 0) {
            throw new DomainException(
                'Provider fee tax posting is not authorized until an approved input-tax routing policy exists. Pass provider_fee_tax=0 or stop for a tax decision.'
            );
        }

        return DB::transaction(function () use (
            $tenantId, $gatewayId, $cashBankId, $ref, $date, $itemsInput,
            $net, $feeExTax, $feeTax, $deductions, $credits, $input, $actor
        ) {
            $gateway = PaymentGateway::query()->whereKey($gatewayId)->lockForUpdate()->first();
            if ($gateway === null) {
                throw new DomainException('Payment gateway must belong to the active tenant.');
            }
            $this->assertSameTenant($tenantId, (string) $gateway->tenant_id, 'Payment gateway');

            $existing = PaymentGatewaySettlement::query()
                ->where('payment_gateway_id', $gateway->id)
                ->where('provider_settlement_ref', $ref)
                ->lockForUpdate()
                ->first();

            if ($existing !== null) {
                return $this->replayOrReject($existing, $net, $feeExTax, $feeTax, $deductions, $credits, $itemsInput);
            }

            $cashEntity = CashBankAccount::query()->whereKey($cashBankId)->first();
            if ($cashEntity === null) {
                throw new DomainException('Cash bank account must belong to the active tenant.');
            }
            $this->assertSameTenant($tenantId, (string) $cashEntity->tenant_id, 'Cash bank account');
            if (! $cashEntity->is_active) {
                throw new RuntimeException('الحساب البنكي المختار معطّل.');
            }
            $this->cashBankAccounts->assertAllowed($cashEntity, 'deposit', $actor);

            $clearing = $this->accountRoles->resolve('gateway_clearing');
            $feeAccount = $this->accountRoles->resolve('provider_fee_expense');
            $bankLedger = $cashEntity->account()->firstOrFail();
            $this->assertSameTenant($tenantId, (string) $clearing->tenant_id, 'Gateway clearing account');
            $this->assertSameTenant($tenantId, (string) $feeAccount->tenant_id, 'Provider fee account');
            $this->assertSameTenant($tenantId, (string) $bankLedger->tenant_id, 'Bank ledger account');

            $normalizedItems = $this->normalizeItems($tenantId, $gateway->id, $itemsInput);
            $gross = 0;
            foreach ($normalizedItems as $item) {
                $gross += $item['gross_amount'];
            }

            $this->assertReconciled($gross, $net, $feeExTax, $feeTax, $deductions, $credits);

            $lines = $this->settlementLines(
                $cashEntity->account_id,
                $feeAccount->id,
                $clearing->id,
                $net,
                $feeExTax,
                $deductions,
                $credits,
                $gross,
            );

            $settlement = PaymentGatewaySettlement::create([
                'tenant_id' => $tenantId,
                'payment_gateway_id' => $gateway->id,
                'cash_bank_account_id' => $cashEntity->id,
                'provider_settlement_ref' => $ref,
                'settlement_date' => $date,
                'status' => PaymentGatewaySettlement::STATUS_POSTED,
                'gross_amount' => $gross,
                'net_bank_amount' => $net,
                'provider_fee_ex_tax' => $feeExTax,
                'provider_fee_tax' => $feeTax,
                'provider_deductions' => $deductions,
                'provider_credits' => $credits,
                'currency' => (string) ($input['currency'] ?? 'SAR'),
                'gateway_provider' => $gateway->provider,
                'gateway_name' => $gateway->name,
                'clearing_account_id' => $clearing->id,
                'fee_expense_account_id' => $feeAccount->id,
                'bank_account_id' => $cashEntity->account_id,
                'created_by' => $input['created_by'] ?? $actor?->id,
            ]);

            foreach ($normalizedItems as $item) {
                PaymentGatewaySettlementItem::create([
                    'tenant_id' => $tenantId,
                    'settlement_id' => $settlement->id,
                    'payment_id' => $item['payment_id'],
                    'provider_event_ref' => $item['provider_event_ref'],
                    'gross_amount' => $item['gross_amount'],
                ]);
            }

            $entry = $this->ledger->post($lines, [
                'entry_date' => $date,
                'description' => "تسوية بوابة {$gateway->name} {$ref}",
                'source_type' => PaymentGatewaySettlement::class,
                'source_id' => $settlement->id,
                'created_by' => $settlement->created_by,
            ]);

            $settlement->forceFill([
                'journal_entry_id' => $entry->id,
                'posted_at' => now(),
            ])->save();

            return $settlement->fresh(['items', 'journalEntry.lines']);
        });
    }

    private function replayOrReject(
        PaymentGatewaySettlement $existing,
        int $net,
        int $feeExTax,
        int $feeTax,
        int $deductions,
        int $credits,
        array $itemsInput,
    ): PaymentGatewaySettlement {
        $gross = 0;
        foreach ($itemsInput as $item) {
            $gross += $this->money($item['gross_amount'] ?? null, 'item gross');
        }

        $same = $existing->isPosted()
            && (int) $existing->gross_amount === $gross
            && (int) $existing->net_bank_amount === $net
            && (int) $existing->provider_fee_ex_tax === $feeExTax
            && (int) $existing->provider_fee_tax === $feeTax
            && (int) $existing->provider_deductions === $deductions
            && (int) $existing->provider_credits === $credits
            && $existing->journal_entry_id;

        if (! $same) {
            throw new DomainException('Provider settlement reference already posted with different amounts.');
        }

        return $existing->fresh(['items', 'journalEntry.lines']);
    }

    private function normalizeItems(string $tenantId, string $gatewayId, array $itemsInput): array
    {
        $normalized = [];
        $seenPayments = [];
        $seenEvents = [];

        foreach ($itemsInput as $raw) {
            $paymentId = (string) ($raw['payment_id'] ?? '');
            $gross = $this->money($raw['gross_amount'] ?? null, 'item gross');
            $eventRef = isset($raw['provider_event_ref']) ? trim((string) $raw['provider_event_ref']) : '';
            $eventRef = $eventRef === '' ? null : $eventRef;

            if ($paymentId === '') {
                throw new DomainException('Each settlement item requires a payment.');
            }
            if (isset($seenPayments[$paymentId])) {
                throw new DomainException('A payment cannot appear twice in the same settlement.');
            }
            $seenPayments[$paymentId] = true;

            if ($eventRef !== null) {
                if (isset($seenEvents[$eventRef])) {
                    throw new DomainException('Provider event references must be unique inside a settlement.');
                }
                $seenEvents[$eventRef] = true;

                $duplicateEvent = PaymentGatewaySettlementItem::query()
                    ->where('provider_event_ref', $eventRef)
                    ->whereHas('settlement', function ($query) use ($gatewayId) {
                        $query->where('payment_gateway_id', $gatewayId)
                            ->where('status', PaymentGatewaySettlement::STATUS_POSTED);
                    })
                    ->exists();
                if ($duplicateEvent) {
                    throw new DomainException('Provider event reference already settled for this gateway.');
                }
            }

            $payment = Payment::query()->whereKey($paymentId)->lockForUpdate()->first();
            if ($payment === null) {
                throw new DomainException('Settlement payment must belong to the active tenant.');
            }
            $this->assertSameTenant($tenantId, (string) $payment->tenant_id, 'Payment');

            if (! $payment->isPosted()) {
                throw new DomainException('Only posted customer payments can be settled.');
            }
            if ($payment->direction !== 'received') {
                throw new DomainException('Gateway settlement matches customer collections only.');
            }
            if ((string) $payment->payment_gateway_id !== $gatewayId) {
                throw new DomainException('Settlement payment must reference the same gateway.');
            }

            $alreadySettled = (int) PaymentGatewaySettlementItem::query()
                ->where('payment_id', $payment->id)
                ->whereHas('settlement', fn ($query) => $query->where('status', PaymentGatewaySettlement::STATUS_POSTED))
                ->sum('gross_amount');

            $remaining = (int) $payment->amount - $alreadySettled;
            if ($gross > $remaining) {
                throw new DomainException("Settlement item {$gross} exceeds remaining uncleared amount {$remaining}.");
            }

            $normalized[] = [
                'payment_id' => $payment->id,
                'gross_amount' => $gross,
                'provider_event_ref' => $eventRef,
            ];
        }

        return $normalized;
    }

    private function settlementLines(
        string $bankAccountId,
        string $feeAccountId,
        string $clearingAccountId,
        int $net,
        int $feeExTax,
        int $deductions,
        int $credits,
        int $gross,
    ): array {
        $lines = [];

        if ($net > 0) {
            $lines[] = ['account_id' => $bankAccountId, 'debit' => $net, 'description' => 'صافي تسوية البوابة'];
        }

        $expense = $feeExTax + $deductions;
        if ($expense > 0) {
            $lines[] = ['account_id' => $feeAccountId, 'debit' => $expense, 'description' => 'عمولة/خصم المزوّد'];
        }

        if ($credits > 0) {
            $lines[] = ['account_id' => $feeAccountId, 'credit' => $credits, 'description' => 'ائتمان مزوّد صريح'];
        }

        $lines[] = ['account_id' => $clearingAccountId, 'credit' => $gross, 'description' => 'إقفال مقاصة البوابة'];

        return $lines;
    }

    private function assertReconciled(int $gross, int $net, int $feeExTax, int $feeTax, int $deductions, int $credits): void
    {
        $reconstructed = $net + $feeExTax + $feeTax + $deductions - $credits;
        if ($reconstructed !== $gross) {
            throw new DomainException(
                "Gateway settlement does not reconcile: gross {$gross} != net {$net} + fee {$feeExTax} + fee_tax {$feeTax} + deductions {$deductions} - credits {$credits}."
            );
        }
        if ($gross <= 0) {
            throw new DomainException('Gateway settlement gross must be positive.');
        }
    }

    private function money(mixed $value, string $label): int
    {
        if ($value === null || $value === '') {
            throw new DomainException("Missing {$label}.");
        }
        if (is_float($value)) {
            throw new DomainException("{$label} must use integer minor units, not floating point.");
        }
        if (! is_int($value) && ! (is_string($value) && preg_match('/^-?\d+$/', $value))) {
            throw new DomainException("{$label} must use integer minor units.");
        }

        $amount = (int) $value;
        if ($amount < 0) {
            throw new DomainException("{$label} cannot be negative.");
        }

        return $amount;
    }

    private function requireTenant(): string
    {
        $tenantId = $this->tenantContext->id();
        if ($tenantId === null) {
            throw new DomainException('Tenant context is required for gateway settlements.');
        }

        return $tenantId;
    }

    private function assertSameTenant(string $activeTenantId, string $recordTenantId, string $label): void
    {
        if ($recordTenantId !== $activeTenantId) {
            throw new DomainException("{$label} must belong to the active tenant.");
        }
    }
}
