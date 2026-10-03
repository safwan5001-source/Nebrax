<?php

namespace App\Services\Commerce;

use App\Models\CommerceCheckout;
use App\Models\CommerceCheckoutGift;
use App\Models\CommerceGiftSetting;
use App\Models\CommerceOrder;
use App\Models\CommerceOrderGift;
use App\Models\SalesChannel;
use App\Tenancy\TenantContext;
use Illuminate\Validation\ValidationException;
use RuntimeException;

/**
 * FLOWERS-H3 / ADR-15 — هوية الإهداء ورسالته على Checkout/Order.
 *
 * يفصل أربع هويات: المشتري (`contact_*`)، مستلم التوصيل، المُرسِل المعروض، ورسالة
 * الإهداء. لا يمسّ سعراً ولا مخزوناً ولا فاتورة ولا قيداً، ولا ينشئ `Partner`.
 * السياسة (مفعَّلة؟ حد الطول؟ إخفاء المُرسِل؟ هاتف المستلم إلزامي؟) من
 * `CommerceGiftSetting` لقناة البيع — معطَّلة افتراضياً.
 */
final class CommerceGiftService
{
    public const MAX_NEWLINES = 6;

    /** @return array{enabled: bool, message_max_length: int, allow_hide_sender: bool, recipient_phone_required: bool} */
    public function optionsForChannel(string $salesChannelId): array
    {
        $setting = CommerceGiftSetting::query()->where('sales_channel_id', $salesChannelId)->first();

        return [
            'enabled' => (bool) ($setting?->is_enabled ?? false),
            'message_max_length' => (int) ($setting?->message_max_length ?? CommerceGiftSetting::DEFAULT_MAX_LENGTH),
            'allow_hide_sender' => (bool) ($setting?->allow_hide_sender ?? true),
            'recipient_phone_required' => (bool) ($setting?->recipient_phone_required ?? true),
        ];
    }

    /**
     * يحفظ سياسة قناة (تاجر مخوَّل). القناة يجب أن تخص المستأجر الحالي.
     *
     * @param  array{is_enabled?: bool, message_max_length?: int, allow_hide_sender?: bool, recipient_phone_required?: bool}  $data
     */
    public function saveSettings(string $salesChannelId, array $data): array
    {
        $this->tenantId();

        if (! SalesChannel::query()->whereKey($salesChannelId)->exists()) {
            throw new RuntimeException('قناة البيع غير موجودة.');
        }

        $setting = CommerceGiftSetting::query()->where('sales_channel_id', $salesChannelId)->first()
            ?? new CommerceGiftSetting(['sales_channel_id' => $salesChannelId]);
        $setting->fill(array_intersect_key($data, array_flip(['is_enabled', 'message_max_length', 'allow_hide_sender', 'recipient_phone_required'])));
        $setting->save();

        return $this->optionsForChannel($salesChannelId);
    }

    /** نص عادي آمن للعرض: يزيل أحرف التحكم وأحرف عكس الاتجاه، ويضبط الأسطر. */
    public function normalizeText(?string $value, bool $multiline = false): ?string
    {
        if ($value === null) {
            return null;
        }

        $value = str_replace(["\r\n", "\r"], "\n", $value);
        // C0 (عدا \n) + DEL + عناصر تحكّم الاتجاه (انتحال العرض): U+202A–202E, U+2066–2069.
        $value = (string) preg_replace('/[\x00-\x09\x0B-\x1F\x7F\x{202A}-\x{202E}\x{2066}-\x{2069}]/u', '', $value);
        if (! $multiline) {
            $value = str_replace("\n", ' ', $value);
        }
        $value = trim($value);

        return $value === '' ? null : $value;
    }

    /**
     * يضبط/يمسح سياق الإهداء لـCheckout (يُستدعى داخل المعاملة وعلى الصف المقفول).
     *
     * @param  array<string, mixed>  $fields is_gift, recipient_name, recipient_phone, sender_name, hide_sender, message
     */
    public function applyToCheckout(CommerceCheckout $checkout, array $fields): ?array
    {
        $existing = CommerceCheckoutGift::query()->where('commerce_checkout_id', $checkout->id)->first();

        if (($fields['is_gift'] ?? true) === false) {
            $existing?->delete();

            return null;
        }

        $options = $this->optionsForChannel($checkout->sales_channel_id);
        if (! $options['enabled']) {
            throw ValidationException::withMessages(['gift' => 'خدمة الإهداء غير مفعّلة لهذا المتجر.']);
        }

        $current = $existing?->only(['recipient_name', 'recipient_phone', 'sender_display_name', 'hide_sender', 'message']) ?? [];
        $next = [
            'recipient_name' => array_key_exists('recipient_name', $fields) ? $this->normalizeText($fields['recipient_name']) : ($current['recipient_name'] ?? null),
            'recipient_phone' => array_key_exists('recipient_phone', $fields) ? $this->normalizeText($fields['recipient_phone']) : ($current['recipient_phone'] ?? null),
            'sender_display_name' => array_key_exists('sender_name', $fields) ? $this->normalizeText($fields['sender_name']) : ($current['sender_display_name'] ?? null),
            'hide_sender' => array_key_exists('hide_sender', $fields) ? (bool) $fields['hide_sender'] : (bool) ($current['hide_sender'] ?? false),
            'message' => array_key_exists('message', $fields) ? $this->normalizeText($fields['message'], true) : ($current['message'] ?? null),
        ];

        if ($next['hide_sender'] && ! $options['allow_hide_sender']) {
            throw ValidationException::withMessages(['hide_sender' => 'إخفاء المُرسِل غير مسموح في هذا المتجر.']);
        }
        $this->assertMessageWithin($next['message'], $options['message_max_length'], 'message');

        $gift = $existing ?? new CommerceCheckoutGift(['commerce_checkout_id' => $checkout->id]);
        $gift->fill($next)->save();

        return $this->present($gift);
    }

    public function forCheckout(CommerceCheckout $checkout): ?array
    {
        $gift = CommerceCheckoutGift::query()->where('commerce_checkout_id', $checkout->id)->first();

        return $gift === null ? null : $this->present($gift);
    }

    /**
     * إعادة تحقق نهائية وقت الإتمام. يعيد `null` حين لا إهداء، أو بيانات اللقطة.
     *
     * @return array{recipient_name: string, recipient_phone: ?string, sender_display_name: ?string, hide_sender: bool, message: ?string}|null
     *
     * @throws CheckoutReviewRequiredException
     */
    public function resolveForCompletion(CommerceCheckout $checkout): ?array
    {
        $gift = CommerceCheckoutGift::query()->where('commerce_checkout_id', $checkout->id)->first();
        if ($gift === null) {
            return null;
        }

        $options = $this->optionsForChannel($checkout->sales_channel_id);
        if (! $options['enabled'] || ($gift->hide_sender && ! $options['allow_hide_sender'])) {
            throw new CheckoutReviewRequiredException('خدمة الإهداء لم تعد متاحة — راجع تفاصيل الإهداء.', [['item_id' => 'gift', 'reason' => 'gift_unavailable']]);
        }

        $name = $this->normalizeText($gift->recipient_name);
        $phone = $this->normalizeText($gift->recipient_phone);
        $message = $this->normalizeText($gift->message, true);
        if ($name === null || ($options['recipient_phone_required'] && $phone === null) || ($message !== null && $this->length($message) > $options['message_max_length'])) {
            throw new CheckoutReviewRequiredException('بيانات الإهداء غير مكتملة.', [['item_id' => 'gift', 'reason' => 'gift_incomplete']]);
        }

        return [
            'recipient_name' => $name,
            'recipient_phone' => $phone,
            'sender_display_name' => $this->normalizeText($gift->sender_display_name),
            'hide_sender' => (bool) $gift->hide_sender,
            'message' => $message,
        ];
    }

    /** يكتب لقطة الإهداء الثابتة داخل معاملة إنشاء الطلب (قبل التأكيد). */
    public function snapshotToOrder(CommerceOrder $order, array $gift): CommerceOrderGift
    {
        return $order->gift()->create([
            'recipient_name' => $gift['recipient_name'],
            'recipient_phone' => $gift['recipient_phone'],
            'sender_display_name' => $gift['sender_display_name'],
            'hide_sender' => $gift['hide_sender'],
            'message' => $gift['message'],
        ]);
    }

    /** @return array{recipient_name: ?string, recipient_phone: ?string, sender_display_name: ?string, hide_sender: bool, message: ?string} */
    public function present(CommerceCheckoutGift|CommerceOrderGift $gift): array
    {
        return [
            'recipient_name' => $gift->recipient_name,
            'recipient_phone' => $gift->recipient_phone,
            'sender_display_name' => $gift->sender_display_name,
            'hide_sender' => (bool) $gift->hide_sender,
            'message' => $gift->message,
        ];
    }

    private function assertMessageWithin(?string $message, int $max, string $field): void
    {
        if ($message === null) {
            return;
        }
        if ($this->length($message) > $max) {
            throw ValidationException::withMessages([$field => "رسالة الإهداء تتجاوز الحد الأقصى ({$max} حرفاً)."]);
        }
        if (substr_count($message, "\n") > self::MAX_NEWLINES) {
            throw ValidationException::withMessages([$field => 'رسالة الإهداء تحتوي أسطراً أكثر من المسموح.']);
        }
    }

    private function length(string $value): int
    {
        return mb_strlen($value);
    }

    private function tenantId(): string
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        return $tenantId;
    }
}
