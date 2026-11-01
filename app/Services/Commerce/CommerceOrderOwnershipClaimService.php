<?php

namespace App\Services\Commerce;

use App\Models\CommerceOrder;
use App\Models\CommerceOrderOwnershipClaim;
use App\Models\CustomerIdentity;
use App\Support\CommerceOrderReference;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * B2C-ACCOUNTS — the ONLY path that links an existing guest order (`customer_identity_id` NULL) to a customer account.
 *
 * Linking is an explicit, authenticated act of the account holder — never automatic, never from a client-supplied
 * identity. The caller names the order by its number and must PROVE ownership with one of:
 *
 *  1. `order_reference` — the signed, order-bound `X-Order-Reference` issued only inside the checkout-complete
 *     response ({@see CommerceOrderReference}); it proves this shopper placed THIS order;
 *  2. `verified_email` — the account's e-mail is VERIFIED (login already requires it) and equals the e-mail the order
 *     was placed with (normalised). Control of a mailbox is the proof; the order snapshot e-mail is otherwise
 *     descriptive data and never authorises anything by itself.
 *
 * Everything else — unknown number, other tenant, other channel, a draft, an order that already belongs to someone
 * else, a wrong reference, a mismatching e-mail — is one and the same `null` (the controller answers one 404), so the
 * endpoint is not an order-number oracle. An order already owned by THIS identity is returned unchanged (idempotent).
 * The transition runs under a row lock, writes an immutable {@see CommerceOrderOwnershipClaim}, and a unique index
 * makes a second claim of the same order impossible even under a race.
 */
final class CommerceOrderOwnershipClaimService
{
    public function __construct(private readonly TenantContext $tenantContext) {}

    /** @return CommerceOrder|null the order now (or already) owned by `$identity`, or null when it cannot be proven */
    public function claim(CustomerIdentity $identity, string $salesChannelId, string $orderNumber, ?string $orderReference): ?CommerceOrder
    {
        if (! $this->tenantContext->has()) {
            throw new LogicException('TenantContext is required to claim an order.');
        }

        $tenantId = (string) $this->tenantContext->id();
        $number = trim($orderNumber);

        if ($identity->tenant_id !== $tenantId
            || ! $identity->is_active
            || $identity->email_verified_at === null
            || $number === ''
            || strlen($number) > 64
        ) {
            return null;
        }

        return DB::transaction(function () use ($identity, $salesChannelId, $number, $orderReference, $tenantId): ?CommerceOrder {
            // Lock the identity first (stable anchor, same order as every other identity-scoped write), then the order.
            CustomerIdentity::query()->whereKey($identity->id)->lockForUpdate()->first();

            $order = CommerceOrder::query()
                ->where('number', $number)
                ->where('sales_channel_id', $salesChannelId)
                ->where('status', CommerceOrder::STATUS_CONFIRMED)
                ->lockForUpdate()
                ->first();

            if ($order === null) {
                return null;
            }

            if ($order->customer_identity_id === $identity->id) {
                return $order;
            }

            if ($order->customer_identity_id !== null) {
                return null;
            }

            $proof = $this->proofFor($order, $identity, $orderReference);
            if ($proof === null) {
                return null;
            }

            $order->attachOwnerAfterVerifiedClaim($identity->id);

            CommerceOrderOwnershipClaim::query()->create([
                'tenant_id' => $tenantId,
                'commerce_order_id' => $order->id,
                'customer_identity_id' => $identity->id,
                'proof' => $proof,
            ]);

            return $order->refresh();
        });
    }

    private function proofFor(CommerceOrder $order, CustomerIdentity $identity, ?string $orderReference): ?string
    {
        if ($orderReference !== null && $orderReference !== '' && CommerceOrderReference::verify($order, $orderReference)) {
            return CommerceOrderOwnershipClaim::PROOF_ORDER_REFERENCE;
        }

        $orderEmail = $order->snapshot()->value('email');
        if (is_string($orderEmail) && $orderEmail !== ''
            && $identity->email_normalized !== null
            && hash_equals($identity->email_normalized, CustomerIdentity::normalizeEmail($orderEmail))
        ) {
            return CommerceOrderOwnershipClaim::PROOF_VERIFIED_EMAIL;
        }

        return null;
    }
}
