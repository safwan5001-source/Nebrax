<?php

namespace App\Services\Reporting;

use App\Models\Appointment;
use App\Models\Invoice;
use App\Models\Payment;
use App\Tenancy\BranchScope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * تقارير العملاء التحليلية — قراءة فقط من مصادرها التشغيلية المرحّلة.
 *
 * تعتمد تقارير المبيعات والأرصدة على فواتير البيع المرحّلة، ومدفوعات العملاء
 * على سندات القبض المرحّلة فقط. تقرير المواعيد تشغيلي صريح ولا يدّعي أثراً
 * محاسبياً. لا تنشئ هذه الخدمة قيوداً أو تحدّث أرصدةً أو مستندات.
 */
class CustomerReportService
{
    public const VIEWS = ['sales', 'balances', 'payments', 'appointments'];

    public const INTERVALS = ['day', 'week', 'month', 'year'];

    /**
     * @return array{view:string,rows:array<int,array<string,mixed>>,totals:array<string,int>,scope:array<string,mixed>}
     */
    public function report(string $view, array $filters = []): array
    {
        if (! in_array($view, self::VIEWS, true)) {
            throw new RuntimeException("نوع تقرير عملاء غير معروف: {$view}");
        }

        $interval = in_array($filters['interval'] ?? null, self::INTERVALS, true)
            ? $filters['interval']
            : 'month';

        $result = match ($view) {
            'sales'        => $this->salesByCustomer($filters),
            'balances'     => $this->customerBalances($filters),
            'payments'     => $this->receiptsByPeriod($filters, $interval),
            'appointments' => $this->appointmentsByCustomer($filters),
        };

        return [
            'view' => $view,
            'rows' => $result['rows'],
            'totals' => $result['totals'],
            'scope' => [
                'interval' => $interval,
                'source' => match ($view) {
                    'payments' => 'posted_customer_receipts',
                    'appointments' => 'customer_appointments',
                    default => 'posted_customer_invoices',
                },
            ],
        ];
    }

    /** فواتير بيع مرحّلة فقط؛ لا تدخل المسودة في المبيعات أو الذمم. */
    private function invoices(array $filters): Builder
    {
        $query = Invoice::query()
            // تقرير العملاء يختار الفروع صراحةً: بلا اختيار = كل فروع المستأجر.
            ->withoutGlobalScope(BranchScope::class)
            ->where('invoices.type', 'sale')
            ->where('invoices.status', 'posted');

        $this->applyInvoiceFilters($query, $filters);

        return $query;
    }

    private function applyInvoiceFilters(Builder $query, array $filters): void
    {
        if (! empty($filters['from'])) {
            $query->whereDate('invoices.invoice_date', '>=', $filters['from']);
        }
        if (! empty($filters['to'])) {
            $query->whereDate('invoices.invoice_date', '<=', $filters['to']);
        }

        $branches = array_filter((array) ($filters['branch_id'] ?? []));
        if ($branches !== []) {
            $query->whereIn('invoices.branch_id', $branches);
        }
        if (! empty($filters['customer_id'])) {
            $query->where('invoices.partner_id', $filters['customer_id']);
        }
        if (! empty($filters['payment_status'])) {
            $query->where('invoices.payment_status', $filters['payment_status']);
        }
    }

    /** @return array{rows:array<int,array<string,mixed>>,totals:array<string,int>} */
    private function salesByCustomer(array $filters): array
    {
        $rows = $this->invoices($filters)
            ->join('partners', 'partners.id', '=', 'invoices.partner_id')
            ->whereIn('partners.type', ['customer', 'both'])
            ->selectRaw('partners.id as bucket_key, partners.name as bucket_label, COUNT(invoices.id) as invoices_count, SUM(invoices.total) as amount')
            ->groupBy('partners.id', 'partners.name')
            ->orderByDesc('amount')
            ->get()
            ->map(fn ($row) => [
                'key' => (string) $row->bucket_key,
                'label' => (string) $row->bucket_label,
                'invoices' => (int) $row->invoices_count,
                'amount' => (int) $row->amount,
            ])->all();

        return ['rows' => $rows, 'totals' => $this->invoiceTotals($filters)];
    }

    /** @return array{rows:array<int,array<string,mixed>>,totals:array<string,int>} */
    private function customerBalances(array $filters): array
    {
        $rows = $this->invoices($filters)
            ->join('partners', 'partners.id', '=', 'invoices.partner_id')
            ->whereIn('partners.type', ['customer', 'both'])
            ->selectRaw('partners.id as bucket_key, partners.name as bucket_label, COUNT(invoices.id) as invoices_count, SUM(invoices.total) as amount, SUM(invoices.total - invoices.paid_amount) as balance')
            ->groupBy('partners.id', 'partners.name')
            ->havingRaw('SUM(invoices.total - invoices.paid_amount) > 0')
            ->orderByDesc('balance')
            ->get()
            ->map(fn ($row) => [
                'key' => (string) $row->bucket_key,
                'label' => (string) $row->bucket_label,
                'invoices' => (int) $row->invoices_count,
                'amount' => (int) $row->amount,
                'balance' => (int) $row->balance,
            ])->all();

        return [
            'rows' => $rows,
            'totals' => [
                'invoices' => array_sum(array_column($rows, 'invoices')),
                'amount' => array_sum(array_column($rows, 'amount')),
                'balance' => array_sum(array_column($rows, 'balance')),
            ],
        ];
    }

    /** @return array{rows:array<int,array<string,mixed>>,totals:array<string,int>} */
    private function receiptsByPeriod(array $filters, string $interval): array
    {
        $query = Payment::query()
            ->withoutGlobalScope(BranchScope::class)
            ->join('partners', 'partners.id', '=', 'payments.partner_id')
            ->where('payments.direction', 'received')
            ->where('payments.status', 'posted')
            ->whereIn('partners.type', ['customer', 'both']);

        if (! empty($filters['from'])) {
            $query->whereDate('payments.payment_date', '>=', $filters['from']);
        }
        if (! empty($filters['to'])) {
            $query->whereDate('payments.payment_date', '<=', $filters['to']);
        }
        $branches = array_filter((array) ($filters['branch_id'] ?? []));
        if ($branches !== []) {
            $query->whereIn('payments.branch_id', $branches);
        }
        if (! empty($filters['customer_id'])) {
            $query->where('payments.partner_id', $filters['customer_id']);
        }
        if (! empty($filters['payment_method'])) {
            $query->where('payments.method', $filters['payment_method']);
        }

        $bucket = $this->dateBucket('payments.payment_date', $interval);
        $rows = $query
            ->selectRaw("{$bucket} as bucket, COUNT(*) as receipts_count, SUM(payments.amount) as amount")
            ->groupBy(DB::raw($bucket))
            ->orderBy('bucket')
            ->get()
            ->map(fn ($row) => [
                'key' => (string) $row->bucket,
                'label' => (string) $row->bucket,
                'receipts' => (int) $row->receipts_count,
                'amount' => (int) $row->amount,
            ])->all();

        return [
            'rows' => $rows,
            'totals' => [
                'receipts' => array_sum(array_column($rows, 'receipts')),
                'amount' => array_sum(array_column($rows, 'amount')),
            ],
        ];
    }

    /** @return array{rows:array<int,array<string,mixed>>,totals:array<string,int>} */
    private function appointmentsByCustomer(array $filters): array
    {
        $query = Appointment::query()
            ->withoutGlobalScope(BranchScope::class)
            ->join('partners', 'partners.id', '=', 'appointments.partner_id')
            ->whereIn('partners.type', ['customer', 'both']);

        if (! empty($filters['from'])) {
            $query->whereDate('appointments.appointment_at', '>=', $filters['from']);
        }
        if (! empty($filters['to'])) {
            $query->whereDate('appointments.appointment_at', '<=', $filters['to']);
        }
        $branches = array_filter((array) ($filters['branch_id'] ?? []));
        if ($branches !== []) {
            $query->whereIn('appointments.branch_id', $branches);
        }
        if (! empty($filters['customer_id'])) {
            $query->where('appointments.partner_id', $filters['customer_id']);
        }
        if (! empty($filters['appointment_status'])) {
            $query->where('appointments.status', $filters['appointment_status']);
        }

        $rows = $query
            ->selectRaw("partners.id as bucket_key, partners.name as bucket_label, COUNT(appointments.id) as appointments_count, SUM(CASE WHEN appointments.status = 'scheduled' THEN 1 ELSE 0 END) as scheduled_count, SUM(CASE WHEN appointments.status = 'done' THEN 1 ELSE 0 END) as done_count, SUM(CASE WHEN appointments.status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count")
            ->groupBy('partners.id', 'partners.name')
            ->orderByDesc('appointments_count')
            ->get()
            ->map(fn ($row) => [
                'key' => (string) $row->bucket_key,
                'label' => (string) $row->bucket_label,
                'appointments' => (int) $row->appointments_count,
                'scheduled' => (int) $row->scheduled_count,
                'done' => (int) $row->done_count,
                'cancelled' => (int) $row->cancelled_count,
            ])->all();

        return [
            'rows' => $rows,
            'totals' => [
                'appointments' => array_sum(array_column($rows, 'appointments')),
                'scheduled' => array_sum(array_column($rows, 'scheduled')),
                'done' => array_sum(array_column($rows, 'done')),
                'cancelled' => array_sum(array_column($rows, 'cancelled')),
            ],
        ];
    }

    /** @return array{invoices:int,amount:int,net_sales:int,tax:int} */
    private function invoiceTotals(array $filters): array
    {
        $summary = $this->invoices($filters)
            ->selectRaw('COUNT(*) as invoices_count, COALESCE(SUM(invoices.total), 0) as amount, COALESCE(SUM(invoices.subtotal - invoices.discount + invoices.shipping + invoices.adjustment), 0) as net_sales, COALESCE(SUM(invoices.tax_amount), 0) as tax')
            ->first();

        return [
            'invoices' => (int) ($summary->invoices_count ?? 0),
            'amount' => (int) ($summary->amount ?? 0),
            'net_sales' => (int) ($summary->net_sales ?? 0),
            'tax' => (int) ($summary->tax ?? 0),
        ];
    }

    /** تاريخ SQL متوافق بين SQLite وPostgreSQL، بعبارة ثابتة لا يمررها العميل. */
    private function dateBucket(string $column, string $interval): string
    {
        $pgsql = DB::connection()->getDriverName() === 'pgsql';

        return match ($interval) {
            'day' => $column,
            'week' => $pgsql
                ? "to_char({$column}, 'IYYY-\"W\"IW')"
                : "strftime('%Y-W%W', {$column})",
            'year' => $pgsql
                ? "to_char({$column}, 'YYYY')"
                : "strftime('%Y', {$column})",
            default => $pgsql
                ? "to_char({$column}, 'YYYY-MM')"
                : "strftime('%Y-%m', {$column})",
        };
    }
}
