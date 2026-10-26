<?php

namespace App\Support;

use App\Models\CommerceOrder;
use App\Models\CommerceOrderPosting;
use App\Models\PaymentAttempt;
use App\Services\Commerce\CommerceDeliveryScheduleService;
use Illuminate\Support\Collection;

/**
 * COMMERCE-ORDERS-O1a — مسلسل طلبات المتجر **للموظف** (قراءة فقط).
 *
 * منفصل عمداً عن `CommerceOrderSerializer` (عقد عام يخدم ضيف الجوال والعميل والمتجر): لا يُوسَّع ذاك لحاجة
 * الموظف، ولا يتسرّب شكل هذا إلى الجمهور. يعمل على علاقات محمَّلة مسبقاً (eager) فلا استعلام داخل الحلقة.
 *
 * **لا يكشف:** `tenant_id`، `customer_identity_id`، `commerce_checkout_id`، مفاتيح/بصمات idempotency، أسرار
 * البوابة أو حمولاتها، تكلفة أو بيانات قيد. `payment.attempts` يعرض حالة الالتقاط ومبالغه وأسباب المراجعة فقط.
 * الأثر المحاسبي (`accounting`) مرجع مِرساة قائم؛ لا يُحسب ولا يُنشأ هنا.
 */
final class CommerceOrderStaffSerializer
{
    /**
     * صف قائمة موجز. يتطلب: salesChannel، storefront، snapshot، paymentIntent، وwithCount('lines').
     *
     * @return array<string, mixed>
     */
    public static function summary(CommerceOrder $order, string $currency): array
    {
        return [
            'id' => $order->id,
            'number' => $order->number,
            'status' => $order->status,
            'created_at' => $order->created_at?->toIso8601String(),
            'confirmed_at' => $order->confirmed_at?->toIso8601String(),
            'total' => self::money($order->total, $currency),
            'items_count' => (int) ($order->lines_count ?? 0),
            'delivery_method' => $order->delivery_method,
            'customer' => [
                'name' => $order->snapshot?->customer_name,
                'phone' => $order->snapshot?->phone,
            ],
            'channel' => self::channel($order),
            'payment' => self::paymentSummary($order),
        ];
    }

    /**
     * تفاصيل طلب واحد. يتطلب: salesChannel، storefront، snapshot، gift، schedule، paymentIntent،
     * lines.personalizations.
     *
     * @param  Collection<int, PaymentAttempt>  $attempts  محاولات النية الإلكترونية (الأحدث أولاً)
     * @return array<string, mixed>
     */
    public static function detail(CommerceOrder $order, string $currency, Collection $attempts, ?CommerceOrderPosting $posting): array
    {
        $snapshot = $order->snapshot;
        $intent = $order->paymentIntent;

        return [
            ...self::summary($order, $currency),
            'partner_id' => $order->partner_id,
            'delivery_amount' => self::money($order->delivery_amount_minor, $currency),
            'contact' => [
                'name' => $snapshot?->contact_name,
                'company' => $snapshot?->company_name,
                'email' => $snapshot?->email,
                'phone' => $snapshot?->phone,
                'vat_number' => $snapshot?->vat_number,
                'cr_number' => $snapshot?->cr_number,
            ],
            'shipping_address' => $snapshot === null ? null : [
                'recipient_name' => $snapshot->shipping_recipient_name,
                'phone' => $snapshot->shipping_phone,
                'country' => $snapshot->shipping_country,
                'region' => $snapshot->shipping_region,
                'city' => $snapshot->shipping_city,
                'district' => $snapshot->shipping_district,
                'street' => $snapshot->shipping_street,
                'building_no' => $snapshot->shipping_building_no,
                'additional_number' => $snapshot->shipping_additional_number,
                'postal_code' => $snapshot->shipping_postal_code,
                'notes' => $snapshot->shipping_notes,
            ],
            'billing_address' => $snapshot === null ? null : [
                'recipient_name' => $snapshot->billing_recipient_name,
                'phone' => $snapshot->billing_phone,
                'country' => $snapshot->billing_country,
                'region' => $snapshot->billing_region,
                'city' => $snapshot->billing_city,
                'district' => $snapshot->billing_district,
                'street' => $snapshot->billing_street,
                'building_no' => $snapshot->billing_building_no,
                'additional_number' => $snapshot->billing_additional_number,
                'postal_code' => $snapshot->billing_postal_code,
            ],
            'gift' => $order->gift === null ? null : [
                'recipient_name' => $order->gift->recipient_name,
                'recipient_phone' => $order->gift->recipient_phone,
                'sender_display_name' => $order->gift->sender_display_name,
                'hide_sender' => (bool) $order->gift->hide_sender,
                'message' => $order->gift->message,
            ],
            'schedule' => $order->schedule === null ? null : CommerceDeliveryScheduleService::presentOrder($order->schedule),
            'items' => $order->lines->map(fn ($line) => self::line($line, $currency))->values()->all(),
            'payment' => [
                ...self::paymentSummary($order),
                'collection_note' => $intent?->collection_note,
                'attempts' => $attempts->map(fn (PaymentAttempt $a) => [
                    'id' => $a->id,
                    'capture_status' => $a->capture_status,
                    'amount' => self::money((int) $a->amount_minor, $a->currency ?: $currency),
                    'captured' => self::money((int) $a->captured_minor, $a->currency ?: $currency),
                    'review_reasons' => $a->review_reasons ?? [],
                    'captured_at' => $a->captured_at?->toIso8601String(),
                    'created_at' => $a->created_at?->toIso8601String(),
                ])->values()->all(),
            ],
            // مرجع الترحيل المحاسبي إن وُجد (طلب إلكتروني مدفوع فقط اليوم). غيابه = لا فاتورة/سند لهذا الطلب بعد.
            'accounting' => $posting === null
                ? ['posted' => false]
                : [
                    'posted' => true,
                    'invoice_id' => $posting->invoice_id,
                    'payment_id' => $posting->payment_id,
                    'accounting_date' => $posting->accounting_date?->toDateString(),
                    'amount' => self::money((int) $posting->amount_minor, $currency),
                ],
        ];
    }

    /** @return array<string, mixed> */
    private static function line($line, string $currency): array
    {
        return [
            'id' => $line->id,
            'parent_line_id' => $line->parent_line_id,
            'product_id' => $line->product_id,
            'product_variant_id' => $line->product_variant_id,
            'product_name' => $line->product_name_snapshot,
            'variant' => $line->variant_descriptor_snapshot,
            'unit_name' => $line->unit_name,
            'quantity' => $line->quantity,
            'unit_price' => self::money($line->unit_price, $currency),
            'line_total' => self::money($line->line_total, $currency),
            'personalization' => $line->personalizations->map(fn ($p) => [
                'key' => $p->field_key,
                'label' => $p->label,
                'label_en' => $p->label_en,
                'value' => $p->value,
                'value_label' => $p->value_label,
            ])->values()->all(),
        ];
    }

    /** @return array<string, mixed> */
    private static function channel(CommerceOrder $order): array
    {
        return [
            'sales_channel_id' => $order->sales_channel_id,
            'sales_channel_name' => $order->salesChannel?->name,
            'sales_channel_type' => $order->salesChannel?->type,
            'storefront_id' => $order->storefront_id,
            'storefront_name' => $order->storefront?->name,
        ];
    }

    /** @return array<string, mixed> */
    private static function paymentSummary(CommerceOrder $order): array
    {
        $intent = $order->paymentIntent;

        return [
            'intent_id' => $intent?->id,
            'method' => $intent?->method,
            'status' => $intent?->status,
            'payment_method_name' => $intent?->payment_method_name,
            'amount_minor' => $intent?->amount_minor,
            'collected_at' => $intent?->collected_at?->toIso8601String(),
            'paid_at' => $intent?->paid_at?->toIso8601String(),
            'cancelled_at' => $intent?->cancelled_at?->toIso8601String(),
        ];
    }

    /** @return array{amount_minor: int, currency: string} */
    private static function money(int $minor, string $currency): array
    {
        return ['amount_minor' => $minor, 'currency' => $currency];
    }
}
