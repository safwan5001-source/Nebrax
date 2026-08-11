<?php

namespace App\Services\Reporting;

use App\Models\Invoice;
use App\Models\InvoiceLine;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  DashboardService — تجميعات **قراءة فقط** للوحة التحكم
 * ═══════════════════════════════════════════════════════════════
 *  لا يمسّ هذا الملف قيداً ولا رصيداً ولا يكتب صفاً واحداً. كل ما فيه
 *  استعلامات تجميع على **الفواتير المرحَّلة** لتغذية رسم المبيعات.
 *
 *  **لماذا الفواتير لا الدفتر العام:** التبويبات تسأل «أي منتج/بائع/فئة باع
 *  أكثر؟» وهذا بُعدٌ لا يحمله سطر القيد — القيد يعرف الحساب لا الصنف. أما
 *  الأرقام المحاسبية الرسمية (الإيراد، الصافي) فتبقى من `ReportService`
 *  المبني على الدفتر، ولا تُشتقّ هنا أبداً.
 *
 *  العزل: كل الاستعلامات تنطلق من نماذج ترث `BaseModel`، فيسري `TenantScope`
 *  تلقائياً. والفرع بُعد تصفية صريح كما في بقية التقارير.
 *
 *  ملاحظة: `invoices.salesperson_id` يشير إلى **موظّف** (`employees`) لا إلى
 *  مستخدم — كما يفرضه `InvoiceController` عند التحقق.
 */
class DashboardService
{
    /** أبعاد التجميع المسموحة — لا يُمرَّر اسم عمود من العميل. */
    public const DIMENSIONS = ['day', 'product', 'category', 'branch', 'salesperson'];

    /**
     * تفصيل المبيعات ببُعد واحد.
     *
     * @param  array  $filters  ['from'=>?, 'to'=>?, 'branch_id'=>?string|array, 'limit'=>?int]
     * @return array{dimension:string, rows:array<int,array{key:?string,label:string,amount:int}>}
     */
    public function salesBreakdown(string $by, array $filters = []): array
    {
        if (! in_array($by, self::DIMENSIONS, true)) {
            throw new RuntimeException("بُعد تجميع غير معروف: {$by}");
        }

        $rows = match ($by) {
            'day'         => $this->byDay($filters),
            'product'     => $this->byLineDimension($filters, 'products.name', 'products.id'),
            'category'    => $this->byLineDimension($filters, 'products.category', 'products.category'),
            'branch'      => $this->byHeaderDimension($filters, 'branches', 'branches.name', 'invoices.branch_id'),
            'salesperson' => $this->byHeaderDimension($filters, 'employees', 'employees.name', 'invoices.salesperson_id'),
        };

        return ['dimension' => $by, 'rows' => $rows];
    }

    /**
     * الفواتير المرحَّلة وحدها. المسوّدة ليست بيعاً بعد، وإدراجها يجعل الرسم
     * يسبق الدفتر — فيقرأ المستخدم مبيعاتٍ لا قيد لها.
     */
    protected function base(array $filters): Builder
    {
        $query = Invoice::query()->where('invoices.status', 'posted')->where('invoices.type', 'sale');

        if (! empty($filters['from'])) {
            $query->whereDate('invoices.invoice_date', '>=', $filters['from']);
        }
        if (! empty($filters['to'])) {
            $query->whereDate('invoices.invoice_date', '<=', $filters['to']);
        }

        $branchIds = array_filter((array) ($filters['branch_id'] ?? []));
        if ($branchIds !== []) {
            $query->whereIn('invoices.branch_id', $branchIds);
        }

        return $query;
    }

    /** سلسلة يومية بإجمالي الفواتير — أساس الخط البياني. */
    protected function byDay(array $filters): array
    {
        $rows = $this->base($filters)
            ->selectRaw('invoices.invoice_date as bucket, SUM(invoices.total) as amount')
            ->groupBy('invoices.invoice_date')
            ->orderBy('invoices.invoice_date')
            ->get();

        // يُقصّ إلى `YYYY-MM-DD`: بعض السائقين يعيدون العمود بوقتٍ ملحق
        // (`2026-01-01 00:00:00`)، والرسم يحتاج يوماً لا طابعاً زمنياً.
        return $rows->map(fn ($r) => [
            'key'    => substr((string) $r->bucket, 0, 10),
            'label'  => substr((string) $r->bucket, 0, 10),
            'amount' => (int) $r->amount,
        ])->all();
    }

    /**
     * أبعاد على مستوى **السطر** (منتج/فئة): تُجمَّع من `invoice_lines` لأن
     * الفاتورة الواحدة تحمل أصنافاً شتّى — وجمعُها بإجمالي الرأس ينسب كامل
     * الفاتورة إلى صنف واحد.
     */
    protected function byLineDimension(array $filters, string $labelColumn, string $keyColumn): array
    {
        $invoiceIds = $this->base($filters)->select('invoices.id');

        $rows = InvoiceLine::query()
            ->join('products', 'products.id', '=', 'invoice_lines.product_id')
            ->whereIn('invoice_lines.invoice_id', $invoiceIds)
            ->selectRaw("{$keyColumn} as bucket_key, {$labelColumn} as bucket_label, SUM(invoice_lines.line_total) as amount")
            ->groupBy(DB::raw($keyColumn), DB::raw($labelColumn))
            ->orderByDesc('amount')
            ->get();

        return $this->mapRows($rows);
    }

    /** أبعاد على مستوى **الرأس** (فرع/بائع): إجمالي الفاتورة ينسب كاملاً إليها. */
    protected function byHeaderDimension(array $filters, string $table, string $labelColumn, string $foreignKey): array
    {
        $rows = $this->base($filters)
            ->join($table, "{$table}.id", '=', $foreignKey)
            ->selectRaw("{$table}.id as bucket_key, {$labelColumn} as bucket_label, SUM(invoices.total) as amount")
            ->groupBy("{$table}.id", DB::raw($labelColumn))
            ->orderByDesc('amount')
            ->get();

        return $this->mapRows($rows);
    }

    /**
     * الصفوف بلا تسمية (منتج بلا فئة مثلاً) تُطوى تحت مفتاح واحد بدل أن تظهر
     * فراغاً — ولا تُسقَط، وإلا اختلف مجموع الرسم عن مجموع المبيعات.
     */
    protected function mapRows($rows): array
    {
        return $rows->map(fn ($r) => [
            'key'    => $r->bucket_key === null ? null : (string) $r->bucket_key,
            'label'  => $r->bucket_label !== null && $r->bucket_label !== ''
                ? (string) $r->bucket_label
                : 'غير محدّد',
            'amount' => (int) $r->amount,
        ])->all();
    }
}
