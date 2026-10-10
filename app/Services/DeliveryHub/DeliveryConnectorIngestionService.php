<?php

namespace App\Services\DeliveryHub;

use App\Models\Branch;
use App\Models\DeliveryConnectorAccount;
use App\Models\DeliveryConnectorAttempt;
use App\Models\DeliveryHubOrder;
use App\Models\DeliveryPlatformProfile;
use App\Models\Tenant;
use App\Models\User;
use App\Support\WebhookSignature;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PDOException;

/**
 * حد إدخال تشغيلي محايد للمزوّد.
 *
 * المصادقة هي HMAC-SHA256 الثابت في `WebhookSignature` (عقد أوْج، لا ادّعاء
 * عن مخطط هنقرستيشن أو غيره). المستأجر يُؤخذ من الربط المخزَّن فقط.
 * الإسقاط يمر عبر `DeliveryHubOrderService` ولا ينشئ فاتورة ولا سنداً ولا قيداً.
 */
class DeliveryConnectorIngestionService
{
    public const TIMESTAMP_TOLERANCE_SECONDS = 300;

    public const MAX_RAW_BYTES = 65536;

    /** @var list<string> */
    public const HUB_ACTIONS = ['accept', 'preparing', 'ready', 'handoff', 'reject', 'cancel'];

    /** @var list<string> */
    private const ENVELOPE_KEYS = [
        'event_id',
        'provider_order_id',
        'external_order_reference',
        'provider_status',
        'hub_action',
        'occurred_at',
        'intake_payload',
        'external_store_id',
        'tenant_id',
        'branch_id',
    ];

    public function __construct(
        private readonly DeliveryHubOrderService $hub,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * @return array{status: int, body: array<string, mixed>}
     */
    public function ingest(string $accountId, string $rawBody, ?string $signatureHeader): array
    {
        try {
            return $this->receive($accountId, $rawBody, $signatureHeader);
        } catch (UniqueConstraintViolationException) {
            return $this->recoverDuplicateEvent($accountId, $rawBody);
        } finally {
            $this->tenant->forget();
        }
    }

    /**
     * @return array{status: int, body: array<string, mixed>}
     */
    private function receive(string $accountId, string $rawBody, ?string $signatureHeader): array
    {
        $account = DeliveryConnectorAccount::withoutGlobalScope(TenantScope::class)
            ->whereKey($accountId)
            ->first();
        if ($account === null) {
            return $this->error(401, 'invalid_signature', 'تعذّر التحقق من الربط.');
        }

        $parsed = $this->parseSignature($signatureHeader);
        if ($parsed === null || ! WebhookSignature::verify($account->secret, $parsed['timestamp'], $rawBody, $parsed['signature'])) {
            return $this->error(401, 'invalid_signature', 'تعذّر التحقق من الربط.');
        }

        $tenant = Tenant::query()->whereKey($account->tenant_id)->first();
        if ($tenant === null || ! $tenant->is_active) {
            return $this->error(403, 'tenant_unavailable', 'المستأجر غير متاح.');
        }

        $this->tenant->set((string) $tenant->id);

        if (! $account->isConfigured()) {
            return $this->error(403, 'connector_disabled', 'الربط معطّل.');
        }

        if (strlen($rawBody) > self::MAX_RAW_BYTES) {
            return $this->error(422, 'invalid_payload', 'الحمولة غير صالحة.');
        }

        $envelope = $this->decodeEnvelope($rawBody);
        if ($envelope === null) {
            return $this->error(422, 'invalid_payload', 'الحمولة غير صالحة.');
        }

        $timestampExpired = ! $this->timestampFresh($parsed['timestamp']);

        return DB::transaction(function () use ($account, $rawBody, $envelope, $timestampExpired) {
            $locked = DeliveryConnectorAccount::query()->whereKey($account->id)->lockForUpdate()->first();
            if ($locked === null || ! $locked->isConfigured()) {
                return $this->error(403, 'connector_disabled', 'الربط معطّل.');
            }

            $checksum = hash('sha256', $rawBody);
            $existingAttempt = DeliveryConnectorAttempt::query()
                ->where('delivery_connector_account_id', $locked->id)
                ->where('event_id', $envelope['event_id'])
                ->lockForUpdate()
                ->first();

            if ($existingAttempt !== null) {
                if (! hash_equals($existingAttempt->raw_checksum, $checksum)) {
                    return $this->error(409, 'payload_conflict', 'تعارض في الحدث نفسه.');
                }

                return $this->replay($existingAttempt);
            }

            if ($timestampExpired) {
                return $this->error(401, 'timestamp_expired', 'انتهت صلاحية التوقيع.');
            }

            $mapped = $this->assertMappedPayload($locked, $envelope);
            if ($mapped !== null) {
                return $this->persist($locked, $envelope, $checksum, null, null, 'mapping_mismatch', 422, 'mapping_mismatch');
            }

            // فشل التهيئة عندنا عابر: لا يستهلك event_id حتى تنجح إعادة المحاولة.
            $actor = $this->actor($locked);
            if ($actor === null) {
                return $this->error(422, 'actor_unavailable', 'تعذّر إدخال الحدث.');
            }

            $profile = DeliveryPlatformProfile::query()->whereKey($locked->delivery_platform_profile_id)->first();
            if ($profile === null || ! $profile->is_active || (string) $profile->platform_key !== (string) $locked->platform_key) {
                return $this->error(422, 'profile_unavailable', 'تعذّر إدخال الحدث.');
            }

            $branchFailure = $this->branchFailure($locked, $actor);
            if ($branchFailure !== null) {
                return $this->error(422, $branchFailure, 'تعذّر إدخال الحدث.');
            }

            return $this->project($locked, $actor, $envelope, $checksum);
        });
    }

    /**
     * @param  array<string, mixed>  $envelope
     * @return array{status: int, body: array<string, mixed>}
     */
    private function project(DeliveryConnectorAccount $account, User $actor, array $envelope, string $rawChecksum): array
    {
        $authoritative = $this->authoritativeChecksum($envelope);
        $providerOrderId = $envelope['provider_order_id'];

        if ($providerOrderId !== null) {
            $existing = DeliveryHubOrder::query()
                ->where('delivery_platform_profile_id', $account->delivery_platform_profile_id)
                ->where('provider_order_id', $providerOrderId)
                ->lockForUpdate()
                ->first();

            if ($existing !== null) {
                $baseline = DeliveryConnectorAttempt::query()
                    ->where('delivery_hub_order_id', $existing->id)
                    ->whereNotNull('authoritative_checksum')
                    ->orderBy('created_at')
                    ->lockForUpdate()
                    ->first();

                if ($baseline !== null && ! hash_equals((string) $baseline->authoritative_checksum, $authoritative)) {
                    return $this->persist($account, $envelope, $rawChecksum, $existing->id, null, 'payload_conflict', 409, 'payload_conflict');
                }

                if ($baseline === null) {
                    try {
                        [$order] = $this->hub->intake($this->intakeInput($account, $envelope), $actor);
                    } catch (DeliveryHubConflictException) {
                        return $this->persist($account, $envelope, $rawChecksum, $existing->id, null, 'payload_conflict', 409, 'payload_conflict');
                    } catch (DeliveryHubNotFoundException) {
                        return $this->persist($account, $envelope, $rawChecksum, null, null, 'branch_unavailable', 422, 'branch_unavailable');
                    }

                    return $this->applyAction($account, $actor, $order, $envelope, $rawChecksum, $authoritative, true);
                }

                return $this->applyAction($account, $actor, $existing, $envelope, $rawChecksum, null, false);
            }
        }

        try {
            [$order] = $this->hub->intake($this->intakeInput($account, $envelope), $actor);
        } catch (DeliveryHubConflictException) {
            return $this->persist($account, $envelope, $rawChecksum, null, null, 'payload_conflict', 409, 'payload_conflict');
        } catch (DeliveryHubNotFoundException) {
            return $this->persist($account, $envelope, $rawChecksum, null, null, 'branch_unavailable', 422, 'branch_unavailable');
        } catch (PDOException $e) {
            throw $e;
        }

        return $this->applyAction($account, $actor, $order, $envelope, $rawChecksum, $authoritative, true);
    }

    /**
     * @param  array<string, mixed>  $envelope
     * @return array{status: int, body: array<string, mixed>}
     */
    private function applyAction(
        DeliveryConnectorAccount $account,
        User $actor,
        DeliveryHubOrder $order,
        array $envelope,
        string $rawChecksum,
        ?string $authoritative,
        bool $storeBaseline,
    ): array {
        $action = $envelope['hub_action'];
        if ($action === null) {
            return $this->persist(
                $account,
                $envelope,
                $rawChecksum,
                $order->id,
                $storeBaseline ? $authoritative : null,
                'accepted',
                201,
                null,
            );
        }

        try {
            [$order] = $this->hub->transition($order->id, $action, null, $actor);
        } catch (DeliveryHubNotFoundException) {
            return $this->persist($account, $envelope, $rawChecksum, $order->id, $storeBaseline ? $authoritative : null, 'branch_unavailable', 422, 'branch_unavailable');
        } catch (PDOException $e) {
            throw $e;
        } catch (\RuntimeException) {
            return $this->persist(
                $account,
                $envelope,
                $rawChecksum,
                $order->id,
                $storeBaseline ? $authoritative : null,
                'state_not_applied',
                200,
                null,
            );
        }

        return $this->persist(
            $account,
            $envelope,
            $rawChecksum,
            $order->id,
            $storeBaseline ? $authoritative : null,
            'accepted',
            201,
            null,
        );
    }

    /**
     * @param  array<string, mixed>  $envelope
     * @return array{status: int, body: array<string, mixed>}
     */
    private function persist(
        DeliveryConnectorAccount $account,
        array $envelope,
        string $rawChecksum,
        ?string $orderId,
        ?string $authoritative,
        string $outcome,
        int $status,
        ?string $errorCode,
    ): array {
        $attempt = new DeliveryConnectorAttempt();
        $attempt->forceFill([
            'tenant_id' => (string) $account->tenant_id,
            'delivery_connector_account_id' => $account->id,
            'event_id' => $envelope['event_id'],
            'raw_checksum' => $rawChecksum,
            'authoritative_checksum' => $authoritative,
            'outcome' => $outcome,
            'http_status' => $status,
            'error_code' => $errorCode,
            'delivery_hub_order_id' => $orderId,
            'provider_order_id' => $envelope['provider_order_id'],
            'secret_version' => (int) $account->secret_version,
            'operational_raw_body' => $envelope['raw'],
        ])->save();

        return $this->present($outcome, $status, $errorCode, $orderId, false);
    }

    /**
     * تزامن محاولتين لنفس الحدث: الفائز يُعتمد، والخاسر يعيد النتيجة إن تطابق الجسم.
     *
     * @return array{status: int, body: array<string, mixed>}
     */
    private function recoverDuplicateEvent(string $accountId, string $rawBody): array
    {
        $account = DeliveryConnectorAccount::withoutGlobalScope(TenantScope::class)->whereKey($accountId)->first();
        if ($account === null) {
            return $this->error(409, 'payload_conflict', 'تعارض في الحدث نفسه.');
        }
        $this->tenant->set((string) $account->tenant_id);
        $envelope = $this->decodeEnvelope($rawBody);
        if ($envelope === null) {
            return $this->error(409, 'payload_conflict', 'تعارض في الحدث نفسه.');
        }

        $existing = DeliveryConnectorAttempt::query()
            ->where('delivery_connector_account_id', $account->id)
            ->where('event_id', $envelope['event_id'])
            ->first();
        if ($existing === null || ! hash_equals($existing->raw_checksum, hash('sha256', $rawBody))) {
            return $this->error(409, 'payload_conflict', 'تعارض في الحدث نفسه.');
        }

        return $this->replay($existing);
    }

    /**
     * @return array{status: int, body: array<string, mixed>}
     */
    private function replay(DeliveryConnectorAttempt $attempt): array
    {
        return $this->present(
            (string) $attempt->outcome,
            (int) $attempt->http_status,
            $attempt->error_code,
            $attempt->delivery_hub_order_id,
            true,
        );
    }

    /**
     * @return array{status: int, body: array<string, mixed>}
     */
    private function present(string $outcome, int $status, ?string $errorCode, ?string $orderId, bool $replay): array
    {
        if ($status >= 400) {
            return $this->error($status, (string) $errorCode, 'تعذّر إدخال الحدث.', $replay);
        }

        $order = $orderId === null ? null : DeliveryHubOrder::query()->whereKey($orderId)->first();

        return [
            'status' => $replay ? 200 : $status,
            'body' => [
                'data' => [
                    'outcome' => $replay ? 'replay' : $outcome,
                    'applied' => $outcome === 'accepted',
                    'delivery_hub_order_id' => $order?->id,
                    'state' => $order?->state,
                    'idempotent_replay' => $replay,
                ],
            ],
        ];
    }

    /**
     * @return array{status: int, body: array<string, mixed>}
     */
    private function error(int $status, string $code, string $message, bool $replay = false): array
    {
        return [
            'status' => $status,
            'body' => [
                'message' => $message,
                'error_code' => $code,
                'idempotent_replay' => $replay,
            ],
        ];
    }

    /** @param  array<string, mixed>  $envelope */
    private function assertMappedPayload(DeliveryConnectorAccount $account, array $envelope): ?string
    {
        if ($envelope['tenant_id'] !== null && $envelope['tenant_id'] !== (string) $account->tenant_id) {
            return 'mapping_mismatch';
        }
        if ($envelope['external_store_id'] !== null && $envelope['external_store_id'] !== (string) $account->external_store_id) {
            return 'mapping_mismatch';
        }
        if ($envelope['asserts_branch'] && $envelope['branch_id'] !== ($account->branch_id === null ? null : (string) $account->branch_id)) {
            return 'mapping_mismatch';
        }

        return null;
    }

    private function actor(DeliveryConnectorAccount $account): ?User
    {
        if ($account->configured_by === null) {
            return null;
        }

        $user = User::query()
            ->where('tenant_id', $account->tenant_id)
            ->whereKey($account->configured_by)
            ->first();

        if ($user === null || ! $user->is_active) {
            return null;
        }

        return $user;
    }

    private function branchFailure(DeliveryConnectorAccount $account, User $actor): ?string
    {
        if ($account->branch_id === null) {
            return $actor->allowedBranchIds() === null ? null : 'branch_unavailable';
        }

        $branch = Branch::query()->whereKey($account->branch_id)->first();
        if ($branch === null || ! $actor->canAccessBranch((string) $branch->id)) {
            return 'branch_unavailable';
        }
        if (! $branch->is_active) {
            return 'branch_inactive';
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $envelope
     * @return array<string, mixed>
     */
    private function intakeInput(DeliveryConnectorAccount $account, array $envelope): array
    {
        return [
            'delivery_platform_profile_id' => (string) $account->delivery_platform_profile_id,
            'provider_order_id' => $envelope['provider_order_id'],
            'idempotency_key' => $envelope['provider_order_id'] === null ? $envelope['event_id'] : null,
            'external_order_reference' => $envelope['external_order_reference'],
            'branch_id' => $account->branch_id,
            'provider_status' => $envelope['provider_status'],
            'intake_payload' => $envelope['intake_payload'],
        ];
    }

    /** @param  array<string, mixed>  $envelope */
    private function authoritativeChecksum(array $envelope): string
    {
        $canonical = $this->canonicalize([
            'external_order_reference' => $envelope['external_order_reference'],
            'intake_payload' => $envelope['intake_payload'],
            'provider_order_id' => $envelope['provider_order_id'],
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

    /** @return array{timestamp: int, signature: string}|null */
    private function parseSignature(?string $header): ?array
    {
        if (! is_string($header) || ! preg_match('/^t=(\d+),v1=([a-f0-9]{64})$/', $header, $matches)) {
            return null;
        }

        return ['timestamp' => (int) $matches[1], 'signature' => $matches[2]];
    }

    private function timestampFresh(int $timestamp): bool
    {
        return abs(now()->timestamp - $timestamp) <= self::TIMESTAMP_TOLERANCE_SECONDS;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function decodeEnvelope(string $rawBody): ?array
    {
        try {
            $decoded = json_decode($rawBody, true, 32, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }
        if (! is_array($decoded) || array_is_list($decoded)) {
            return null;
        }
        foreach (array_keys($decoded) as $key) {
            if (! in_array($key, self::ENVELOPE_KEYS, true)) {
                return null;
            }
        }
        if (! isset($decoded['event_id']) || ! is_string($decoded['event_id']) || ! Str::isUuid($decoded['event_id'])) {
            return null;
        }

        $providerOrderId = $this->optionalString($decoded['provider_order_id'] ?? null, 191);
        $reference = $this->optionalString($decoded['external_order_reference'] ?? null, 191);
        $status = $this->optionalString($decoded['provider_status'] ?? null, 255);
        $occurredAt = $this->optionalString($decoded['occurred_at'] ?? null, 64);
        $storeId = $this->optionalString($decoded['external_store_id'] ?? null, 191);
        $tenantId = $this->optionalString($decoded['tenant_id'] ?? null, 64);
        if ($providerOrderId === false || $reference === false || $status === false || $occurredAt === false || $storeId === false || $tenantId === false) {
            return null;
        }
        if ($reference !== null) {
            $reference = preg_replace('/\s+/u', ' ', $reference);
        }

        $action = $decoded['hub_action'] ?? null;
        if ($action !== null && (! is_string($action) || ! in_array($action, self::HUB_ACTIONS, true))) {
            return null;
        }

        $payload = $decoded['intake_payload'] ?? null;
        if ($payload !== null && (! is_array($payload) || count($payload) > 50)) {
            return null;
        }

        $assertsBranch = array_key_exists('branch_id', $decoded);
        $branchId = null;
        if ($assertsBranch) {
            if ($decoded['branch_id'] !== null && (! is_string($decoded['branch_id']) || ! Str::isUuid($decoded['branch_id']))) {
                return null;
            }
            $branchId = $decoded['branch_id'];
        }
        if ($tenantId !== null && ! Str::isUuid($tenantId)) {
            return null;
        }

        return [
            'raw' => $rawBody,
            'event_id' => $decoded['event_id'],
            'provider_order_id' => $providerOrderId,
            'external_order_reference' => $reference,
            'provider_status' => $status,
            'hub_action' => $action,
            'intake_payload' => $payload,
            'external_store_id' => $storeId,
            'tenant_id' => $tenantId,
            'asserts_branch' => $assertsBranch,
            'branch_id' => is_string($branchId) ? $branchId : null,
        ];
    }

    /** @return string|null|false */
    private function optionalString(mixed $value, int $max): string|null|false
    {
        if ($value === null) {
            return null;
        }
        if (! is_string($value)) {
            return false;
        }
        $trimmed = trim($value);
        if ($trimmed === '' || strlen($trimmed) > $max) {
            return false;
        }

        return $trimmed;
    }
}
