<?php

namespace App\Services;

use App\Models\FuelStation;
use App\Models\FuelStationAuditEvent;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Model;
use RuntimeException;

/**
 * FS-22: كاتب سجل التدقيق بالفاعل للبيانات الرئيسية وسجل الأجهزة (مصدر وحيد).
 *
 * - يُستدعى **داخل معاملة** العملية الأصلية (إن وُجدت) فتُثبَّت الحدث والتغيير معاً أو يتراجعان معاً.
 * - لقطتا قبل/بعد تحويان **الحقول المتغيّرة فقط** في التعديل، والمسموحة كلها في الإنشاء/الحذف.
 * - لا سرّ في السجل أبداً: أي مفتاح يشبه كلمة مرور/رمز/سر/اعتماد يُحجب قبل التخزين (`[redacted]`)، وحقل `credential_reference`
 *   (مرجع vault) يسجَّل تغيّره دون قيمته. `tenant_id`/الطوابع/معرّف المنشئ لا تدخل اللقطة.
 */
class FuelStationAuditTrail
{
    public const REDACTED = '[redacted]';

    /** حقول لا تدخل اللقطة (ضجيج أو مفاتيح داخلية). */
    private const SKIP_KEYS = ['tenant_id', 'created_at', 'updated_at', 'deleted_at', 'created_by', 'updated_by'];

    /** حقول تُحجب قيمتها دائماً (يُسجَّل أنها تغيّرت فقط). */
    private const ALWAYS_REDACT = ['credential_reference'];

    private const SECRET_PATTERN = '/(password|passwd|secret|token|api[_-]?key|private[_-]?key|authorization|credential)/i';

    /**
     * @param  array<string,mixed>|null  $before  لقطة قبل (من snapshot) أو null للإنشاء
     * @param  array<string,mixed>|null  $after   لقطة بعد أو null للحذف
     */
    public function record(string $action, Model $subject, ?array $before, ?array $after, ?User $actor = null, ?string $reason = null): ?FuelStationAuditEvent
    {
        if ($before !== null && $after !== null) {
            [$before, $after] = $this->changedOnly($before, $after);
            if ($before === [] && $after === []) {
                return null; // لا تغيير فعلي ⇒ لا حدث ضجيج
            }
        }

        $tenantId = $subject->getAttribute('tenant_id') ?? app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('سياق المستأجر مطلوب لتسجيل حدث تدقيق محطة الوقود.');
        }

        [$stationId, $branchId, $warehouseId] = $this->stationScope($subject);

        return FuelStationAuditEvent::create([
            'tenant_id' => $tenantId,
            'branch_id' => $branchId,
            'fuel_station_id' => $stationId,
            'warehouse_id' => $warehouseId,
            'actor_id' => $actor?->id,
            'action' => $action,
            'subject_type' => $subject::class,
            'subject_id' => $subject->getKey(),
            'before' => $before === null ? null : $this->redact($before),
            'after' => $after === null ? null : $this->redact($after),
            'reason' => $reason === null ? null : mb_substr($reason, 0, 500),
            'occurred_at' => now(),
        ]);
    }

    /** لقطة سمات النموذج المسموحة (بلا مفاتيح داخلية). @return array<string,mixed> */
    public function snapshot(Model $model): array
    {
        $attributes = $model->attributesToArray();
        foreach (self::SKIP_KEYS as $key) {
            unset($attributes[$key]);
        }
        ksort($attributes);

        return $attributes;
    }

    /**
     * @param  array<string,mixed>  $before
     * @param  array<string,mixed>  $after
     * @return array{0:array<string,mixed>,1:array<string,mixed>}
     */
    private function changedOnly(array $before, array $after): array
    {
        $changedBefore = [];
        $changedAfter = [];
        foreach (array_unique([...array_keys($before), ...array_keys($after)]) as $key) {
            $old = $before[$key] ?? null;
            $new = $after[$key] ?? null;
            if ($old !== $new && json_encode($old) !== json_encode($new)) {
                $changedBefore[$key] = $old;
                $changedAfter[$key] = $new;
            }
        }

        return [$changedBefore, $changedAfter];
    }

    /**
     * @param  array<string,mixed>  $values
     * @return array<string,mixed>
     */
    private function redact(array $values): array
    {
        foreach ($values as $key => $value) {
            if (in_array((string) $key, self::ALWAYS_REDACT, true) || preg_match(self::SECRET_PATTERN, (string) $key)) {
                $values[$key] = $value === null ? null : self::REDACTED;
            } elseif (is_array($value)) {
                $values[$key] = $this->redact($value);
            }
        }

        return $values;
    }

    /** @return array{0:?string,1:?string,2:?string} [المحطة، الفرع، المخزن] لقطة وقت الحدث */
    private function stationScope(Model $subject): array
    {
        if ($subject instanceof FuelStation) {
            return [$subject->getKey(), $subject->branch_id, $subject->warehouse_id];
        }
        $stationId = $subject->getAttribute('fuel_station_id');
        if ($stationId === null) {
            return [null, $subject->getAttribute('branch_id'), null];
        }
        $station = FuelStation::query()->whereKey($stationId)->first(['branch_id', 'warehouse_id']);

        return [$stationId, $subject->getAttribute('branch_id') ?? $station?->branch_id, $station?->warehouse_id];
    }
}
