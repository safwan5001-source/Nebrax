<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\DeliveryChannelReportRequest;
use App\Services\Reporting\DeliveryChannelReportService;
use App\Support\Money;
use Illuminate\Http\JsonResponse;

/** تقرير مبيعات قنوات التوصيل: قراءة فقط، والريال على حافة العرض وحدها. */
class DeliveryChannelReportController extends ApiController
{
    /** @var list<string> */
    private const MONEY_KEYS = [
        'amount',
        'gross_sales',
        'discounts',
        'shipping',
        'adjustment',
        'net_sales',
        'vat',
        'total',
        'subtotal',
        'tax',
        'platform_collected_total',
        'merchant_collected_total',
        'unclassified_total',
        'returns_subtotal',
        'returns_vat',
        'returns_total',
        'net_after_pos_returns',
    ];

    public function __construct(protected DeliveryChannelReportService $reports) {}

    public function show(DeliveryChannelReportRequest $request): JsonResponse
    {
        $result = $this->domain(fn () => $this->reports->report($request->validated()));

        return response()->json($this->present($result));
    }

    /**
     * @param  array<string,mixed>  $row
     * @return array<string,mixed>
     */
    private function present(array $row): array
    {
        $out = [];
        foreach ($row as $key => $value) {
            if (is_array($value)) {
                $out[$key] = array_is_list($value)
                    ? array_map(fn ($item) => is_array($item) ? $this->present($item) : $item, $value)
                    : $this->present($value);
                continue;
            }
            if (is_int($value) && in_array((string) $key, self::MONEY_KEYS, true)) {
                $out[$key] = Money::toRiyal($value);
                continue;
            }
            $out[$key] = $value;
        }

        return $out;
    }
}
