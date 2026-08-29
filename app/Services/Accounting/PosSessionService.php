<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\PosCashMovement;
use App\Models\PosDevice;
use App\Models\PosExchange;
use App\Models\PosHeldSale;
use App\Models\PaymentMethod;
use App\Models\PosSession;
use App\Models\PosSessionEvent;
use App\Models\PosShift;
use App\Models\ReturnDocument;
use App\Models\User;
use App\Models\Warehouse;
use App\Support\PosSettings;
use App\Services\Pos\PosAuditService;
use App\Tenancy\BranchContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * جلسات/ورديات نقطة البيع ومطابقة الدرج.
 *
 * حركات الدرج هنا تشغيلية داخل الصندوق فقط: لا تمثل قبضاً أو صرفاً خارجياً، ولا
 * تنشئ قيداً محاسبياً. التحصيل والصرف والتحويل المالي تبقى حصراً في وحداتها.
 * كل المبالغ بالهللات.
 */
class PosSessionService
{
    // فرق صندوق نقاط البيع (عجز/فائض) يُرحّل على حساب الفروق والتسويات العام
    // القائم (5170) عبر LedgerService، لا عبر كتابة مباشرة لقيود أو حساب موازٍ.
    private const ACC_CASH_VARIANCE = '5170';

    public function __construct(
        protected LedgerService $ledger,
        protected CashBankAccountService $cashBankAccounts,
        private readonly PosAuditService $audit,
    ) {}

    public function open(
        int $openingBalance,
        string $deviceId,
        string $posShiftId,
        ?string $userId = null,
        ?User $actor = null,
    ): PosSession {
        if ($openingBalance < 0) {
            throw new RuntimeException('الرصيد الافتتاحي لا يكون سالباً.');
        }

        return DB::transaction(function () use ($openingBalance, $deviceId, $posShiftId, $userId, $actor) {
            $device = PosDevice::lockForUpdate()->findOrFail($deviceId);
            $branchId = app(BranchContext::class)->id();
            if ($device->branch_id !== $branchId) {
                throw new RuntimeException('جهاز نقطة البيع لا يخص الفرع النشط.');
            }
            if (! $device->is_active) {
                throw new RuntimeException('لا يمكن فتح وردية على جهاز نقطة بيع معطّل.');
            }

            $warehouse = Warehouse::whereKey($device->warehouse_id)->first();
            if (! $warehouse || ! $warehouse->is_active) {
                throw new RuntimeException('مستودع جهاز نقطة البيع غير متاح.');
            }
            if ($warehouse->branch_id !== null && $warehouse->branch_id !== $branchId) {
                throw new RuntimeException('مستودع جهاز نقطة البيع لا يخص الفرع النشط.');
            }
            if ($actor && (! $actor->canAccessBranch($branchId) || ! $actor->canAccessWarehouse($warehouse->id))) {
                throw new RuntimeException('جهاز نقطة البيع أو مستودعه خارج نطاق صلاحياتك.');
            }

            $posShift = $this->resolvePosShift($posShiftId, $branchId);
            if (PosSession::where('pos_device_id', $device->id)->where('status', 'open')->exists()) {
                throw new RuntimeException('توجد وردية مفتوحة على جهاز نقطة البيع المحدد — أغلقها أولاً.');
            }

            return PosSession::create([
                'number'          => $this->nextNumber(),
                'status'          => 'open',
                'opening_balance' => $openingBalance,
                'opened_at'       => now(),
                'opened_by'       => $userId,
                'pos_device_id'   => $device->id,
                'warehouse_id'    => $warehouse->id,
                'pos_shift_id'    => $posShift->id,
                // `shift_id` القديم يبقى فقط كسجل تاريخي للجلسات السابقة ولا
                // يُعاد ملؤه في الجلسات الجديدة بعد فصل POS عن HR.
                'shift_id'        => null,
                // نثبّت خزينة الجلسة من مسار نقد POS نفسه وقت الفتح، فلا تنجرف
                // تسوية الفرق لاحقاً إلى «الرئيسية» إن غُيّرت خزينة الطريقة.
                'cash_account_id' => $this->resolveSessionCashAccountId(),
            ]);
        });
    }

    /** يقفل الجلسة داخل معاملة البيع ويتحقق من مسؤولها وفرعها وصلاحية مخزنها. */
    public function requireOpenForCheckout(string $sessionId, ?string $userId, ?User $actor = null): PosSession
    {
        $session = PosSession::lockForUpdate()->findOrFail($sessionId);

        if (! $session->isOpen()) {
            throw new RuntimeException('جلسة نقطة البيع مغلقة ولا تقبل عملية بيع جديدة.');
        }
        if ($session->opened_by !== null && $session->opened_by !== $userId) {
            throw new RuntimeException('جلسة نقطة البيع تخص كاشيراً آخر.');
        }

        $branchId = app(BranchContext::class)->id();
        if ($session->branch_id !== $branchId) {
            throw new RuntimeException('جلسة نقطة البيع لا تخص الفرع النشط.');
        }
        if ($actor && (! $actor->canAccessBranch($branchId)
            || ($session->warehouse_id !== null && ! $actor->canAccessWarehouse($session->warehouse_id)))) {
            throw new RuntimeException('جلسة نقطة البيع أو مخزنها خارج نطاق صلاحياتك.');
        }

        return $session;
    }

    /**
     * يسجّل إدخالاً أو إخراجاً مادياً من درج الكاشير المفتوح. لا يمثل حركة مالية
     * خارج المنشأة ولا يعدّل حساب الصندوق؛ لذلك لا ينشئ قيداً أو سند دفع.
     *
     * `$approvalId` يُفحص فقط للصرف (`cash_out`) حين تكون سياسته «تحتاج
     * اعتماداً» (Phase 4) — الإدخال النقدي أقل خطراً ولا يدخل بوابة السياسة.
     */
    public function recordCashMovement(PosSession $session, string $type, int $amount, string $reason, User $actor, ?string $approvalId = null): PosCashMovement
    {
        if (! in_array($type, PosCashMovement::TYPES, true)) {
            throw new RuntimeException('نوع حركة الدرج غير صالح.');
        }
        if ($amount <= 0) {
            throw new RuntimeException('مبلغ حركة الدرج يجب أن يكون موجباً.');
        }
        $reason = trim($reason);
        if ($reason === '') {
            throw new RuntimeException('سبب حركة الدرج مطلوب.');
        }

        return DB::transaction(function () use ($session, $type, $amount, $reason, $actor, $approvalId) {
            $session = PosSession::lockForUpdate()->findOrFail($session->id);
            $this->assertDrawerActor($session, $actor);
            if ($type === PosCashMovement::TYPE_CASH_OUT) {
                if ($amount > $session->opening_balance + $this->cashMovement($session)['net']) {
                    throw new RuntimeException('لا يمكن إخراج مبلغ يتجاوز الرصيد المتوقع داخل درج الجلسة.');
                }
                $this->audit->enforceOperationPolicy($session, $actor, 'cash_out', $approvalId);
            }

            $movement = PosCashMovement::create([
                'branch_id'      => $session->branch_id,
                'pos_session_id' => $session->id,
                'type'           => $type,
                'amount'         => $amount,
                'reason'         => $reason,
                'recorded_by'    => $actor->id,
                'created_at'     => now(),
            ]);

            $this->recordEvent($session, $type === PosCashMovement::TYPE_CASH_IN
                ? PosSessionEvent::TYPE_CASH_IN_RECORDED
                : PosSessionEvent::TYPE_CASH_OUT_RECORDED, $actor, [
                    'cash_movement_id' => $movement->id,
                    'type' => $type,
                    'amount' => $amount,
                    'reason' => $reason,
                ]);

            return $movement->fresh('recordedBy');
        });
    }

    public function close(PosSession $session, int $countedBalance, ?string $userId = null): PosSession
    {
        if ($countedBalance < 0) {
            throw new RuntimeException('الرصيد المعدود لا يكون سالباً.');
        }

        return DB::transaction(function () use ($session, $countedBalance, $userId) {
            // القفل نفسه الذي يأخذه checkout() وحركة الدرج يحسم سباق الإقفال مع البيع أو السحب.
            $session = PosSession::lockForUpdate()->findOrFail($session->id);
            if (! $session->isOpen()) {
                throw new RuntimeException('الجلسة مغلقة بالفعل.');
            }

            $cash = $this->cashMovement($session);
            $expected = $session->opening_balance + $cash['net'];
            if (PosSettings::heldSaleClosePolicy() === PosSettings::HELD_SALE_DISCARD_ON_SESSION_CLOSE) {
                // سلال التشغيل لا تملك قيداً أو مخزوناً لعكسه، لكن لا يجوز أن
                // يختفي أثر إتلافها مع الإغلاق؛ يسجّل حدث مستقل لكل سلة.
                $actor = $userId ? User::find($userId) : null;
                PosHeldSale::where('pos_session_id', $session->id)
                    ->where('status', PosHeldSale::STATUS_HELD)
                    ->lockForUpdate()
                    ->get()
                    ->each(function (PosHeldSale $held) use ($session, $actor): void {
                        $cartId = $held->cart_id;
                        if (! is_string($cartId) || $cartId === '') {
                            $cartId = $actor ? $this->audit->createCart($session, $actor)->cart_id : null;
                        }
                        $held->update([
                            'cart_id' => $cartId,
                            'status' => PosHeldSale::STATUS_DISCARDED,
                            'discarded_at' => now(),
                        ]);
                        if ($cartId !== null) {
                            $this->audit->auditEventForExistingOperation($session, PosSessionEvent::TYPE_CART_DISCARDED, $actor, [
                                'cart_id' => $cartId,
                                'held_sale_id' => $held->id,
                                'items' => $held->payload['items'] ?? [],
                                'status' => 'discarded_on_session_close',
                            ]);
                        }
                    });
            }
            $difference = $countedBalance - $expected;
            $requiresAcknowledgement = $difference !== 0;
            $closedAt = now();

            $this->audit->auditEventForExistingOperation($session, PosSessionEvent::TYPE_CLOSING_COUNT_SUBMITTED, $userId ? User::find($userId) : null, [
                'counted_balance' => $countedBalance,
                'amount' => $countedBalance,
                'status' => PosSettings::blindCashCountEnabled() ? 'blind_locked' : 'submitted',
            ]);

            $session->update([
                'status'                           => 'closed',
                'closing_balance'                  => $countedBalance,
                'counted_balance_locked_at'         => $closedAt,
                'closing_count_revealed_at'         => $closedAt,
                'expected_balance'                 => $expected,
                'difference'                       => $difference,
                'difference_status'                => $requiresAcknowledgement ? 'pending' : 'not_required',
                'difference_acknowledged_by'       => null,
                'difference_acknowledged_at'       => null,
                'difference_acknowledgement_note'  => null,
                'closed_at'                        => $closedAt,
                'closed_by'                        => $userId,
            ]);

            $actor = $userId ? User::find($userId) : null;
            $this->audit->auditEventForExistingOperation($session, PosSessionEvent::TYPE_CLOSING_COUNT_REVEALED, $actor, [
                'counted_balance' => $countedBalance,
                'expected_balance' => $expected,
                'difference' => $difference,
                'amount' => $difference,
                'status' => PosSettings::blindCashCountEnabled() ? 'revealed_after_lock' : 'calculated',
            ]);

            if ($requiresAcknowledgement) {
                $this->recordEvent($session, PosSessionEvent::TYPE_CLOSING_DIFFERENCE_REQUIRES_ACKNOWLEDGEMENT, $actor, [
                    'counted_balance' => $countedBalance,
                    'expected_balance' => $expected,
                    'difference' => $difference,
                ]);
            }

            return $session->fresh();
        });
    }

    /** اعتماد إداري للفرق يقر بالحالة فقط؛ لا ينشئ تسوية أو قيداً محاسبياً. */
    public function acknowledgeDifference(PosSession $session, string $note, User $actor): PosSession
    {
        $note = trim($note);
        if ($note === '') {
            throw new RuntimeException('ملاحظة اعتماد فرق الإغلاق مطلوبة.');
        }
        if (! $actor->hasPermission('pos.variance.approve')) {
            throw new RuntimeException('لا تملك صلاحية اعتماد فرق إغلاق نقطة البيع.');
        }

        return DB::transaction(function () use ($session, $note, $actor) {
            $session = PosSession::lockForUpdate()->findOrFail($session->id);
            if ($session->status !== 'closed') {
                throw new RuntimeException('لا يمكن اعتماد فرق جلسة لم تُغلق بعد.');
            }
            $this->assertVarianceSelfApprovalAllowed($session, $actor);
            if ((int) $session->difference === 0 || $session->difference_status === 'not_required') {
                throw new RuntimeException('لا يوجد فرق إغلاق يتطلب اعتماداً.');
            }
            if ($session->difference_status === 'acknowledged') {
                throw new RuntimeException('فرق الإغلاق معتمد بالفعل.');
            }

            $session->update([
                'difference_status'               => 'acknowledged',
                'difference_acknowledged_by'      => $actor->id,
                'difference_acknowledged_at'      => now(),
                'difference_acknowledgement_note' => $note,
            ]);

            $this->recordEvent($session, PosSessionEvent::TYPE_CLOSING_DIFFERENCE_ACKNOWLEDGED, $actor, [
                'difference' => (int) $session->difference,
                'note' => $note,
            ]);

            return $session->fresh();
        });
    }

    /**
     * إعادة العد لا تعدل الإدخال الأصلي بصمت: تحتاج اعتماداً مستقلاً بعد كشف
     * الفرق، وتكتب before/after في حدث جديد، ولا تمس قيداً أو حركة مخزون.
     */
    public function recount(PosSession $session, int $countedBalance, User $actor, string $approvalId): PosSession
    {
        if ($countedBalance < 0) {
            throw new RuntimeException('الرصيد المعاد عده لا يكون سالباً.');
        }

        return DB::transaction(function () use ($session, $countedBalance, $actor, $approvalId) {
            $session = PosSession::lockForUpdate()->findOrFail($session->id);
            if ($session->status !== 'closed' || $session->counted_balance_locked_at === null || $session->closing_count_revealed_at === null) {
                throw new RuntimeException('إعادة العد متاحة فقط بعد تثبيت العد وكشف نتيجة الإغلاق.');
            }
            if ($session->variance_journal_entry_id !== null) {
                throw new RuntimeException('لا يمكن إعادة عد فرق سُوِّي محاسبياً؛ أنشئ تسوية تصحيحية معتمدة بدلاً من تغيير أساس القيد.');
            }
            $approvedBy = $this->audit->consumeApprovedOperation($session, $actor, 'cash_recount', $approvalId);
            $expected = $this->report($session)['expected'];
            $previous = [
                'counted_balance' => (int) $session->closing_balance,
                'expected_balance' => (int) $session->expected_balance,
                'difference' => (int) $session->difference,
            ];
            $difference = $countedBalance - $expected;
            $requiresAcknowledgement = $difference !== 0;

            $session->update([
                'closing_balance' => $countedBalance,
                'expected_balance' => $expected,
                'difference' => $difference,
                'difference_status' => $requiresAcknowledgement ? 'pending' : 'not_required',
                'difference_acknowledged_by' => null,
                'difference_acknowledged_at' => null,
                'difference_acknowledgement_note' => null,
                'recounted_by' => $actor->id,
                'recounted_at' => now(),
            ]);
            $this->audit->auditEventForExistingOperation($session, PosSessionEvent::TYPE_CLOSING_COUNT_RECOUNTED, $actor, [
                'before' => $previous,
                'after' => ['counted_balance' => $countedBalance, 'expected_balance' => $expected, 'difference' => $difference],
                'counted_balance' => $countedBalance,
                'expected_balance' => $expected,
                'difference' => $difference,
                'amount' => $difference,
                'approved_by' => $approvedBy->id,
                'status' => 'recounted_after_approval',
            ]);
            if ($requiresAcknowledgement) {
                $this->recordEvent($session, PosSessionEvent::TYPE_CLOSING_DIFFERENCE_REQUIRES_ACKNOWLEDGEMENT, $actor, [
                    'counted_balance' => $countedBalance,
                    'expected_balance' => $expected,
                    'difference' => $difference,
                    'recount_after_approval' => true,
                ]);
            }

            return $session->fresh();
        });
    }

    /**
     * يسوّي فرق صندوق الجلسة في دفتر الأستاذ عبر المحرّك، بعد اعتماد الفرق فقط.
     *
     * القيد (المبالغ بالهللات، القيمة = |الفرق| المثبّت وقت الإغلاق):
     *  • عجز (المعدود < المتوقّع): مدين 5190 فروق الصندوق / دائن حساب الصندوق الرئيسي.
     *  • فائض (المعدود > المتوقّع): مدين حساب الصندوق الرئيسي / دائن 5190 فروق الصندوق.
     *
     * التسوية حدثٌ صريح منفصل عن الاعتماد التشغيلي: الاعتماد يقرّ الحالة، وهذه
     * تُثبّت الأثر المحاسبي مرّة واحدة فقط (`variance_journal_entry_id`). كل الحسابات
     * يحلّها الخادم؛ لا يمرّر الكاشير أي حساب أستاذ.
     */
    public function settleVariance(PosSession $session, User $actor): PosSession
    {
        if (! $actor->hasPermission('pos.variance.approve')) {
            throw new RuntimeException('لا تملك صلاحية تسوية فرق إغلاق نقطة البيع.');
        }

        return DB::transaction(function () use ($session, $actor) {
            $session = PosSession::lockForUpdate()->findOrFail($session->id);
            if ($session->status !== 'closed') {
                throw new RuntimeException('لا يمكن تسوية فرق جلسة لم تُغلق بعد.');
            }
            $this->assertVarianceSelfApprovalAllowed($session, $actor);
            $difference = (int) $session->difference;
            if ($difference === 0 || $session->difference_status === 'not_required') {
                throw new RuntimeException('لا يوجد فرق إغلاق يتطلب تسوية محاسبية.');
            }
            if ($session->difference_status !== 'acknowledged') {
                throw new RuntimeException('لا يمكن تسوية فرق قبل اعتماده إدارياً.');
            }
            if ($session->variance_journal_entry_id !== null) {
                throw new RuntimeException('فرق إغلاق الجلسة مسوّى محاسبياً بالفعل.');
            }

            $cashAccountId = $this->sessionCashAccountId($session);
            $varianceAccountId = $this->varianceAccountId();

            $amount = abs($difference);
            $isShortage = $difference < 0;
            // عجز: خسارة على حساب الفروق مقابل نقص الصندوق. فائض: زيادة صندوق مقابل حساب الفروق.
            $lines = $isShortage
                ? [
                    ['account_id' => $varianceAccountId, 'debit' => $amount, 'credit' => 0, 'description' => 'عجز صندوق نقاط البيع'],
                    ['account_id' => $cashAccountId, 'debit' => 0, 'credit' => $amount, 'description' => 'نقص نقدية درج نقاط البيع'],
                ]
                : [
                    ['account_id' => $cashAccountId, 'debit' => $amount, 'credit' => 0, 'description' => 'زيادة نقدية درج نقاط البيع'],
                    ['account_id' => $varianceAccountId, 'debit' => 0, 'credit' => $amount, 'description' => 'فائض صندوق نقاط البيع'],
                ];

            $entry = $this->ledger->post($lines, [
                // تاريخ الترحيل = تاريخ إغلاق الجلسة (تاريخ نشوء الفرق)، لا لحظة الاعتماد.
                'entry_date'  => optional($session->closed_at)->toDateString() ?? now()->toDateString(),
                'description' => "تسوية فرق صندوق جلسة نقاط البيع {$session->number}",
                'source_type' => PosSession::class,
                'source_id'   => $session->id,
                'created_by'  => $actor->id,
                'branch_id'   => $session->branch_id,
            ]);

            $session->update(['variance_journal_entry_id' => $entry->id]);

            $this->recordEvent($session, PosSessionEvent::TYPE_CLOSING_DIFFERENCE_SETTLED, $actor, [
                'expected_balance' => (int) $session->expected_balance,
                'counted_balance' => (int) $session->closing_balance,
                'difference' => $difference,
                'variance_type' => $isShortage ? 'shortage' : 'overage',
                'amount' => $amount,
                'journal_entry_id' => $entry->id,
                'journal_entry_number' => $entry->number,
            ]);

            return $session->fresh();
        });
    }

    /**
     * فصل مهام (SoD) اختياري Phase 4: لا يعتمد/يسوّي من أغلق الجلسة (وبالتالي
     * أنشأ الفرق) فرقَه هو نفسه، حين يفعّل المالك `self_approval_blocked_for_variance`
     * صراحةً. الافتراض معطّل — يحفظ سلوك المنشآت أحادية الكاشير التي لا يوجد
     * فيها معتمِد ثانٍ أصلاً؛ نفس مبدأ منع الاعتماد الذاتي في `PosOverrideApproval::approve()`.
     */
    private function assertVarianceSelfApprovalAllowed(PosSession $session, User $actor): void
    {
        if (! PosSettings::selfApprovalBlockedForVariance()) {
            return;
        }
        if ($session->closed_by !== null && $session->closed_by === $actor->id) {
            throw new RuntimeException('سياسة فصل المهام تمنع من أغلق الجلسة من اعتماد أو تسوية فرقها.');
        }
    }

    /**
     * خزينة الجلسة وقت الفتح = خزينة وسيلة الدفع النقدية النشطة (المفضّل افتراضها)،
     * وإلا الخزينة الرئيسية. يُحلّ عبر `resolveForPayment` نفسه الذي تسلكه سندات
     * قبض POS النقدية، فتضرب التسوية الخزينة الفعلية لا حساباً عاماً. الخادم وحده
     * يحلّه؛ لا يمرّر الكاشير خزينة أو حساباً.
     */
    private function resolveSessionCashAccountId(): string
    {
        $cashMethod = PaymentMethod::with('cashBankAccount')
            ->where('settlement_type', 'cash')
            ->where('is_active', true)
            ->orderByDesc('is_default')
            ->orderBy('created_at')
            ->first();

        // نمرّر حساب الأستاذ (account_id) لا معرّف الخزينة — مطابقةً لمسار سند
        // القبض في PaymentService؛ الغياب يسقط على الخزينة الرئيسية بأمان.
        return $this->cashBankAccounts
            ->resolveForPayment($cashMethod?->cashBankAccount?->account_id, 'cash')
            ->account_id;
    }

    /**
     * حساب خزينة الجلسة المثبّت وقت الفتح. الجلسات القديمة السابقة للهجرة لا تحمله،
     * فتُمنع تسويتها بخطأ واضح بدل تلفيق خزينة أو الوقوع على الرئيسية العامة.
     */
    private function sessionCashAccountId(PosSession $session): string
    {
        $accountId = $session->cash_account_id;
        if ($accountId === null) {
            throw new RuntimeException('الجلسة لا تحمل خزينة مثبتة (جلسة قديمة)؛ لا يمكن تسوية فرقها محاسبياً. راجع إعدادات الخزائن.');
        }

        $account = Account::whereKey($accountId)->first();
        if (! $account) {
            throw new RuntimeException('خزينة الجلسة غير موجودة في دليل الحسابات.');
        }
        if (! $account->is_active) {
            throw new RuntimeException('خزينة الجلسة معطّلة في دليل الحسابات؛ فعّلها لتسوية الفرق.');
        }
        if ($account->is_group) {
            throw new RuntimeException('خزينة الجلسة حساب تجميعي لا يقبل قيوداً مباشرة.');
        }

        return $account->id;
    }

    /** يحل حساب الفروق والتسويات من كوده؛ غيابه خطأ تهيئة صريح لا يُنشئ حساباً بصمت. */
    private function varianceAccountId(): string
    {
        $account = Account::where('code', self::ACC_CASH_VARIANCE)->first();
        if (! $account) {
            throw new RuntimeException('حساب الفروق والتسويات (5170) غير موجود في دليل الحسابات. يرجى مراجعة إعدادات المحاسبة.');
        }
        if (! $account->is_active) {
            throw new RuntimeException('حساب الفروق والتسويات (5170) معطّل. فعّله من دليل الحسابات لتسوية الفرق.');
        }

        return $account->id;
    }

    /**
     * تقرير X/Z يقرأ مستندات الجلسة الثابتة لا نافذةً زمنية: نقد البيع يدخل،
     * وردّ النقد المرحّل يخرج، وحركات الدرج التشغيلية لا تمسّ القيود.
     *
     * @return array{cash_sales:int,cash_refunds:int,cash_in:int,cash_out:int,sales_count:int,returns_count:int,returns_total:int,net_sales:int,average:int,expected:int}
     */
    public function report(PosSession $session): array
    {
        $cash = $this->cashMovement($session);
        $invoices = Invoice::where('pos_session_id', $session->id)->where('status', 'posted');
        $salesTotal = (int) $invoices->sum('total');
        $count = (int) $invoices->count();
        $returns = ReturnDocument::where('pos_session_id', $session->id)
            ->where('type', 'sales')
            ->where('status', 'posted');
        $returnsTotal = (int) $returns->sum('total');
        $returnsCount = (int) $returns->count();

        return [
            'cash_sales' => $cash['cash_sales'],
            'cash_refunds' => $cash['cash_refunds'],
            'cash_in' => $cash['cash_in'],
            'cash_out' => $cash['cash_out'],
            'sales_count' => $count,
            'returns_count' => $returnsCount,
            'returns_total' => $returnsTotal,
            'net_sales' => $salesTotal - $returnsTotal,
            'average' => $count > 0 ? intdiv($salesTotal, $count) : 0,
            'expected' => $session->opening_balance + $cash['net'],
        ];
    }

    /** @return array{cash_sales:int,cash_refunds:int,cash_in:int,cash_out:int,net:int} */
    protected function cashMovement(PosSession $session): array
    {
        $cashSales = (int) Payment::where('pos_session_id', $session->id)
            ->where('status', 'posted')
            ->where('direction', 'received')
            ->where('method', 'cash')
            ->sum('amount');
        $cashRefunds = (int) ReturnDocument::where('pos_session_id', $session->id)
            ->where('type', 'sales')
            ->where('status', 'posted')
            ->where('payment_type', 'cash')
            ->sum('total');
        // الاستبدال ينشئ المرتجع بالذمم حتى يُطبّق على البديل؛ لا يخرج من
        // الدرج إلا الفرق النقدي المسجل صراحةً على سجل الاستبدال.
        $cashRefunds += (int) PosExchange::where('pos_session_id', $session->id)
            ->where('status', 'posted')
            ->sum('cash_refund_amount');
        $cashIn = (int) PosCashMovement::where('pos_session_id', $session->id)
            ->where('type', PosCashMovement::TYPE_CASH_IN)
            ->sum('amount');
        $cashOut = (int) PosCashMovement::where('pos_session_id', $session->id)
            ->where('type', PosCashMovement::TYPE_CASH_OUT)
            ->sum('amount');

        return [
            'cash_sales' => $cashSales,
            'cash_refunds' => $cashRefunds,
            'cash_in' => $cashIn,
            'cash_out' => $cashOut,
            'net' => $cashSales + $cashIn - $cashOut - $cashRefunds,
        ];
    }

    /** يسجل أثر المرتجع في السجل فقط؛ القيد والمخزون مرّرا مسبقاً عبر ReturnService. */
    public function recordReturn(PosSession $session, ReturnDocument $return, User $actor): void
    {
        $this->assertDrawerActor($session, $actor);
        if (! $return->isPosted() || $return->pos_session_id !== $session->id) {
            throw new RuntimeException('المرتجع المرحّل لا يخص جلسة نقطة البيع المحددة.');
        }

        $this->recordEvent($session, PosSessionEvent::TYPE_RETURN_RECORDED, $actor, [
            'return_id' => $return->id,
            'return_number' => $return->number,
            'original_id' => $return->original_id,
            'payment_type' => $return->payment_type,
            'amount' => (int) $return->total,
        ]);
    }

    /** يسجل الاستبدال بعد ترحيل مستنداته وقيد سداد الفائض — إن وجد — عبر المحرك. */
    public function recordExchange(PosSession $session, PosExchange $exchange, User $actor): void
    {
        $this->assertDrawerActor($session, $actor);
        if ($exchange->status !== 'posted' || $exchange->pos_session_id !== $session->id) {
            throw new RuntimeException('استبدال POS المرحّل لا يخص جلسة الكاشير المحددة.');
        }

        // المبلغ الرقابي للاستبدال = قيمة البضاعة المرتجعة الفعلية = الرصيد المطبّق
        // على البديل + النقد المصروف. مصدرٌ خادمي من صفّ الاستبدال، لا اختلاق ولا
        // ازدواج (قيمة الإرجاع مرة واحدة)، فيتّسق مع مرتجعات POS التي تحمل amount.
        $this->recordEvent($session, PosSessionEvent::TYPE_EXCHANGE_RECORDED, $actor, [
            'exchange_id' => $exchange->id,
            'original_invoice_id' => $exchange->original_invoice_id,
            'return_id' => $exchange->return_id,
            'replacement_invoice_id' => $exchange->replacement_invoice_id,
            'applied_credit_amount' => (int) $exchange->applied_credit_amount,
            'cash_refund_amount' => (int) $exchange->cash_refund_amount,
            'amount' => (int) $exchange->applied_credit_amount + (int) $exchange->cash_refund_amount,
        ]);
    }

    private function assertDrawerActor(PosSession $session, User $actor): void
    {
        if (! $session->isOpen()) {
            throw new RuntimeException('لا يمكن تسجيل حركة درج بعد إغلاق الجلسة.');
        }
        if ($session->opened_by !== null && $session->opened_by !== $actor->id) {
            throw new RuntimeException('حركة الدرج تخص كاشير الجلسة المفتوحة فقط.');
        }

        $branchId = app(BranchContext::class)->id();
        if ($session->branch_id !== $branchId || ! $actor->canAccessBranch($branchId)) {
            throw new RuntimeException('جلسة نقطة البيع لا تخص الفرع النشط أو صلاحياتك.');
        }
        if ($session->warehouse_id !== null && ! $actor->canAccessWarehouse($session->warehouse_id)) {
            throw new RuntimeException('مخزن جلسة نقطة البيع خارج نطاق صلاحياتك.');
        }
    }

    /** @param array<string,mixed> $payload */
    private function recordEvent(PosSession $session, string $type, ?User $actor, array $payload): PosSessionEvent
    {
        return $this->audit->auditEventForExistingOperation($session, $type, $actor, $payload);
    }

    private function resolvePosShift(string $posShiftId, string $branchId): PosShift
    {
        $shift = PosShift::whereKey($posShiftId)->first();
        if (! $shift || $shift->branch_id !== $branchId) {
            throw new RuntimeException('وردية نقاط البيع غير موجودة أو لا تخص الفرع النشط.');
        }
        if (! $shift->is_active) {
            throw new RuntimeException('وردية نقاط البيع المحددة معطّلة.');
        }

        return $shift;
    }

    protected function nextNumber(): string
    {
        return PosSession::nextDocumentNumber('POS', Carbon::now()->toDateString());
    }
}
