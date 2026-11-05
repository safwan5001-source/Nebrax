<?php

namespace App\Services\Commerce;

use App\Models\SalesChannel;
use App\Support\CommerceChannelIntake;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * COPS-H4-4 (D-OPS-7/8، D-H4-03/05) — إنفاذ تحكّمات استقبال الطلبات عند **إنشاء** الطلب فقط (`CommerceCheckoutService::complete`)، وكتلة `ordering` العامة.
 *
 * ═══ العقد ═══
 *  • **البوابة مغلقة ⇒ لا أثر ولا استعلام:** `forCompletion()` يعيد `null` فيبقى الإتمام حرفياً كما كان. يحرس ذلك اختبار.
 *  • **فحص واحد داخل معاملة الإتمام بقفل القناة المشترك** (`sharedLock`، بروتوكول ADR-19: كاتب الإعدادات يقفلها `FOR UPDATE`): سباق إيقاف↔إتمام يُحسم بالتسلسل — إيقاف سبق ⇒ الإتمام يراه
 *    ويُرفض؛ إتمام سبق ⇒ الإيقاف ينتظره. لا قفل جديد ولا تغيير في ترتيب `Attempt→Intent→Order→Fulfillment→Reservations` (القفل بعد السلة وCheckout، كما يفعل `CommerceDeliveryScheduleService`).
 *  • الرفض `CheckoutReviewRequiredException` (409 `review_required`) **قبل أي كتابة** (لا طلب ولا حجز ولا نية) برمز ثابت: `store_paused` · `outside_opening_hours` · `below_minimum_order`.
 *  • **نقطة الإنفاذ الوحيدة هي الإنشاء (D-OPS-7c):** لا يمسّ طلباً قائماً ولا الدفع/عودة المزوّد/التتبع/المكنسة.
 *  • التوقيت: منطقة جدولة القناة (← المستأجر ← `Asia/Riyadh`) عبر `CommerceDeliveryScheduleService::settings`.
 */
class CommerceChannelIntakeGuard
{
    public function __construct(
        private readonly CommerceChannelOperationsSettingsService $settings,
        private readonly CommerceDeliveryScheduleService $schedule,
    ) {}

    /**
     * لقطة الاستقبال لمعاملة إتمام جارية (يجب أن تُستدعى داخل معاملة الإتمام). `null` = البوابة مغلقة.
     *
     * @throws LogicException خارج معاملة
     */
    public function forCompletion(string $channelId): ?CommerceIntakeCheck
    {
        if (! (bool) config('commerce.channel_intake_controls_enabled')) {
            return null;
        }
        if (DB::transactionLevel() === 0) {
            throw new LogicException('Intake enforcement must run inside the checkout completion transaction.');
        }
        // قفل مشترك على صف القناة قبل قراءة الإعداد (يتسلسل مع كاتب الإعدادات `FOR UPDATE`). قناة غير موجودة ⇒ لا إنفاذ (سياق خاطئ يفشل في موضع آخر).
        if (SalesChannel::query()->whereKey($channelId)->sharedLock()->first() === null) {
            return null;
        }
        $snapshot = $this->settings->intakeSnapshot($channelId);
        if ($snapshot === null) {
            return null;
        }

        return new CommerceIntakeCheck($snapshot, CarbonImmutable::now(), $this->schedule->settings($channelId)['timezone']);
    }

    /**
     * كتلة `ordering` العامة (`GET store/v1/storefront`)، أو `null` (البوابة مغلقة ⇒ الاستجابة حرفياً كما كانت). قراءة بلا قفل.
     * لا تكشف إعداداً داخلياً: السبب (`paused` | `outside_hours`)، رسالة التاجر القصيرة، وقت الاستئناف إن وُجد، والحد الأدنى (يراه المشتري عملياً).
     *
     * @return null|array{accepting: bool, reason: ?string, message: ?string, resumes_at: ?string, min_order_minor: ?int, min_order_scope: string}
     */
    public function publicBlock(string $channelId): ?array
    {
        $snapshot = $this->settings->intakeSnapshot($channelId);
        if ($snapshot === null) {
            return null;
        }
        $state = CommerceChannelIntake::state($snapshot, CarbonImmutable::now(), $this->schedule->settings($channelId)['timezone']);

        return [
            'accepting' => $state['accepting'],
            'reason' => $state['reason'],
            'message' => $state['reason'] === CommerceChannelIntake::REASON_PAUSED ? $state['message'] : null,
            'resumes_at' => $state['resumes_at'],
            'min_order_minor' => $snapshot['min_order_minor'],
            'min_order_scope' => $snapshot['min_order_scope'],
        ];
    }
}
