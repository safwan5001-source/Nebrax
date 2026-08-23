<?php

namespace App\Services;

use App\Models\FuelAviAuthorization;
use App\Models\FuelAviIdentityTag;
use App\Models\FuelNozzle;
use App\Models\FuelProduct;
use App\Models\FuelSale;
use App\Models\FuelStation;
use App\Models\User;
use App\Tenancy\BranchContext;
use Carbon\CarbonInterface;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * محرك هوية وتفويض AVI/RFID. لا يعرف قارئاً أو مورداً ولا يفتح مضخة، ولا ينشئ
 * Invoice/Payment/StockMovement/Ledger؛ يقرر فقط ما إذا كان بالإمكان متابعة
 * مسار FuelSale الرسمي بعد إعادة استخدام تفويض Cycle 6.
 */
class FuelAviAuthorizationService
{
    public function __construct(
        private CorporateFuelAuthorizationService $corporateAuthorizations,
        private FuelStationSettingsService $settings,
    ) {}

    public function authorize(array $attributes, User $actor): FuelAviAuthorization
    {
        $stationId = $this->requiredString($attributes, 'fuel_station_id');
        $nozzleId = $this->requiredString($attributes, 'fuel_nozzle_id');
        $idempotencyKey = $this->requiredString($attributes, 'idempotency_key');
        $quantity = $this->positiveInteger($attributes['quantity_milliliters'] ?? null, 'quantity_milliliters');
        $odometer = $this->nullableNonNegativeInteger($attributes['odometer'] ?? null, 'odometer');

        try {
            return DB::transaction(function () use ($attributes, $actor, $stationId, $nozzleId, $idempotencyKey, $quantity, $odometer) {
                $station = FuelStation::lockForUpdate()->findOrFail($stationId);
                $this->assertStation($station);
                $nozzle = FuelNozzle::lockForUpdate()->findOrFail($nozzleId);
                $this->assertNozzle($nozzle, $station);
                $fuelProduct = FuelProduct::findOrFail($nozzle->fuel_product_id);
                $checksum = $this->requestChecksum($station, $nozzle, $quantity, $odometer, $attributes);

                $existing = FuelAviAuthorization::where('fuel_station_id', $station->id)
                    ->where('idempotency_key', $idempotencyKey)
                    ->lockForUpdate()
                    ->first();
                if ($existing !== null) {
                    if (! hash_equals($existing->payload_checksum, $checksum)) {
                        throw new RuntimeException('AVI_AUTHORIZATION_IDEMPOTENCY_CONFLICT');
                    }

                    return $existing;
                }

                $context = [
                    'vehicle_tag' => null,
                    'driver_tag' => null,
                    'partner_id' => null,
                    'contract_id' => null,
                    'card_id' => null,
                    'vehicle_id' => null,
                    'driver_id' => null,
                    'identity_mode' => null,
                    'signals' => [],
                ];

                try {
                    if (! (bool) $this->settings->get($station, 'avi_rfid_enabled')) {
                        throw new RuntimeException('AVI_RFID_DISABLED');
                    }
                    $context = $this->resolveIdentityContext($attributes, $station, $fuelProduct, $quantity, $odometer, now());
                    $authorization = $context['corporate_authorization'];
                    $this->assertFrequency($context['vehicle_id'], $station, now());
                    $this->assertVehicleCapacity($authorization['vehicle'] ?? null, $quantity, $station);
                    $context['signals'] = $this->denialSignals($station, $context, null, now());

                    return $this->record(
                        $station,
                        $nozzle,
                        $fuelProduct,
                        $quantity,
                        $odometer,
                        $idempotencyKey,
                        $checksum,
                        FuelAviAuthorization::DECISION_APPROVED,
                        null,
                        $context,
                        $actor,
                    );
                } catch (RuntimeException $exception) {
                    $reason = $exception->getMessage();
                    $context['signals'] = $this->denialSignals($station, $context, $reason, now());

                    return $this->record(
                        $station,
                        $nozzle,
                        $fuelProduct,
                        $quantity,
                        $odometer,
                        $idempotencyKey,
                        $checksum,
                        FuelAviAuthorization::DECISION_DENIED,
                        $reason,
                        $context,
                        $actor,
                    );
                }
            });
        } catch (QueryException $exception) {
            $existing = FuelAviAuthorization::where('fuel_station_id', $stationId)
                ->where('idempotency_key', $idempotencyKey)
                ->first();
            if ($existing !== null) {
                $checksum = $this->requestChecksumFromIds($stationId, $nozzleId, $quantity, $odometer, $attributes);
                if (hash_equals($existing->payload_checksum, $checksum)) {
                    return $existing;
                }
            }

            throw new RuntimeException('AVI_AUTHORIZATION_IDEMPOTENCY_CONFLICT', previous: $exception);
        }
    }

    /** يحقن حقيقة الهوية في مسودة البيع ولا يسمح لطلب العميل باستبدالها. */
    public function prepareDraftAttributes(array $attributes): array
    {
        $id = $attributes['fuel_avi_authorization_id'] ?? null;
        if ($id === null || $id === '') {
            return $attributes;
        }
        if (! is_string($id)) {
            throw new RuntimeException('AVI_AUTHORIZATION_NOT_FOUND');
        }

        $authorization = FuelAviAuthorization::lockForUpdate()->find($id);
        if ($authorization === null) {
            throw new RuntimeException('AVI_AUTHORIZATION_NOT_FOUND');
        }
        $this->assertDraftUsable($authorization, $attributes, now());
        $this->assertClientDoesNotOverrideReferences($attributes, $authorization);

        return array_merge($attributes, $this->references($authorization));
    }

    /** يربط القرار الموافق بالمسودة مرة واحدة، بعد نجاح حفظ FuelSale داخل المعاملة. */
    public function attachToSale(FuelSale $sale): void
    {
        if ($sale->fuel_avi_authorization_id === null) {
            return;
        }
        $authorization = FuelAviAuthorization::lockForUpdate()->findOrFail($sale->fuel_avi_authorization_id);
        $this->assertDraftUsable($authorization, [
            'fuel_station_id' => $sale->fuel_station_id,
            'fuel_nozzle_id' => $sale->fuel_nozzle_id,
            'quantity_milliliters' => (int) $sale->quantity_milliliters,
            'odometer' => $sale->odometer_snapshot,
            'fuel_sale_id' => $sale->id,
        ], now());
        if ($authorization->fuel_sale_id !== null && $authorization->fuel_sale_id !== $sale->id) {
            throw new RuntimeException('AVI_AUTHORIZATION_ALREADY_USED');
        }
        $authorization->update(['fuel_sale_id' => $sale->id]);
    }

    /** يعاد فحص صلاحية الهوية قبل الأثر الرسمي، لكن حد الائتمان يبقى في Cycle 6. */
    public function assertFinalizationAllowed(FuelSale $sale): void
    {
        if ($sale->fuel_avi_authorization_id === null) {
            return;
        }
        $authorization = FuelAviAuthorization::lockForUpdate()->findOrFail($sale->fuel_avi_authorization_id);
        $this->assertDraftUsable($authorization, [
            'fuel_station_id' => $sale->fuel_station_id,
            'fuel_nozzle_id' => $sale->fuel_nozzle_id,
            'quantity_milliliters' => (int) $sale->quantity_milliliters,
            'odometer' => $sale->odometer_snapshot,
            'fuel_sale_id' => $sale->id,
        ], now());
        if ($authorization->fuel_sale_id !== $sale->id) {
            throw new RuntimeException('AVI_AUTHORIZATION_SALE_MISMATCH');
        }
        $this->assertCurrentTag($authorization->vehicleIdentityTag, now());
        $this->assertCurrentTag($authorization->driverIdentityTag, now());
        $authorization->update(['finalization_checked_at' => now()]);
    }

    /** @return array<string,mixed> */
    private function resolveIdentityContext(array $attributes, FuelStation $station, FuelProduct $fuelProduct, int $quantity, ?int $odometer, CarbonInterface $at): array
    {
        $vehicleTag = $this->tagFromCredential($attributes['vehicle_credential'] ?? null, true, $at);
        $driverTag = $this->tagFromCredential($attributes['driver_credential'] ?? null, false, $at);
        if ($vehicleTag === null && $driverTag === null) {
            throw new RuntimeException('AVI_IDENTITY_REQUIRED');
        }
        if ((bool) $this->settings->get($station, 'avi_driver_identity_required') && $driverTag === null) {
            throw new RuntimeException('AVI_DUAL_IDENTITY_REQUIRED');
        }

        $tags = array_values(array_filter([$vehicleTag, $driverTag]));
        $partnerId = $tags[0]->partner_id;
        $contractId = $tags[0]->corporate_fuel_contract_id;
        $cardId = $tags[0]->fuel_card_id;
        foreach ($tags as $tag) {
            if ($tag->partner_id !== $partnerId || $tag->corporate_fuel_contract_id !== $contractId) {
                throw new RuntimeException('AVI_IDENTITY_CONTRACT_MISMATCH');
            }
            if ($tag->fuel_card_id !== null && $cardId !== null && $tag->fuel_card_id !== $cardId) {
                throw new RuntimeException('AVI_IDENTITY_CARD_MISMATCH');
            }
            $cardId ??= $tag->fuel_card_id;
        }

        $sale = new FuelSale([
            'partner_id' => $partnerId,
            'corporate_fuel_contract_id' => $contractId,
            'fuel_card_id' => $cardId,
            'fuel_fleet_vehicle_id' => $vehicleTag?->fuel_fleet_vehicle_id,
            'fuel_fleet_driver_id' => $driverTag?->fuel_fleet_driver_id,
            'fuel_product_id' => $fuelProduct->id,
            'quantity_milliliters' => $quantity,
            'odometer_snapshot' => $odometer,
        ]);
        $corporate = $this->corporateAuthorizations->resolve($sale, $station, $fuelProduct, $at);
        if ($corporate === null) {
            throw new RuntimeException('AVI_CORPORATE_AUTHORIZATION_REQUIRED');
        }

        return [
            'vehicle_tag' => $vehicleTag,
            'driver_tag' => $driverTag,
            'partner_id' => $corporate['contract']->partner_id,
            'contract_id' => $corporate['contract']->id,
            'card_id' => $corporate['card']?->id,
            'vehicle_id' => $corporate['vehicle']?->id,
            'driver_id' => $corporate['driver']?->id,
            'identity_mode' => $vehicleTag !== null && $driverTag !== null
                ? FuelAviAuthorization::MODE_DUAL
                : ($vehicleTag !== null ? FuelAviAuthorization::MODE_VEHICLE_ONLY : FuelAviAuthorization::MODE_DRIVER_ONLY),
            'signals' => [],
            'corporate_authorization' => $corporate,
        ];
    }

    private function tagFromCredential(mixed $credential, bool $vehicle, CarbonInterface $at): ?FuelAviIdentityTag
    {
        if ($credential === null || $credential === '') {
            return null;
        }
        if (! is_string($credential) || trim($credential) === '') {
            throw new RuntimeException('AVI_IDENTITY_CREDENTIAL_INVALID');
        }
        $tag = FuelAviIdentityTag::lockForUpdate()->where('credential_hash', hash('sha256', trim($credential)))->first();
        if ($tag === null) {
            throw new RuntimeException('AVI_TAG_NOT_FOUND');
        }
        if ($vehicle && ! $tag->isVehicleIdentity()) {
            throw new RuntimeException('AVI_VEHICLE_TAG_REQUIRED');
        }
        if (! $vehicle && ! $tag->isDriverIdentity()) {
            throw new RuntimeException('AVI_DRIVER_TAG_REQUIRED');
        }
        if (! $tag->isActiveAt($at)) {
            throw new RuntimeException($tag->status === FuelAviIdentityTag::STATUS_BLACKLISTED ? 'AVI_TAG_BLACKLISTED' : 'AVI_TAG_NOT_ACTIVE');
        }

        return $tag;
    }

    private function assertCurrentTag(?FuelAviIdentityTag $tag, CarbonInterface $at): void
    {
        if ($tag === null) {
            return;
        }
        if (! $tag->isActiveAt($at)) {
            throw new RuntimeException($tag->status === FuelAviIdentityTag::STATUS_BLACKLISTED ? 'AVI_TAG_BLACKLISTED' : 'AVI_TAG_NOT_ACTIVE');
        }
    }

    private function assertFrequency(?string $vehicleId, FuelStation $station, CarbonInterface $at): void
    {
        $seconds = (int) $this->settings->get($station, 'avi_min_refill_interval_seconds');
        if ($seconds <= 0 || $vehicleId === null) {
            return;
        }
        $cutoff = $at->copy()->subSeconds($seconds);
        if (FuelAviAuthorization::where('fuel_fleet_vehicle_id', $vehicleId)
            ->where('decision', FuelAviAuthorization::DECISION_APPROVED)
            ->where('authorized_at', '>', $cutoff)
            ->exists()) {
            throw new RuntimeException('AVI_REFILL_INTERVAL_RESTRICTED');
        }
    }

    private function assertVehicleCapacity(mixed $vehicle, int $quantity, FuelStation $station): void
    {
        if (! (bool) $this->settings->get($station, 'avi_enforce_vehicle_tank_capacity') || $vehicle === null) {
            return;
        }
        $capacity = $vehicle->tank_capacity_milliliters;
        if ($capacity !== null && $quantity > (int) $capacity) {
            throw new RuntimeException('AVI_VEHICLE_CAPACITY_EXCEEDED');
        }
    }

    /** @return list<string> */
    private function denialSignals(FuelStation $station, array $context, ?string $reason, CarbonInterface $at): array
    {
        $signals = $context['signals'] ?? [];
        if ($reason !== null) {
            if (str_contains($reason, 'FUEL_RESTRICTED') || str_contains($reason, 'CONTRACT_FUEL_RESTRICTED')) {
                $signals[] = 'wrong_fuel_attempt';
            }
            if ($reason === 'AVI_REFILL_INTERVAL_RESTRICTED') {
                $signals[] = 'refill_too_soon';
            }
            if ($reason === 'AVI_VEHICLE_CAPACITY_EXCEEDED') {
                $signals[] = 'quantity_exceeds_vehicle_capacity';
            }
            if (str_contains($reason, 'ODOMETER')) {
                $signals[] = 'suspicious_odometer';
            }
            if (str_contains($reason, 'STATION_RESTRICTED')) {
                $signals[] = 'suspicious_station_usage';
            }
        }

        $threshold = (int) $this->settings->get($station, 'avi_repeated_denial_threshold');
        $window = (int) $this->settings->get($station, 'avi_denial_window_seconds');
        $tagId = $context['vehicle_tag']?->id ?? $context['driver_tag']?->id ?? null;
        if ($threshold > 0 && $window > 0 && $tagId !== null) {
            $recentDenials = FuelAviAuthorization::where('fuel_station_id', $station->id)
                ->where('decision', FuelAviAuthorization::DECISION_DENIED)
                ->where(fn ($query) => $query->where('vehicle_identity_tag_id', $tagId)->orWhere('driver_identity_tag_id', $tagId))
                ->where('authorized_at', '>=', $at->copy()->subSeconds($window))
                ->count();
            if ($recentDenials >= $threshold - 1) {
                $signals[] = 'repeated_denial_pattern';
            }
        }

        return array_values(array_unique($signals));
    }

    private function record(FuelStation $station, FuelNozzle $nozzle, FuelProduct $fuelProduct, int $quantity, ?int $odometer, string $idempotencyKey, string $checksum, string $decision, ?string $reason, array $context, User $actor): FuelAviAuthorization
    {
        $ttl = (int) $this->settings->get($station, 'avi_authorization_ttl_seconds');
        $at = now();

        return FuelAviAuthorization::create([
            'branch_id' => $station->branch_id,
            'fuel_station_id' => $station->id,
            'fuel_nozzle_id' => $nozzle->id,
            'fuel_product_id' => $fuelProduct->id,
            'vehicle_identity_tag_id' => $context['vehicle_tag']?->id,
            'driver_identity_tag_id' => $context['driver_tag']?->id,
            'partner_id' => $context['partner_id'],
            'corporate_fuel_contract_id' => $context['contract_id'],
            'fuel_card_id' => $context['card_id'],
            'fuel_fleet_vehicle_id' => $context['vehicle_id'],
            'fuel_fleet_driver_id' => $context['driver_id'],
            'identity_mode' => $context['identity_mode'] ?? 'unresolved',
            'quantity_milliliters' => $quantity,
            'odometer' => $odometer,
            'idempotency_key' => $idempotencyKey,
            'payload_checksum' => $checksum,
            'decision' => $decision,
            'reason_code' => $reason,
            'suspicion_signals' => $context['signals'] === [] ? null : $context['signals'],
            'authorized_at' => $at,
            'expires_at' => $decision === FuelAviAuthorization::DECISION_APPROVED && $ttl > 0 ? $at->copy()->addSeconds($ttl) : null,
            'requested_by' => $actor->id,
        ]);
    }

    private function assertDraftUsable(FuelAviAuthorization $authorization, array $attributes, CarbonInterface $at): void
    {
        if (! $authorization->isApproved()) {
            throw new RuntimeException('AVI_AUTHORIZATION_DENIED');
        }
        if ($authorization->isExpiredAt($at)) {
            throw new RuntimeException('AVI_AUTHORIZATION_EXPIRED');
        }
        if ($authorization->fuel_sale_id !== null && $authorization->fuel_sale_id !== ($attributes['fuel_sale_id'] ?? null)) {
            throw new RuntimeException('AVI_AUTHORIZATION_ALREADY_USED');
        }
        if (($attributes['fuel_station_id'] ?? null) !== $authorization->fuel_station_id
            || ($attributes['fuel_nozzle_id'] ?? null) !== $authorization->fuel_nozzle_id
            || (int) ($attributes['quantity_milliliters'] ?? 0) !== (int) $authorization->quantity_milliliters
            || $this->nullableNonNegativeInteger($attributes['odometer'] ?? null, 'odometer') !== $authorization->odometer) {
            throw new RuntimeException('AVI_AUTHORIZATION_REQUEST_MISMATCH');
        }
    }

    private function assertClientDoesNotOverrideReferences(array $attributes, FuelAviAuthorization $authorization): void
    {
        foreach ($this->references($authorization) as $key => $value) {
            if ($key === 'fuel_avi_authorization_id' || ! array_key_exists($key, $attributes) || $attributes[$key] === null) {
                continue;
            }
            if ($attributes[$key] !== $value) {
                throw new RuntimeException('AVI_AUTHORIZATION_REFERENCE_OVERRIDE');
            }
        }
    }

    /** @return array<string,string|null> */
    private function references(FuelAviAuthorization $authorization): array
    {
        return [
            'partner_id' => $authorization->partner_id,
            'corporate_fuel_contract_id' => $authorization->corporate_fuel_contract_id,
            'fuel_card_id' => $authorization->fuel_card_id,
            'fuel_fleet_vehicle_id' => $authorization->fuel_fleet_vehicle_id,
            'fuel_fleet_driver_id' => $authorization->fuel_fleet_driver_id,
            'fuel_avi_authorization_id' => $authorization->id,
            'odometer' => $authorization->odometer,
        ];
    }

    private function assertStation(FuelStation $station): void
    {
        $branchId = app(BranchContext::class)->id();
        if ($branchId !== null && $station->branch_id !== $branchId) {
            throw new RuntimeException('AVI_STATION_BRANCH_MISMATCH');
        }
        if ($station->status !== FuelStation::STATUS_ACTIVE) {
            throw new RuntimeException('AVI_STATION_NOT_ACTIVE');
        }
    }

    private function assertNozzle(FuelNozzle $nozzle, FuelStation $station): void
    {
        if ($nozzle->fuel_station_id !== $station->id || $nozzle->branch_id !== $station->branch_id || $nozzle->status !== FuelNozzle::STATUS_ACTIVE) {
            throw new RuntimeException('AVI_NOZZLE_NOT_ACTIVE');
        }
    }

    private function requestChecksum(FuelStation $station, FuelNozzle $nozzle, int $quantity, ?int $odometer, array $attributes): string
    {
        return $this->checksum([
            'fuel_station_id' => $station->id,
            'fuel_nozzle_id' => $nozzle->id,
            'quantity_milliliters' => $quantity,
            'odometer' => $odometer,
            'vehicle_credential_hash' => $this->nullableCredentialHash($attributes['vehicle_credential'] ?? null),
            'driver_credential_hash' => $this->nullableCredentialHash($attributes['driver_credential'] ?? null),
        ]);
    }

    private function requestChecksumFromIds(string $stationId, string $nozzleId, int $quantity, ?int $odometer, array $attributes): string
    {
        return $this->checksum([
            'fuel_station_id' => $stationId,
            'fuel_nozzle_id' => $nozzleId,
            'quantity_milliliters' => $quantity,
            'odometer' => $odometer,
            'vehicle_credential_hash' => $this->nullableCredentialHash($attributes['vehicle_credential'] ?? null),
            'driver_credential_hash' => $this->nullableCredentialHash($attributes['driver_credential'] ?? null),
        ]);
    }

    private function checksum(array $payload): string
    {
        return hash('sha256', json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
    }

    private function nullableCredentialHash(mixed $credential): ?string
    {
        if ($credential === null || $credential === '') {
            return null;
        }

        return is_string($credential) ? hash('sha256', trim($credential)) : '__invalid__';
    }

    private function requiredString(array $attributes, string $key): string
    {
        $value = $attributes[$key] ?? null;
        if (! is_string($value) || trim($value) === '') {
            throw new RuntimeException("{$key} مطلوب.");
        }

        return trim($value);
    }

    private function positiveInteger(mixed $value, string $key): int
    {
        $integer = $this->nullableNonNegativeInteger($value, $key);
        if ($integer === null || $integer <= 0) {
            throw new RuntimeException("{$key} يجب أن يكون عدداً صحيحاً موجباً.");
        }

        return $integer;
    }

    private function nullableNonNegativeInteger(mixed $value, string $key): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (! is_int($value) && !(is_string($value) && preg_match('/^\d+$/', $value))) {
            throw new RuntimeException("{$key} يجب أن يكون عدداً صحيحاً غير سالب.");
        }
        $integer = (int) $value;
        if ($integer < 0) {
            throw new RuntimeException("{$key} يجب أن يكون عدداً صحيحاً غير سالب.");
        }

        return $integer;
    }
}
