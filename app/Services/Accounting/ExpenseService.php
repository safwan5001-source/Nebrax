<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Expense;
use App\Models\Partner;
use App\Tenancy\BranchScope;
use App\Services\DocumentDuplicateReservationService;
use App\Support\DuplicateDocumentException;
use App\Support\Settings;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  ExpenseService — المصروفات (مستند مالي صرف، بلا مخزون)
 * ═══════════════════════════════════════════════════════════════
 *  - create(): ينشئ مصروفاً draft ويشتقّ الضريبة والإجمالي من المبلغ.
 *  - post():   يرحّل المصروف ويولّد قيداً متوازناً عبر LedgerService.
 *
 *  مصروف إيجار 1000 + 15% ضريبة، مدفوع نقداً:
 *    مدين  5130 الإيجار            100000
 *    مدين  `tax_input` ضريبة المدخلات (افتراضياً 1150)  15000
 *    دائن  1110 الصندوق            115000
 *  (طريقة الدفع تحدّد الحساب الدائن: نقد 1110 / بنك 1120 / آجل 2110 الموردون)
 *
 *  التصنيف والبائع والمرفقات بيانات إثبات وتحليل؛ لا تغيّر الحساب المدين ولا
 *  القيد. لا كتابة مباشرة في journal_lines — المرور إجباري عبر المحرك.
 */
class ExpenseService
{
    private const ACC_CASH      = '1110';
    private const ACC_BANK      = '1120';
    private const ACC_PAYABLE   = '2110';

    /**
     * REM-06 / ACC-02: ضريبة المدخلات عبر الدور الدلالي `tax_input` (كما في `PurchaseService` منذ ACC-4)،
     * لا بالكود 1150. التعيين المفقود أو الفاسد (معطَّل/تجميعي) فشلٌ مغلق قبل أي قيد — لا رجوع صامت إلى 1150.
     */
    public function __construct(
        protected LedgerService $ledger,
        protected AccountRoleResolver $accountRoles,
        protected DocumentDuplicateReservationService $duplicates,
    ) {}

    /**
     * @param  array  $data  ['account_id'=>uuid, 'category_id'=>?uuid, 'vendor_name'=>?string,
     *                         'amount'=>int(هللات), 'tax_rate'=>?int,
     *                         'payment_method'=>'cash|bank|credit', 'partner_id'=>?uuid,
     *                         'expense_date'=>?, 'description'=>?, 'number'=>?, 'created_by'=>?]
     * @param  array|null  $reservation  ['source'=>DocumentDuplicateReservationService::SOURCE_*, 'reference'=>?string, 'occurrence_id'=>?string]
     *         — يمرّره المستورد/مركز المستندات فقط (IMP-H5-S1b). `null` = إنشاء مباشر: لا يحجز إلا حين `finance.duplicate_reference_policy = block`.
     *         المصروف بلا عمود مرجع، فالمرجع/معرّف التمييز يعيشان في مسند الحجز وحده.
     */
    public function create(array $data, ?array $reservation = null): Expense
    {
        $amount = (int) ($data['amount'] ?? 0);
        if ($amount <= 0) {
            throw new RuntimeException('مبلغ المصروف يجب أن يكون موجباً.');
        }

        $this->assertExpenseAccount($data['account_id']);

        return DB::transaction(function () use ($data, $amount, $reservation) {
            $date = $data['expense_date'] ?? now()->toDateString();
            $rate = (int) ($data['tax_rate'] ?? 15);
            $tax  = $this->calcTax($amount, $rate);

            $predicate = $this->guardDuplicate($data, $date, $amount, $reservation);

            $expense = Expense::create([
                'number'         => $data['number'] ?? $this->nextNumber($date),
                'account_id'     => $data['account_id'],
                'category_id'    => $data['category_id'] ?? null,
                'partner_id'     => $data['partner_id'] ?? null,
                'vendor_name'    => $data['vendor_name'] ?? null,
                'cost_center_id' => $data['cost_center_id'] ?? null,
                'expense_date'   => $date,
                'payment_method' => $data['payment_method'] ?? 'cash',
                'description'    => $data['description'] ?? null,
                'amount'         => $amount,
                'tax_rate'       => $rate,
                'tax_amount'     => $tax,
                'total'          => $amount + $tax,
                'status'         => 'draft',
                'created_by'     => $data['created_by'] ?? null,
            ]);

            if ($predicate !== null) {
                $this->duplicates->reserve(
                    DocumentDuplicateReservationService::DOMAIN_EXPENSE,
                    $predicate,
                    'expense',
                    $expense->id,
                    $reservation['source'] ?? DocumentDuplicateReservationService::SOURCE_MANUAL,
                    $data['partner_id'] ?? null,
                );
            }

            return $expense;
        });
    }

    /**
     * تعديل مسودة المصروف فقط. إعادة اشتقاق الضريبة والإجمالي تمنع تعارض شاشة
     * قديمة مع القيم المخزّنة، والمصروف المرحّل لا يُفتح للتعديل أبداً.
     */
    public function update(Expense $expense, array $data): Expense
    {
        if (! $expense->isDraft()) {
            throw new RuntimeException('لا يمكن تعديل مصروف مرحّل أو ملغى.');
        }

        $amount = (int) ($data['amount'] ?? 0);
        if ($amount <= 0) {
            throw new RuntimeException('مبلغ المصروف يجب أن يكون موجباً.');
        }

        $this->assertExpenseAccount($data['account_id']);

        return DB::transaction(function () use ($expense, $data, $amount) {
            $rate = (int) ($data['tax_rate'] ?? 15);
            $tax = $this->calcTax($amount, $rate);
            $date = $data['expense_date'] ?? $expense->expense_date->toDateString();

            // مصروفٌ محجوز الهوية (مستورد/سياسة block): تعديل مورّده/تاريخه/مبلغه يعيد اشتقاق الحجز ذرّياً، والمرجع ومعرّف التمييز
            // يبقيان من المسند المخزَّن (لا عمود مرجع على المصروف). تنازع ⇒ DuplicateDocumentException ⇒ 422 وتراجع كامل.
            $held = $this->duplicates->forDocument('expense', $expense->id);
            if ($held !== null) {
                $this->duplicates->rekey('expense', $expense->id, DocumentDuplicateReservationService::expensePredicate(
                    $data['partner_id'] ?? null,
                    $data['vendor_name'] ?? null,
                    $held->predicate['reference'] ?? null,
                    $date,
                    $amount,
                    $held->predicate['occurrence'] ?? null,
                ), $data['partner_id'] ?? null);
            }

            $expense->update([
                'account_id'     => $data['account_id'],
                'category_id'    => $data['category_id'] ?? null,
                'partner_id'     => $data['partner_id'] ?? null,
                'vendor_name'    => $data['vendor_name'] ?? null,
                'cost_center_id' => $data['cost_center_id'] ?? null,
                'expense_date'   => $date,
                'payment_method' => $data['payment_method'] ?? 'cash',
                'description'    => $data['description'] ?? null,
                'amount'         => $amount,
                'tax_rate'       => $rate,
                'tax_amount'     => $tax,
                'total'          => $amount + $tax,
            ]);

            return $expense->fresh();
        });
    }

    /**
     * حذف مسودة المصروف مع تحرير حجز هويته في المعاملة نفسها (IMP-H5-S1b): الحجز يعيش بعمر مستنده، فيُقبل إعادة الاستيراد بعد تصحيح الخطأ.
     * المصروف المرحّل لا يُحذف (يبقى حجزه ويمنع إعادة الاستيراد). المرفقات يحذف صفوفها المستدعي مع هذا الاستدعاء كما كان.
     */
    public function discardDraft(Expense $expense): void
    {
        if (! $expense->isDraft()) {
            throw new RuntimeException('لا يمكن حذف مصروف مرحّل أو ملغى.');
        }

        DB::transaction(function () use ($expense) {
            $expense->attachments()->delete();
            $this->duplicates->release('expense', $expense->id);
            $expense->delete();
        });
    }

    /**
     * يحدّد هل يُحجز هذا الإنشاء، وإن كان كذلك يقفل الطرف ويعيد فحص المستندات القائمة (تغطي ما أُنشئ قبل أي حجز) ثم يعيد المسند.
     * `null` = لا حجز (إنشاء مباشر تحت `allow`): السلوك القديم حرفياً. معرّف التمييز الصريح يتجاوز فحص القائم (المستخدم أقرّ التكرار)
     * ويبقى الفهرس الفريد حاكماً على المعرّف نفسه.
     *
     * @return array<string, mixed>|null
     */
    private function guardDuplicate(array $data, string $date, int $amount, ?array $reservation): ?array
    {
        $block = (string) (Settings::group('finance')['duplicate_reference_policy'] ?? 'allow') === 'block';
        if ($reservation === null && ! $block) {
            return null;
        }

        $partnerId = $data['partner_id'] ?? null;
        $predicate = DocumentDuplicateReservationService::expensePredicate(
            $partnerId, $data['vendor_name'] ?? null, $reservation['reference'] ?? null, $date, $amount, $reservation['occurrence_id'] ?? null,
        );

        // تسلسل الفاحصين المتنافسين على الهوية الواسعة نفسها (مورّد ‖ تاريخ ‖ مبلغ) — بغضّ النظر عن المرجع: فحص «القائم» لا يرى مصروفاً غير مثبَّت،
        // والفهرس الفريد وحده لا يلتقط مصروفين بمرجعين مختلفين لهوية واحدة. قفل استشاري على مستوى المعاملة (يتحرر عند commit/rollback)، وSQLite تسلسل كتابتها.
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::select('select pg_advisory_xact_lock(hashtextextended(?, 0))', [
                'expense-dup:'.app(\App\Tenancy\TenantContext::class)->id().':'.$predicate['vendor'].':'.$predicate['date'].':'.$amount,
            ]);
        }
        if (($reservation['occurrence_id'] ?? null) === null) {
            // التكرار مسألة مؤسسية لا فرعية: الفحص يتجاوز نطاق الفرع عمداً (نطاق المستأجر باقٍ).
            $existing = Expense::query()->withoutGlobalScope(BranchScope::class)
                ->whereDate('expense_date', $date)->where('amount', $amount)
                ->when($partnerId !== null,
                    fn ($q) => $q->where('partner_id', $partnerId),
                    fn ($q) => $q->whereNull('partner_id'))
                ->get(['id', 'vendor_name'])
                ->first(fn (Expense $e) => $partnerId !== null
                    || DocumentDuplicateReservationService::normalizeName($e->vendor_name) === DocumentDuplicateReservationService::normalizeName($data['vendor_name'] ?? null));
            if ($existing !== null) {
                throw new DuplicateDocumentException(DocumentDuplicateReservationService::DOMAIN_EXPENSE, 'expense', $existing->id);
            }
        }

        return $predicate;
    }

    /**
     * النسخة الجديدة مسودة مستقلة برقم وتاريخ جديدين. لا تُنسخ المرفقات لأنها
     * إثبات للمستند المصدر لا للمستند الجديد.
     */
    public function duplicate(Expense $expense, ?string $createdBy = null): Expense
    {
        return $this->create([
            'account_id'     => $expense->account_id,
            'category_id'    => $expense->category_id,
            'partner_id'     => $expense->partner_id,
            'vendor_name'    => $expense->vendor_name,
            'cost_center_id' => $expense->cost_center_id,
            'expense_date'   => now()->toDateString(),
            'payment_method' => $expense->payment_method,
            'description'    => $expense->description,
            'amount'         => $expense->amount,
            'tax_rate'       => $expense->tax_rate,
            'created_by'     => $createdBy,
        ]);
    }

    /** ترحيل المصروف: توليد القيد المتوازن عبر LedgerService. */
    public function post(Expense $expense): Expense
    {
        if (! $expense->isDraft()) {
            throw new RuntimeException('لا يمكن ترحيل مصروف غير مسوّد (draft).');
        }

        return DB::transaction(function () use ($expense) {
            // إعادة اشتقاق الضريبة والإجمالي من المبلغ (مصدر الحقيقة) قبل توليد القيد.
            $amount = (int) $expense->amount;
            $tax    = $this->calcTax($amount, (int) $expense->tax_rate);
            $total  = $amount + $tax;

            // مدين حساب المصروف (موسوماً بمركز التكلفة) + مدين ضريبة المدخلات / دائن نقد أو بنك أو موردون
            $lines = [['account_id' => $expense->account_id, 'debit' => $amount, 'cost_center_id' => $expense->cost_center_id]];
            if ($tax > 0) {
                $lines[] = ['account_id' => $this->accountRoles->resolve('tax_input')->id, 'debit' => $tax];
            }

            $creditLine = ['account_id' => $this->accountId($this->creditCode($expense->payment_method)), 'credit' => $total];
            if ($expense->payment_method === 'credit' && $expense->partner_id) {
                $creditLine['partner_type'] = Partner::class;
                $creditLine['partner_id']   = $expense->partner_id;
            }
            $lines[] = $creditLine;

            $entry = $this->ledger->post($lines, [
                'entry_date'  => $expense->expense_date->toDateString(),
                'description' => "مصروف {$expense->number}",
                'source_type' => Expense::class,
                'source_id'   => $expense->id,
                'created_by'  => $expense->created_by,
            ]);

            $expense->update([
                'status'           => 'posted',
                'tax_amount'       => $tax,
                'total'            => $total,
                'journal_entry_id' => $entry->id,
            ]);

            return $expense->fresh('account');
        });
    }

    /** الحساب الدائن وفق طريقة الدفع. */
    private function creditCode(string $method): string
    {
        return match ($method) {
            'bank'   => self::ACC_BANK,
            'credit' => self::ACC_PAYABLE,
            default  => self::ACC_CASH,
        };
    }

    /** التأكد أن الحساب المختار حساب مصروف فعلي يقبل القيود. */
    protected function assertExpenseAccount(string $accountId): void
    {
        $account = Account::find($accountId);
        if (! $account) {
            throw new RuntimeException('حساب المصروف غير موجود في دليل الحسابات.');
        }
        if ($account->type !== 'expense') {
            throw new RuntimeException('الحساب المختار ليس حساب مصروفات.');
        }
        if ($account->is_group) {
            throw new RuntimeException('لا يمكن تسجيل مصروف على حساب تجميعي.');
        }
    }

    /** حساب الضريبة كعدد صحيح (تقريب نصفي لأعلى) — بلا float. */
    protected function calcTax(int $base, int $rate): int
    {
        return intdiv($base * $rate + 50, 100);
    }

    protected function accountId(string $code): string
    {
        $account = Account::where('code', $code)->first();
        if (! $account) {
            throw new RuntimeException("الحساب بالكود {$code} غير موجود في دليل الحسابات.");
        }

        return $account->id;
    }

    /** توليد رقم تسلسلي: EXP-2025-00001 */
    protected function nextNumber(string $date): string
    {
        return Expense::nextDocumentNumber('EXP', $date);
    }
}
