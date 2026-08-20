<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\PaymentMethod;
use App\Models\User;
use App\Models\PaymentAllocation;
use App\Models\Purchase;
use App\Services\PrintTemplates\PrintTemplateService;
use App\Support\Settings;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PaymentService — سندات القبض والصرف + تخصيصها على الفواتير
 * ═══════════════════════════════════════════════════════════════
 *  - create(): ينشئ سنداً بحالة draft، ويبني تخصيصاته على الفواتير.
 *  - post():   يرحّل السند، يولّد قيداً متوازناً عبر LedgerService،
 *              ويحدّث سداد كل فاتورة مخصَّصة (unpaid → partial → paid).
 *
 *  قبض من عميل (received):  مدين 1110/1120 │ دائن 1130 العملاء
 *  صرف لمورد  (paid):       مدين 2110       │ دائن 1110/1120
 *
 *  التخصيص (allocation) للقبض فقط: مجموع التخصيصات = مبلغ السند،
 *  وكل تخصيص ≤ متبقي فاتورته، والفاتورة مرحّلة وتخص طرف السند.
 *  لا كتابة مباشرة في journal_lines — القيد عبر المحرك حصراً.
 */
class PaymentService
{
    private const ACC_RECEIVABLE  = '1130'; // العملاء
    private const ACC_PAYABLE     = '2110'; // الموردون
    private const ACC_INPUT_VAT   = '1150'; // ضريبة قيمة مضافة - مدخلات

    public function __construct(
        protected LedgerService $ledger,
        protected PrintTemplateService $printTemplates,
        protected CashBankAccountService $cashBankAccounts,
    ) {}

    /**
     * إنشاء سند قبض/صرف بحالة draft.
     *
     * @param  array  $data         ['partner_id'=>uuid, 'amount'=>int, 'direction'=>'received|paid',
     *                               'method'=>'cash|bank', 'reference'=>?, 'cash_account_id'=>?,
     *                               'invoice_id'=>?, 'purchase_id'=>?, 'payment_date'=>?, 'notes'=>?, 'number'=>?]
     * @param  array  $allocations  قبض: [['invoice_id'=>uuid,'amount'=>int], ...]
     *                              صرف: [['purchase_id'=>uuid,'amount'=>int], ...]
     */
    public function create(array $data, array $allocations = []): Payment
    {
        $amount = (int) ($data['amount'] ?? 0);
        if ($amount <= 0) {
            throw new RuntimeException('مبلغ السند يجب أن يكون موجباً.');
        }

        $direction = $data['direction'] ?? 'received';
        $date      = $data['payment_date'] ?? now()->toDateString();
        [$method, $cashAccountId, $fee] = $this->resolvePaymentSetup($data, $amount, $direction);

        // المستند المستهدَف حسب الاتجاه: قبض→فاتورة مبيعات، صرف→فاتورة مشتريات.
        [$targetClass, $key] = $direction === 'received'
            ? [Invoice::class, 'invoice_id']
            : [Purchase::class, 'purchase_id'];

        // بناء التخصيصات: صريحة، أو ضمنياً من معرّف المستند المفرد.
        $items = ! empty($allocations)
            ? $allocations
            : (! empty($data[$key]) ? [[$key => $data[$key], 'amount' => $amount]] : []);

        $allocs = [];
        $sum = 0;
        foreach ($items as $a) {
            $amt = (int) ($a['amount'] ?? 0);
            if (empty($a[$key]) || $amt <= 0) {
                throw new RuntimeException('كل تخصيص يحتاج مستنداً ومبلغاً موجباً.');
            }
            $allocs[] = ['type' => $targetClass, 'id' => $a[$key], 'amount' => $amt];
            $sum += $amt;
        }

        if (! empty($allocs) && $sum !== $amount) {
            throw new RuntimeException("مجموع التخصيصات ({$sum}) يجب أن يساوي مبلغ السند ({$amount}).");
        }

        return DB::transaction(function () use ($data, $amount, $direction, $date, $allocs, $method, $cashAccountId, $fee) {
            // النسخ قد يكون لمستند تاريخي بلا فرع. نحفظ نطاق المصدر صراحةً،
            // فلا تنتقل النسخة إلى الفرع الرئيسي للطلب ثم تصطدم برقمه القديم.
            $hasExplicitBranch = array_key_exists('branch_id', $data);
            $number = $data['number'] ?? (
                $hasExplicitBranch
                    ? $this->nextNumber($direction, $date, $data['branch_id'])
                    : $this->nextNumber($direction, $date)
            );

            $attributes = [
                'number'          => $number,
                'partner_id'      => $data['partner_id'],
                'invoice_id'      => $data['invoice_id'] ?? null, // مرجع اختياري للقبض
                'direction'       => $direction,
                'method'          => $method,
                'payment_method_id' => $fee['payment_method_id'],
                'payment_method_name' => $fee['payment_method_name'],
                'reference'       => $data['reference'] ?? null,
                'cash_account_id' => $cashAccountId,
                'payment_date'    => $date,
                'amount'          => $amount,
                'fee_amount'      => $fee['amount'],
                'fee_tax_amount'  => $fee['tax_amount'],
                'fee_expense_account_id' => $fee['expense_account_id'],
                'status'          => 'draft',
                'notes'           => $data['notes'] ?? null,
                'created_by'      => $data['created_by'] ?? null,
            ];
            if ($hasExplicitBranch) {
                $attributes['branch_id'] = $data['branch_id'];
            }

            $payment = Payment::create($attributes);

            foreach ($allocs as $a) {
                PaymentAllocation::create([
                    'payment_id'       => $payment->id,
                    'allocatable_type' => $a['type'],
                    'allocatable_id'   => $a['id'],
                    'amount'           => $a['amount'],
                ]);
            }

            return $payment;
        });
    }

    /**
     * تعديل مسودة السند. لا يتغير اتجاه السند بعد إنشائه؛ فاستبدال قبض بصرف
     * يبدّل طرفي القيد ولا يُعد تعديلاً آمناً. تُستبدل التخصيصات كاملةً داخل
     * المعاملة نفسها، ثم يُعاد التحقق النهائي عند الترحيل.
     */
    public function update(Payment $payment, array $data, array $allocations = []): Payment
    {
        if (! $payment->isDraft()) {
            throw new RuntimeException('لا يمكن تعديل سند مرحّل أو ملغى.');
        }

        $amount = (int) ($data['amount'] ?? 0);
        if ($amount <= 0) {
            throw new RuntimeException('مبلغ السند يجب أن يكون موجباً.');
        }

        $direction = $payment->direction;
        [$method, $cashAccountId, $fee] = $this->resolvePaymentSetup($data, $amount, $direction);
        [$targetClass, $key] = $direction === 'received'
            ? [Invoice::class, 'invoice_id']
            : [Purchase::class, 'purchase_id'];
        $items = ! empty($allocations)
            ? $allocations
            : (! empty($data[$key]) ? [[$key => $data[$key], 'amount' => $amount]] : []);

        $normalized = [];
        $sum = 0;
        foreach ($items as $item) {
            $allocated = (int) ($item['amount'] ?? 0);
            if (empty($item[$key]) || $allocated <= 0) {
                throw new RuntimeException('كل تخصيص يحتاج مستنداً ومبلغاً موجباً.');
            }
            $normalized[] = ['type' => $targetClass, 'id' => $item[$key], 'amount' => $allocated];
            $sum += $allocated;
        }
        if (! empty($normalized) && $sum !== $amount) {
            throw new RuntimeException("مجموع التخصيصات ({$sum}) يجب أن يساوي مبلغ السند ({$amount}).");
        }

        return DB::transaction(function () use ($payment, $data, $amount, $normalized, $method, $cashAccountId, $fee) {
            $payment->update([
                'partner_id'      => $data['partner_id'],
                'invoice_id'      => $data['invoice_id'] ?? null,
                'method'          => $method,
                'payment_method_id' => $fee['payment_method_id'],
                'payment_method_name' => $fee['payment_method_name'],
                'reference'       => $data['reference'] ?? null,
                'cash_account_id' => $cashAccountId,
                'payment_date'    => $data['payment_date'] ?? $payment->payment_date->toDateString(),
                'amount'          => $amount,
                'fee_amount'      => $fee['amount'],
                'fee_tax_amount'  => $fee['tax_amount'],
                'fee_expense_account_id' => $fee['expense_account_id'],
                'notes'           => $data['notes'] ?? null,
            ]);

            $payment->allocations()->delete();
            foreach ($normalized as $allocation) {
                PaymentAllocation::create([
                    'payment_id'       => $payment->id,
                    'allocatable_type' => $allocation['type'],
                    'allocatable_id'   => $allocation['id'],
                    'amount'           => $allocation['amount'],
                ]);
            }

            return $payment->fresh();
        });
    }

    /** نسخة المسودة لا تنسخ التخصيصات كي لا تحجز متبقي فاتورة مرتين. */
    public function duplicate(Payment $payment, ?string $createdBy = null): Payment
    {
        $date = now()->toDateString();
        $data = [
            'partner_id'      => $payment->partner_id,
            'direction'       => $payment->direction,
            'method'          => $payment->method,
            'payment_method_id' => $payment->payment_method_id,
            'reference'       => $payment->reference,
            'cash_account_id' => $payment->cash_account_id,
            'payment_date'    => $date,
            'amount'          => $payment->amount,
            'notes'           => $payment->notes,
            'created_by'      => $createdBy,
        ];

        // فرع المصدر المحدد هو نطاق الوثيقة وسلسلته؛ لا نعتمد على السياق الذي
        // قد يتبدل بين قراءة السند وتنفيذ طلب API. صفوف ما قبل الفروع تُنشأ
        // في الفرع النشط، لكن رقمها التالي يُقرأ من سلسلتها القديمة حتى لا
        // يعاد رقمٌ ما زال محمياً بالقيد الفريد في SQLite.
        if ($payment->branch_id !== null) {
            $data['branch_id'] = $payment->branch_id;
        } else {
            $data['number'] = $this->nextNumber($payment->direction, $date, null);
        }

        return $this->create($data);
    }

    /**
     * ترحيل السند: توليد القيد المتوازن عبر LedgerService + تحديث سداد الفواتير.
     */
    public function post(Payment $payment, ?User $actor = null): Payment
    {
        if (! $payment->isDraft()) {
            throw new RuntimeException('لا يمكن ترحيل سند غير مسوّد (draft).');
        }

        return DB::transaction(function () use ($payment, $actor) {
            // قفل الصف وإعادة فحص الحالة — يمنع الترحيل المزدوج المتزامن.
            $payment = Payment::lockForUpdate()->findOrFail($payment->id);
            if (! $payment->isDraft()) {
                throw new RuntimeException('لا يمكن ترحيل سند غير مسوّد (draft).');
            }

            $allocations = $payment->allocations()->get();

            // التحقق من كل تخصيص قبل توليد القيد (لا أثر عند الرفض).
            // المستند polymorphic: فاتورة مبيعات (قبض) أو فاتورة مشتريات (صرف).
            $targets = [];
            foreach ($allocations as $alloc) {
                $class  = $alloc->allocatable_type;
                $target = $class::lockForUpdate()->find($alloc->allocatable_id);

                if (! $target) {
                    throw new RuntimeException('المستند المخصَّص غير موجود.');
                }
                if (! $target->isPosted()) {
                    throw new RuntimeException(
                        $payment->direction === 'received'
                            ? 'لا يمكن التحصيل على فاتورة غير مرحّلة.'
                            : 'لا يمكن السداد على فاتورة مشتريات غير مرحّلة.'
                    );
                }
                if ($target->partner_id !== $payment->partner_id) {
                    throw new RuntimeException('الفاتورة المخصَّصة لا تخص طرف السند.');
                }

                $remaining = $target->total - $target->paid_amount;
                if ($alloc->amount > $remaining) {
                    throw new RuntimeException(
                        "مبلغ التخصيص ({$alloc->amount}) يتجاوز المتبقي على الفاتورة ({$remaining})."
                    );
                }

                $targets[$alloc->id] = $target;
            }

            // الحساب المختار كيان خزينة/بنك فعلي؛ تُفحص صلاحية الإيداع أو السحب عند الأثر المالي لا عند إنشاء المسودة فقط.
            $cashEntity = $this->cashBankAccounts->resolveForPayment($payment->cash_account_id, $payment->method);
            $this->cashBankAccounts->assertAllowed(
                $cashEntity,
                $payment->direction === 'received' ? 'deposit' : 'withdraw',
                $actor
            );
            $cashAccountId = $cashEntity->account_id;

            $feeTotal = $payment->fee_amount + $payment->fee_tax_amount;
            $feeLines = $this->feeLines($payment);

            if ($payment->direction === 'received') {
                // قبض: العميل يسدد كامل الذمة، والمنشأة تتحمل العمولة فينخفض صافي الإيداع.
                $netDeposit = $payment->amount - $feeTotal;
                if ($netDeposit <= 0) {
                    throw new RuntimeException('رسوم الدفع وضريبتها يجب أن تكون أقل من مبلغ سند القبض.');
                }
                $lines = [[
                    'account_id' => $cashAccountId,
                    'debit'      => $netDeposit,
                ], ...$feeLines, [
                    'account_id'   => $this->accountId(self::ACC_RECEIVABLE),
                    'credit'       => $payment->amount,
                    'partner_type' => Partner::class,
                    'partner_id'   => $payment->partner_id,
                ]];
            } else {
                // صرف: ذمة المورد تسدد بكاملها وتزداد حركة الخزينة بعمولة المنشأة وضريبتها.
                $lines = [[
                    'account_id'   => $this->accountId(self::ACC_PAYABLE),
                    'debit'        => $payment->amount,
                    'partner_type' => Partner::class,
                    'partner_id'   => $payment->partner_id,
                ], ...$feeLines, [
                    'account_id' => $cashAccountId,
                    'credit'     => $payment->amount + $feeTotal,
                ]];
            }

            $label = $payment->direction === 'received' ? 'سند قبض' : 'سند صرف';

            $entry = $this->ledger->post($lines, [
                'entry_date'  => $payment->payment_date->toDateString(),
                'description' => "{$label} {$payment->number}",
                'source_type' => Payment::class,
                'source_id'   => $payment->id,
                'created_by'  => $payment->created_by,
            ]);

            // يُختار قالب السند داخل معاملة الترحيل ثم يُثبت على المستند؛
            // لا يؤدي نشر مراجعة أحدث لاحقاً إلى إعادة تفسير سندٍ صدر بالفعل.
            $documentType = $payment->direction === 'received' ? 'receipt_voucher' : 'payment_voucher';
            $printAssignment = $this->printTemplates->resolve($documentType, 'print', $payment->branch_id);
            $pdfAssignment = $this->printTemplates->resolve($documentType, 'pdf', $payment->branch_id);
            $thermalAssignment = $this->printTemplates->resolve($documentType, 'thermal', $payment->branch_id);

            $payment->update([
                'status'           => 'posted',
                'print_template_revision_id' => $printAssignment?->print_template_revision_id,
                'pdf_template_revision_id' => $pdfAssignment?->print_template_revision_id,
                'thermal_template_revision_id' => $thermalAssignment?->print_template_revision_id,
                'journal_entry_id' => $entry->id,
            ]);

            // تطبيق التخصيصات: تحديث سداد كل مستند وحالته.
            foreach ($allocations as $alloc) {
                $target  = $targets[$alloc->id];
                $newPaid = $target->paid_amount + $alloc->amount;
                $target->update([
                    'paid_amount'    => $newPaid,
                    'payment_status' => $this->paymentStatus($newPaid, $target->total),
                ]);
            }

            return $payment->fresh();
        });
    }

    /**
     * يطابق الطريقة الجديدة بخزينتها/حسابها ويحسب لقطة رسومها قبل إنشاء أو تعديل المسودة.
     * تبقى المدفوعات القديمة التي لا تحمل payment_method_id على عقد cash|bank السابق.
     *
     * @return array{0:string,1:string,2:array{payment_method_id:?string,payment_method_name:?string,amount:int,tax_amount:int,expense_account_id:?string}}
     */
    private function resolvePaymentSetup(array $data, int $amount, string $direction): array
    {
        $paymentMethodId = $data['payment_method_id'] ?? null;
        if (! $paymentMethodId) {
            $method = $data['method'] ?? 'cash';
            $cashAccount = $this->cashBankAccounts->resolveForPayment($data['cash_account_id'] ?? null, $method);

            return [$method, $cashAccount->account_id, [
                'payment_method_id' => null,
                'payment_method_name' => null,
                'amount' => 0,
                'tax_amount' => 0,
                'expense_account_id' => null,
            ]];
        }

        $paymentMethod = PaymentMethod::with('cashBankAccount')->find($paymentMethodId);
        if (! $paymentMethod || ! $paymentMethod->is_active) {
            throw new RuntimeException('طريقة الدفع المختارة غير موجودة أو معطلة.');
        }

        $method = $paymentMethod->settlement_type;
        $accountId = $data['cash_account_id'] ?? $paymentMethod->cashBankAccount?->account_id;
        $cashAccount = $this->cashBankAccounts->resolveForPayment($accountId, $method);
        $fee = $this->calculateFee($paymentMethod, $amount, $direction);

        return [$method, $cashAccount->account_id, [
            'payment_method_id' => $paymentMethod->id,
            'payment_method_name' => $paymentMethod->name,
            'amount' => $fee['amount'],
            'tax_amount' => $fee['tax_amount'],
            'expense_account_id' => $fee['expense_account_id'],
        ]];
    }

    /**
     * تحسب رسوم المنشأة بالهللات. النسبة نقاط أساس (10000 = 100%)، والناتج يقرب
     * نصفاً إلى أعلى. الحد الأدنى يقارن بالجزء النسبي ثم يضاف الرسم الثابت.
     */
    private function calculateFee(PaymentMethod $method, int $amount, string $direction): array
    {
        $application = Settings::get('finance', 'payment_fee_application');
        $applies = match ($application) {
            'received' => $direction === 'received',
            'paid' => $direction === 'paid',
            'both' => true,
            default => false,
        };

        if (! $applies || ! $method->fees_enabled) {
            return ['amount' => 0, 'tax_amount' => 0, 'expense_account_id' => null];
        }
        if (! $method->fee_expense_account_id) {
            throw new RuntimeException('طريقة الدفع ذات الرسوم تحتاج حساب مصروف رسوم نشطاً.');
        }

        $percentage = intdiv($amount * $method->fee_rate_bps + 5000, 10000);
        $fee = max($percentage, $method->fee_min_amount) + $method->fee_fixed_amount;
        $tax = intdiv($fee * $method->fee_tax_rate + 50, 100);

        return [
            'amount' => $fee,
            'tax_amount' => $tax,
            'expense_account_id' => $method->fee_expense_account_id,
        ];
    }

    /** سطور مصروف الرسوم وضريبة المدخلات؛ تبقى فارغة للطرق بلا رسوم أو خارج النطاق. */
    private function feeLines(Payment $payment): array
    {
        if ($payment->fee_amount <= 0) {
            return [];
        }
        if (! $payment->fee_expense_account_id) {
            throw new RuntimeException('سند الرسوم لا يحمل حساب مصروف صالحاً.');
        }

        $lines = [[
            'account_id' => $payment->fee_expense_account_id,
            'debit' => $payment->fee_amount,
        ]];
        if ($payment->fee_tax_amount > 0) {
            $lines[] = [
                'account_id' => $this->accountId(self::ACC_INPUT_VAT),
                'debit' => $payment->fee_tax_amount,
            ];
        }

        return $lines;
    }

    /**
     * حالة سداد الفاتورة حسب المسدَّد مقابل الإجمالي.
     */
    protected function paymentStatus(int $paid, int $total): string
    {
        if ($paid <= 0) {
            return 'unpaid';
        }

        return $paid >= $total ? 'paid' : 'partial';
    }

    /**
     * معرّف الحساب من كوده ضمن المستأجر الحالي.
     */
    protected function accountId(string $code): string
    {
        $account = Account::where('code', $code)->first();

        if (! $account) {
            throw new RuntimeException("الحساب بالكود {$code} غير موجود في دليل الحسابات.");
        }

        return $account->id;
    }

    /**
     * توليد رقم سند تسلسلي: REC-2025-00001 (قبض) | PAY-2025-00001 (صرف)
     */
    protected function nextNumber(string $direction, string $date, string|null|false $branchId = false): string
    {
        return Payment::nextDocumentNumber(
            $direction === 'received' ? 'REC' : 'PAY',
            $date,
            $branchId
        );
    }
}
