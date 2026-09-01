<?php

namespace App\Http\Resources;

use App\Support\PublicMoney;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * تمثيل الفاتورة في الـ Public API — ملخّص مُنتقى ومستقر. النقود بالوحدات الصغرى
 * الصحيحة + `currency`. السطور تُضاف في مسار التفاصيل فقط عبر `withLines()`.
 *
 * **يستبعد صراحةً:** كل حقول ZATCA (QR/hash/UUID/ICV/XML/توقيع)، معرّفات القيد
 * (journal/cogs)، مراجع القوالب، الفرع/المخزن/قائمة السعر/مركز التكلفة/المندوب،
 * الملاحظات، ومرجع/طريقة السداد الداخلية. لا داخليّات دفتر أستاذ ولا تشخيص.
 */
class PublicInvoiceResource extends JsonResource
{
    private bool $includeLines = false;

    /** يُفعِّل تضمين السطور (مسار التفاصيل). يُتوقَّع تحميل `lines` مسبقًا. */
    public function withLines(): static
    {
        $this->includeLines = true;

        return $this;
    }

    public function toArray(Request $request): array
    {
        $data = [
            'id'             => $this->id,
            'number'         => $this->number,
            'status'         => $this->status,         // draft | posted | cancelled
            'type'           => $this->type,           // sale …
            'payment_type'   => $this->payment_type,   // cash | credit
            'payment_status' => $this->payment_status, // unpaid | partial | paid
            'is_paid'        => (bool) $this->is_paid,
            'tax_inclusive'  => (bool) $this->tax_inclusive,
            'invoice_date'   => $this->invoice_date?->toDateString(),
            'due_date'       => $this->due_date?->toDateString(),
            'partner_id'     => $this->partner_id,
            'partner'        => $this->whenLoaded('partner', fn () => $this->partner ? [
                'id'   => $this->partner->id,
                'name' => $this->partner->name,
                'code' => $this->partner->code,
            ] : null),
            'currency'       => PublicMoney::currency($request),
            'subtotal_minor' => PublicMoney::minor($this->subtotal),
            'discount_minor' => PublicMoney::minor($this->discount),
            'shipping_minor' => PublicMoney::minor($this->shipping),
            'adjustment_minor' => PublicMoney::minor($this->adjustment),
            'tax_minor'      => PublicMoney::minor($this->tax_amount),
            'total_minor'    => PublicMoney::minor($this->total),
            'paid_minor'     => PublicMoney::minor($this->paid_amount),
            'balance_minor'  => PublicMoney::minor($this->remaining()),
            'created_at'     => $this->created_at?->toIso8601String(),
            'updated_at'     => $this->updated_at?->toIso8601String(),
        ];

        if ($this->includeLines) {
            $data['lines'] = PublicInvoiceLineResource::collection($this->whenLoaded('lines'));
        }

        return $data;
    }
}
