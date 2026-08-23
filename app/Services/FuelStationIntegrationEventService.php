<?php

namespace App\Services;

use App\Models\FuelStationDevice;
use App\Models\FuelStationIntegrationEvent;
use App\Models\FuelStationIntegrationEventAttempt;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * بوابة الإدخال المعياري للأحداث الخارجية.
 *
 * تربط هذه الخدمة هوية المصدر بسجل جهاز نشط، ثم تحفظ الحدث append-only مع
 * idempotency وتسلسل المصدر. «processed» هنا يعني أن منصة التكامل تحققت من
 * صلاحية الحدث وأحدثت صحة الجهاز؛ ولا يعني صرف وقود أو حركة مخزون أو أثراً
 * محاسبياً. يظل أي مستهلك مجالي فعلي مسؤولية دورة معتمدة لاحقة.
 */
class FuelStationIntegrationEventService
{
    public function __construct(private readonly FuelStationDeviceService $devices)
    {
    }

    public function accept(FuelStationDeviceIdentity $source, FuelStationNormalizedEvent $event, ?User $actor = null): FuelStationIntegrationEvent
    {
        $device = $this->devices->activeSource($source->stationId, $source->sourceId, $source->adapterKey);
        $this->assertEventTime($device, $event);
        $checksum = $this->payloadChecksum($event->payload);

        $existing = FuelStationIntegrationEvent::query()
            ->where('source_id', $source->sourceId)
            ->where('event_id', $event->eventId)
            ->first();
        if ($existing !== null) {
            return $this->assertSameReplay($existing, $checksum);
        }

        if ($event->sequence !== null) {
            $sameSequence = FuelStationIntegrationEvent::query()
                ->where('source_id', $source->sourceId)
                ->where('sequence', $event->sequence)
                ->first();
            if ($sameSequence !== null) {
                $this->devices->markFailed($device, 'SOURCE_SEQUENCE_REUSED');
                throw new RuntimeException('تسلسل جهاز الساحة استُخدم مسبقاً لحدث مختلف.');
            }
        }

        try {
            $accepted = DB::transaction(function () use ($device, $source, $event, $checksum, $actor) {
                $record = FuelStationIntegrationEvent::create([
                    'tenant_id' => $device->tenant_id,
                    'branch_id' => $device->branch_id,
                    'fuel_station_id' => $device->fuel_station_id,
                    'fuel_station_device_id' => $device->id,
                    'source_id' => $source->sourceId,
                    'event_id' => $event->eventId,
                    'sequence' => $event->sequence,
                    'event_type' => $event->eventType->value,
                    'occurred_at' => $event->occurredAt,
                    'correlation_id' => $event->correlationId,
                    'checksum' => $checksum,
                    'payload' => $event->payload,
                    'status' => FuelStationIntegrationEvent::STATUS_ACCEPTED,
                    'retry_count' => 0,
                    'received_at' => now(),
                ]);
                $this->attempt($record, FuelStationIntegrationEventAttempt::ACTION_INGEST, FuelStationIntegrationEventAttempt::STATUS_ACCEPTED, $this->nextAttemptNumber($record), null, $actor);

                return $record;
            });
        } catch (QueryException $exception) {
            $replayed = FuelStationIntegrationEvent::query()
                ->where('source_id', $source->sourceId)
                ->where('event_id', $event->eventId)
                ->first();
            if ($replayed !== null) {
                return $this->assertSameReplay($replayed, $checksum);
            }

            throw new RuntimeException('تعذر قبول حدث جهاز الساحة بسبب تعارض الهوية أو التسلسل.', previous: $exception);
        }

        return $this->process($accepted, $actor);
    }

    /**
     * يعالج معنى منصة التكامل فقط: توافق نوع الحدث مع نوع الجهاز وصحة المصدر.
     * لا يرسل أمراً خارجياً ولا يستهلك الحدث في محاسبة أو مخزون أو مبيعات.
     */
    public function process(FuelStationIntegrationEvent $event, ?User $actor = null): FuelStationIntegrationEvent
    {
        return DB::transaction(function () use ($event, $actor) {
            $event = FuelStationIntegrationEvent::lockForUpdate()->with('device')->findOrFail($event->id);
            if ($event->status === FuelStationIntegrationEvent::STATUS_PROCESSED) {
                return $event;
            }
            if ($event->device === null || $event->device->status !== FuelStationDevice::STATUS_ACTIVE) {
                return $this->fail($event, 'DEVICE_NOT_ACTIVE', $actor);
            }

            try {
                $this->assertEventMatchesDevice($event->device, $event->event_type);
                $event->update([
                    'status' => FuelStationIntegrationEvent::STATUS_PROCESSED,
                    'processed_at' => now(),
                    'failure_reason' => null,
                ]);
                $this->devices->markObserved($event->device, $event->occurred_at);
                $this->attempt($event, FuelStationIntegrationEventAttempt::ACTION_PROCESS, FuelStationIntegrationEventAttempt::STATUS_PROCESSED, $this->nextAttemptNumber($event), null, $actor);

                return $event->fresh(['device', 'attempts']);
            } catch (RuntimeException $exception) {
                return $this->fail($event, $exception->getMessage(), $actor);
            }
        });
    }

    /** يعيد الحدث الفاشل إلى منصة المعالجة بعد حد retry المدقق. */
    public function retry(FuelStationIntegrationEvent $event, User $actor): FuelStationIntegrationEvent
    {
        return DB::transaction(function () use ($event, $actor) {
            $event = FuelStationIntegrationEvent::lockForUpdate()->with(['device', 'station'])->findOrFail($event->id);
            if ($event->status !== FuelStationIntegrationEvent::STATUS_FAILED) {
                throw new RuntimeException('يمكن إعادة محاولة حدث تكامل فاشل فقط.');
            }
            if ($event->device === null || $event->station === null || $event->device->status !== FuelStationDevice::STATUS_ACTIVE) {
                throw new RuntimeException('لا يمكن إعادة محاولة حدث لا يرتبط بجهاز نشط ومحطة موثوقة.');
            }

            $maxRetries = app(FuelStationSettingsService::class)->get($event->station, 'device_max_retry_attempts', $event->device->device_key);
            if ($event->retry_count >= $maxRetries) {
                throw new RuntimeException('بلغ حدث التكامل الحد الأقصى لمحاولات إعادة المعالجة.');
            }

            $event->increment('retry_count');
            $event->update([
                'status' => FuelStationIntegrationEvent::STATUS_ACCEPTED,
                'failure_reason' => null,
                'processed_at' => null,
            ]);
            $this->attempt($event, FuelStationIntegrationEventAttempt::ACTION_RETRY, FuelStationIntegrationEventAttempt::STATUS_ACCEPTED, $this->nextAttemptNumber($event), null, $actor);

            return $event->fresh();
        });
    }

    private function fail(FuelStationIntegrationEvent $event, string $reason, ?User $actor): FuelStationIntegrationEvent
    {
        $reason = mb_substr(trim($reason), 0, 500);
        $event->update([
            'status' => FuelStationIntegrationEvent::STATUS_FAILED,
            'failure_reason' => $reason,
            'processed_at' => now(),
        ]);
        if ($event->device !== null) {
            $this->devices->markFailed($event->device, $reason);
        }
        $this->attempt($event, FuelStationIntegrationEventAttempt::ACTION_PROCESS, FuelStationIntegrationEventAttempt::STATUS_FAILED, $this->nextAttemptNumber($event), $reason, $actor);

        return $event->fresh(['device', 'attempts']);
    }

    private function assertEventMatchesDevice(FuelStationDevice $device, string $eventType): void
    {
        $eventsByType = [
            FuelStationDevice::TYPE_FORECOURT_CONTROLLER => [
                FuelStationEventType::FORECOURT_TRANSACTION_RECORDED->value,
                FuelStationEventType::PUMP_STATUS_CHANGED->value,
                FuelStationEventType::NOZZLE_METER_RECORDED->value,
            ],
            FuelStationDevice::TYPE_ATG => [
                FuelStationEventType::ATG_READING_RECORDED->value,
                FuelStationEventType::TANK_ALARM_RAISED->value,
                FuelStationEventType::TANK_ALARM_CLEARED->value,
            ],
            FuelStationDevice::TYPE_RFID_READER => [
                FuelStationEventType::VEHICLE_IDENTIFIED->value,
            ],
            FuelStationDevice::TYPE_PAYMENT_TERMINAL => [],
            FuelStationDevice::TYPE_STATION_GATEWAY => array_map(static fn (FuelStationEventType $type) => $type->value, FuelStationEventType::cases()),
        ];
        if (! in_array($eventType, $eventsByType[$device->device_type] ?? [], true)) {
            throw new RuntimeException('نوع الحدث المعياري لا يطابق نوع جهاز الساحة المسجل.');
        }
    }

    private function assertEventTime(FuelStationDevice $device, FuelStationNormalizedEvent $event): void
    {
        $station = $device->loadMissing('station')->station;
        $settings = app(FuelStationSettingsService::class);
        $maxFutureSkew = $settings->get($station, 'device_max_future_skew_seconds', $device->device_key);
        $maxLateness = $settings->get($station, 'device_event_max_lateness_seconds', $device->device_key);
        if ($event->occurredAt->isAfter(now()->addSeconds($maxFutureSkew))) {
            throw new RuntimeException('وقت حدث الجهاز يتجاوز انحراف الساعة المسموح به.');
        }
        if ($event->occurredAt->isBefore(now()->subSeconds($maxLateness))) {
            throw new RuntimeException('حدث الجهاز متأخر عن نافذة الاستلام المسموح بها.');
        }
    }

    private function assertSameReplay(FuelStationIntegrationEvent $existing, string $checksum): FuelStationIntegrationEvent
    {
        if (! hash_equals((string) $existing->checksum, $checksum)) {
            throw new RuntimeException('معرّف الحدث الخارجي أُعيد استخدامه بحمولة مختلفة.');
        }

        return $existing;
    }

    private function attempt(FuelStationIntegrationEvent $event, string $action, string $status, int $attemptNumber, ?string $reason, ?User $actor): void
    {
        FuelStationIntegrationEventAttempt::create([
            'tenant_id' => $event->tenant_id,
            'branch_id' => $event->branch_id,
            'fuel_station_integration_event_id' => $event->id,
            'fuel_station_device_id' => $event->fuel_station_device_id,
            'action' => $action,
            'status' => $status,
            'attempt_number' => $attemptNumber,
            'reason' => $reason,
            'performed_by' => $actor?->id,
            'attempted_at' => now(),
        ]);
    }

    private function nextAttemptNumber(FuelStationIntegrationEvent $event): int
    {
        return (int) $event->attempts()->count() + 1;
    }

    /** @param array<string, mixed> $payload */
    private function payloadChecksum(array $payload): string
    {
        return hash('sha256', json_encode($this->canonicalize($payload), JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
    }

    private function canonicalize(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }

        foreach ($value as $key => $child) {
            $value[$key] = $this->canonicalize($child);
        }
        if (! array_is_list($value)) {
            ksort($value);
        }

        return $value;
    }
}
