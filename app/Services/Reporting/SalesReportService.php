<?php

namespace App\Services\Reporting;

use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\JournalLine;
use App\Models\Payment;
use App\Support\ReportBranchScope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * تقارير المبيعات التحليلية — قراءة فقط.
 *
 * المصدر هو الفواتير المرحّلة وسندات القبض المرحّلة، لا المسودات ولا الأرقام
 * المدخلة في الواجهة. لا تُكتب هذه الخدمة قيداً أو رصيداً ولا تحدّث أي نموذج.
 * الأرقام الداخلة والخارجة كلها هللات صحيحة؛ التحويل إلى ريال مسؤولية المورد.
 */
class SalesReportService
{
    public const VIEWS = ['period', 'customer', 'product', 'classification', 'salesperson', 'profit', 'payments'];
    public const INTERVALS = ['day', 'week', 'month', 'year'];

    /**
     * @return array{view:string, rows:array<int,array<string,mixed>>, totals:array<string,int>, scope:array<string,mixed>}
     */
    public function report(string $view, array $filters = []): array
    {
        if (! in_array($view, self::VIEWS, true)) {
            throw new RuntimeException("نوع تقرير مبيعات غير معروف: {$view}");
        }

        $interval = in_array($filters['interval'] ?? null, self::INTERVALS, true)
            ? $filters['interval']
            : 'month';

        $result = match ($view) {
            'period'      => $this->byPeriod($filters, $interval),
            'customer'    => $this->byCustomer($filters),
            'product'     => $this->byProduct($filters),
            'classification' => $this->byClassification($filters),
            'salesperson' => $this->bySalesperson($filters),
            'profit'      => $this->profitByPeriod($filters, $interval),
            'payments'    => $this->paymentsByPeriod($filters, $interval),
        };

        return [
            'view'   => $view,
            'rows'   => $result['rows'],
            'totals' => $result['totals'],
            'scope'  => [
                'interval' => $interval,
                'source'   => $view === 'payments' ? 'posted_receipts' : 'posted_sales_invoices',
            ],
        ];
    }

    /** فواتير مبيعات مرحّلة فقط؛ المسودة ليست بيعاً ولا يحق أن تظهر في تقرير. */
    private function invoices(array $filters): Builder
    {
        $query = Invoice::query()
            ->where('invoices.status', 'posted')
            ->where('invoices.type', 'sale');

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

        $branches = ReportBranchScope::resolve($filters);
        if ($branches !== null) {
            $query->whereIn('invoices.branch_id', $branches);
        }
        if (! empty($filters['customer_id'])) {
            $query->where('invoices.partner_id', $filters['customer_id']);
        }
        if (! empty($filters['customer_classification_id'])) {
            $query->whereHas('partner', fn (Builder $partner) => $partner->where('customer_classification_id', $filters['customer_classification_id']));
        }
        if (! empty($filters['classification_id'])) {
            $query->where('invoices.classification_id', $filters['classification_id']);
        }
        if (! empty($filters['salesperson_id'])) {
            $query->where('invoices.salesperson_id', $filters['salesperson_id']);
        }
        if (! empty($filters['payment_status'])) {
            $query->where('invoices.payment_status', $filters['payment_status']);
        }

        // في تقارير الرأس، الصنف يعني «فواتير تحتوي الصنف» لا نسبةً مخفية من
        // الإجمالي. تقرير المنتج نفسه ينتقل إلى invoice_lines ويجمع السطور فقط.
        if (! empty($filters['product_id'])) {
            $query->whereHas('lines', fn (Builder $lines) => $lines->where('product_id', $filters['product_id']));
        }
        // VAR-REPORT-1: إضافيٌّ بحت — منتجٌ بسيط لا يملك متغيّراً فلا يتأثر.
        // منتجٌ متعدد الخيارات: تحديد متغيّرٍ فعليٍّ بعينه (لا نسخة تحقّقٍ
        // جديدة هنا — عدم تطابق منتجٍ آخر أو مستأجرٍ آخر يُرجع صفوفاً فارغة
        // فحسب عبر WHERE عادي، بلا أي تسريب).
        if (! empty($filters['product_variant_id'])) {
            $query->whereHas('lines', fn (Builder $lines) => $lines->where('product_variant_id', $filters['product_variant_id']));
        }
        if (! empty($filters['product_category_id'])) {
            $query->whereHas('lines.product', fn (Builder $product) => $product->where('category_id', $filters['product_category_id']));
        }
    }

    /** @return array{rows:array<int,array<string,mixed>>, totals:array<string,int>} */
    private function byPeriod(array $filters, string $interval): array
    {
        $bucket = $this->dateBucket('invoices.invoice_date', $interval);
        $rows = $this->invoices($filters)
            ->selectRaw("{$bucket} as bucket, COUNT(*) as invoices_count, SUM(invoices.total) as amount")
            ->groupBy(DB::raw($bucket))
            ->orderBy('bucket')
            ->get()
            ->map(fn ($row) => [
                'key'      => (string) $row->bucket,
                'label'    => (string) $row->bucket,
                'invoices' => (int) $row->invoices_count,
                'amount'   => (int) $row->amount,
            ])->all();

        return ['rows' => $rows, 'totals' => $this->invoiceTotals($filters)];
    }

    /** @return array{rows:array<int,array<string,mixed>>, totals:array<string,int>} */
    private function byCustomer(array $filters): array
    {
        $rows = $this->invoices($filters)
            ->join('partners', 'partners.id', '=', 'invoices.partner_id')
            ->selectRaw('partners.id as bucket_key, partners.name as bucket_label, COUNT(invoices.id) as invoices_count, SUM(invoices.total) as amount')
            ->groupBy('partners.id', 'partners.name')
            ->orderByDesc('amount')
            ->get()
            ->map(fn ($row) => [
                'key'      => (string) $row->bucket_key,
                'label'    => (string) $row->bucket_label,
                'invoices' => (int) $row->invoices_count,
                'amount'   => (int) $row->amount,
            ])->all();

        return ['rows' => $rows, 'totals' => $this->invoiceTotals($filters)];
    }

    /**
     * VAR-REPORT-1 — الهويّة الآن `product_id` + `product_variant_id` (لا
     * `product_id` وحده): متغيّرٌ شقيقٌ (أسود/كبير مقابل أسود/صغير) يُنتج
     * سطراً مستقلاً، لا يندمجان معاً. منتجٌ بسيطٌ (`product_variant_id
     * IS NULL`) يحتفظ بنفس المفتاح/التجميع حرفياً كما كان قبل هذا المعيار.
     *
     * **الحقيقة التاريخية**: التسمية تُبنى من لقطة السطر نفسه
     * (`product_name_snapshot`/`variant_descriptor_snapshot`، VAR-DOC-1) لا
     * من `products.name` الحيّ — إعادة تسمية منتجٍ اليوم لا تُعيد كتابة
     * تقرير الأمس. `products.name` يبقى **احتياطاً فقط** لسطورٍ قديمة
     * أُنشئت قبل إضافة اللقطة (عمودٌ اختياريٌّ بلا ترحيلٍ عكسي) — نفس
     * السلوك الحيّ الذي كانت عليه كل الصفوف قبل هذا المعيار، فلا صفَّ
     * موجود يفقد تسميته.
     *
     * @return array{rows:array<int,array<string,mixed>>, totals:array<string,int>}
     */
    private function byProduct(array $filters): array
    {
        $invoiceFilters = $filters;
        unset($invoiceFilters['product_id'], $invoiceFilters['product_category_id'], $invoiceFilters['product_variant_id']);
        $invoiceIds = $this->invoices($invoiceFilters)->select('invoices.id');

        $query = InvoiceLine::query()
            ->leftJoin('products', 'products.id', '=', 'invoice_lines.product_id')
            ->whereIn('invoice_lines.invoice_id', $invoiceIds);

        if (! empty($filters['product_id'])) {
            $query->where('invoice_lines.product_id', $filters['product_id']);
        }
        if (! empty($filters['product_variant_id'])) {
            $query->where('invoice_lines.product_variant_id', $filters['product_variant_id']);
        }
        if (! empty($filters['product_category_id'])) {
            $query->where('products.category_id', $filters['product_category_id']);
        }

        $rows = $query
            ->selectRaw('invoice_lines.product_id as bucket_key, invoice_lines.product_variant_id as bucket_variant_id, '
                .'MAX(invoice_lines.product_name_snapshot) as bucket_name_snapshot, MAX(invoice_lines.variant_descriptor_snapshot) as bucket_variant_descriptor, '
                .'products.name as bucket_live_name, SUM(invoice_lines.quantity) as quantity, SUM(invoice_lines.line_total) as amount')
            ->groupBy('invoice_lines.product_id', 'invoice_lines.product_variant_id', 'products.name')
            ->orderByDesc('amount')
            ->get()
            ->map(function ($row) {
                $name = $row->bucket_name_snapshot ?: $row->bucket_live_name;
                $label = $name === null || $name === ''
                    ? null
                    : ($row->bucket_variant_descriptor ? "{$name} — {$row->bucket_variant_descriptor}" : $name);

                // مفتاحٌ فريد لكل سطر: منتجٌ بسيطٌ يبقى `product_id` وحده
                // حرفياً (لا متغيّر له فيتطابق حتماً)؛ متغيّرٌ فعليٌّ يُلحَق
                // معرّفه فلا يتصادم مفتاحا شقيقين على نفس المنتج.
                $key = $row->bucket_key === null
                    ? null
                    : ($row->bucket_variant_id !== null ? "{$row->bucket_key}:{$row->bucket_variant_id}" : (string) $row->bucket_key);

                return [
                    'key'                => $key,
                    'label'              => $label,
                    'product_id'         => $row->bucket_key === null ? null : (string) $row->bucket_key,
                    'product_variant_id' => $row->bucket_variant_id === null ? null : (string) $row->bucket_variant_id,
                    'variant_descriptor' => $row->bucket_variant_descriptor,
                    'quantity'           => (int) $row->quantity,
                    'amount'             => (int) $row->amount,
                ];
            })->all();

        return [
            'rows' => $rows,
            // إجمالي البنود ليس بالضرورة إجمالي رؤوس الفواتير: الشحن والخصم
            // والرسم يعيشان على الرأس، ولذلك يُكشف هذا المجموع مستقلاً وصريحاً.
            'totals' => [
                'invoices' => (clone $this->invoices($filters))->count(),
                'amount'   => array_sum(array_column($rows, 'amount')),
            ],
        ];
    }

    /** تجميع رؤوس الفواتير حسب تصنيف المستند: لا JOIN على السطور كي لا يتكرر الإجمالي. */
    private function byClassification(array $filters): array
    {
        $rows = $this->invoices($filters)
            ->leftJoin('classifications', 'classifications.id', '=', 'invoices.classification_id')
            ->selectRaw('invoices.classification_id as bucket_key, classifications.name as bucket_label, COUNT(invoices.id) as invoices_count, SUM(invoices.total) as amount')
            ->groupBy('invoices.classification_id', 'classifications.name')
            ->orderByDesc('amount')
            ->get()
            ->map(fn ($row) => [
                'key' => $row->bucket_key === null ? null : (string) $row->bucket_key,
                'label' => $row->bucket_label === null || $row->bucket_label === '' ? 'غير مصنف' : (string) $row->bucket_label,
                'invoices' => (int) $row->invoices_count,
                'amount' => (int) $row->amount,
            ])->all();

        return ['rows' => $rows, 'totals' => $this->invoiceTotals($filters)];
    }

    /** @return array{rows:array<int,array<string,mixed>>, totals:array<string,int>} */
    private function bySalesperson(array $filters): array
    {
        $rows = $this->invoices($filters)
            ->leftJoin('employees', 'employees.id', '=', 'invoices.salesperson_id')
            ->selectRaw('invoices.salesperson_id as bucket_key, employees.name as bucket_label, COUNT(invoices.id) as invoices_count, SUM(invoices.total) as amount')
            ->groupBy('invoices.salesperson_id', 'employees.name')
            ->orderByDesc('amount')
            ->get()
            ->map(fn ($row) => [
                'key'      => $row->bucket_key === null ? null : (string) $row->bucket_key,
                'label'    => $row->bucket_label === null || $row->bucket_label === '' ? null : (string) $row->bucket_label,
                'invoices' => (int) $row->invoices_count,
                'amount'   => (int) $row->amount,
            ])->all();

        return ['rows' => $rows, 'totals' => $this->invoiceTotals($filters)];
    }

    /** @return array{rows:array<int,array<string,mixed>>, totals:array<string,int>} */
    private function profitByPeriod(array $filters, string $interval): array
    {
        $bucket = $this->dateBucket('invoices.invoice_date', $interval);
        $cogs = JournalLine::query()
            ->selectRaw('journal_entry_id, SUM(debit) as cogs_amount')
            ->groupBy('journal_entry_id');

        $rows = $this->invoices($filters)
            ->leftJoinSub($cogs, 'cogs', 'cogs.journal_entry_id', '=', 'invoices.cogs_entry_id')
            ->selectRaw("{$bucket} as bucket, SUM(invoices.subtotal - invoices.discount + invoices.shipping + invoices.adjustment) as revenue, SUM(COALESCE(cogs.cogs_amount, 0)) as cost")
            ->groupBy(DB::raw($bucket))
            ->orderBy('bucket')
            ->get()
            ->map(function ($row) {
                $revenue = (int) $row->revenue;
                $cost = (int) $row->cost;

                return [
                    'key'       => (string) $row->bucket,
                    'label'     => (string) $row->bucket,
                    'revenue'   => $revenue,
                    'cost'      => $cost,
                    'profit'    => $revenue - $cost,
                    // يخرج كنقطة أساس لا float: 2500 = 25.00%، والعرض وحده
                    // ينسّقه؛ لا يدخل في أي حساب مالي جديد.
                    'margin_bp' => $revenue > 0 ? intdiv(($revenue - $cost) * 10000, $revenue) : 0,
                ];
            })->all();

        $revenue = array_sum(array_column($rows, 'revenue'));
        $cost = array_sum(array_column($rows, 'cost'));
        $profit = $revenue - $cost;

        return [
            'rows' => $rows,
            'totals' => [
                'revenue' => $revenue,
                'cost'    => $cost,
                'profit'  => $profit,
                'margin_bp' => $revenue > 0 ? intdiv($profit * 10000, $revenue) : 0,
            ],
        ];
    }

    /** @return array{rows:array<int,array<string,mixed>>, totals:array<string,int>} */
    private function paymentsByPeriod(array $filters, string $interval): array
    {
        $query = Payment::query()
            ->where('payments.direction', 'received')
            ->where('payments.status', 'posted');

        if (! empty($filters['from'])) {
            $query->whereDate('payments.payment_date', '>=', $filters['from']);
        }
        if (! empty($filters['to'])) {
            $query->whereDate('payments.payment_date', '<=', $filters['to']);
        }
        $branches = ReportBranchScope::resolve($filters);
        if ($branches !== null) {
            $query->whereIn('payments.branch_id', $branches);
        }
        if (! empty($filters['customer_id'])) {
            $query->where('payments.partner_id', $filters['customer_id']);
        }
        if (! empty($filters['receipt_method'])) {
            $query->where('payments.method', $filters['receipt_method']);
        }

        $bucket = $this->dateBucket('payments.payment_date', $interval);
        $rows = $query
            ->selectRaw("{$bucket} as bucket, COUNT(*) as receipts_count, SUM(payments.amount) as amount")
            ->groupBy(DB::raw($bucket))
            ->orderBy('bucket')
            ->get()
            ->map(fn ($row) => [
                'key'      => (string) $row->bucket,
                'label'    => (string) $row->bucket,
                'receipts' => (int) $row->receipts_count,
                'amount'   => (int) $row->amount,
            ])->all();

        return [
            'rows' => $rows,
            'totals' => [
                'receipts' => array_sum(array_column($rows, 'receipts')),
                'amount'   => array_sum(array_column($rows, 'amount')),
            ],
        ];
    }

    /** @return array{invoices:int, amount:int, net_sales:int, tax:int} */
    private function invoiceTotals(array $filters): array
    {
        $summary = $this->invoices($filters)
            ->selectRaw('COUNT(*) as invoices_count, COALESCE(SUM(invoices.total), 0) as amount, COALESCE(SUM(invoices.subtotal - invoices.discount + invoices.shipping + invoices.adjustment), 0) as net_sales, COALESCE(SUM(invoices.tax_amount), 0) as tax')
            ->first();

        return [
            'invoices' => (int) ($summary->invoices_count ?? 0),
            'amount'   => (int) ($summary->amount ?? 0),
            'net_sales' => (int) ($summary->net_sales ?? 0),
            'tax'      => (int) ($summary->tax ?? 0),
        ];
    }

    /**
     * تاريخ SQL متوافق بين SQLite وPostgreSQL، بعبارة داخلية ثابتة لا يمررها العميل.
     */
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
