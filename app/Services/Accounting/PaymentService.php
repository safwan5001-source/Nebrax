<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\PaymentAllocation;
use App\Models\Purchase;
use App\Services\PrintTemplates\PrintTemplateService;
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
    private const ACC_CASH        = '1110'; // الصندوق
    private const ACC_BANK        = '1120'; // البنك
    private const ACC_RECEIVABLE  = '1130'; // العملاء
    private const ACC_PAYABLE     = '2110'; // الموردون

    /**
     * عائلة النقد والبنوك في دليل الحسابات — المدى المقبول لـ«الخزينة».
     * خزينةٌ ثانية أو حسابٌ بنكي إضافي يُرمَّز داخل 111x/112x، وما دونه
     * (1130 العملاء، 1140 المخزون…) يجعل قيد السند متوازناً وكاذباً معاً.
     */
    private const CASH_CODE_PREFIXES = ['111', '112'];

    public function __construct(
        protected LedgerService $ledger,
        protected PrintTemplateService $printTemplates
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

        // الخزينة تُتحقَّق **قبل** الإنشاء: سندٌ يحمل حساباً مرفوضاً كان سيُرفض
        // عند الترحيل وحده، فيبقى في القاعدة مسوّدةً لا تُرحَّل أبداً.
        $cashAccountId = $this->validCashAccountId($data['cash_account_id'] ?? null);

        return DB::transaction(function () use ($data, $amount, $direction, $date, $allocs, $cashAccountId) {
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
                'method'          => $data['method'] ?? 'cash',
                'reference'       => $data['reference'] ?? null,
                'cash_account_id' => $cashAccountId,
                'payment_date'    => $date,
                'amount'          => $amount,
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

        $cashAccountId = $this->validCashAccountId($data['cash_account_id'] ?? null);

        return DB::transaction(function () use ($payment, $data, $amount, $normalized, $cashAccountId) {
            $payment->update([
                'partner_id'      => $data['partner_id'],
                'invoice_id'      => $data['invoice_id'] ?? null,
                'method'          => $data['method'] ?? 'cash',
                'reference'       => $data['reference'] ?? null,
                'cash_account_id' => $cashAccountId,
                'payment_date'    => $data['payment_date'] ?? $payment->payment_date->toDateString(),
                'amount'          => $amount,
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
    public function post(Payment $payment): Payment
    {
        if (! $payment->isDraft()) {
            throw new RuntimeException('لا يمكن ترحيل سند غير مسوّد (draft).');
        }

        return DB::transaction(function () use ($payment) {
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

            // الخزينة المختارة تعلو على الاشتقاق من الطريقة؛ وغيابها = سلوك ما قبل الحقل.
            $cashCode      = $payment->method === 'bank' ? self::ACC_BANK : self::ACC_CASH;
            $cashAccountId = $payment->cash_account_id ?: $this->accountId($cashCode);

            if ($payment->direction === 'received') {
                // قبض من عميل: مدين الصندوق/البنك، دائن العملاء
                $lines = [[
                    'account_id' => $cashAccountId,
                    'debit'      => $payment->amount,
                ], [
                    'account_id'   => $this->accountId(self::ACC_RECEIVABLE),
                    'credit'       => $payment->amount,
                    'partner_type' => Partner::class,
                    'partner_id'   => $payment->partner_id,
                ]];
            } else {
                // صرف لمورد: مدين الموردون، دائن الصندوق/البنك
                $lines = [[
                    'account_id'   => $this->accountId(self::ACC_PAYABLE),
                    'debit'        => $payment->amount,
                    'partner_type' => Partner::class,
                    'partner_id'   => $payment->partner_id,
                ], [
                    'account_id' => $cashAccountId,
                    'credit'     => $payment->amount,
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
     * تحقّق «الخزينة» المختارة وإعادتها (أو null إن لم تُختَر).
     *
     * ثلاثة شروط لا رابع: موجودة في مستأجر السند، **فرعية لا تجميعية**
     * (قاعدة معمارية: `is_group` لا يقبل قيوداً)، ومن عائلة النقد والبنوك.
     */
    protected function validCashAccountId(?string $accountId): ?string
    {
        if (empty($accountId)) {
            return null;
        }

        $account = Account::find($accountId); // TenantScope يتكفّل بالعزل

        if (! $account) {
            throw new RuntimeException('الخزينة المختارة غير موجودة.');
        }
        if ($account->is_group) {
            throw new RuntimeException('الحساب التجميعي لا يقبل قيوداً مباشرة، فلا يصلح خزينةً.');
        }

        $inCashFamily = $account->type === 'asset' && count(array_filter(
            self::CASH_CODE_PREFIXES,
            fn (string $prefix) => str_starts_with((string) $account->code, $prefix)
        )) > 0;

        if (! $inCashFamily) {
            throw new RuntimeException('الخزينة يجب أن تكون حساب نقد أو بنك (111x/112x).');
        }

        return $account->id;
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
