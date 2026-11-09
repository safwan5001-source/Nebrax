<?php

namespace App\Services;

use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * قارئ التواريخ الأربعة لتسوية وردية (P1-3b-2a) — **قراءة فقط**: صفر كتابة وصفر قفل، تواريخ ومعرّفات فقط (لا مبالغ ولا تكاليف).
 *
 * لا نسخ للتاريخين 3 و4 إلى رأس التسوية (انظر هجرة 2027_01_21_010000): تُقرأ من مصدريهما الثابتين عبر سلسلة
 * سطر التسوية ← بيع الوقود ← الفاتورة ← القيد، فتبقى كل فاتورة صاحبة لحظتها ولو رُحِّلت أسطر الوردية في أوقات مختلفة.
 *
 * العزل: كل جدول مربوط بالمستأجر الحالي صراحةً (الاستعلام بـQuery Builder يتجاوز نطاقات النماذج)؛ مستأجر آخر أو تسوية غير موجودة ⇒ null.
 */
class FuelShiftSettlementDates
{
    public function __construct(private TenantContext $tenant) {}

    /**
     * @return array{
     *   settlement_id:string,
     *   supply:array{started_at:string,ended_at:string,business_date:string},
     *   accounting_date:string,
     *   lines:list<array<string,mixed>>
     * }|null
     */
    public function forSettlement(string $settlementId): ?array
    {
        $tenantId = $this->tenant->id();
        if ($tenantId === null) {
            return null;
        }

        $header = DB::table('fuel_shift_settlements')->where('tenant_id', $tenantId)->where('id', $settlementId)->first();
        if ($header === null) {
            return null;
        }

        $rows = DB::table('fuel_shift_settlement_lines as l')
            ->leftJoin('fuel_sales as s', fn ($j) => $j->on('s.id', '=', 'l.fuel_sale_id')->where('s.tenant_id', '=', $tenantId))
            ->leftJoin('invoices as i', fn ($j) => $j->on('i.id', '=', 's.invoice_id')->where('i.tenant_id', '=', $tenantId))
            ->leftJoin('journal_entries as je', fn ($j) => $j->on('je.id', '=', 'i.journal_entry_id')->where('je.tenant_id', '=', $tenantId))
            ->where('l.tenant_id', $tenantId)->where('l.fuel_shift_settlement_id', $settlementId)
            ->orderBy('l.fuel_nozzle_id')
            ->get([
                'l.id as line_id', 'l.fuel_nozzle_id', 'l.state', 'l.fuel_sale_id',
                'i.id as invoice_id', 'i.invoice_date', 'i.issued_at',
                'je.entry_date', 'je.created_at as entry_recorded_at',
            ]);

        return [
            'settlement_id' => (string) $header->id,
            'supply' => [
                'started_at' => (string) $header->supply_started_at,
                'ended_at' => (string) $header->supply_ended_at,
                'business_date' => substr((string) $header->supply_business_date, 0, 10),
            ],
            'accounting_date' => substr((string) $header->accounting_date, 0, 10),
            'lines' => $rows->map(fn ($r) => [
                'line_id' => (string) $r->line_id,
                'fuel_nozzle_id' => (string) $r->fuel_nozzle_id,
                'state' => (string) $r->state,
                'fuel_sale_id' => $r->fuel_sale_id,
                'invoice_id' => $r->invoice_id,
                // 2) تاريخ الفاتورة · 3) لحظة الإصدار · 4) تاريخ القيد ولحظة كتابته — كلها من مصادرها الثابتة.
                'invoice_date' => $r->invoice_date === null ? null : substr((string) $r->invoice_date, 0, 10),
                'issued_at' => $r->issued_at,
                'entry_date' => $r->entry_date === null ? null : substr((string) $r->entry_date, 0, 10),
                'entry_recorded_at' => $r->entry_recorded_at,
            ])->all(),
        ];
    }
}
