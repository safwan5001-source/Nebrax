<?php

namespace App\Http\Controllers\Api;

use App\Models\PaymentMethod;
use App\Models\PaymentMethodChannelAvailability;
use App\Models\SalesChannel;
use App\Models\SalesChannelSettingEvent;
use App\Services\PaymentMethodChannelAvailabilityService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * COPS-H4-6 (D-H4-06، معتمد 2026-11-04) — إتاحة طريقة دفع لكل قناة Commerce من شاشة الوسيلة القائمة (`/payment-methods`).
 *
 * يغلّف `PaymentMethodChannelAvailabilityService` (المصدر الوحيد لـ«هل تُعرض الوسيلة لهذه القناة»: Checkout المتجر وجاهزية وسائل الدفع الإلكتروني يقرآنه) **دون أي منطق موازٍ**.
 *  • **الصلاحيتان معاً:** قراءة = `payments.view` + `commerce.channel_settings.manage`؛ كتابة = `payments.manage` + `commerce.channel_settings.manage` (+ قدرة `commerce.storefront`) — تغيير ما يدفع به المشتري
 *    يمسّ المالية والقناة (نمط D-9-R1). لا صلاحية جديدة. owner/admin عبر `*`.
 *  • **الافتراضي = `available_online`** (غياب التجاوز = السلوك التاريخي)؛ `is_enabled: null` يزيل التجاوز فيعود الافتراضي. POS خارج النطاق (يحكمه `PosSettings`).
 *  • قفل صف القناة `FOR UPDATE` أولاً (بروتوكول ADR-19 §2.3) ثم الكتابة؛ تدقيق في `sales_channel_setting_events` بمفتاح `payment_methods.<id>.channel_availability` (من/إلى؛ null = الافتراضي)
 *    لتغيير فعلي فقط. 404 موحَّد لطريقة/قناة مستأجر آخر (TenantScope). لا أثر محاسبي ولا مخزني ولا مساس بالدفعات القائمة.
 */
class PaymentMethodChannelAvailabilityController extends ApiController
{
    public function index(string $id, PaymentMethodChannelAvailabilityService $availability): JsonResponse
    {
        $method = PaymentMethod::query()->findOrFail($id);
        $overrides = PaymentMethodChannelAvailability::query()->where('payment_method_id', $method->id)->get()->keyBy('sales_channel_id');

        $channels = SalesChannel::query()
            ->where('type', '!=', SalesChannel::TYPE_POS)
            ->orderBy('name')->orderBy('id')
            ->get()
            ->map(fn (SalesChannel $channel): array => $this->row($method, $channel, $overrides[$channel->id]->is_enabled ?? null, $availability))
            ->all();

        return response()->json(['data' => [
            'payment_method' => ['id' => $method->id, 'name' => $method->name, 'is_active' => (bool) $method->is_active, 'available_online' => (bool) $method->available_online],
            'channels' => $channels,
        ]]);
    }

    public function update(Request $request, string $id, string $channelId, PaymentMethodChannelAvailabilityService $availability): JsonResponse
    {
        $data = $request->validate([
            'tenant_id' => ['prohibited'],
            'is_enabled' => ['present', 'nullable', 'boolean'],
        ]);
        $enabled = $data['is_enabled'] === null ? null : filter_var($data['is_enabled'], FILTER_VALIDATE_BOOLEAN);

        $result = DB::transaction(function () use ($request, $id, $channelId, $enabled, $availability): array|JsonResponse {
            // قفل القناة أولاً (ADR-19 §2.3) ثم الوسيلة؛ كلاهما بنطاق المستأجر (404 موحَّد لغيره).
            $channel = SalesChannel::query()->lockForUpdate()->findOrFail($channelId);
            $method = PaymentMethod::query()->findOrFail($id);
            if ($channel->type === SalesChannel::TYPE_POS) {
                return response()->json(['message' => 'POS payment-method availability is governed by PosSettings.', 'reason' => 'channel_not_supported'], 422);
            }

            $before = PaymentMethodChannelAvailability::query()->where('payment_method_id', $method->id)->where('sales_channel_id', $channel->id)->first()?->is_enabled;
            $before = $before === null ? null : (bool) $before;
            if ($before !== $enabled) {
                if ($enabled === null) {
                    $availability->clearOverride($method, $channel);
                } else {
                    $availability->setAvailability($method, $channel, $enabled);
                }
                SalesChannelSettingEvent::create([
                    'tenant_id' => $channel->tenant_id,
                    'sales_channel_id' => $channel->id,
                    'actor_user_id' => $request->user()->id,
                    'changes' => ['payment_methods.'.$method->id.'.channel_availability' => ['from' => $before, 'to' => $enabled]],
                ]);
            }

            return $this->row($method, $channel, $enabled, $availability);
        });

        return $result instanceof JsonResponse ? $result : response()->json(['data' => $result]);
    }

    /** @return array<string, mixed> */
    private function row(PaymentMethod $method, SalesChannel $channel, ?bool $override, PaymentMethodChannelAvailabilityService $availability): array
    {
        return [
            'sales_channel_id' => $channel->id,
            'name' => $channel->name,
            'type' => $channel->type,
            'is_active' => (bool) $channel->is_active,
            'override' => $override === null ? null : (bool) $override,
            'effective' => $availability->isAvailable($method, $channel),
        ];
    }
}
