<?php

namespace App\Services\Accounting;

use App\Models\Invoice;
use App\Models\Tenant;

/**
 * ═══════════════════════════════════════════════════════════════
 *  ZatcaService — الفاتورة الإلكترونية (المرحلة 1: التوليد)
 * ═══════════════════════════════════════════════════════════════
 *  يولّد رمز QR متوافقاً مع هيئة الزكاة والضريبة (ZATCA) بصيغة TLV
 *  مُرمَّزة Base64، يحتوي الحقول الخمسة الإلزامية:
 *    1) اسم البائع   2) الرقم الضريبي   3) وقت الفاتورة (ISO 8601)
 *    4) الإجمالي شامل الضريبة   5) مبلغ الضريبة
 *  مع هاش SHA-256 للنزاهة والتتبّع.
 *
 *  المبالغ تُحوَّل من الهللات إلى صيغة عشرية نصية (بلا float).
 */
class ZatcaService
{
    /**
     * توليد بيانات ZATCA لفاتورة: ['qr' => Base64, 'hash' => Base64].
     */
    public function generateFor(Invoice $invoice): array
    {
        $tenant    = Tenant::find($invoice->tenant_id);
        $seller    = $tenant?->name ?? '';
        $vat       = $tenant?->vat_number ?? '';
        $timestamp = ($invoice->created_at ?? now())->toIso8601String();
        $total     = $this->formatAmount($invoice->total);
        $vatAmount = $this->formatAmount($invoice->tax_amount);

        $payload =
            $this->tlv(1, $seller) .
            $this->tlv(2, $vat) .
            $this->tlv(3, $timestamp) .
            $this->tlv(4, $total) .
            $this->tlv(5, $vatAmount);

        $canonical = implode('|', [$invoice->number, $vat, $timestamp, $invoice->total, $invoice->tax_amount]);

        return [
            'qr'   => base64_encode($payload),
            'hash' => base64_encode(hash('sha256', $canonical, true)),
        ];
    }

    /**
     * بناء حقل TLV واحد: [وسم 1 بايت][طول القيمة 1 بايت][القيمة UTF-8].
     */
    public function tlv(int $tag, string $value): string
    {
        return chr($tag) . chr(strlen($value)) . $value;
    }

    /**
     * تحويل المبلغ من الهللات (bigint) إلى صيغة عشرية نصية — بلا float.
     * 115000 → "1150.00" ، 10050 → "100.50"
     */
    public function formatAmount(int $minor): string
    {
        $sign  = $minor < 0 ? '-' : '';
        $minor = abs($minor);

        return sprintf('%s%d.%02d', $sign, intdiv($minor, 100), $minor % 100);
    }
}
