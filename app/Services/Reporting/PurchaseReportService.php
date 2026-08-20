<?php

namespace App\Services\Reporting;

use App\Models\Payment;
use App\Models\Purchase;
use App\Models\PurchaseLine;
use App\Tenancy\BranchScope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * تقارير المشتريات التحليلية — قراءة فقط.
 *
 * المصدر هو فواتير الشراء المرحّلة وسندات الصرف المرحّلة، لا المسودات ولا
 * الأرقام المدخلة في الواجهة. لا تكتب الخدمة قيداً أو رصيداً ولا تحدّث أي نموذج.
 * كل المبالغ الداخلة والخارجة هللات صحيحة؛ التحويل إلى ريال مسؤولية المورد.
 */
class PurchaseReportService
{
    public const VIEWS = ['period', 'supplier', 'product', 'classification', 'employee', 'balances', 'payments'];

    public const INTERVALS = ['day', 'week', 'month', 'year'];

    /**
     * @return array{view:string, rows:array<int,array<string,mixed>>, totals:array<string,int>, scope:array<string,mixed>}
     */
    public function report(string $view, array $filters = []): array
    {
        if (! in_array($view, self::VIEWS, true)) {
            throw new RuntimeException("نوع تقرير مشتريات غير معروف: {$view}");
        }

        $interval = in_array($filters['interval'] ?? null, self::INTERVALS, true)
            ? $filters['interval']
            : 'month';

        $result = match ($view) {
            'period'   => $this->byPeriod($filters, $interval),
            'supplier' => $this->bySupplier($filters),
            'product'  => $this->byProduct($filters),
            'classification' => $this->byClassification($filters),
            'employee' => $this->byEmployee($filters),
            'balances' => $this->supplierBalances($filters),
            'payments' => $this->paymentsByPeriod($filters, $interval),
        };

        return [
            'view'   => $view,
            'rows'   => $result['rows'],
            'totals' => $result['totals'],
            'scope'  => [
                'interval' => $interval,
                'source'   => $view === 'payments' ? 'posted_supplier_payments' : 'posted_purchase_invoices',
            ],
        ];
    }

    /** فواتير شراء مرحّلة فقط؛ المسودة ليست مشتريات ولا يحق أن تظهر في تقرير. */
    private function purchases(array $filters): Builder
    {
        // التقرير المجمّع يختار الفروع صراحةً: بلا اختيار = كل فروع المستأجر، لا الفرع النشط فقط.
        $query = Purchase::query()
            ->withoutGlobalScope(BranchScope::class)
            ->where('purchases.status', 'posted');

        $this->applyPurchaseFilters($query, $filters);

        return $query;
    }

    private function applyPurchaseFilters(Builder $query, array $filters): void
    {
        if (! empty($filters['from'])) {
            $query->whereDate('purchases.purchase_date', '>=', $filters['from']);
        }
        if (! empty($filters['to'])) {
            $query->whereDate('purchases.purchase_date', '<=', $filters['to']);
        }

        $branches = array_filter((array) ($filters['branch_id'] ?? []));
        if ($branches !== []) {
            $query->whereIn('purchases.branch_id', $branches);
        }
        if (! empty($filters['supplier_id'])) {
            $query->where('purchases.partner_id', $filters['supplier_id']);
        }
        if (! empty($filters['supplier_classification_id'])) {
            $query->whereHas('partner', fn (Builder $partner) => $partner->where('supplier_classification_id', $filters['supplier_classification_id']));
        }
        if (! empty($filters['classification_id'])) {
            $query->where('purchases.classification_id', $filters['classification_id']);
        }
        if (! empty($filters['creator_id'])) {
            $query->where('purchases.created_by', $filters['creator_id']);
        }
        if (! empty($filters['payment_status'])) {
            $query->where('purchases.payment_status', $filters['payment_status']);
        }
        if (! empty($filters['received_status'])) {
            $query->where('purchases.received_status', $filters['received_status']);
        }

        // في تقارير الرأس، الصنف يعني «فواتير تحتوي الصنف» لا نسبةً مخفية من
        // الإجمالي. تقرير المنتج نفسه ينتقل إلى purchase_lines ويجمع السطور فقط.
        if (! empty($filters['product_id'])) {
            $query->whereHas('lines', fn (Builder $lines) => $lines->where('product_id', $filters['product_id']));
        }
        if (! empty($filters['product_category_id'])) {
            $query->whereHas('lines.product', fn (Builder $product) => $product->where('category_id', $filters['product_category_id']));
        }
    }

    /** @return array{rows:array<int,array<string,mixed>>, totals:array<string,int>} */
    private function byPeriod(array $filters, string $interval): array
    {
        $bucket = $this->dateBucket('purchases.purchase_date', $interval);
        $rows = $this->purchases($filters)
            ->selectRaw("{$bucket} as bucket, COUNT(*) as purchases_count, SUM(purchases.total) as amount")
            ->groupBy(DB::raw($bucket))
            ->orderBy('bucket')
            ->get()
            ->map(fn ($row) => [
                'key'       => (string) $row->bucket,
                'label'     => (string) $row->bucket,
                'purchases' => (int) $row->purchases_count,
                'amount'    => (int) $row->amount,
            ])->all();

        return ['rows' => $rows, 'totals' => $this->purchaseTotals($filters)];
    }

    /** @return array{rows:array<int,array<string,mixed>>, totals:array<string,int>} */
    private function bySupplier(array $filters): array
    {
        $rows = $this->purchases($filters)
            ->join('partners', 'partners.id', '=', 'purchases.partner_id')
            ->selectRaw('partners.id as bucket_key, partners.name as bucket_label, COUNT(purchases.id) as purchases_count, SUM(purchases.total) as amount')
            ->groupBy('partners.id', 'partners.name')
            ->orderByDesc('amount')
            ->get()
            ->map(fn ($row) => [
                'key'       => (string) $row->bucket_key,
                'label'     => (string) $row->bucket_label,
                'purchases' => (int) $row->purchases_count,
                'amount'    => (int) $row->amount,
            ])->all();

        return ['rows' => $rows, 'totals' => $this->purchaseTotals($filters)];
    }

    /** @return array{rows:array<int,array<string,mixed>>, totals:array<string,int>} */
    private function byProduct(array $filters): array
    {
        $purchaseFilters = $filters;
        unset($purchaseFilters['product_id'], $purchaseFilters['product_category_id']);
        $purchaseIds = $this->purchases($purchaseFilters)->select('purchases.id');

        $query = PurchaseLine::query()
            ->leftJoin('products', 'products.id', '=', 'purchase_lines.product_id')
            ->whereIn('purchase_lines.purchase_id', $purchaseIds);

        if (! empty($filters['product_id'])) {
            $query->where('purchase_lines.product_id', $filters['product_id']);
        }
        if (! empty($filters['product_category_id'])) {
            $query->where('products.category_id', $filters['product_category_id']);
        }

        $rows = $query
            ->selectRaw('purchase_lines.product_id as bucket_key, products.name as bucket_label, SUM(purchase_lines.quantity) as quantity, SUM(purchase_lines.line_total) as amount')
            ->groupBy('purchase_lines.product_id', 'products.name')
            ->orderByDesc('amount')
            ->get()
            ->map(fn ($row) => [
                'key'      => $row->bucket_key === null ? null : (string) $row->bucket_key,
                'label'    => $row->bucket_label === null || $row->bucket_label === '' ? null : (string) $row->bucket_label,
                'quantity' => (int) $row->quantity,
                'amount'   => (int) $row->amount,
            ])->all();

        return [
            'rows' => $rows,
            // إجمالي البنود مستقل وصريح: الخصم والشحن والتسوية على رأس الفاتورة
            // لا تُوزّع على المنتجات خفيةً.
            'totals' => [
                'purchases' => (clone $this->purchases($filters))->count(),
                'amount'    => array_sum(array_column($rows, 'amount')),
            ],
        ];
    }

    /** تجميع رؤوس فواتير الشراء حسب تصنيف المستند؛ لا JOIN على السطور كي لا يتكرر الإجمالي. */
    private function byClassification(array $filters): array
    {
        $rows = $this->purchases($filters)
            ->leftJoin('classifications', 'classifications.id', '=', 'purchases.classification_id')
            ->selectRaw('purchases.classification_id as bucket_key, classifications.name as bucket_label, COUNT(purchases.id) as purchases_count, SUM(purchases.total) as amount')
            ->groupBy('purchases.classification_id', 'classifications.name')
            ->orderByDesc('amount')
            ->get()
            ->map(fn ($row) => [
                'key' => $row->bucket_key === null ? null : (string) $row->bucket_key,
                'label' => $row->bucket_label === null || $row->bucket_label === '' ? 'غير مصنف' : (string) $row->bucket_label,
                'purchases' => (int) $row->purchases_count,
                'amount' => (int) $row->amount,
            ])->all();

        return ['rows' => $rows, 'totals' => $this->purchaseTotals($filters)];
    }

    /** @return array{rows:array<int,array<string,mixed>>, totals:array<string,int>} */
    private function byEmployee(array $filters): array
    {
        $rows = $this->purchases($filters)
            ->leftJoin('users', function ($join) {
                $join->on('users.id', '=', 'purchases.created_by')
                    ->on('users.tenant_id', '=', 'purchases.tenant_id')
                    ->whereNull('users.deleted_at');
            })
            ->leftJoin('employees', function ($join) {
                $join->on('employees.id', '=', 'users.employee_id')
                    ->on('employees.tenant_id', '=', 'purchases.tenant_id');
            })
            ->selectRaw('purchases.created_by as bucket_key, COALESCE(employees.name, users.name) as bucket_label, COUNT(purchases.id) as purchases_count, SUM(purchases.total) as amount')
            ->groupBy('purchases.created_by', 'employees.name', 'users.name')
            ->orderByDesc('amount')
            ->get()
            ->map(fn ($row) => [
                'key'       => $row->bucket_key === null ? null : (string) $row->bucket_key,
                'label'     => $row->bucket_label === null || $row->bucket_label === '' ? null : (string) $row->bucket_label,
                'purchases' => (int) $row->purchases_count,
                'amount'    => (int) $row->amount,
            ])->all();

        return ['rows' => $rows, 'totals' => $this->purchaseTotals($filters)];
    }

    /** @return array{rows:array<int,array<string,mixed>>, totals:array<string,int>} */
    private function supplierBalances(array $filters): array
    {
        $rows = $this->purchases($filters)
            ->join('partners', 'partners.id', '=', 'purchases.partner_id')
            ->selectRaw('partners.id as bucket_key, partners.name as bucket_label, COUNT(purchases.id) as purchases_count, SUM(purchases.total) as amount, SUM(purchases.total - purchases.paid_amount) as balance')
            ->groupBy('partners.id', 'partners.name')
            ->havingRaw('SUM(purchases.total - purchases.paid_amount) > 0')
            ->orderByDesc('balance')
            ->get()
            ->map(fn ($row) => [
                'key'       => (string) $row->bucket_key,
                'label'     => (string) $row->bucket_label,
                'purchases' => (int) $row->purchases_count,
                'amount'    => (int) $row->amount,
                'balance'   => (int) $row->balance,
            ])->all();

        return [
            'rows' => $rows,
            'totals' => [
                'purchases' => array_sum(array_column($rows, 'purchases')),
                'amount'    => array_sum(array_column($rows, 'amount')),
                'balance'   => array_sum(array_column($rows, 'balance')),
            ],
        ];
    }

    /** @return array{rows:array<int,array<string,mixed>>, totals:array<string,int>} */
    private function paymentsByPeriod(array $filters, string $interval): array
    {
        $query = Payment::query()
            ->withoutGlobalScope(BranchScope::class)
            ->join('partners', 'partners.id', '=', 'payments.partner_id')
            ->where('payments.direction', 'paid')
            ->where('payments.status', 'posted')
            ->whereIn('partners.type', ['supplier', 'both']);

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
        if (! empty($filters['supplier_id'])) {
            $query->where('payments.partner_id', $filters['supplier_id']);
        }
        if (! empty($filters['payment_method'])) {
            $query->where('payments.method', $filters['payment_method']);
        }

        $bucket = $this->dateBucket('payments.payment_date', $interval);
        $rows = $query
            ->selectRaw("{$bucket} as bucket, COUNT(*) as payments_count, SUM(payments.amount) as amount")
            ->groupBy(DB::raw($bucket))
            ->orderBy('bucket')
            ->get()
            ->map(fn ($row) => [
                'key'      => (string) $row->bucket,
                'label'    => (string) $row->bucket,
                'payments' => (int) $row->payments_count,
                'amount'   => (int) $row->amount,
            ])->all();

        return [
            'rows' => $rows,
            'totals' => [
                'payments' => array_sum(array_column($rows, 'payments')),
                'amount'   => array_sum(array_column($rows, 'amount')),
            ],
        ];
    }

    /** @return array{purchases:int, amount:int, net_purchases:int, tax:int} */
    private function purchaseTotals(array $filters): array
    {
        $summary = $this->purchases($filters)
            ->selectRaw('COUNT(*) as purchases_count, COALESCE(SUM(purchases.total), 0) as amount, COALESCE(SUM(purchases.subtotal - purchases.discount + purchases.shipping + purchases.adjustment), 0) as net_purchases, COALESCE(SUM(purchases.tax_amount), 0) as tax')
            ->first();

        return [
            'purchases'    => (int) ($summary->purchases_count ?? 0),
            'amount'       => (int) ($summary->amount ?? 0),
            'net_purchases' => (int) ($summary->net_purchases ?? 0),
            'tax'          => (int) ($summary->tax ?? 0),
        ];
    }

    /** تاريخ SQL متوافق بين SQLite وPostgreSQL، بعبارة داخلية ثابتة لا يمررها العميل. */
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
