<?php

namespace App\Services\Commerce;

/**
 * لقطة قراءة واحدة لثلاثيّة On Hand / Active Reserved / Available-to-Sell
 * لمنتج في مخزن واحد، وفق عقد ADR-02:
 *
 *     Available To Sell = max(0, On Hand - Active Reserved)
 *
 * `onHand` القيمة الخام كما هي في دفتر المخزون — **لا تُقصّ** حتى لو كانت
 * سالبة (مخزون قديم سالب معروف، انظر Existing Architecture Audit)، لأن
 * القصّ عند صفر خاص بـ`availableToSell` وحده؛ عرض `onHand` مقصوصاً كان
 * سيُخفي حقيقة الدفتر عن أول مستهلك يقارنها بتقرير المخزون.
 *
 * `activeReserved` صفرٌ حصراً في PR-COM-1A — لا حجز مخزون مبني بعد
 * (PR-COM-1B). القيمة موجودة في العقد الآن حتى يستهلكها العميل بلا تغيير
 * توقيع حين تُملأ فعلياً لاحقاً.
 */
final readonly class AvailableToSellSnapshot
{
    public function __construct(
        public int $onHand,
        public int $activeReserved,
        public int $availableToSell,
    ) {}
}
