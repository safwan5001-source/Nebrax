<?php

namespace App\Services;

use App\Models\FuelSale;
use App\Models\FuelSalePaymentReceipt;
use App\Models\FuelShift;
use App\Models\FuelShiftCashMovement;
use App\Models\FuelShiftCashVariance;
use App\Models\FuelShiftEvent;
use App\Models\FuelStation;
use App\Models\Payment;
use App\Models\User;

/**
 * #2021 (D1/D2/D5) — الحساب الوحيد لـ«النقد المتوقع» في وردية الوقود.
 *
 * يستعمله ثلاثة مواضع فقط: حارس السحب/التسليم في `recordCashMovement`، لقطة `close`، ومورد `show`. ممنوع حساب ثانٍ في
 * متحكم أو واجهة. لا يكتب شيئاً ولا يأخذ أقفالاً (المستدعي يملك قفل الوردية عند الحاجة لاتساق القرار).
 *
 *   E = O + R + I − U − X          (R يدخل فقط تحت الأساس receiving_shift_receipts)
 *
 * R = إيصالات نقد مختومة بهذه الوردية وسندها `posted` — لا مصدر آخر، فلا احتساب مزدوج (سند واحد = إيصال واحد).
 * الشبكة N تُعرض للعلم ولا تدخل E أبداً. المتوقع لا يُعاد إجماليًا إلا إذا اكتملت مكوّناته.
 */
class FuelShiftCashExpectationService
{
    public const BASIS_MOVEMENTS_ONLY = 'movements_only';
    public const BASIS_RECEIVING_SHIFT = 'receiving_shift_receipts';

    public const GAP_SALES_CASH_NOT_INCLUDED = 'sales_cash_not_included';
    public const GAP_PERMISSION_SALES_VIEW = 'permission_sales_view';
    public const GAP_UNATTRIBUTED = 'unattributed_cash_receipts';
    public const GAP_MULTIPLE_CASH_ACCOUNTS = 'multiple_cash_accounts';
    public const GAP_LEGACY_SNAPSHOT = 'legacy_closed_snapshot';

    public function __construct(private FuelStationSettingsService $settings) {}

    /** الأساس الفعّال: البوابة المغلقة تفرض movements_only مهما خُزِّن. */
    public function effectiveBasis(FuelStation $station): string
    {
        if (! (bool) config('fuel_stations.shift_cash_receipts_enabled', false)) {
            return self::BASIS_MOVEMENTS_ONLY;
        }

        return ($this->settings->forStation($station)['shift_expected_cash_basis'] ?? null) === self::BASIS_RECEIVING_SHIFT
            ? self::BASIS_RECEIVING_SHIFT
            : self::BASIS_MOVEMENTS_ONLY;
    }

    /**
     * الحساب الحيّ (حقيقة الخادم، بلا اعتبار لصلاحيات العارض). أرقامه هي ما تحرسه القواعد وما يُجمَّد عند الإغلاق.
     *
     * @return array{basis:string,opening:int,receipts:int,receipts_count:int,cash_in:int,cash_out:int,handover:int,expenses:int,expected:int,network:int,network_count:int,unattributed_count:int,unattributed_amount:int,cash_accounts:int,gaps:array<int,string>,complete:bool}
     */
    public function live(FuelShift $shift, string $basis): array
    {
        $movements = fn (string $type) => FuelShiftCashMovement::where('fuel_shift_id', $shift->id)->where('type', $type);
        $in = (int) $movements(FuelShiftCashMovement::TYPE_CASH_IN)->sum('amount_minor');
        $out = (int) $movements(FuelShiftCashMovement::TYPE_CASH_OUT)->sum('amount_minor');
        $expenses = (int) $movements(FuelShiftCashMovement::TYPE_EXPENSE)->sum('amount_minor');
        $handover = (int) $movements(FuelShiftCashMovement::TYPE_CASH_OUT)
            ->where('purpose', FuelShiftCashMovement::PURPOSE_TREASURY_HANDOVER)->sum('amount_minor');

        $cashReceipts = $this->stampedReceipts($shift, 'cash');
        $receipts = (int) (clone $cashReceipts)->sum('amount_minor');
        $receiptsCount = (clone $cashReceipts)->count();
        $cashAccounts = (clone $cashReceipts)->whereNotNull('cash_account_id')->distinct()->count('cash_account_id');
        $bank = $this->stampedReceipts($shift, 'bank');
        $network = (int) (clone $bank)->sum('amount_minor');
        $networkCount = (clone $bank)->count();
        [$unCount, $unAmount] = $this->unattributedCash($shift);

        $opening = (int) $shift->opening_float_minor;
        $counted = $basis === self::BASIS_RECEIVING_SHIFT ? $receipts : 0;
        $gaps = [];
        if ($basis === self::BASIS_MOVEMENTS_ONLY) {
            $gaps[] = self::GAP_SALES_CASH_NOT_INCLUDED;
        } else {
            if ($unCount > 0) {
                $gaps[] = self::GAP_UNATTRIBUTED;
            }
            if ($cashAccounts > 1) {
                $gaps[] = self::GAP_MULTIPLE_CASH_ACCOUNTS;
            }
        }

        return [
            'basis' => $basis,
            'opening' => $opening,
            'receipts' => $receipts,
            'receipts_count' => $receiptsCount,
            'cash_in' => $in,
            'cash_out' => $out,
            'handover' => $handover,
            'expenses' => $expenses,
            'expected' => $opening + $counted + $in - $out - $expenses,
            'network' => $network,
            'network_count' => $networkCount,
            'unattributed_count' => $unCount,
            'unattributed_amount' => $unAmount,
            'cash_accounts' => $cashAccounts,
            'gaps' => $gaps,
            'complete' => $gaps === [],
        ];
    }

    /**
     * الملخص المعروض للبائع/المشرف. وردية مفتوحة = حيّ؛ مغلقة/معتمدة = اللقطة المجمّدة فقط (D2).
     *
     * @return array<string,mixed>
     */
    public function summary(FuelShift $shift, User $viewer): array
    {
        $salesVisible = $viewer->hasPermission('fuel.sale.view');
        $variance = $shift->isOpen() ? null : FuelShiftCashVariance::where('fuel_shift_id', $shift->id)->first();

        if ($variance === null) {
            $station = FuelStation::findOrFail($shift->fuel_station_id);
            $live = $this->live($shift, $this->effectiveBasis($station));

            return $this->shape(
                state: 'live', basis: $live['basis'],
                opening: $live['opening'], cashIn: $live['cash_in'], cashOut: $live['cash_out'], handover: $live['handover'], expenses: $live['expenses'],
                receipts: $live['receipts'], receiptsCount: $live['receipts_count'], receiptsKnown: $live['basis'] === self::BASIS_RECEIVING_SHIFT,
                network: $live['network'], networkKnown: $live['basis'] === self::BASIS_RECEIVING_SHIFT, gaps: $live['gaps'], salesVisible: $salesVisible,
                counted: null, variance: null, unattributed: [$live['unattributed_count'], $live['unattributed_amount']],
                shift: $shift,
            );
        }

        $frozen = $variance->official_cash_basis !== null;
        $gaps = $frozen ? (array) ($variance->incompleteness ?? []) : [self::GAP_LEGACY_SNAPSHOT, self::GAP_SALES_CASH_NOT_INCLUDED];

        return $this->shape(
            state: $frozen ? 'frozen' : 'legacy_frozen',
            basis: $frozen ? (string) $variance->official_cash_basis : self::BASIS_MOVEMENTS_ONLY,
            opening: (int) $variance->opening_float_minor, cashIn: (int) $variance->documented_cash_in_minor,
            cashOut: (int) $variance->documented_cash_out_minor,
            handover: (int) ($variance->documented_treasury_handover_minor ?? 0),
            expenses: (int) $variance->documented_expenses_minor,
            receipts: (int) ($variance->documented_official_cash_receipts_minor ?? 0), receiptsCount: null,
            receiptsKnown: $frozen && $variance->official_cash_basis === self::BASIS_RECEIVING_SHIFT,
            network: (int) ($variance->registered_network_receipts_minor ?? 0), networkKnown: $variance->registered_network_receipts_minor !== null,
            gaps: $gaps, salesVisible: $salesVisible,
            counted: (int) $variance->counted_cash_minor, variance: (int) $variance->variance_minor, unattributed: [0, 0],
            shift: $shift,
        );
    }

    /** إيصالات الوردية المختومة بنوع تسوية (cash|bank) وسندها مرحَّل غير معكوس. */
    private function stampedReceipts(FuelShift $shift, string $type)
    {
        return FuelSalePaymentReceipt::where('fuel_shift_id', $shift->id)
            ->where('settlement_type', $type)
            ->whereIn('payment_id', Payment::query()->select('id')->where('status', 'posted'));
    }

    /**
     * إيصالات نقد سابقة للتفعيل (بلا ختم) ضمن نافذة هذه الوردية على المحطة نفسها: لا تُنسب تلقائياً (D1) بل تجعل المتوقع غير مكتمل.
     *
     * @return array{0:int,1:int}
     */
    private function unattributedCash(FuelShift $shift): array
    {
        if ($shift->opened_at === null) {
            return [0, 0];
        }
        $paymentIds = FuelSalePaymentReceipt::whereNull('fuel_shift_id')
            ->where('recorded_at', '>=', $shift->opened_at)
            ->when($shift->closed_at !== null, fn ($q) => $q->where('recorded_at', '<=', $shift->closed_at))
            ->whereIn('fuel_sale_id', FuelSale::query()->select('id')->where('fuel_station_id', $shift->fuel_station_id))
            ->pluck('payment_id');
        if ($paymentIds->isEmpty()) {
            return [0, 0];
        }
        $payments = Payment::whereIn('id', $paymentIds)->where('status', 'posted')->where('method', 'cash');

        return [(clone $payments)->count(), (int) $payments->sum('amount')];
    }

    /**
     * @param array<int,string> $gaps
     * @param array{0:int,1:int} $unattributed
     * @return array<string,mixed>
     */
    private function shape(
        string $state, string $basis, int $opening, int $cashIn, int $cashOut, int $handover, int $expenses,
        int $receipts, ?int $receiptsCount, bool $receiptsKnown, int $network, bool $networkKnown,
        array $gaps, bool $salesVisible, ?int $counted, ?int $variance, array $unattributed, FuelShift $shift,
    ): array {
        $receiptsAvailable = $receiptsKnown && $salesVisible;
        $visibleGaps = $gaps;
        if ($receiptsKnown && ! $salesVisible) {
            $visibleGaps[] = self::GAP_PERMISSION_SALES_VIEW;
        }
        // المجموع الجزئي المعروض يُبنى من المكوّنات المسموح للعارض برؤيتها فقط: وإلا كشف طرحُ المكوّنات الظاهرة منه
        // مبلغ نقد المبيعات المحجوب. الحساب الداخلي (live()['expected']) لا يتأثر.
        $partial = $opening + ($receiptsAvailable ? $receipts : 0) + $cashIn - $cashOut - $expenses;
        $complete = $visibleGaps === [];
        $reason = static fn (bool $known, bool $visible, string $state): ?string => $known && $visible ? null
            : (! $visible && $known ? 'permission' : ($state === 'legacy_frozen' ? 'not_recorded_legacy' : 'basis_not_enabled'));

        return [
            'state' => $state,
            'basis' => $basis,
            'components' => [
                'opening_float_minor' => $opening,
                'official_cash_receipts' => [
                    'available' => $receiptsAvailable,
                    'amount_minor' => $receiptsAvailable ? $receipts : null,
                    'count' => $receiptsAvailable ? $receiptsCount : null,
                    'reason' => $reason($receiptsKnown, $salesVisible, $state),
                ],
                'cash_in_minor' => $cashIn,
                'cash_out_minor' => $cashOut,
                'treasury_handover_minor' => $handover,
                'expenses_minor' => $expenses,
            ],
            'expected_cash_minor' => $complete ? $partial : null,
            'expected_cash_partial_minor' => $partial,
            'expected_complete' => $complete,
            'incompleteness' => array_values(array_unique($visibleGaps)),
            'counted_cash_minor' => $counted,
            'variance_minor' => $variance,
            'variance_final' => $complete && $counted !== null,
            'network_receipts' => [
                'available' => $networkKnown && $salesVisible,
                'amount_minor' => $networkKnown && $salesVisible ? $network : null,
                'reason' => ! $networkKnown ? ($state === 'legacy_frozen' ? 'not_recorded_legacy' : 'basis_not_enabled') : (! $salesVisible ? 'permission' : null),
                'information_only' => true,
            ],
            'unattributed_cash_receipts' => $salesVisible && $state === 'live'
                ? ['count' => $unattributed[0], 'amount_minor' => $unattributed[1]]
                : null,
            'post_close_adjustments' => $this->postCloseAdjustments($shift, $salesVisible),
        ];
    }

    /** @return array{available:bool,items:array<int,array<string,mixed>>,net_effect_minor:?int} */
    private function postCloseAdjustments(FuelShift $shift, bool $salesVisible): array
    {
        if ($shift->isOpen()) {
            return ['available' => true, 'items' => [], 'net_effect_minor' => 0];
        }
        if (! $salesVisible) {
            return ['available' => false, 'items' => [], 'net_effect_minor' => null];
        }
        $items = FuelShiftEvent::where('fuel_shift_id', $shift->id)
            ->where('type', FuelShiftEvent::TYPE_POST_CLOSE_CASH_ADJUSTMENT)
            ->orderBy('occurred_at')->orderBy('id')->get()
            ->map(fn (FuelShiftEvent $e) => [
                'payment_id' => $e->payload['payment_id'] ?? null,
                'receipt_id' => $e->payload['receipt_id'] ?? null,
                'amount_minor' => (int) ($e->payload['amount_minor'] ?? 0),
                'kind' => $e->payload['kind'] ?? 'payment_reversed',
                'occurred_at' => $e->occurred_at?->toISOString(),
            ])->values()->all();

        return [
            'available' => true,
            'items' => $items,
            // عكس سند نقدي يُنقص نقد الدرج المتوقع؛ يُعرض إرشادياً ولا يغيّر الفرق المجمَّد.
            'net_effect_minor' => -1 * array_sum(array_column($items, 'amount_minor')),
        ];
    }
}
