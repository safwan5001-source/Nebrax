<?php

namespace App\Services\DeliveryHub;

use App\Models\Branch;
use App\Models\DeliveryHubOrder;
use App\Models\DeliveryPlatformProfile;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * إسقاط تشغيلي فقط. لا يستدعي الفوترة ولا السداد ولا المخزون ولا جلسة البيع.
 */
class DeliveryHubOrderService
{
    /**
     * @param  array<string, mixed>  $input
     * @return array{0: DeliveryHubOrder, 1: bool}
     */
    public function intake(array $input, User $user): array
    {
        $normalized = $this->normalize($input);
        if ($normalized['provider_order_id'] === null && $normalized['idempotency_key'] === null) {
            throw new RuntimeException('يجب تزويد رقم طلب المنصة أو مفتاح الإدخال.');
        }

        $profile = $this->profileOrFail($normalized['profile_id']);
        $branchId = $this->destinationOrFail($user, $normalized['branch_id'], requiredWhenRestricted: true);
        $checksum = $this->checksum($profile->id, $normalized, $branchId);
        $hash = $this->payloadHash($normalized['provider_status'], $normalized['intake_payload']);

        try {
            return $this->within(fn () => $this->insertOrReplay($user, $profile->id, $branchId, $normalized, $checksum, $hash));
        } catch (UniqueConstraintViolationException) {
            return $this->within(function () use ($user, $profile, $branchId, $normalized, $checksum, $hash) {
                $existing = $this->resolveExisting($user, $profile->id, $normalized, $checksum);
                if ($existing !== null) {
                    return $existing;
                }

                return $this->insertOrReplay($user, $profile->id, $branchId, $normalized, $checksum, $hash);
            });
        }
    }

    /**
     * @return array{0: DeliveryHubOrder, 1: bool}
     */
    public function transition(string $id, string $action, ?string $branchId, User $user): array
    {
        return $this->within(function () use ($id, $action, $branchId, $user) {
            $order = DeliveryHubOrder::query()->whereKey($id)->lockForUpdate()->first();
            if ($order === null || ! $order->visibleTo($user)) {
                throw new DeliveryHubNotFoundException();
            }

            $destination = $action === 'route'
                ? $this->destinationOrFail($user, $branchId, requiredWhenRestricted: true)
                : null;

            if ($action !== 'route' && $branchId !== null && $branchId !== '' && (string) $branchId !== (string) $order->branch_id) {
                throw new RuntimeException('انتقال الحالة غير مسموح.');
            }

            if ($this->isReplay($order, $action, $destination)) {
                return [$order, true];
            }

            $next = $this->nextState($order, $action, $destination, $user);
            $order->state = $next['state'];
            $order->branch_id = $next['branch_id'];
            $order->updated_by = $user->id;
            $order->save();

            return [$order, false];
        });
    }

    public function visibleQuery(User $user): Builder
    {
        $query = DeliveryHubOrder::query();
        $allowed = $user->allowedBranchIds();
        if ($allowed === null) {
            return $query;
        }

        return $query->whereIn('branch_id', $allowed);
    }

    /**
     * @param  array<string, mixed>  $normalized
     * @return array{0: DeliveryHubOrder, 1: bool}
     */
    private function insertOrReplay(User $user, string $profileId, ?string $branchId, array $normalized, string $checksum, string $hash): array
    {
        $existing = $this->resolveExisting($user, $profileId, $normalized, $checksum);
        if ($existing !== null) {
            return $existing;
        }

        $order = DeliveryHubOrder::query()->create([
            'tenant_id' => (string) app(TenantContext::class)->id(),
            'branch_id' => $branchId,
            'delivery_platform_profile_id' => $profileId,
            'state' => $branchId === null ? DeliveryHubOrder::UNROUTED : DeliveryHubOrder::RECEIVED,
            'provider_order_id' => $normalized['provider_order_id'],
            'external_order_reference' => $normalized['external_order_reference'],
            'idempotency_key' => $normalized['idempotency_key'],
            'request_checksum' => $checksum,
            'intake_payload_hash' => $hash,
            'provider_status' => $normalized['provider_status'],
            'created_by' => $user->id,
            'updated_by' => $user->id,
        ]);

        return [$order, false];
    }

    /**
     * @param  array<string, mixed>  $normalized
     * @return array{0: DeliveryHubOrder, 1: bool}|null
     */
    private function resolveExisting(User $user, string $profileId, array $normalized, string $checksum): ?array
    {
        if ($normalized['idempotency_key'] !== null) {
            $byKey = DeliveryHubOrder::query()
                ->where('idempotency_key', $normalized['idempotency_key'])
                ->lockForUpdate()
                ->first();
            if ($byKey !== null) {
                return $this->settle($byKey, $user, $checksum);
            }
        }

        if ($normalized['provider_order_id'] !== null) {
            $byProvider = DeliveryHubOrder::query()
                ->where('delivery_platform_profile_id', $profileId)
                ->where('provider_order_id', $normalized['provider_order_id'])
                ->lockForUpdate()
                ->first();
            if ($byProvider !== null) {
                return $this->settle($byProvider, $user, $checksum);
            }
        }

        return null;
    }

    /** @return array{0: DeliveryHubOrder, 1: bool} */
    private function settle(DeliveryHubOrder $order, User $user, string $checksum): array
    {
        if (! $order->visibleTo($user)) {
            throw new DeliveryHubNotFoundException();
        }
        $this->assertChecksum($order, $checksum);

        return [$order, true];
    }

    private function assertChecksum(DeliveryHubOrder $order, string $checksum): void
    {
        if (! hash_equals((string) $order->request_checksum, $checksum)) {
            throw new DeliveryHubConflictException('تعارض في هوية طلب التوصيل.');
        }
    }

    /**
     * @param  array{state: string, branch_id: ?string}  $next
     */
    private function isReplay(DeliveryHubOrder $order, string $action, ?string $destination): bool
    {
        if ($action === 'route') {
            return $order->state === DeliveryHubOrder::RECEIVED
                && $destination !== null
                && (string) $order->branch_id === $destination;
        }

        $asked = match ($action) {
            'accept' => DeliveryHubOrder::ACCEPTED,
            'preparing' => DeliveryHubOrder::PREPARING,
            'ready' => DeliveryHubOrder::READY,
            'handoff' => DeliveryHubOrder::HANDED_OFF,
            'reject', 'cancel' => DeliveryHubOrder::CANCELLED,
            default => null,
        };

        return $asked !== null && $order->state === $asked;
    }

    /**
     * @return array{state: string, branch_id: ?string}
     */
    private function nextState(DeliveryHubOrder $order, string $action, ?string $destination, User $user): array
    {
        $branch = $order->branch_id === null ? null : (string) $order->branch_id;

        if ($action === 'route') {
            if ($destination === null) {
                throw new RuntimeException('انتقال الحالة غير مسموح.');
            }
            if ($order->state === DeliveryHubOrder::UNROUTED) {
                return ['state' => DeliveryHubOrder::RECEIVED, 'branch_id' => $destination];
            }
            if ($order->state === DeliveryHubOrder::RECEIVED && $branch !== null && $user->canAccessBranch($branch)) {
                return ['state' => DeliveryHubOrder::RECEIVED, 'branch_id' => $destination];
            }
            throw new RuntimeException('انتقال الحالة غير مسموح.');
        }

        if (in_array($action, ['reject', 'cancel'], true)) {
            if ($order->state === DeliveryHubOrder::UNROUTED) {
                if ($user->allowedBranchIds() !== null) {
                    throw new DeliveryHubNotFoundException();
                }

                return ['state' => DeliveryHubOrder::CANCELLED, 'branch_id' => null];
            }
            if ($branch === null || ! $user->canAccessBranch($branch)) {
                throw new DeliveryHubNotFoundException();
            }
            if (in_array($order->state, [
                DeliveryHubOrder::RECEIVED,
                DeliveryHubOrder::ACCEPTED,
                DeliveryHubOrder::PREPARING,
                DeliveryHubOrder::READY,
                DeliveryHubOrder::HANDED_OFF,
            ], true)) {
                return ['state' => DeliveryHubOrder::CANCELLED, 'branch_id' => $branch];
            }
            throw new RuntimeException('انتقال الحالة غير مسموح.');
        }

        if ($branch !== null && ! $user->canAccessBranch($branch)) {
            throw new DeliveryHubNotFoundException();
        }
        if ($branch === null) {
            throw new RuntimeException('انتقال الحالة غير مسموح.');
        }

        $edge = [
            'accept' => [DeliveryHubOrder::RECEIVED, DeliveryHubOrder::ACCEPTED],
            'preparing' => [DeliveryHubOrder::ACCEPTED, DeliveryHubOrder::PREPARING],
            'ready' => [DeliveryHubOrder::PREPARING, DeliveryHubOrder::READY],
            'handoff' => [DeliveryHubOrder::READY, DeliveryHubOrder::HANDED_OFF],
        ][$action] ?? null;

        if ($edge === null || $order->state !== $edge[0]) {
            throw new RuntimeException('انتقال الحالة غير مسموح.');
        }

        return ['state' => $edge[1], 'branch_id' => $branch];
    }

    private function profileOrFail(string $profileId): DeliveryPlatformProfile
    {
        $profile = DeliveryPlatformProfile::query()->whereKey($profileId)->first();
        if ($profile === null) {
            throw new DeliveryHubNotFoundException();
        }

        return $profile;
    }

    private function destinationOrFail(User $user, ?string $branchId, bool $requiredWhenRestricted): ?string
    {
        if ($branchId === null || $branchId === '') {
            if ($requiredWhenRestricted && $user->allowedBranchIds() !== null) {
                throw new RuntimeException('يجب تحديد فرع الوجهة.');
            }

            return null;
        }

        $branch = Branch::query()->whereKey($branchId)->first();
        if ($branch === null || ! $user->canAccessBranch((string) $branch->id)) {
            throw new DeliveryHubNotFoundException();
        }
        if (! $branch->is_active) {
            throw new RuntimeException('انتقال الحالة غير مسموح.');
        }

        return (string) $branch->id;
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{profile_id: string, provider_order_id: ?string, idempotency_key: ?string, external_order_reference: ?string, branch_id: ?string, provider_status: ?string, intake_payload: ?array}
     */
    private function normalize(array $input): array
    {
        return [
            'profile_id' => (string) $input['delivery_platform_profile_id'],
            'provider_order_id' => $this->blankToNull($input['provider_order_id'] ?? null),
            'idempotency_key' => $this->blankToNull($input['idempotency_key'] ?? null),
            'external_order_reference' => $this->normalizeReference($input['external_order_reference'] ?? null),
            'branch_id' => $this->blankToNull($input['branch_id'] ?? null),
            'provider_status' => $this->blankToNull($input['provider_status'] ?? null),
            'intake_payload' => isset($input['intake_payload']) && is_array($input['intake_payload']) ? $input['intake_payload'] : null,
        ];
    }

    /**
     * @param  array<string, mixed>  $normalized
     */
    private function checksum(string $profileId, array $normalized, ?string $branchId): string
    {
        $canonical = $this->canonicalize([
            'branch_id' => $branchId,
            'delivery_platform_profile_id' => $profileId,
            'external_order_reference' => $normalized['external_order_reference'],
            'idempotency_key' => $normalized['idempotency_key'],
            'intake_payload_hash' => $this->payloadHash($normalized['provider_status'], $normalized['intake_payload']),
            'provider_order_id' => $normalized['provider_order_id'],
        ]);

        return hash('sha256', json_encode($canonical, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    }

    private function payloadHash(?string $providerStatus, ?array $payload): string
    {
        $canonical = $this->canonicalize([
            'intake_payload' => $payload,
            'provider_status' => $providerStatus,
        ]);

        return hash('sha256', json_encode($canonical, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    }

    private function canonicalize(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        if (array_is_list($value)) {
            return array_map($this->canonicalize(...), $value);
        }
        ksort($value);
        foreach ($value as $key => $item) {
            $value[$key] = $this->canonicalize($item);
        }

        return $value;
    }

    private function blankToNull(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }
        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }

    private function normalizeReference(mixed $value): ?string
    {
        $text = $this->blankToNull($value);
        if ($text === null) {
            return null;
        }

        return preg_replace('/\s+/u', ' ', $text);
    }

    /**
     * @template T
     * @param  callable(): T  $callback
     * @return T
     */
    private function within(callable $callback): mixed
    {
        if (! app(TenantContext::class)->has()) {
            throw new RuntimeException('سياق المستأجر مطلوب.');
        }

        return DB::transaction($callback);
    }
}
