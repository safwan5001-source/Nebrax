<?php

namespace App\Services\Commerce;

use App\Models\CommerceDeliverySlot;
use App\Models\Product;
use Carbon\CarbonInterface;

/**
 * FLOWERS-H8 / ADR-20 — وعد التسليم المشتق لكل منتج: **مشتقٌّ لا مخزَّن** من المصادر الحاكمة وقت الطلب، فيتغيّر
 * «التسليم اليوم» تلقائياً بتغيّر أي منها (مخزون، مهلة، إغلاق يومي، تواريخ محجوبة، سعة). لا نسخ لـATS ولا لقواعد
 * الجدولة؛ هذه الخدمة تركّبهما فقط:
 *
 *   منشور (يضمنه المستدعي) ∧ مخزن تنفيذ صالح ∧ ATS > 0 (`AvailableToSellService::forWarehouseMany`)
 *   ∧ نافذة تنطبق على الوجهة بعد المهلة والإغلاق والحجب والسعة (`CommerceDeliveryScheduleService::evaluate`)
 *
 * عدد الاستعلامات ثابت لا يتبع عدد المنتجات: سياق الجدولة يُحمَّل مرة، ATS باستعلامين، المُهَل باستعلام، والتقييم
 * بالذاكرة (مُخزَّنٌ لكل مهلة متمايزة). التوصيل فقط في V1 (الاستلام خارج النطاق).
 */
final class CommerceDeliveryPromiseService
{
    public const REASON_NOT_CONFIGURED = 'not_configured';

    public const REASON_OUT_OF_STOCK = 'out_of_stock';

    public const REASON_NO_SLOT = 'no_slot';

    public function __construct(
        private readonly AvailableToSellService $availability,
        private readonly CommerceDeliveryScheduleService $schedule,
        private readonly ProductPreparationService $preparation,
        private readonly FulfillmentPolicyService $fulfillment,
    ) {}

    /**
     * @param  iterable<Product>  $products  منتجات منشورة على القناة حمّلها المستدعي بنطاق المستأجر
     * @return array<string, array<string, mixed>>|null `productId => promise`؛ null حين الجدولة معطَّلة (فلا مفتاح وعد)
     */
    public function forProducts(string $salesChannelId, iterable $products, ?string $city = null, ?string $region = null, ?CarbonInterface $now = null): ?array
    {
        $context = $this->schedule->context($salesChannelId, CommerceDeliverySlot::METHOD_DELIVERY, $city, $region, $now);
        if ($context === null) {
            return null;
        }

        $list = [];
        foreach ($products as $product) {
            $list[$product->id] = $product;
        }
        if ($list === []) {
            return [];
        }

        $stock = null;
        try {
            $warehouse = $this->fulfillment->resolveWarehouseFor($salesChannelId);
            $stock = $this->availability->forWarehouseMany(array_keys($list), $warehouse->id);
        } catch (FulfillmentPolicyNotConfiguredException) {
            $stock = null;
        }

        $prep = $this->preparation->minutesMany(array_keys($list));
        $today = $context['local']->format('Y-m-d');
        $byLead = [];
        $promises = [];

        foreach ($list as $id => $product) {
            if ($stock === null) {
                $promises[$id] = $this->none(self::REASON_NOT_CONFIGURED);

                continue;
            }
            if (! $this->inStock($product, $stock[$id] ?? [])) {
                $promises[$id] = $this->none(self::REASON_OUT_OF_STOCK);

                continue;
            }

            $lead = $prep[$id] ?? 0;
            $byLead[$lead] ??= $this->earliest($context, $lead);
            $earliest = $byLead[$lead];

            $promises[$id] = $earliest === null
                ? $this->none(self::REASON_NO_SLOT)
                : ['deliverable' => true, 'same_day' => $earliest['date'] === $today, 'earliest' => $earliest, 'reason' => null];
        }

        return $promises;
    }

    /** @param  array<string, int>  $variants `variantKey => ats` */
    private function inStock(Product $product, array $variants): bool
    {
        if ($product->isVariantManaged()) {
            foreach ($variants as $key => $quantity) {
                if ($key !== '' && $quantity > 0) {
                    return true;
                }
            }

            return false;
        }

        return ($variants[''] ?? 0) > 0;
    }

    /** @return array{date: string, slot: array<string, mixed>}|null */
    private function earliest(array $context, int $leadMinutes): ?array
    {
        $result = $this->schedule->evaluate($context, $leadMinutes > 0 ? $leadMinutes : null, true);
        if ($result['earliest'] === null) {
            return null;
        }

        foreach ($result['dates'] as $day) {
            if ($day['date'] !== $result['earliest']['date']) {
                continue;
            }
            foreach ($day['slots'] as $slot) {
                if ($slot['id'] === $result['earliest']['slot_id']) {
                    return ['date' => $day['date'], 'slot' => $slot];
                }
            }
        }

        return null;
    }

    /** @return array{deliverable: false, same_day: false, earliest: null, reason: string} */
    private function none(string $reason): array
    {
        return ['deliverable' => false, 'same_day' => false, 'earliest' => null, 'reason' => $reason];
    }
}
