<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\CustomerIdentityResource;
use App\Models\CustomerIdentity;
use App\Services\Commerce\BuyerPasswordResetService;
use App\Services\Commerce\CommerceOrderOwnershipClaimService;
use App\Support\CommerceOrderReference;
use App\Support\CommerceOrderSerializer;
use App\Support\PublicApiErrorCode;
use App\Support\PublicApiResponse;
use App\Tenancy\StorefrontContext;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * B2C-ACCOUNTS — the signed-in retail shopper's OWN account on the Host-resolved store (profile, password, sessions,
 * guest-order claim). Addresses and orders reuse the existing owner-scoped controllers (see routes).
 *
 * Reached only through `EnsureRetailAccountsEnabled` + `AuthenticateCommerceCustomer` (token, expiry, active, verified,
 * same tenant) + `BindStorefrontBuyerToChannel` (token minted for THIS host's channel). The subject is always
 * `$request->user()` — no identity id is ever read from input, and every body is `rejectUnknown`-strict so a smuggled
 * `tenant_id`/`customer_identity_id`/`email_verified_at`/`is_active` is a 422 rather than silently ignored.
 */
final class StorefrontAccountController extends PublicApiController
{
    public function show(Request $request): JsonResponse
    {
        return PublicApiResponse::success($request, ['customer' => new CustomerIdentityResource($this->identity($request))]);
    }

    /** Profile: display name and (optional) contact phone. The e-mail is the login identifier and is not editable here. */
    public function update(Request $request): JsonResponse
    {
        $this->rejectUnknown($request, ['display_name', 'phone']);
        $data = $request->validate([
            'display_name' => ['sometimes', 'string', 'min:1', 'max:255'],
            'phone' => ['sometimes', 'nullable', 'string', 'regex:/^\+[1-9][0-9]{7,14}$/'],
        ]);

        $identity = $this->identity($request);

        // Check first (clean 422 on every engine, no aborted transaction on PostgreSQL); the unique index below stays the
        // guarantee under a race. Same generic message either way — a taken number is never named.
        if (($data['phone'] ?? null) !== null) {
            $taken = CustomerIdentity::query()
                ->where('phone_e164', CustomerIdentity::normalizePhone($data['phone']))
                ->whereKeyNot($identity->id)
                ->exists();
            if ($taken) {
                throw ValidationException::withMessages(['phone' => ['تعذّر حفظ رقم الجوال.']]);
            }
        }

        try {
            $identity->fill($data)->save();
        } catch (QueryException $e) {
            if (in_array((string) $e->getCode(), ['23000', '23505'], true)) {
                throw ValidationException::withMessages(['phone' => ['تعذّر حفظ رقم الجوال.']]);
            }
            throw $e;
        }

        return PublicApiResponse::success($request, ['customer' => new CustomerIdentityResource($identity->refresh())]);
    }

    /** Change password: needs the current password; every OTHER session of the account (all channels) is ended. */
    public function changePassword(Request $request): JsonResponse
    {
        $this->rejectUnknown($request, ['current_password', 'password']);
        $data = $request->validate([
            'current_password' => ['required', 'string', 'max:255'],
            'password' => ['required', 'string', 'min:8', 'max:255', 'different:current_password'],
        ]);

        $subject = $this->identity($request);
        $currentId = $subject->currentAccessToken()?->getKey();

        // Verify against a FRESH, row-locked identity: a concurrent change or an e-mailed reset (which also ends this
        // session) must not be overwritten by a request that was authenticated with the old password.
        DB::transaction(function () use ($subject, $data, $currentId): void {
            $identity = CustomerIdentity::query()->whereKey($subject->id)->lockForUpdate()->firstOrFail();

            if (! Hash::check($data['current_password'], (string) $identity->password)) {
                throw ValidationException::withMessages(['current_password' => ['كلمة المرور الحالية غير صحيحة.']]);
            }
            if ($currentId !== null && ! $identity->tokens()->whereKey($currentId)->exists()) {
                abort(401); // this session was revoked while the request was in flight
            }

            $identity->forceFill(['password' => $data['password']])->save(); // 'hashed' cast
            $identity->tokens()->when($currentId !== null, fn ($q) => $q->where('id', '!=', $currentId))->delete();
        });

        return PublicApiResponse::success($request, ['password_changed' => true]);
    }

    /** The account's sessions on THIS store (token metadata only — never the token). */
    public function sessions(Request $request, StorefrontContext $context): JsonResponse
    {
        $identity = $this->identity($request);
        $currentId = $identity->currentAccessToken()?->getKey();

        $rows = $this->channelTokens($identity, $context)
            ->filter(fn (PersonalAccessToken $t): bool => $t->expires_at === null || $t->expires_at->isFuture())
            ->sortByDesc(fn (PersonalAccessToken $t) => $t->last_used_at ?? $t->created_at)
            ->values()
            ->map(fn (PersonalAccessToken $t): array => [
                'id' => (string) $t->getKey(),
                'created_at' => $t->created_at?->toIso8601String(),
                'last_used_at' => $t->last_used_at?->toIso8601String(),
                'expires_at' => $t->expires_at?->toIso8601String(),
                'current' => $t->getKey() === $currentId,
            ])->all();

        return PublicApiResponse::success($request, ['sessions' => $rows]);
    }

    /** End one session of this account on this store. Another account's / another channel's id is the same 404. */
    public function revokeSession(Request $request, string $session, StorefrontContext $context): JsonResponse
    {
        $identity = $this->identity($request);
        $token = $this->channelTokens($identity, $context)->first(fn (PersonalAccessToken $t): bool => (string) $t->getKey() === $session);
        if ($token === null) {
            return PublicApiResponse::error($request, PublicApiErrorCode::NOT_FOUND, 'الجلسة غير متاحة.');
        }

        $token->delete();

        return PublicApiResponse::success($request, ['revoked' => true]);
    }

    /** "Sign out everywhere else": ends every session of the account except the one making this request. */
    public function revokeOtherSessions(Request $request): JsonResponse
    {
        $identity = $this->identity($request);
        $currentId = $identity->currentAccessToken()?->getKey();
        $identity->tokens()->when($currentId !== null, fn ($q) => $q->where('id', '!=', $currentId))->delete();

        return PublicApiResponse::success($request, ['revoked_others' => true]);
    }

    /**
     * Link a guest order to this account — see {@see CommerceOrderOwnershipClaimService}. Proof is the signed order
     * reference OR a verified e-mail equal to the order's e-mail. Any failure is one uniform 404.
     */
    public function claimOrder(Request $request, CommerceOrderOwnershipClaimService $claims, StorefrontContext $context): JsonResponse
    {
        $this->rejectUnknown($request, ['order_number', 'order_reference']);
        $data = $request->validate([
            'order_number' => ['required', 'string', 'max:64'],
            'order_reference' => ['sometimes', 'nullable', 'string', 'max:128'],
        ]);

        $order = $claims->claim(
            $this->identity($request),
            $context->salesChannelId(),
            $data['order_number'],
            $data['order_reference'] ?? $request->header(CommerceOrderReference::HEADER),
        );

        if ($order === null) {
            return PublicApiResponse::error($request, PublicApiErrorCode::NOT_FOUND, 'تعذّر ربط هذا الطلب بحسابك.');
        }

        return PublicApiResponse::success($request, ['order' => CommerceOrderSerializer::serialize($order)]);
    }

    private function identity(Request $request): CustomerIdentity
    {
        $identity = $request->user();
        abort_unless($identity instanceof CustomerIdentity, 401);

        return $identity;
    }

    /** @return \Illuminate\Support\Collection<int, PersonalAccessToken> */
    private function channelTokens(CustomerIdentity $identity, StorefrontContext $context): \Illuminate\Support\Collection
    {
        $ability = \App\Http\Middleware\BindStorefrontBuyerToChannel::ability($context->salesChannelId());

        return $identity->tokens()->get()->filter(
            fn (PersonalAccessToken $t): bool => in_array($ability, (array) $t->abilities, true),
        )->values();
    }

    /** @param list<string> $allowed */
    private function rejectUnknown(Request $request, array $allowed): void
    {
        $unknown = array_values(array_diff(array_keys($request->all()), $allowed));
        if ($unknown !== []) {
            throw ValidationException::withMessages(['request' => 'حقول غير مسموحة: '.implode(', ', $unknown)]);
        }
    }
}
