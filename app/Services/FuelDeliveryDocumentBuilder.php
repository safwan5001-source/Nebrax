<?php

namespace App\Services;

use App\Models\FuelDelivery;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Support\Collection;

/**
 * FUEL-B5.1: مصدر **وحيد** لمحتوى سند استلام الوقود وكشف الاستلامات (PDF وExcel وأي عرض مطبوع).
 *
 * ═══ نسختان، والخادم هو الحَكَم ═══
 *  - `operational`: بلا أي سعر أو تكلفة أو قيمة — **ولا مفتاح فارغ** لها (لا تُبنى أصلاً).
 *  - `financial`: يضيف التكلفة وسجّل من سجّلها. يطلبها المتحكّم بعد فحص `FuelCostVisibility::canSeeCost` (403 لغير المخوّل)،
 *    فلا يصل المبلغ إلى أي عميل (واجهة، PDF مرسوم في المتصفح، أو Excel) ما لم يخوّله الخادم. الواجهة لا تُخفي شيئاً: لا تتلقاه.
 *  القائمة البيضاء صريحة (لا `toArray()` للنموذج) فلا ينجرف حقل مالي إلى النسخة التشغيلية بإضافة عمود لاحقاً.
 *
 * رقمان متمايزان: `reference` = رقم الاستلام **الداخلي** `FD-XXXXXXXX` (مشتق من المعرّف، مستقر)، و`delivery_note_number` = رقم سند المورد (يطبعه المورد). لا ترقيم تسلسلي لاستلامات الوقود
 * في هذه الشريحة (يحتاج عموداً وعدّاداً — انظر التقرير).
 */
class FuelDeliveryDocumentBuilder
{
    public const REPORT_ROW_LIMIT = 2000;

    public function __construct(private readonly FuelQuantity $quantity, private readonly TenantContext $tenant) {}

    /** @return array<string, mixed> */
    public function document(FuelDelivery $d, bool $financial, ?User $viewer): array
    {
        $d->loadMissing(['station', 'tank', 'fuelProduct.product', 'warehouse', 'supplier', 'beforePhysicalReading', 'afterPhysicalReading', 'beforeAtgReading', 'afterAtgReading', 'attachments']);
        $names = $this->userNames([$d->created_by, $d->approved_by, $financial ? $d->cost_recorded_by : null]);

        $doc = [
            'variant' => $financial ? 'financial' : 'operational',
            'generated_at' => now()->toIso8601String(),
            'generated_by' => $viewer?->name,
            'company' => $this->company(),
            'station' => $d->station ? ['code' => $d->station->code, 'name' => $d->station->name, 'city' => $d->station->city, 'address' => $d->station->address] : null,
            'reference' => $this->reference($d),
            'status' => $d->status,
            'delivery_note_number' => $d->delivery_note_number,
            'purchase_reference' => $d->purchase_reference,
            'supplier' => $d->supplier ? ['name' => $d->supplier->name, 'code' => $d->supplier->code] : null,
            'product' => $d->fuelProduct ? ['code' => $d->fuelProduct->code, 'name' => $d->fuelProduct->name ?: $d->fuelProduct->product?->name] : null,
            'tank' => $d->tank ? ['code' => $d->tank->code, 'name' => $d->tank->name] : null,
            'warehouse' => $d->warehouse ? ['code' => $d->warehouse->code, 'name' => $d->warehouse->name] : null,
            'tanker_identifier' => $d->tanker_identifier,
            'driver_name' => $d->driver_name,
            'temperature_milli_celsius' => $d->temperature_milli_celsius,
            'density_kg_per_m3' => $d->density_kg_per_m3,
            'quantities' => [
                'dispatched_liters' => $this->liters((int) $d->dispatched_milliliters),
                'received_liters' => $this->liters((int) $d->received_milliliters),
                'transit_variance_liters' => $this->signedLiters((int) $d->transit_variance_milliliters),
                'transit_variance_percent' => $this->percent((int) $d->transit_variance_milliliters, (int) $d->dispatched_milliliters),
            ],
            'readings' => $this->readings($d),
            'received_at' => $d->received_at?->toIso8601String(),
            'received_by' => $names[$d->created_by] ?? null,
            'approved_by' => $names[$d->approved_by] ?? null,
            'approved_at' => $d->approved_at?->toIso8601String(),
            'notes' => $d->notes,
            'attachments' => $d->attachments->map(fn ($a) => ['name' => $a->original_name, 'mime_type' => $a->mime_type, 'size' => (int) $a->size])->values()->all(),
        ];

        if ($financial) {
            $doc['cost'] = [
                'currency' => $this->company()['currency'],
                'total_minor' => $d->received_total_cost_minor === null ? null : (int) $d->received_total_cost_minor,
                'per_liter' => $this->costPerLiter($d->received_total_cost_minor, (int) $d->received_milliliters),
                'recorded_by' => $names[$d->cost_recorded_by] ?? null,
                'recorded_at' => $d->cost_recorded_at?->toIso8601String(),
            ];
        }

        return $doc;
    }

    /**
     * @param  Collection<int, FuelDelivery>  $deliveries
     * @param  array<string, mixed>  $filters  وصف نصي للمرشحات المطبَّقة (للترويسة) — لا يُستعمل في أي استعلام.
     * @return array<string, mixed>
     */
    public function report(Collection $deliveries, bool $financial, ?User $viewer, array $filters, bool $truncated): array
    {
        $deliveries->loadMissing(['station', 'tank', 'fuelProduct.product', 'supplier']);

        $received = 0;
        $dispatched = 0;
        $totalCost = 0;
        $uncosted = 0;
        $rows = $deliveries->map(function (FuelDelivery $d) use ($financial, &$received, &$dispatched, &$totalCost, &$uncosted) {
            $received += (int) $d->received_milliliters;
            $dispatched += (int) $d->dispatched_milliliters;
            $row = [
                'reference' => $this->reference($d),
                'received_at' => $d->received_at?->toIso8601String(),
                'status' => $d->status,
                'delivery_note_number' => $d->delivery_note_number,
                'station' => $d->station?->name,
                'supplier' => $d->supplier?->name,
                'product' => $d->fuelProduct?->name ?: $d->fuelProduct?->product?->name,
                'tank' => $d->tank?->code,
                'dispatched_liters' => $this->liters((int) $d->dispatched_milliliters),
                'received_liters' => $this->liters((int) $d->received_milliliters),
                'transit_variance_liters' => $this->signedLiters((int) $d->transit_variance_milliliters),
            ];
            if ($financial) {
                if ($d->received_total_cost_minor === null) {
                    $uncosted++;
                } else {
                    $totalCost += (int) $d->received_total_cost_minor;
                }
                $row['total_cost_minor'] = $d->received_total_cost_minor === null ? null : (int) $d->received_total_cost_minor;
            }

            return $row;
        })->values()->all();

        $totals = [
            'count' => count($rows),
            'dispatched_liters' => $this->liters($dispatched),
            'received_liters' => $this->liters($received),
            'transit_variance_liters' => $this->signedLiters($received - $dispatched),
        ];
        if ($financial) {
            $totals['total_cost_minor'] = $totalCost;
            $totals['uncosted_count'] = $uncosted;
        }

        return [
            'variant' => $financial ? 'financial' : 'operational',
            'generated_at' => now()->toIso8601String(),
            'generated_by' => $viewer?->name,
            'company' => $this->company(),
            'filters' => $filters,
            'truncated' => $truncated,
            'rows' => $rows,
            'totals' => $totals,
        ];
    }

    /** رقم الاستلام الداخلي `FD-XXXXXXXX` (≠ رقم سند المورد). */
    public function reference(FuelDelivery $d): string
    {
        return $d->reference();
    }

    /** @return array{name: ?string, vat_number: ?string, cr_number: ?string, currency: string} */
    private function company(): array
    {
        $tenant = $this->tenant->id() === null ? null : Tenant::query()->find($this->tenant->id());

        return [
            'name' => $tenant?->name,
            'vat_number' => $tenant?->vat_number,
            'cr_number' => $tenant?->cr_number,
            'currency' => (string) ($tenant?->currency ?: 'SAR'),
        ];
    }

    /** @return array<string, ?array<string, mixed>> */
    private function readings(FuelDelivery $d): array
    {
        $one = fn ($r) => $r === null ? null : [
            'liters' => $this->liters((int) $r->quantity_milliliters),
            'measured_at' => $r->measured_at?->toIso8601String(),
        ];

        return [
            'before_physical' => $one($d->beforePhysicalReading),
            'after_physical' => $one($d->afterPhysicalReading),
            'before_atg' => $one($d->beforeAtgReading),
            'after_atg' => $one($d->afterAtgReading),
        ];
    }

    /**
     * @param  array<int, ?string>  $ids
     * @return array<string, string>
     */
    private function userNames(array $ids): array
    {
        $ids = array_values(array_unique(array_filter($ids)));

        return $ids === [] ? [] : User::query()->whereIn('id', $ids)->pluck('name', 'id')->all();
    }

    private function liters(int $milliliters): string
    {
        return $this->quantity->millilitersToLiters(max(0, $milliliters));
    }

    private function signedLiters(int $milliliters): string
    {
        return ($milliliters < 0 ? '-' : '').$this->quantity->millilitersToLiters(abs($milliliters));
    }

    /** نسبة مئوية بمنزلتين بحساب صحيح (نصف بعيداً عن الصفر) — لا float في أي مبلغ أو كمية. */
    private function percent(int $variance, int $base): ?string
    {
        if ($base <= 0) {
            return null;
        }
        $hundredths = intdiv(abs($variance) * 20000 + $base, 2 * $base); // round(abs*10000/base)
        $text = intdiv($hundredths, 100).'.'.str_pad((string) ($hundredths % 100), 2, '0', STR_PAD_LEFT);

        return ($variance < 0 && $hundredths > 0 ? '-' : '').$text;
    }

    /** متوسط تكلفة اللتر بأربع منازل (هللات→ريال) بحساب صحيح؛ null إن لم تُسجَّل التكلفة. */
    private function costPerLiter(?int $totalMinor, int $milliliters): ?string
    {
        if ($totalMinor === null || $milliliters <= 0) {
            return null;
        }
        // minor/L = total*1000/ml ؛ بأربع منازل من الريال: ×100 ثم تقريب.
        $scaled = intdiv($totalMinor * 1000 * 100 * 2 + $milliliters, 2 * $milliliters); // (minor per liter) * 100 → 1/10000 SAR
        $int = intdiv($scaled, 10000);

        return $int.'.'.str_pad((string) ($scaled % 10000), 4, '0', STR_PAD_LEFT);
    }
}
