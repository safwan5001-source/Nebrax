<?php

namespace App\Services\Commerce;

use App\Models\CommerceChannelOperationSetting;
use App\Models\SalesChannel;
use App\Models\SalesChannelSettingEvent;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * الكاتب الوحيد لإعدادات تشغيل قناة المتجر (COPS-H1-3، ADR-29 §2.5): مفاتيح **القبول فقط** — `acceptance_mode`، `acceptance_reminder_minutes`،
 * `acceptance_escalation_minutes` — و`version`. **لا إنفاذ هنا:** لا شيء في Checkout ولا الدفع ولا الإلغاء يقرأ هذا الجدول (القبول والرفض في H1-4).
 *
 * ═══ العقد ═══
 *  • **غياب الصف = السلوك الحالي حرفياً:** `auto`، بلا تذكير ولا تصعيد، النسخة 0. القراءة لا تُنشئ صفاً. طلب كتابة يطابق الافتراضيات على قناة بلا صف لا يكتب شيئاً.
 *  • **الحماية من التحديث المتزامن (طبقتان):** (1) قفل صف القناة `FOR UPDATE` طوال القراءة والكتابة وفق بروتوكول ADR-19 §2.3 (قناة ← صفوفنا؛ لا قفل قبل القناة) فيتسلسل
 *    كاتبان؛ (2) تفاؤلي: `expected_version` إلزامي ويجب أن يطابق النسخة الحالية (0 = لا صف) وإلا 409 `settings_version_conflict` بلا أي كتابة. يزداد `version` بمقدار 1
 *    عند كل تغيير فعلي فقط. الفريد `(sales_channel_id)` شبكة أمان أخيرة.
 *  • **تدقيق:** كل تغيير فعلي يُلحق حدثاً ثابتاً في `sales_channel_setting_events` بمفاتيح `operations.*` (من/إلى لما تغيّر فقط). الطلب بلا تغيير لا يكتب شيئاً.
 *  • **البوابة R-6b:** ضبط `acceptance_mode = manual` يُرفض (409 `acceptance_deployment_disabled`) ما دام `commerce.order_acceptance_enabled` مغلقاً؛ الإبقاء على `manual`
 *    سبق تخزينه والتحويل إلى `auto` مسموحان دائماً. الوضع الفعّال المعلَن `auto` ما دامت البوابة مغلقة مهما خُزِّن.
 *  • قناة ويب فقط؛ قناة مستأجر آخر أو غير موجودة 404 واحد (TenantScope). لا يُقبل معرّف مستأجر من العميل.
 */
class CommerceChannelOperationsSettingsService
{
    public const KEY_MODE = 'acceptance_mode';

    public const KEY_REMINDER = 'acceptance_reminder_minutes';

    public const KEY_ESCALATION = 'acceptance_escalation_minutes';

    public const KEYS = [self::KEY_MODE, self::KEY_REMINDER, self::KEY_ESCALATION];

    public const MAX_MINUTES = 1440;

    /** بادئة مفاتيح التدقيق في `sales_channel_setting_events.changes` (تميّزها عن إعدادات التسعير). */
    public const AUDIT_PREFIX = 'operations.';

    public function __construct(private TenantContext $tenantContext) {}

    /**
     * العرض الحالي (قراءة فقط بلا أقفال). الافتراضيات حين لا صف.
     *
     * @return array<string, mixed>
     *
     * @throws SalesChannelSettingsException
     */
    public function view(string $channelId): array
    {
        $channel = SalesChannel::query()->find($channelId);
        if ($channel === null || $channel->type !== SalesChannel::TYPE_WEB) {
            throw new SalesChannelSettingsException('not_found', 'Channel not found.', 404);
        }

        return $this->present($channel->id, CommerceChannelOperationSetting::query()->where('sales_channel_id', $channel->id)->first());
    }

    /**
     * @param  array<string, mixed>  $changes  مجموعة جزئية من `KEYS`
     * @return array<string, mixed> العرض بعد التطبيق
     *
     * @throws SalesChannelSettingsException
     */
    public function update(string $channelId, int $expectedVersion, array $changes, User $actor): array
    {
        if (! $this->tenantContext->has()) {
            throw new LogicException('TenantContext is required to change channel operation settings.');
        }
        if ($actor->tenant_id !== $this->tenantContext->id()) {
            throw new SalesChannelSettingsException('not_found', 'Channel not found.', 404);
        }
        $this->assertKnownKeysAndValues($changes);

        return DB::transaction(function () use ($channelId, $expectedVersion, $changes, $actor): array {
            // بروتوكول ADR-19 §2.3: قفل صف القناة أولاً، ثم صفوفنا. لا قفل آخر قبله.
            $channel = SalesChannel::query()->lockForUpdate()->find($channelId);
            if ($channel === null) {
                throw new SalesChannelSettingsException('not_found', 'Channel not found.', 404);
            }
            if ($channel->type !== SalesChannel::TYPE_WEB) {
                throw new SalesChannelSettingsException('channel_not_web', 'Operation settings apply to web channels only.');
            }

            $row = CommerceChannelOperationSetting::query()->where('sales_channel_id', $channel->id)->first();
            $currentVersion = $row === null ? 0 : (int) $row->version;
            if ($expectedVersion !== $currentVersion) {
                throw new SalesChannelSettingsException('settings_version_conflict',
                    'The settings changed since you loaded them; reload and retry.', 409, ['current_version' => $currentVersion]);
            }

            $before = $this->values($row);
            $after = array_merge($before, $changes);
            $this->assertConsistent($after);
            if ($after[self::KEY_MODE] === CommerceChannelOperationSetting::MODE_MANUAL && $before[self::KEY_MODE] !== CommerceChannelOperationSetting::MODE_MANUAL
                && ! (bool) config('commerce.order_acceptance_enabled')) {
                throw new SalesChannelSettingsException('acceptance_deployment_disabled',
                    'Manual acceptance is not enabled for this deployment; the setting cannot be turned on.', 409);
            }

            $diff = [];
            foreach (self::KEYS as $key) {
                if ($after[$key] !== $before[$key]) {
                    $diff[self::AUDIT_PREFIX.$key] = ['from' => $before[$key], 'to' => $after[$key]];
                }
            }
            if ($diff === []) {
                return $this->present($channel->id, $row);
            }

            if ($row === null) {
                $row = new CommerceChannelOperationSetting;
                $row->forceFill(['tenant_id' => $this->tenantContext->id(), 'sales_channel_id' => $channel->id, 'version' => 1]);
            } else {
                $row->version = $currentVersion + 1;
            }
            $row->forceFill([
                self::KEY_MODE => $after[self::KEY_MODE],
                self::KEY_REMINDER => $after[self::KEY_REMINDER],
                self::KEY_ESCALATION => $after[self::KEY_ESCALATION],
                'updated_by_user_id' => $actor->id,
            ])->save();

            SalesChannelSettingEvent::create([
                'tenant_id' => $this->tenantContext->id(),
                'sales_channel_id' => $channel->id,
                'actor_user_id' => $actor->id,
                'changes' => $diff,
            ]);

            return $this->present($channel->id, $row);
        });
    }

    /** @return array{acceptance_mode: string, acceptance_reminder_minutes: ?int, acceptance_escalation_minutes: ?int} */
    private function values(?CommerceChannelOperationSetting $row): array
    {
        return [
            self::KEY_MODE => $row?->acceptance_mode ?? CommerceChannelOperationSetting::MODE_AUTO,
            self::KEY_REMINDER => $row?->acceptance_reminder_minutes,
            self::KEY_ESCALATION => $row?->acceptance_escalation_minutes,
        ];
    }

    /**
     * @param  array<string, mixed>  $changes
     *
     * @throws SalesChannelSettingsException
     */
    private function assertKnownKeysAndValues(array $changes): void
    {
        foreach ($changes as $key => $value) {
            if (! in_array($key, self::KEYS, true)) {
                throw new SalesChannelSettingsException('unknown_setting', "Unknown operation setting [{$key}].");
            }
            if ($key === self::KEY_MODE) {
                if (! is_string($value) || ! in_array($value, CommerceChannelOperationSetting::MODES, true)) {
                    throw new SalesChannelSettingsException('acceptance_mode_invalid', 'acceptance_mode must be auto or manual.');
                }

                continue;
            }
            if ($value !== null && (! is_int($value) || $value < 1 || $value > self::MAX_MINUTES)) {
                throw new SalesChannelSettingsException('minutes_out_of_range', "{$key} must be null or an integer between 1 and ".self::MAX_MINUTES.'.');
            }
        }
    }

    /**
     * @param  array<string, mixed>  $values  القيم بعد التطبيق (لا تخزّن قيمة تناقض أخرى)
     *
     * @throws SalesChannelSettingsException
     */
    private function assertConsistent(array $values): void
    {
        $reminder = $values[self::KEY_REMINDER];
        $escalation = $values[self::KEY_ESCALATION];
        if ($reminder !== null && $escalation !== null && $escalation < $reminder) {
            throw new SalesChannelSettingsException('escalation_before_reminder', 'The escalation delay cannot be shorter than the reminder delay.');
        }
    }

    /** @return array<string, mixed> */
    private function present(string $channelId, ?CommerceChannelOperationSetting $row): array
    {
        $values = $this->values($row);
        $gate = (bool) config('commerce.order_acceptance_enabled');

        return [
            'sales_channel_id' => $channelId,
            'acceptance_mode' => $values[self::KEY_MODE],
            // الوضع الفعّال: المخزَّن `manual` لا يسري ما دامت بوابة النشر مغلقة (ADR-29 §2.2).
            'effective_acceptance_mode' => ($gate && $values[self::KEY_MODE] === CommerceChannelOperationSetting::MODE_MANUAL) ? 'manual' : 'auto',
            'acceptance_deployment_enabled' => $gate,
            'acceptance_reminder_minutes' => $values[self::KEY_REMINDER],
            'acceptance_escalation_minutes' => $values[self::KEY_ESCALATION],
            'version' => $row === null ? 0 : (int) $row->version,
            'configured' => $row !== null,
            'updated_at' => $row?->updated_at?->toIso8601String(),
        ];
    }
}
