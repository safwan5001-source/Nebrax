<?php

namespace App\Services\Commerce;

use App\Support\CommerceChannelIntake;
use Carbon\CarbonImmutable;

/**
 * لقطة استقبال لإتمام جارٍ (COPS-H4-4): تُنشئها `CommerceChannelIntakeGuard::forCompletion()` بعد قفل القناة، وتُقيِّم بـ`CommerceChannelIntake` النقي. الرفض دائماً
 * `CheckoutReviewRequiredException` قبل أي كتابة.
 */
final class CommerceIntakeCheck
{
    /** @param  array<string, mixed>  $snapshot */
    public function __construct(
        private readonly array $snapshot,
        private readonly CarbonImmutable $now,
        private readonly string $timezone,
    ) {}

    /** @throws CheckoutReviewRequiredException المتجر موقوف أو خارج ساعات العمل مع سياسة `block` */
    public function assertAcceptingOrders(): void
    {
        $state = CommerceChannelIntake::state($this->snapshot, $this->now, $this->timezone);
        if ($state['accepting']) {
            return;
        }
        $reason = $state['reason'] === CommerceChannelIntake::REASON_PAUSED ? CommerceChannelIntake::REVIEW_PAUSED : CommerceChannelIntake::REVIEW_OUTSIDE_HOURS;

        throw new CheckoutReviewRequiredException(
            CommerceChannelIntake::reviewMessage($reason, $state['message']),
            [['item_id' => 'store', 'reason' => $reason]],
        );
    }

    /** @throws CheckoutReviewRequiredException مجموع السطور (بعد الخصم وقبل الشحن) دون الحد الأدنى */
    public function assertMinimumOrder(int $linesTotalMinor, ?string $deliveryMethod): void
    {
        $shortfall = CommerceChannelIntake::minimumShortfall($this->snapshot, $linesTotalMinor, $deliveryMethod);
        if ($shortfall === null) {
            return;
        }

        throw new CheckoutReviewRequiredException(
            CommerceChannelIntake::reviewMessage(CommerceChannelIntake::REVIEW_BELOW_MINIMUM),
            [[
                'item_id' => 'store',
                'reason' => CommerceChannelIntake::REVIEW_BELOW_MINIMUM,
                'min_order_minor' => (int) $this->snapshot['min_order_minor'],
                'shortfall_minor' => $shortfall,
            ]],
        );
    }
}
