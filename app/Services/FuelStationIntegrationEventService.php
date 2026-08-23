<?php

namespace App\Services;

use App\Models\FuelStation;
use App\Models\FuelStationIntegrationEvent;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * بوابة الإدخال المعياري للأحداث الخارجية.
 *
 * تحفظ قاعدة البيانات حارس idempotency النهائي على (tenant, source, event_id)
 * وعلى sequence المصدر. تعيد المحاولة الحدث الأصلي فقط عندما تكون الحمولة
 * المتعارضة مطابقة؛ أما reuse لنفس الهوية مع payload مختلف فيُرفض فلا يتحول
 * الخطأ إلى عملية مكررة صامتة. لا يرحّل هذا الكود أي حركة وقود أو قيد محاسبي.
 */
class FuelStationIntegrationEventService
{
    public function accept(FuelStationDeviceIdentity $source, FuelStationNormalizedEvent $event): FuelStationIntegrationEvent
    {
        $context = app(TenantContext::class);
        $station = FuelStation::query()->findOrFail($source->stationId);
        if ($context->has() && $context->id() !== $station->tenant_id) {
            throw new RuntimeException('المحطة لا تنتمي إلى المستأجر النشط.');
        }

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
                throw new RuntimeException('تسلسل جهاز الساحة استُخدم مسبقاً لحدث مختلف.');
            }
        }

        try {
            return DB::transaction(function () use ($station, $source, $event, $checksum) {
                return FuelStationIntegrationEvent::create([
                    'tenant_id' => $station->tenant_id,
                    'branch_id' => $station->branch_id,
                    'fuel_station_id' => $station->id,
                    'source_id' => $source->sourceId,
                    'event_id' => $event->eventId,
                    'sequence' => $event->sequence,
                    'event_type' => $event->eventType->value,
                    'occurred_at' => $event->occurredAt,
                    'correlation_id' => $event->correlationId,
                    'checksum' => $checksum,
                    'payload' => $event->payload,
                    'status' => FuelStationIntegrationEvent::STATUS_ACCEPTED,
                    'received_at' => now(),
                ]);
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
    }

    private function assertSameReplay(FuelStationIntegrationEvent $existing, string $checksum): FuelStationIntegrationEvent
    {
        if (! hash_equals((string) $existing->checksum, $checksum)) {
            throw new RuntimeException('معرّف الحدث الخارجي أُعيد استخدامه بحمولة مختلفة.');
        }

        return $existing;
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
