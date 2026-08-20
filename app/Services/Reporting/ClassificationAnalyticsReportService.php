<?php

namespace App\Services\Reporting;

use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\Purchase;
use App\Tenancy\BranchScope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * تقرير موحّد، قراءة فقط، للتصنيفات التحليلية المُدارة.
 *
 * كل نطاق يُجمع من رؤوس مستنداته أو أطرافه، لا من سطور الفواتير؛ لذلك لا
 * يتكرر إجمالي الفاتورة عند تعدد البنود. «غير مصنف» صف حقيقي يرصد فجوة البيانات.
 */
class ClassificationAnalyticsReportService
{
    public const SCOPES = [
        'sales_invoice', 'purchase_invoice', 'customer', 'supplier', 'receipt', 'payment',
    ];

    /** @return array{scope:string,rows:array<int,array<string,mixed>>,totals:array<string,int>} */
    public function report(array $filters): array
    {
        $scope = $filters['scope'] ?? null;
        if (! in_array($scope, self::SCOPES, true)) {
            throw new RuntimeException('نطاق تحليل التصنيف غير صالح.');
        }

        $result = match ($scope) {
            'sales_invoice' => $this->documents(Invoice::class, 'invoices', 'invoice_date', $filters),
            'purchase_invoice' => $this->documents(Purchase::class, 'purchases', 'purchase_date', $filters),
            'receipt' => $this->payments('received', $filters),
            'payment' => $this->payments('paid', $filters),
            'customer' => $this->partners('customer', 'invoices', 'invoice_date', $filters),
            'supplier' => $this->partners('supplier', 'purchases', 'purchase_date', $filters),
        };

        return ['scope' => $scope, ...$result];
    }

    /**
     * تجميع رؤوس الفواتير؛ لا join للسطور كي يظل كل مبلغ فاتورة محسوباً مرة واحدة.
     *
     * @return array{rows:array<int,array<string,mixed>>,totals:array<string,int>}
     */
    private function documents(string $model, string $table, string $dateColumn, array $filters): array
    {
        $query = $model::query()
            ->withoutGlobalScope(BranchScope::class)
            ->where("{$table}.status", 'posted');
        $this->applyDocumentFilters($query, $table, $dateColumn, $filters);

        $rows = $query
            ->leftJoin('classifications', 'classifications.id', '=', "{$table}.classification_id")
            ->selectRaw("{$table}.classification_id as bucket_key, classifications.name as bucket_label, COUNT({$table}.id) as records, COALESCE(SUM({$table}.total), 0) as amount")
            ->groupBy("{$table}.classification_id", 'classifications.name')
            ->orderByDesc('amount')
            ->get()
            ->map(fn ($row) => $this->row($row->bucket_key, $row->bucket_label, $row->records, $row->amount))
            ->all();

        return ['rows' => $rows, 'totals' => $this->totals($rows)];
    }

    /** @return array{rows:array<int,array<string,mixed>>,totals:array<string,int>} */
    private function payments(string $direction, array $filters): array
    {
        $query = Payment::query()
            ->withoutGlobalScope(BranchScope::class)
            ->where('payments.status', 'posted')
            ->where('payments.direction', $direction);
        $this->applyDocumentFilters($query, 'payments', 'payment_date', $filters);

        $rows = $query
            ->leftJoin('classifications', 'classifications.id', '=', 'payments.classification_id')
            ->selectRaw('payments.classification_id as bucket_key, classifications.name as bucket_label, COUNT(payments.id) as records, COALESCE(SUM(payments.amount), 0) as amount')
            ->groupBy('payments.classification_id', 'classifications.name')
            ->orderByDesc('amount')
            ->get()
            ->map(fn ($row) => $this->row($row->bucket_key, $row->bucket_label, $row->records, $row->amount))
            ->all();

        return ['rows' => $rows, 'totals' => $this->totals($rows)];
    }

    /**
     * تصنيف الطرف يظل مفيداً حتى إن لم يملك حركة في الفترة؛ لذلك يبدأ التقرير
     * من الطرف ويصل إلى مستنداته بربط خارجي مقيد بالحالة والتاريخ داخل join.
     *
     * @return array{rows:array<int,array<string,mixed>>,totals:array<string,int>}
     */
    private function partners(string $kind, string $table, string $dateColumn, array $filters): array
    {
        $classificationKey = "{$kind}_classification_id";
        $query = Partner::query()->withoutGlobalScope(BranchScope::class)
            ->whereIn('partners.type', $kind === 'customer' ? ['customer', 'both'] : ['supplier', 'both']);

        $branches = array_filter((array) ($filters['branch_id'] ?? []));
        if ($branches !== []) {
            // الطرف المركزي (بلا فرع) مرئي في التقارير متعددة الفروع، أما الطرف
            // المنسوب لفرع فيحترم اختيار الفروع كي لا يزيد عدّ «بلا حركة» خارج النطاق.
            $query->where(fn (Builder $partners) => $partners
                ->whereIn('partners.branch_id', $branches)
                ->orWhereNull('partners.branch_id'));
        }

        $query
            ->leftJoin($table, function ($join) use ($table, $dateColumn, $filters) {
                $join->on("{$table}.partner_id", '=', 'partners.id')
                    ->where("{$table}.status", '=', 'posted');
                if (! empty($filters['from'])) {
                    $join->whereDate("{$table}.{$dateColumn}", '>=', $filters['from']);
                }
                if (! empty($filters['to'])) {
                    $join->whereDate("{$table}.{$dateColumn}", '<=', $filters['to']);
                }
                $branches = array_filter((array) ($filters['branch_id'] ?? []));
                if ($branches !== []) {
                    $join->whereIn("{$table}.branch_id", $branches);
                }
            });

        if (! empty($filters['classification_id'])) {
            $query->where("partners.{$classificationKey}", $filters['classification_id']);
        }

        $rows = $query
            ->leftJoin('classifications', 'classifications.id', '=', "partners.{$classificationKey}")
            ->selectRaw("partners.{$classificationKey} as bucket_key, classifications.name as bucket_label, COUNT(DISTINCT partners.id) as records, COALESCE(SUM({$table}.total), 0) as amount")
            ->groupBy("partners.{$classificationKey}", 'classifications.name')
            ->orderByDesc('amount')
            ->get()
            ->map(fn ($row) => $this->row($row->bucket_key, $row->bucket_label, $row->records, $row->amount))
            ->all();

        return ['rows' => $rows, 'totals' => $this->totals($rows)];
    }

    private function applyDocumentFilters(Builder $query, string $table, string $dateColumn, array $filters): void
    {
        if (! empty($filters['from'])) {
            $query->whereDate("{$table}.{$dateColumn}", '>=', $filters['from']);
        }
        if (! empty($filters['to'])) {
            $query->whereDate("{$table}.{$dateColumn}", '<=', $filters['to']);
        }
        $branches = array_filter((array) ($filters['branch_id'] ?? []));
        if ($branches !== []) {
            $query->whereIn("{$table}.branch_id", $branches);
        }
        if (! empty($filters['classification_id'])) {
            $query->where("{$table}.classification_id", $filters['classification_id']);
        }
    }

    /** @return array{key:?string,label:?string,records:int,amount:int} */
    private function row(mixed $key, mixed $label, mixed $records, mixed $amount): array
    {
        return [
            'key' => $key === null ? null : (string) $key,
            'label' => $label === null || $label === '' ? null : (string) $label,
            'records' => (int) $records,
            'amount' => (int) $amount,
        ];
    }

    /** @param array<int,array{key:?string,label:?string,records:int,amount:int}> $rows */
    private function totals(array $rows): array
    {
        return [
            'records' => array_sum(array_column($rows, 'records')),
            'amount' => array_sum(array_column($rows, 'amount')),
            'classified_records' => array_sum(array_map(fn (array $row) => $row['key'] !== null ? $row['records'] : 0, $rows)),
            'unclassified_records' => array_sum(array_map(fn (array $row) => $row['key'] === null ? $row['records'] : 0, $rows)),
        ];
    }
}
