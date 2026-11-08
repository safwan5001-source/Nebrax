<?php

namespace App\Services;

use App\Models\FuelInventoryCostState;
use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\FuelStationWalkInPartner;
use App\Models\Partner;
use App\Models\ProductWarehouseStock;
use Illuminate\Support\Facades\Schema;

/**
 * شروط تفعيل تسوية ورديات الوقود (P1-3a) — **قراءة فقط**: لا قفل ولا كتابة ولا إنشاء بيانات رئيسية.
 *
 * مصدر وحيد للحكم «هل التسوية جاهزة لهذه المحطة؟» يستعمله ضبط السياسة (`shift_settlement_mode = post_on_close`) والمعاينة، ويُعاد استعماله
 * في الإغلاق مع P1-3b. الرموز ثابتة وغير مالية (تُعرض لمن يملك `fuel.shift.close` وحده بلا أي قيمة).
 */
class FuelShiftSettlementReadiness
{
    public const MODE_NONE = 'none';
    public const MODE_POST_ON_CLOSE = 'post_on_close';
    public const MODES = [self::MODE_NONE, self::MODE_POST_ON_CLOSE];

    public const OPEN_SHIFT_INDEX = 'fuel_shifts_one_open_per_station';

    public function __construct(
        private FuelStationSettingsService $settings,
        private FuelShiftCashExpectationService $expectation,
        private FuelStationPaymentMethods $methods,
    ) {}

    /** بوابة النشر: العلم مفتوح **و** مرجع الرأي الضريبي غير فارغ. أحدهما ناقص ⇒ مغلقة (404 على المسارات). */
    public static function enabled(): bool
    {
        return (bool) config('fuel_stations.shift_settlement_enabled', false)
            && trim((string) config('fuel_stations.shift_settlement_tax_opinion_ref', '')) !== '';
    }

    /** السياسة الفعّالة للمحطة: القيمة المخزَّنة إن كانت صالحة وإلا `none` (فشل مغلق). */
    public function mode(FuelStation $station): string
    {
        $stored = $this->settings->forStation($station)['shift_settlement_mode'] ?? self::MODE_NONE;

        return is_string($stored) && in_array($stored, self::MODES, true) ? $stored : self::MODE_NONE;
    }

    /**
     * العميل النقدي المعيَّن للمحطة (طرف نشط موسوم) أو null.
     */
    public function walkInPartner(FuelStation $station): ?Partner
    {
        $link = FuelStationWalkInPartner::query()->where('fuel_station_id', $station->id)->first();
        if ($link === null) {
            return null;
        }

        return Partner::query()->withoutGlobalScopes()
            ->where('tenant_id', $station->tenant_id)
            ->where('id', $link->partner_id)
            ->where('system_kind', 'fuel_walk_in')
            ->first();
    }

    /**
     * شروط مستوى المحطة (لا تعتمد على وردية بعينها). الفارغة = جاهزة.
     * `$includePolicy = false` عند التحقق وقت ضبط السياسة نفسها (فلا تمنع نفسَها).
     *
     * @return list<string>
     */
    public function stationBlockers(FuelStation $station, bool $includePolicy = true): array
    {
        $blockers = [];

        if (! (bool) config('fuel_stations.shift_settlement_enabled', false)) {
            $blockers[] = 'FUEL_SETTLEMENT_NOT_READY_DEPLOYMENT_GATE_CLOSED';
        } elseif (! self::enabled()) {
            $blockers[] = 'FUEL_SETTLEMENT_NOT_READY_TAX_OPINION_MISSING';
        }
        if (! (bool) config('fuel_stations.shift_collection_declaration_enabled', false)) {
            $blockers[] = 'FUEL_SETTLEMENT_NOT_READY_DECLARATION_GATE_CLOSED';
        }
        if (! (bool) config('fuel_stations.shift_cash_receipts_enabled', false)) {
            $blockers[] = 'FUEL_SETTLEMENT_NOT_READY_RECEIPT_STAMPING_GATE_CLOSED';
        }
        if ($this->expectation->effectiveBasis($station) !== FuelShiftCashExpectationService::BASIS_DECLARED_COLLECTION) {
            $blockers[] = 'FUEL_SETTLEMENT_NOT_READY_CASH_BASIS_NOT_DECLARED';
        }

        $partner = $this->walkInPartner($station);
        if ($partner === null) {
            $blockers[] = 'FUEL_SETTLEMENT_WALK_IN_REQUIRED';
        } elseif (! $partner->is_active) {
            $blockers[] = 'FUEL_SETTLEMENT_WALK_IN_INACTIVE';
        }

        $allowedIds = $this->settings->forStation($station)['fuel_sales_allowed_payment_method_ids'] ?? [];
        $allowed = $this->methods->allowedFor($station);
        if (! is_array($allowedIds) || $allowedIds === [] || $allowed->isEmpty()) {
            $blockers[] = 'FUEL_SETTLEMENT_NOT_READY_NO_PAYMENT_METHODS';
        } else {
            $unlinked = $allowed->contains(fn ($method) => $method->cash_bank_account_id === null || ! (bool) $method->cashBankAccount?->is_active);
            if ($unlinked || $allowed->count() !== count($allowedIds)) {
                $blockers[] = 'FUEL_SETTLEMENT_NOT_READY_PAYMENT_METHOD_TREASURY';
            }
        }

        if (($this->settings->forStation($station)['fuel_price_tax_mode'] ?? '') === '') {
            $blockers[] = 'FUEL_SETTLEMENT_NOT_READY_TAX_MODE_UNSET';
        }

        if (! $this->openShiftIndexExists()) {
            $blockers[] = 'FUEL_SETTLEMENT_NOT_READY_OPEN_SHIFT_INDEX_MISSING';
        }

        foreach ($this->poolsOf($station) as [$product]) {
            if (! $this->costStateReady($station, $product)) {
                $blockers[] = 'FUEL_SETTLEMENT_NOT_READY_COST_STATE:'.$product->id;
            }
        }

        if ($includePolicy && $this->mode($station) !== self::MODE_POST_ON_CLOSE) {
            $blockers[] = 'FUEL_SETTLEMENT_NOT_READY_POLICY_NONE';
        }

        return array_values(array_unique($blockers));
    }

    /** حالة التكلفة جاهزة لمجمّع المنتج: موجودة، أو غائبة والرصيد الدفتري صفر (تُنشأ عند أول عملية). رصيد بلا baseline ⇒ غير جاهزة. */
    public function costStateReady(FuelStation $station, FuelProduct $product): bool
    {
        $exists = FuelInventoryCostState::query()
            ->where('warehouse_id', $station->warehouse_id)
            ->where('fuel_product_id', $product->id)
            ->exists();
        if ($exists) {
            return true;
        }

        return (int) (ProductWarehouseStock::query()
            ->where('warehouse_id', $station->warehouse_id)
            ->where('product_id', $product->product_id)
            ->value('quantity') ?? 0) <= 0;
    }

    /** @return list<array{0:FuelProduct}> منتجات الوقود التي تغذّيها خزانات المحطة (مجمّعات المخزن × المنتج). */
    private function poolsOf(FuelStation $station): array
    {
        $ids = \App\Models\FuelTank::query()->where('fuel_station_id', $station->id)->distinct()->pluck('fuel_product_id');

        return FuelProduct::query()->whereIn('id', $ids)->get()->map(fn ($product) => [$product])->all();
    }

    public function openShiftIndexExists(): bool
    {
        foreach (Schema::getIndexes('fuel_shifts') as $index) {
            if (($index['name'] ?? null) === self::OPEN_SHIFT_INDEX && ($index['unique'] ?? false)) {
                return true;
            }
        }

        return false;
    }
}
