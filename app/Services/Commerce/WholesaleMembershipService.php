<?php

namespace App\Services\Commerce;

use App\Models\CustomerIdentity;
use App\Models\User;
use App\Models\WholesaleMembership;
use App\Models\WholesaleMembershipEvent;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * H6 Batch E — the ONLY writer of {@see WholesaleMembership}. Eligibility lifecycle, independent of
 * authentication state.
 *
 *   (none) ──apply──▶ pending ──approve──▶ approved ──suspend──▶ suspended
 *                        │                    ▲                      │
 *                        └────reject──▶ rejected               reinstate (→ approved)
 *
 * - A buyer can only ever *apply*: the application creates/returns a `pending` row and never changes the
 *   status of an existing one (so a rejected/suspended buyer cannot re-open or self-approve).
 * - Decisions are staff-only (the controller enforces `commerce.wholesale.manage`); every decision runs in
 *   one transaction under a row lock and re-validates the transition against the *current* status, so a
 *   concurrent approve/suspend cannot both succeed against a stale read. Each decision writes an immutable
 *   event (actor + timestamp) and stamps the current row.
 * - Everything is scoped to the active tenant (TenantScope) and to the channel; no tenant/channel/identity
 *   id supplied by a client is trusted.
 */
class WholesaleMembershipService
{
    /** action => [allowed from statuses, resulting status] */
    public const TRANSITIONS = [
        'approve' => [[WholesaleMembership::PENDING], WholesaleMembership::APPROVED],
        'reject' => [[WholesaleMembership::PENDING], WholesaleMembership::REJECTED],
        'suspend' => [[WholesaleMembership::APPROVED], WholesaleMembership::SUSPENDED],
        'reinstate' => [[WholesaleMembership::SUSPENDED], WholesaleMembership::APPROVED],
    ];

    public function __construct(private TenantContext $tenantContext) {}

    /** Idempotent self-application. Returns the existing membership untouched if one already exists. */
    public function apply(CustomerIdentity $identity, string $salesChannelId): WholesaleMembership
    {
        $this->requireTenant();

        $existing = $this->find($identity->id, $salesChannelId);
        if ($existing !== null) {
            return $existing;
        }

        try {
            return DB::transaction(function () use ($identity, $salesChannelId): WholesaleMembership {
                $membership = WholesaleMembership::create([
                    'tenant_id' => $this->tenantContext->id(),
                    'sales_channel_id' => $salesChannelId,
                    'customer_identity_id' => $identity->id,
                    'applied_at' => now(),
                ]);

                WholesaleMembershipEvent::create([
                    'tenant_id' => $this->tenantContext->id(),
                    'wholesale_membership_id' => $membership->id,
                    'from_status' => null,
                    'to_status' => WholesaleMembership::PENDING,
                    'actor_type' => 'buyer',
                ]);

                return $membership;
            });
        } catch (QueryException $exception) {
            // Lost a race with a concurrent application for the same buyer/channel: return the winner.
            $winner = $this->find($identity->id, $salesChannelId);
            if ($winner !== null) {
                return $winner;
            }

            throw $exception;
        }
    }

    public function find(string $identityId, string $salesChannelId): ?WholesaleMembership
    {
        $this->requireTenant();

        return WholesaleMembership::query()
            ->where('customer_identity_id', $identityId)
            ->where('sales_channel_id', $salesChannelId)
            ->first();
    }

    /** Fresh read on every call — never cached — so a suspension is effective on the very next request. */
    public function isApproved(string $identityId, string $salesChannelId): bool
    {
        return $this->find($identityId, $salesChannelId)?->status === WholesaleMembership::APPROVED;
    }

    /**
     * @param  string  $action  one of the keys of {@see self::TRANSITIONS}
     *
     * @throws WholesaleMembershipException
     */
    public function transition(string $membershipId, string $action, User $actor, ?string $note = null): WholesaleMembership
    {
        $this->requireTenant();

        if (! isset(self::TRANSITIONS[$action])) {
            throw new WholesaleMembershipException('unknown_action', 'Unknown membership action.', 422);
        }

        if ($actor->tenant_id !== $this->tenantContext->id()) {
            // A staff principal from another tenant is never a decision authority here.
            throw new WholesaleMembershipException('not_found', 'Membership not found.', 404);
        }

        [$allowedFrom, $to] = self::TRANSITIONS[$action];

        return DB::transaction(function () use ($membershipId, $action, $actor, $note, $allowedFrom, $to): WholesaleMembership {
            $membership = WholesaleMembership::query()->lockForUpdate()->find($membershipId);

            if ($membership === null) {
                throw new WholesaleMembershipException('not_found', 'Membership not found.', 404);
            }

            if (! in_array($membership->status, $allowedFrom, true)) {
                throw new WholesaleMembershipException(
                    'invalid_transition',
                    "Cannot {$action} a {$membership->status} membership.",
                );
            }

            $from = $membership->status;
            $membership->forceFill([
                'status' => $to,
                'decided_at' => now(),
                'decided_by_user_id' => $actor->id,
                'decision_note' => $note,
            ])->save();

            WholesaleMembershipEvent::create([
                'tenant_id' => $this->tenantContext->id(),
                'wholesale_membership_id' => $membership->id,
                'from_status' => $from,
                'to_status' => $to,
                'actor_type' => 'staff',
                'actor_user_id' => $actor->id,
                'note' => $note,
            ]);

            return $membership;
        });
    }

    private function requireTenant(): void
    {
        if (! $this->tenantContext->has()) {
            throw new LogicException('TenantContext is required for wholesale membership.');
        }
    }
}
