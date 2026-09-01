<?php

namespace App\Http\Resources;

use App\Support\PublicMoney;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * سطر فاتورة في الـ Public API — عقد مُنتقى. يعتمد لقطات السطر المحفوظة (اسم/رمز/
 * باركود المنتج) فلا يحتاج تحميل المنتج. النقود بالوحدات الصغرى الصحيحة + `currency`.
 *
 * يستبعد الداخليّ: بسط/مقام الكمية والتسعير، سياسة/بقايا التقريب، الحدّ الأدنى
 * للسعر وتجاوزاته، معامل الوحدة، وتخصيصات مراكز التكلفة.
 */
class PublicInvoiceLineResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'product_id'   => $this->product_id,
            'product_name' => $this->product_name_snapshot ?? $this->description,
            'product_sku'  => $this->product_sku_snapshot,
            'barcode'      => $this->product_barcode_snapshot,
            'description'  => $this->description,
            'quantity'     => (int) $this->quantity,
            'unit_name'    => $this->unit_name,
            'tax_rate'     => (int) $this->tax_rate,
            'currency'          => PublicMoney::currency($request),
            'unit_price_minor'  => PublicMoney::minor($this->unit_price),
            'line_subtotal_minor' => PublicMoney::minor($this->line_subtotal),
            'line_discount_minor' => PublicMoney::minor($this->line_discount),
            'line_tax_minor'    => PublicMoney::minor($this->line_tax),
            'line_total_minor'  => PublicMoney::minor($this->line_total),
        ];
    }
}
