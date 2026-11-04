<?php

namespace App\Services\Commerce;

use App\Models\CommerceChannelOperationSetting;
use App\Models\CommerceChannelOpeningHour;
use App\Models\SalesChannel;
use App\Models\SalesChannelSettingEvent;
use App\Models\User;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * الكاتب الوحيد لإعدادات تشغيل قناة المتجر (COPS-H1-3، ADR-29 §2.5): مفاتيح القبول — `acceptance_mode`، `acceptance_reminder_minutes`،
 * `acceptance_escalation_minutes` — و**COPS-H4-3 (D-OPS-7/8، D-H4-01..05)** تحكّمات الاستقبال: `accepting_orders`/`paused_until`/`pause_message` (إيقاف يدوي)،
 * `outside_hours_policy` وساعات العمل الأسبوعية `opening_hours` (جدول `commerce_channel_opening_hours`)، و`min_order_minor`/`min_order_scope` (حدّ أدنى)؛ و`version`.
 * **لا إنفاذ هنا:** لا شيء في Checkout ولا الدفع ولا الإلغاء يقرأ هذا الجدول (القبول والرفض في H1-4؛ إنفاذ الاستقبال H4-4 خلف بوابة مغلقة).
 *
 * ═══ H4-3 ═══
 *  • الافتراضيات = السلوك الحالي: مفتوح، `accept`، بلا حد أدنى، بلا ساعات (24/7). الساعات تُستبدل كمجموعة كاملة داخل معاملة الإعداد نفسها (قفل القناة ثم الصفوف) وبالنسخة نفسها.
 *  • **البوابة D-H4-03** `commerce.channel_intake_controls_enabled` (مغلقة): تُخزَّن الإعدادات لكن يُرفض (409 `intake_controls_deployment_disabled`) **الانتقال إلى** حالة حجب
 *    (إيقاف الطلبات، `block`، حدّ أدنى)؛ الإبقاء على المخزَّن والرجوع إلى الافتراضي مسموحان دائماً. لا alert_contacts ولا auto_reject (D-H4-02، D-OPS-3).
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

    public const KEY_ACCEPTING = 'accepting_orders';

    public const KEY_PAUSED_UNTIL = 'paused_until';

    public const KEY_PAUSE_MESSAGE = 'pause_message';

    public const KEY_OUTSIDE_POLICY = 'outside_hours_policy';

    public const KEY_MIN_ORDER = 'min_order_minor';

    public const KEY_MIN_SCOPE = 'min_order_scope';

    public const KEY_HOURS = 'opening_hours';

    public const KEYS = [
        self::KEY_MODE, self::KEY_REMINDER, self::KEY_ESCALATION,
        self::KEY_ACCEPTING, self::KEY_PAUSED_UNTIL, self::KEY_PAUSE_MESSAGE,
        self::KEY_OUTSIDE_POLICY, self::KEY_MIN_ORDER, self::KEY_MIN_SCOPE, self::KEY_HOURS,
    ];

    public const MAX_PAUSE_MESSAGE = 200;

    public const MAX_MIN_ORDER_MINOR = 100_000_000_000;

    /** أقصى فترات في اليوم الواحد، وفي الأسبوع. */
    public const MAX_PERIODS_PER_DAY = 3;

    public const MAX_PERIODS = 21;

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

        return $this->present(
            $channel->id,
            CommerceChannelOperationSetting::query()->where('sales_channel_id', $channel->id)->first(),
            $this->hours($channel->id),
        );
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

            $before = $this->values($row, $this->hours($channel->id));
            $after = array_merge($before, $changes);
            $this->assertConsistent($after);
            if ($after[self::KEY_MODE] === CommerceChannelOperationSetting::MODE_MANUAL && $before[self::KEY_MODE] !== CommerceChannelOperationSetting::MODE_MANUAL
                && ! (bool) config('commerce.order_acceptance_enabled')) {
                throw new SalesChannelSettingsException('acceptance_deployment_disabled',
                    'Manual acceptance is not enabled for this deployment; the setting cannot be turned on.', 409);
            }

            $this->assertIntakeGate($before, $after);
            $this->assertPauseUntilIsFuture($before, $after);

            $diff = [];
            foreach (self::KEYS as $key) {
                if ($after[$key] !== $before[$key]) {
                    $diff[self::AUDIT_PREFIX.$key] = ['from' => $before[$key], 'to' => $after[$key]];
                }
            }
            if ($diff === []) {
                return $this->present($channel->id, $row, $before[self::KEY_HOURS]);
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
                self::KEY_ACCEPTING => $after[self::KEY_ACCEPTING],
                self::KEY_PAUSED_UNTIL => $after[self::KEY_PAUSED_UNTIL] === null ? null : CarbonImmutable::parse($after[self::KEY_PAUSED_UNTIL]),
                self::KEY_PAUSE_MESSAGE => $after[self::KEY_PAUSE_MESSAGE],
                self::KEY_OUTSIDE_POLICY => $after[self::KEY_OUTSIDE_POLICY],
                self::KEY_MIN_ORDER => $after[self::KEY_MIN_ORDER],
                self::KEY_MIN_SCOPE => $after[self::KEY_MIN_SCOPE],
                'updated_by_user_id' => $actor->id,
            ])->save();

            if ($after[self::KEY_HOURS] !== $before[self::KEY_HOURS]) {
                $this->replaceHours($channel->id, $after[self::KEY_HOURS]);
            }

            SalesChannelSettingEvent::create([
                'tenant_id' => $this->tenantContext->id(),
                'sales_channel_id' => $channel->id,
                'actor_user_id' => $actor->id,
                'changes' => $diff,
            ]);

            return $this->present($channel->id, $row, $after[self::KEY_HOURS]);
        });
    }

    /**
     * COPS-H1-4 (ADR-29 §2.2) — **المستهلك الوحيد** لهذا الجدول خارج هذه الخدمة: لقطة وضع القبول لطلب ينشأ الآن، يستدعيها
     * `CommerceOrderService::createFromCheckout` داخل معاملة الإنشاء. قراءة عادية بلا قفل (لقطة لحظة؛ الكاتب يقفل القناة ولا سباق صحة).
     *
     * البوابة مغلقة ⇒ `null` **بلا أي استعلام** (مسار الإنشاء حرفياً كما قبل H1-4). مفتوحة ⇒ `manual` فقط حين المخزَّن للقناة `manual`؛ غياب
     * الصف أو `auto` ⇒ `null` (تلقائي). لا تمسّ إعدادات H4.
     */
    public function acceptanceModeForNewOrder(string $channelId): ?string
    {
        if (! (bool) config('commerce.order_acceptance_enabled')) {
            return null;
        }
        $mode = CommerceChannelOperationSetting::query()->where('sales_channel_id', $channelId)->value('acceptance_mode');

        return $mode === CommerceChannelOperationSetting::MODE_MANUAL ? $mode : null;
    }

    /**
     * @param  list<array{weekday: int, opens_at: string, closes_at: string}>  $hours
     * @return array<string, mixed>
     */
    private function values(?CommerceChannelOperationSetting $row, array $hours): array
    {
        return [
            self::KEY_MODE => $row?->acceptance_mode ?? CommerceChannelOperationSetting::MODE_AUTO,
            self::KEY_REMINDER => $row?->acceptance_reminder_minutes,
            self::KEY_ESCALATION => $row?->acceptance_escalation_minutes,
            self::KEY_ACCEPTING => $row === null ? true : (bool) $row->accepting_orders,
            self::KEY_PAUSED_UNTIL => $row?->paused_until?->utc()->format('Y-m-d\TH:i:s\Z'),
            self::KEY_PAUSE_MESSAGE => $row?->pause_message,
            self::KEY_OUTSIDE_POLICY => $row?->outside_hours_policy ?? CommerceChannelOperationSetting::OUTSIDE_HOURS_ACCEPT,
            self::KEY_MIN_ORDER => $row?->min_order_minor === null ? null : (int) $row->min_order_minor,
            self::KEY_MIN_SCOPE => $row?->min_order_scope ?? CommerceChannelOperationSetting::MIN_SCOPE_ALL,
            self::KEY_HOURS => $hours,
        ];
    }

    /**
     * الفترات المخزَّنة مرتّبة (يوم ثم بداية) — قراءة المستأجر الحالي فقط (TenantScope).
     *
     * @return list<array{weekday: int, opens_at: string, closes_at: string}>
     */
    private function hours(string $channelId): array
    {
        return CommerceChannelOpeningHour::query()
            ->where('sales_channel_id', $channelId)
            ->orderBy('weekday')->orderBy('opens_at')
            ->get(['weekday', 'opens_at', 'closes_at'])
            ->map(fn (CommerceChannelOpeningHour $h): array => ['weekday' => (int) $h->weekday, 'opens_at' => (string) $h->opens_at, 'closes_at' => (string) $h->closes_at])
            ->all();
    }

    /** @param  list<array{weekday: int, opens_at: string, closes_at: string}>  $periods */
    private function replaceHours(string $channelId, array $periods): void
    {
        CommerceChannelOpeningHour::query()->where('sales_channel_id', $channelId)->delete();
        foreach ($periods as $period) {
            $hour = new CommerceChannelOpeningHour;
            $hour->forceFill([
                'tenant_id' => $this->tenantContext->id(),
                'sales_channel_id' => $channelId,
                'weekday' => $period['weekday'],
                'opens_at' => $period['opens_at'],
                'closes_at' => $period['closes_at'],
            ])->save();
        }
    }

    /**
     * @param  array<string, mixed>  $changes
     *
     * @throws SalesChannelSettingsException
     */
    private function assertKnownKeysAndValues(array &$changes): void
    {
        foreach ($changes as $key => $value) {
            if (! in_array($key, self::KEYS, true)) {
                throw new SalesChannelSettingsException('unknown_setting', "Unknown operation setting [{$key}].");
            }
            switch ($key) {
                case self::KEY_MODE:
                    if (! is_string($value) || ! in_array($value, CommerceChannelOperationSetting::MODES, true)) {
                        throw new SalesChannelSettingsException('acceptance_mode_invalid', 'acceptance_mode must be auto or manual.');
                    }
                    break;
                case self::KEY_REMINDER:
                case self::KEY_ESCALATION:
                    if ($value !== null && (! is_int($value) || $value < 1 || $value > self::MAX_MINUTES)) {
                        throw new SalesChannelSettingsException('minutes_out_of_range', "{$key} must be null or an integer between 1 and ".self::MAX_MINUTES.'.');
                    }
                    break;
                case self::KEY_ACCEPTING:
                    if (! is_bool($value)) {
                        throw new SalesChannelSettingsException('accepting_orders_invalid', 'accepting_orders must be a boolean.');
                    }
                    break;
                case self::KEY_PAUSED_UNTIL:
                    $changes[$key] = $this->normalizePausedUntil($value);
                    break;
                case self::KEY_PAUSE_MESSAGE:
                    $changes[$key] = $this->normalizePauseMessage($value);
                    break;
                case self::KEY_OUTSIDE_POLICY:
                    if (! is_string($value) || ! in_array($value, CommerceChannelOperationSetting::OUTSIDE_HOURS_POLICIES, true)) {
                        throw new SalesChannelSettingsException('outside_hours_policy_invalid', 'outside_hours_policy must be accept or block.');
                    }
                    break;
                case self::KEY_MIN_ORDER:
                    if ($value !== null && (! is_int($value) || $value < 1 || $value > self::MAX_MIN_ORDER_MINOR)) {
                        throw new SalesChannelSettingsException('min_order_out_of_range', 'min_order_minor must be null or an integer between 1 and '.self::MAX_MIN_ORDER_MINOR.'.');
                    }
                    break;
                case self::KEY_MIN_SCOPE:
                    if (! is_string($value) || ! in_array($value, CommerceChannelOperationSetting::MIN_SCOPES, true)) {
                        throw new SalesChannelSettingsException('min_order_scope_invalid', 'min_order_scope must be all or delivery_only.');
                    }
                    break;
                case self::KEY_HOURS:
                    $changes[$key] = $this->normalizeHours($value);
                    break;
            }
        }
    }

    private function normalizePausedUntil(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        try {
            if (! is_string($value) || trim($value) === '') {
                throw new \InvalidArgumentException('not a string');
            }

            return CarbonImmutable::parse($value)->utc()->format('Y-m-d\TH:i:s\Z');
        } catch (\Throwable) {
            throw new SalesChannelSettingsException('paused_until_invalid', 'paused_until must be a valid date-time or null.');
        }
    }

    private function normalizePauseMessage(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if (! is_string($value)) {
            throw new SalesChannelSettingsException('pause_message_invalid', 'pause_message must be text or null.');
        }
        $text = trim($value);
        if ($text === '') {
            return null;
        }
        // نصّ عادي قصير فقط (D-OPS-7e): لا HTML، ولا أحرف تحكّم.
        if (mb_strlen($text) > self::MAX_PAUSE_MESSAGE || preg_match('/[<>]|[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', $text) === 1) {
            throw new SalesChannelSettingsException('pause_message_invalid', 'pause_message must be plain text up to '.self::MAX_PAUSE_MESSAGE.' characters.');
        }

        return $text;
    }

    /**
     * فترات ساعات العمل: مصفوفة (أو null/[] = بلا ساعات = 24/7). كل فترة {weekday 0..6، opens_at «HH:MM»، closes_at «HH:MM» حتى «24:00»}، بداية < نهاية، بلا تداخل داخل اليوم،
     * وحدّا اليوم والأسبوع. تُعاد مرتّبة (يوم ثم بداية) بمفاتيح ثابتة فتقارَن بالمخزَّن بالتساوي.
     *
     * @return list<array{weekday: int, opens_at: string, closes_at: string}>
     */
    private function normalizeHours(mixed $value): array
    {
        if ($value === null || $value === []) {
            return [];
        }
        $invalid = fn (string $why): SalesChannelSettingsException => new SalesChannelSettingsException('opening_hours_invalid', 'opening_hours is invalid: '.$why.'.');
        if (! is_array($value) || ! array_is_list($value) || count($value) > self::MAX_PERIODS) {
            throw $invalid('expected a list of at most '.self::MAX_PERIODS.' periods');
        }
        $periods = [];
        foreach ($value as $period) {
            if (! is_array($period) || array_diff(array_keys($period), ['weekday', 'opens_at', 'closes_at']) !== [] || count($period) !== 3) {
                throw $invalid('each period needs exactly weekday, opens_at and closes_at');
            }
            $weekday = $period['weekday'];
            $opens = $period['opens_at'];
            $closes = $period['closes_at'];
            if (! is_int($weekday) || $weekday < 0 || $weekday > 6) {
                throw $invalid('weekday must be an integer 0 (Sunday) to 6 (Saturday)');
            }
            if (! is_string($opens) || preg_match('/^([01][0-9]|2[0-3]):[0-5][0-9]$/', $opens) !== 1) {
                throw $invalid('opens_at must be HH:MM');
            }
            if (! is_string($closes) || preg_match('/^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$/', $closes) !== 1) {
                throw $invalid('closes_at must be HH:MM or 24:00');
            }
            if ($opens >= $closes) {
                throw $invalid('opens_at must be before closes_at');
            }
            $periods[] = ['weekday' => $weekday, 'opens_at' => $opens, 'closes_at' => $closes];
        }
        usort($periods, fn (array $a, array $b): int => [$a['weekday'], $a['opens_at']] <=> [$b['weekday'], $b['opens_at']]);
        $perDay = [];
        $previous = null;
        foreach ($periods as $period) {
            $perDay[$period['weekday']] = ($perDay[$period['weekday']] ?? 0) + 1;
            if ($perDay[$period['weekday']] > self::MAX_PERIODS_PER_DAY) {
                throw $invalid('at most '.self::MAX_PERIODS_PER_DAY.' periods per day');
            }
            if ($previous !== null && $previous['weekday'] === $period['weekday'] && $period['opens_at'] < $previous['closes_at']) {
                throw $invalid('periods of the same day must not overlap');
            }
            $previous = $period;
        }

        return $periods;
    }

    /**
     * D-H4-03: والبوابة مغلقة يُرفض **الانتقال إلى** حالة حجب (إيقاف الطلبات، سياسة `block`، حدّ أدنى)؛ الإبقاء على المخزَّن والرجوع للافتراضي مسموحان.
     *
     * @param  array<string, mixed>  $before
     * @param  array<string, mixed>  $after
     *
     * @throws SalesChannelSettingsException
     */
    private function assertIntakeGate(array $before, array $after): void
    {
        if ((bool) config('commerce.channel_intake_controls_enabled')) {
            return;
        }
        $enteringBlock = ($before[self::KEY_ACCEPTING] === true && $after[self::KEY_ACCEPTING] === false)
            || ($before[self::KEY_OUTSIDE_POLICY] !== CommerceChannelOperationSetting::OUTSIDE_HOURS_BLOCK && $after[self::KEY_OUTSIDE_POLICY] === CommerceChannelOperationSetting::OUTSIDE_HOURS_BLOCK)
            || ($before[self::KEY_MIN_ORDER] === null && $after[self::KEY_MIN_ORDER] !== null);
        if ($enteringBlock) {
            throw new SalesChannelSettingsException('intake_controls_deployment_disabled',
                'Order intake controls are not enabled for this deployment; pausing, blocking outside hours and a minimum order cannot be turned on.', 409);
        }
    }

    /**
     * `paused_until` المتغيّر يجب أن يكون في المستقبل (القيمة المخزَّنة نفسها تبقى مقبولة وإن مضى وقتها).
     *
     * @param  array<string, mixed>  $before
     * @param  array<string, mixed>  $after
     *
     * @throws SalesChannelSettingsException
     */
    private function assertPauseUntilIsFuture(array $before, array $after): void
    {
        $until = $after[self::KEY_PAUSED_UNTIL];
        if ($until !== null && $until !== $before[self::KEY_PAUSED_UNTIL] && CarbonImmutable::parse($until)->lessThanOrEqualTo(CarbonImmutable::now())) {
            throw new SalesChannelSettingsException('paused_until_in_past', 'paused_until must be in the future.');
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
        // الاستئناف المجدول يخصّ الإيقاف فقط: لا `paused_until` والطلبات مقبولة (يتّسق مع CHECK في PostgreSQL).
        if ($values[self::KEY_PAUSED_UNTIL] !== null && $values[self::KEY_ACCEPTING] === true) {
            throw new SalesChannelSettingsException('paused_until_requires_pause', 'paused_until applies only while accepting_orders is false.');
        }
    }

    /**
     * @param  list<array{weekday: int, opens_at: string, closes_at: string}>  $hours
     * @return array<string, mixed>
     */
    private function present(string $channelId, ?CommerceChannelOperationSetting $row, array $hours): array
    {
        $values = $this->values($row, $hours);
        $gate = (bool) config('commerce.order_acceptance_enabled');

        return [
            'sales_channel_id' => $channelId,
            'acceptance_mode' => $values[self::KEY_MODE],
            // الوضع الفعّال: المخزَّن `manual` لا يسري ما دامت بوابة النشر مغلقة (ADR-29 §2.2).
            'effective_acceptance_mode' => ($gate && $values[self::KEY_MODE] === CommerceChannelOperationSetting::MODE_MANUAL) ? 'manual' : 'auto',
            'acceptance_deployment_enabled' => $gate,
            'acceptance_reminder_minutes' => $values[self::KEY_REMINDER],
            'acceptance_escalation_minutes' => $values[self::KEY_ESCALATION],
            // COPS-H4-3 — تحكّمات الاستقبال (تُخزَّن دائماً؛ الإنفاذ في H4-4 خلف البوابة).
            'accepting_orders' => $values[self::KEY_ACCEPTING],
            'paused_until' => $values[self::KEY_PAUSED_UNTIL],
            'pause_message' => $values[self::KEY_PAUSE_MESSAGE],
            'outside_hours_policy' => $values[self::KEY_OUTSIDE_POLICY],
            'opening_hours' => $values[self::KEY_HOURS],
            'min_order_minor' => $values[self::KEY_MIN_ORDER],
            'min_order_scope' => $values[self::KEY_MIN_SCOPE],
            'intake_controls_deployment_enabled' => (bool) config('commerce.channel_intake_controls_enabled'),
            'version' => $row === null ? 0 : (int) $row->version,
            'configured' => $row !== null,
            'updated_at' => $row?->updated_at?->toIso8601String(),
        ];
    }
}
