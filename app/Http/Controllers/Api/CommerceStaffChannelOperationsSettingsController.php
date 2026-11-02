<?php

namespace App\Http\Controllers\Api;

use App\Models\SalesChannelSettingEvent;
use App\Services\Commerce\CommerceChannelOperationsSettingsService;
use App\Services\Commerce\SalesChannelSettingsException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * COPS-H1-3 — إعدادات تشغيل قناة المتجر (القبول) للموظف. الصلاحية `commerce.channel_settings.manage` (owner/admin عبر `*` فقط؛ لا `MATRIX` ولا دور
 * مخزَّن) + `EnsureApplicationActive:commerce.storefront` على المسار. المستأجر هو مستأجر الموظف المصادَق؛ الجسم لا يستطيع تسميته (`tenant_id` محظور).
 * إعداد فقط، بلا إنفاذ ولا أثر على Checkout أو الدفع أو الإلغاء أو المحاسبة أو المخزون. الكتابة عبر `CommerceChannelOperationsSettingsService` وحده.
 */
class CommerceStaffChannelOperationsSettingsController extends ApiController
{
    public function show(string $id, CommerceChannelOperationsSettingsService $settings): JsonResponse
    {
        try {
            $view = $settings->view($id);
        } catch (SalesChannelSettingsException $e) {
            return $this->refusal($e);
        }

        return response()->json(['data' => $view + ['recent_changes' => $this->history($id)]]);
    }

    public function update(Request $request, string $id, CommerceChannelOperationsSettingsService $settings): JsonResponse
    {
        // قاعدة `integer` في Laravel تقبل المنطقي `true` (يتحوّل إلى 1)؛ نرفضه صراحةً حتى لا يُخزَّن «دقيقة واحدة» من `true`.
        $notBoolean = function (string $attribute, mixed $value, \Closure $fail): void {
            if (is_bool($value)) {
                $fail("The {$attribute} field must be an integer.");
            }
        };
        $data = $request->validate([
            'tenant_id' => ['prohibited'],
            'expected_version' => ['sometimes', 'nullable', $notBoolean, 'integer', 'min:0', 'max:4294967295'],
            CommerceChannelOperationsSettingsService::KEY_MODE => ['sometimes', 'string', 'in:auto,manual'],
            CommerceChannelOperationsSettingsService::KEY_REMINDER => ['sometimes', 'nullable', $notBoolean, 'integer', 'min:1', 'max:'.CommerceChannelOperationsSettingsService::MAX_MINUTES],
            CommerceChannelOperationsSettingsService::KEY_ESCALATION => ['sometimes', 'nullable', $notBoolean, 'integer', 'min:1', 'max:'.CommerceChannelOperationsSettingsService::MAX_MINUTES],
        ]);

        // نسخة الإعدادات التي حمّلها المحرّر إلزامية (428 كنمط AD-01): بلا نسخة لا نعرف ما الذي يستبدله، فلا كتابة.
        if (! array_key_exists('expected_version', $data) || $data['expected_version'] === null) {
            $current = null;
            try {
                $current = $settings->view($id)['version'];
            } catch (SalesChannelSettingsException $e) {
                return $this->refusal($e);
            }

            return response()->json(['message' => 'expected_version is required.', 'reason' => 'expected_version_required', 'current_version' => $current], 428);
        }
        $expected = (int) $data['expected_version'];
        $changes = array_intersect_key($data, array_flip(CommerceChannelOperationsSettingsService::KEYS));
        // `integer` يقبل أرقاماً نصية ("30")؛ الخدمة صارمة النوع فنحوّلها هنا.
        foreach ([CommerceChannelOperationsSettingsService::KEY_REMINDER, CommerceChannelOperationsSettingsService::KEY_ESCALATION] as $minutesKey) {
            if (array_key_exists($minutesKey, $changes) && $changes[$minutesKey] !== null) {
                $changes[$minutesKey] = (int) $changes[$minutesKey];
            }
        }

        if ($changes === []) {
            return response()->json(['message' => 'No setting supplied.', 'reason' => 'no_changes_supplied'], 422);
        }

        try {
            $view = $settings->update($id, $expected, $changes, $request->user());
        } catch (SalesChannelSettingsException $e) {
            return $this->refusal($e);
        }

        return response()->json(['data' => $view + ['recent_changes' => $this->history($id)]]);
    }

    private function refusal(SalesChannelSettingsException $e): JsonResponse
    {
        return response()->json(['message' => $e->getMessage(), 'reason' => $e->reason] + $e->details, $e->status);
    }

    /**
     * آخر تغييرات إعدادات التشغيل من سجل التدقيق المشترك (مفاتيح `operations.*` فقط).
     *
     * @return list<array<string, mixed>>
     */
    private function history(string $channelId): array
    {
        return SalesChannelSettingEvent::query()
            ->where('sales_channel_id', $channelId)
            ->with('actor:id,name')
            ->orderByDesc('created_at')->orderByDesc('id')
            ->limit(50)->get()
            ->filter(fn (SalesChannelSettingEvent $e): bool => collect(array_keys($e->changes ?? []))->contains(fn ($k) => str_starts_with((string) $k, CommerceChannelOperationsSettingsService::AUDIT_PREFIX)))
            ->take(10)
            ->map(fn (SalesChannelSettingEvent $e): array => [
                'at' => $e->created_at?->toIso8601String(),
                'actor' => $e->actor === null ? null : ['id' => $e->actor->id, 'name' => $e->actor->name],
                'changes' => $e->changes,
            ])->values()->all();
    }
}
