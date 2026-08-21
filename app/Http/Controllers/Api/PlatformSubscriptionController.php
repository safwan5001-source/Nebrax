<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\PlatformPriceVersionStoreRequest;
use App\Http\Requests\PlatformSubscriptionLifecycleActionRequest;
use App\Http\Requests\PlatformSubscriptionStoreRequest;
use App\Http\Requests\PlatformSubscriptionTransitionRequest;
use App\Models\PlatformAdministrator;
use App\Models\PlatformPriceVersion;
use App\Models\PlatformSubscription;
use App\Models\PlatformSubscriptionEvent;
use App\Models\Tenant;
use App\Support\Money;
use App\Support\PlatformSubscriptionLifecycle;
use Illuminate\Http\JsonResponse;

/**
 * إدارة دورة العقد التجارية من مساحة منصة Nebrax المحكومة فقط.
 *
 * لا يستدعي SetTenant ولا يعدل خطة/وصول مستأجر ولا ينشئ فاتورة أو تحصيلاً.
 */
class PlatformSubscriptionController extends ApiController
{
    public function prices(): JsonResponse
    {
        return response()->json([
            'data' => PlatformPriceVersion::query()
                ->orderBy('plan')
                ->orderByDesc('effective_on')
                ->get()
                ->map(fn (PlatformPriceVersion $price) => $this->pricePayload($price))
                ->all(),
        ]);
    }

    public function storePrice(PlatformPriceVersionStoreRequest $request, PlatformSubscriptionLifecycle $lifecycle): JsonResponse
    {
        /** @var PlatformAdministrator $administrator */
        $administrator = $request->user();
        $validated = $request->validated();
        $price = $this->domain(fn () => $lifecycle->createPriceVersion(
            $administrator,
            $validated['plan'],
            $validated['currency'],
            $validated['monthly_amount'],
            new \DateTimeImmutable($validated['effective_on']),
        ));

        return response()->json(['data' => $this->pricePayload($price)], 201);
    }

    public function store(PlatformSubscriptionStoreRequest $request, string $tenant, PlatformSubscriptionLifecycle $lifecycle): JsonResponse
    {
        /** @var PlatformAdministrator $administrator */
        $administrator = $request->user();
        $validated = $request->validated();
        $contract = $this->domain(fn () => $lifecycle->createContract(
            Tenant::findOrFail($tenant),
            $administrator,
            $validated['plan'],
            $validated['currency'],
            new \DateTimeImmutable($validated['starts_on']),
            isset($validated['ends_on']) ? new \DateTimeImmutable($validated['ends_on']) : null,
            $validated['external_reference'] ?? null,
            $validated['reason'] ?? null,
            $validated['status'] ?? PlatformSubscription::STATUS_ACTIVE,
        ));

        return response()->json(['data' => $this->subscriptionPayload($contract)], 201);
    }

    public function transition(PlatformSubscriptionTransitionRequest $request, string $subscription, PlatformSubscriptionLifecycle $lifecycle): JsonResponse
    {
        /** @var PlatformAdministrator $administrator */
        $administrator = $request->user();
        $validated = $request->validated();
        $contract = $this->domain(fn () => $lifecycle->transition(
            PlatformSubscription::findOrFail($subscription),
            $administrator,
            $validated['plan'],
            $validated['currency'],
            new \DateTimeImmutable($validated['effective_on']),
            $validated['reason'] ?? null,
            $validated['external_reference'] ?? null,
        ));

        return response()->json(['data' => $this->subscriptionPayload($contract)]);
    }

    public function cancel(PlatformSubscriptionLifecycleActionRequest $request, string $subscription, PlatformSubscriptionLifecycle $lifecycle): JsonResponse
    {
        /** @var PlatformAdministrator $administrator */
        $administrator = $request->user();
        $validated = $request->validated();
        $contract = $this->domain(fn () => $lifecycle->cancel(
            PlatformSubscription::findOrFail($subscription),
            $administrator,
            new \DateTimeImmutable($validated['effective_on']),
            $validated['reason'] ?? null,
        ));

        return response()->json(['data' => $this->subscriptionPayload($contract)]);
    }

    public function expire(PlatformSubscriptionLifecycleActionRequest $request, string $subscription, PlatformSubscriptionLifecycle $lifecycle): JsonResponse
    {
        /** @var PlatformAdministrator $administrator */
        $administrator = $request->user();
        $validated = $request->validated();
        $contract = $this->domain(fn () => $lifecycle->expire(
            PlatformSubscription::findOrFail($subscription),
            $administrator,
            new \DateTimeImmutable($validated['effective_on']),
            $validated['reason'] ?? null,
        ));

        return response()->json(['data' => $this->subscriptionPayload($contract)]);
    }

    public function events(string $subscription): JsonResponse
    {
        $contract = PlatformSubscription::findOrFail($subscription);
        $events = $contract->events()
            ->get()
            ->map(fn (PlatformSubscriptionEvent $event) => [
                'id'                        => $event->id,
                'action'                    => $event->action,
                'from_plan'                 => $event->from_plan,
                'to_plan'                   => $event->to_plan,
                'from_monthly_amount_minor' => $event->from_monthly_amount,
                'to_monthly_amount_minor'   => $event->to_monthly_amount,
                'effective_on'              => $event->effective_on?->toDateString(),
                'reason'                    => $event->reason,
                'created_at'                => $event->created_at?->toIso8601String(),
            ])
            ->all();

        return response()->json(['data' => $events]);
    }

    /** @return array<string, mixed> */
    private function pricePayload(PlatformPriceVersion $price): array
    {
        return [
            'id'                   => $price->id,
            'plan'                 => $price->plan,
            'currency'             => $price->currency,
            'monthly_amount_minor' => $price->monthly_amount,
            'monthly_amount'       => Money::toRiyal($price->monthly_amount),
            'effective_on'         => $price->effective_on?->toDateString(),
            'created_at'           => $price->created_at?->toIso8601String(),
        ];
    }

    /** @return array<string, mixed> */
    private function subscriptionPayload(PlatformSubscription $subscription): array
    {
        $subscription->loadMissing('priceVersion');

        return [
            'id'                   => $subscription->id,
            'tenant_id'            => $subscription->tenant_id,
            'plan'                 => $subscription->plan,
            'status'               => $subscription->status,
            'currency'             => $subscription->currency,
            'monthly_amount_minor' => $subscription->monthly_amount,
            'monthly_amount'       => Money::toRiyal($subscription->monthly_amount),
            'starts_on'            => $subscription->starts_on?->toDateString(),
            'ends_on'              => $subscription->ends_on?->toDateString(),
            'external_reference'   => $subscription->external_reference,
            'price_version'        => $subscription->priceVersion ? $this->pricePayload($subscription->priceVersion) : null,
        ];
    }
}
