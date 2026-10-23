<?php

namespace App\Services;

use App\Models\Invoice;
use App\Models\Payment;
use App\Models\PaymentMethod;
use App\Models\PosPaymentTerminal;
use App\Models\PosSession;
use App\Models\PosTerminalRequest;
use App\Models\User;
use App\Services\Accounting\PosSessionService;
use App\Support\PosTerminalException;
use App\Support\PosTerminalResult;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * أجهزة دفع POS والتعويض — PAY-H6-02. **لا ترحيل ولا قيد ولا سند هنا**: الخدمة تدير دورة الموافقة على الجهاز فقط؛ البيع نفسه يمرّ
 * بـ`PosService::checkout` (A11/A12) الذي يستهلك الموافقة عبر `claimApprovals`/`markConsumed`.
 *
 * ضمانات: لا بيع يستهلك موافقة غير مؤكدة · موافقة تُستهلك مرة واحدة (قفل صف + سند فريد) · فشل البيع بعد موافقة ⇒ إلغاء آلي على الجهاز
 * (`compensateAfterFailedCheckout`) · تعذّر الإلغاء ⇒ `compensation_required` يمنع إقفال الجلسة · الموافقة اليتيمة تُلغى بالمجدول.
 * استدعاءات الجهاز **خارج** معاملات القاعدة؛ إيجار `compensating_until` يمنع مُعوِّضَين وتسابق الاستهلاك والإلغاء.
 */
class PosTerminalService
{
    public function __construct(
        private readonly PosTerminalAdapterRegistry $adapters,
        private readonly PosSessionService $sessions,
    ) {}

    // ═══════════════ الأجهزة ═══════════════

    public function assertProviderAvailable(string $provider): void
    {
        if (! $this->adapters->has($provider)) {
            throw new PosTerminalException('provider_unavailable', 'مزوّد جهاز الدفع غير متاح بعد في هذه البيئة.');
        }
    }

    // ═══════════════ دورة الطلب ═══════════════

    /** @param array{pos_session_id:string,pos_payment_terminal_id:string,payment_method_id:string,amount:int,idempotency_key:string} $data */
    public function createRequest(User $actor, array $data): PosTerminalRequest
    {
        $amount = (int) $data['amount'];
        if ($amount <= 0) {
            throw new PosTerminalException('invalid_amount', 'مبلغ الطلب يجب أن يكون موجباً.');
        }

        try {
            $request = DB::transaction(function () use ($actor, $data, $amount) {
                $existing = PosTerminalRequest::query()->where('idempotency_key', $data['idempotency_key'])->lockForUpdate()->first();
                if ($existing !== null) {
                    return $this->replayOf($actor, $existing, $data, $amount);
                }

                $session = $this->sessions->requireOpenForCheckout($data['pos_session_id'], $actor->id, $actor);
                $terminal = PosPaymentTerminal::query()->whereKey($data['pos_payment_terminal_id'])->first();
                if ($terminal === null || ! $terminal->is_active) {
                    throw new PosTerminalException('terminal_unavailable', 'جهاز الدفع غير موجود أو معطّل.');
                }
                // جهاز مخصَّص لجهاز POS معيّن لا يخدم جلسة جهاز آخر (الجهاز غير المخصَّص متاح لأي جهاز في الفرع).
                if ($terminal->pos_device_id !== null && $terminal->pos_device_id !== $session->pos_device_id) {
                    throw new PosTerminalException('terminal_device_mismatch', 'جهاز الدفع مخصَّص لجهاز نقطة بيع آخر.');
                }
                $this->assertProviderAvailable($terminal->provider);
                $method = PaymentMethod::query()->whereKey($data['payment_method_id'])->first();
                if ($method === null || ! $method->is_active || $method->settlement_type !== 'bank') {
                    throw new PosTerminalException('method_not_card', 'طريقة الدفع يجب أن تكون بنكية نشطة.');
                }

                return PosTerminalRequest::query()->create([
                    'pos_session_id' => $session->id,
                    'pos_payment_terminal_id' => $terminal->id,
                    'payment_method_id' => $method->id,
                    'idempotency_key' => $data['idempotency_key'],
                    'amount' => $amount,
                    'created_by' => $actor->id,
                ]);
            });
        } catch (QueryException $e) {
            // الفهرس الجزئي: طلب نشط واحد لكل جهاز (أو سباق المفتاح نفسه).
            // سباق المفتاح نفسه: الفائز يُعاد كـreplay **بعد** فحص تطابق المحتوى كالمسار العادي، وإلا تعارض.
            $existing = PosTerminalRequest::query()->where('idempotency_key', $data['idempotency_key'])->first();
            if ($existing !== null) {
                return $this->replayOf($actor, $existing, $data, $amount);
            }
            throw new PosTerminalException('terminal_busy', 'على الجهاز طلب نشط؛ أنهِه أو ألغِه أولاً.');
        }

        if ($request->getAttribute('idempotent_replay') === true) {
            return $request;
        }

        // استدعاء الجهاز خارج المعاملة وبإيجار على الطلب. **استثناء من المحوّل = نتيجة غامضة** (قد يكون الجهاز استلم ووافق وضاع الردّ): يبقى الطلب `sent`
        // بعلامة `start_unconfirmed` فيحجز الجهاز (طلب نشط واحد) ويستعلمه الكاشير/المجدول ويلغيه — لا `error` نهائياً يحرّر الجهاز لخصم ثانٍ.
        // الفشل القاطع (لم يُرسَل شيء) يعيده المحوّل نتيجة ERROR صريحة.
        return $this->providerOp($request->id, function (PosTerminalRequest $claimed) {
            try {
                $terminal = PosPaymentTerminal::query()->findOrFail($claimed->pos_payment_terminal_id);

                return $this->adapters->for($terminal->provider)->start($terminal, $claimed);
            } catch (Throwable) {
                return new PosTerminalResult(PosTerminalResult::PENDING, failureCode: 'start_unconfirmed');
            }
        });
    }

    private function replayOf(User $actor, PosTerminalRequest $existing, array $data, int $amount): PosTerminalRequest
    {
        // الإعادة تكشف مراجع الموافقة وحالتها: تُفحص ملكية الجلسة كما يفحصها الإنشاء (لا كاشير آخر بمفتاح معروف).
        $owner = PosSession::query()->whereKey($existing->pos_session_id)->value('opened_by');
        if ($owner !== null && $owner !== $actor->id) {
            throw new PosTerminalException('session_forbidden', 'جلسة نقطة البيع تخص كاشيراً آخر.');
        }
        $same = $existing->pos_session_id === $data['pos_session_id']
            && $existing->pos_payment_terminal_id === $data['pos_payment_terminal_id']
            && $existing->payment_method_id === $data['payment_method_id']
            && $existing->amount === $amount;
        if (! $same) {
            throw new PosTerminalException('idempotency_conflict', 'مفتاح الطلب استُعمل بمحتوى مختلف.');
        }

        return $existing->setAttribute('idempotent_replay', true);
    }

    /**
     * عملية مزوّد على طلب غير نهائي (created/sent) **متسلسلة بإيجار**: استعلام وإلغاء متزامنان لا يمرّان معاً — وإلا حُفظت موافقة محلياً بينما ألغاها
     * المزوّد فيُستهلك تفويضٌ ملغى. الإيجار يُسلَّم في معاملة قصيرة، والاستدعاء خارج المعاملة، وتطبيق النتيجة يُحرّره (`apply`)؛ الاستثناء يحرّره أيضاً.
     *
     * @param  \Closure(PosTerminalRequest): PosTerminalResult  $call
     */
    private function providerOp(string $requestId, \Closure $call, bool $expireOnCancel = false): PosTerminalRequest
    {
        $lease = max(10, (int) config('pos_terminals.compensation_lease_seconds', 90));

        $token = (string) Str::uuid();
        $claimed = DB::transaction(function () use ($requestId, $lease, $token) {
            $request = PosTerminalRequest::query()->whereKey($requestId)->lockForUpdate()->firstOrFail();
            if (! in_array($request->status, [PosTerminalRequest::STATUS_CREATED, PosTerminalRequest::STATUS_SENT], true)) {
                return [null, $request];
            }
            if ($request->compensating_until !== null && $request->compensating_until->isFuture()) {
                throw new PosTerminalException('operation_in_progress', 'عملية أخرى جارية على هذا الطلب؛ أعد المحاولة بعد لحظات.');
            }
            $request->update(['compensating_until' => now('UTC')->addSeconds($lease), 'lease_token' => $token]);

            return [$request, $request];
        });
        if ($claimed[0] === null) {
            return $claimed[1];
        }

        try {
            $result = $call($claimed[0]);
        } catch (Throwable $e) {
            // يحرّر إيجاره هو فقط: إن انتهى وأخذه غيره فلا يمسّه.
            DB::table('pos_terminal_requests')->where('id', $requestId)->where('lease_token', $token)->update(['compensating_until' => null, 'lease_token' => null]);
            throw $e;
        }

        return $this->settle($this->apply($requestId, $result, $expireOnCancel, $token));
    }

    /** يستعلم الجهاز (الحقيقة) ويطبّق النتيجة على طلب قيد التنفيذ. */
    public function sync(PosTerminalRequest $request): PosTerminalRequest
    {
        $request = PosTerminalRequest::query()->findOrFail($request->id);
        if (! in_array($request->status, [PosTerminalRequest::STATUS_CREATED, PosTerminalRequest::STATUS_SENT], true)) {
            return $request;
        }

        return $this->providerOp($request->id, function (PosTerminalRequest $claimed) {
            $terminal = PosPaymentTerminal::query()->findOrFail($claimed->pos_payment_terminal_id);
            try {
                return $this->adapters->for($terminal->provider)->fetch($terminal, $claimed);
            } catch (Throwable) {
                throw new PosTerminalException('terminal_unavailable_now', 'تعذّر الوصول إلى الجهاز الآن؛ أعد المحاولة.');
            }
        });
    }

    /** إلغاء طلب لم يُوافَق عليه. إن سبقته موافقة على الجهاز تُسجَّل موافقة (ويلغيها المجدول/الكاشير). */
    public function cancel(PosTerminalRequest $request): PosTerminalRequest
    {
        $request = PosTerminalRequest::query()->findOrFail($request->id);
        if (! in_array($request->status, [PosTerminalRequest::STATUS_CREATED, PosTerminalRequest::STATUS_SENT], true)) {
            throw new PosTerminalException('not_cancellable', 'لا يمكن إلغاء الطلب في حالته الحالية؛ استعمل إلغاء الموافقة.');
        }

        return $this->providerOp($request->id, function (PosTerminalRequest $claimed) {
            $terminal = PosPaymentTerminal::query()->findOrFail($claimed->pos_payment_terminal_id);
            try {
                return $this->adapters->for($terminal->provider)->cancel($terminal, $claimed);
            } catch (Throwable) {
                throw new PosTerminalException('terminal_unavailable_now', 'تعذّر الوصول إلى الجهاز الآن؛ أعد المحاولة.');
            }
        });
    }

    /** إلغاء يدوي لموافقة قائمة أو إعادة محاولة إلغاء فاشل. */
    public function void(PosTerminalRequest $request): PosTerminalRequest
    {
        $request = PosTerminalRequest::query()->findOrFail($request->id);
        if (! in_array($request->status, [PosTerminalRequest::STATUS_APPROVED, PosTerminalRequest::STATUS_COMPENSATION_REQUIRED], true)) {
            throw new PosTerminalException('not_voidable', 'لا توجد موافقة قائمة لإلغائها.');
        }

        return $this->compensate($request->id);
    }

    /** إقرار مدير بأن الأموال أُعيدت خارج النظام (مثلاً من لوحة المزوّد) فيُحلّ `compensation_required` ويُفتح الإقفال. */
    public function resolve(PosTerminalRequest $request, User $actor, string $note): PosTerminalRequest
    {
        $note = trim($note);
        if (mb_strlen($note) < 5) {
            throw new PosTerminalException('note_required', 'ملاحظة الحل مطلوبة (5 أحرف على الأقل).');
        }

        return DB::transaction(function () use ($request, $actor, $note) {
            $locked = PosTerminalRequest::query()->whereKey($request->id)->lockForUpdate()->firstOrFail();
            if ($locked->status !== PosTerminalRequest::STATUS_COMPENSATION_REQUIRED) {
                throw new PosTerminalException('not_resolvable', 'الطلب لا يحتاج حلاً.');
            }
            // محاولة إلغاء حيّة (إيجار) ⇒ لا حلّ يدوي الآن: قد ينجح الإلغاء بعد إقرار المدير بأن المبلغ أُعيد خارجياً فيُرَدّ مرتين.
            if ($locked->compensating_until !== null && $locked->compensating_until->isFuture()) {
                throw new PosTerminalException('compensation_in_progress', 'محاولة إلغاء جارية على الجهاز؛ انتظر انتهاءها ثم أعد المحاولة.');
            }
            $locked->update([
                'status' => PosTerminalRequest::STATUS_COMPENSATED,
                'resolved_by' => $actor->id,
                'resolution_note' => $note,
                'resolved_at' => now('UTC'),
            ]);

            return $locked->fresh();
        });
    }

    // ═══════════════ التكامل مع البيع (داخل معاملة checkout) ═══════════════

    /**
     * يقفل ويتحقق من الموافقات التي تحملها وسائل الدفع. أي خلل ⇒ استثناء يُرجع البيع كاملاً. `$claimedIds` يُملأ بالموافقات التي اجتازت التحقق فقط
     * (بالمرجع، فيبقى متاحاً بعد تراجع المعاملة) وهي وحدها ما يُعوَّض آلياً إن فشل البيع بعدها.
     *
     * @param  list<array<string,mixed>>  $tenders
     * @param  array<string, PaymentMethod>  $methods  مفهرسة بمعرّف الوسيلة
     * @return array<string, PosTerminalRequest> مفهرسة بمعرّف الوسيلة
     */
    public function claimApprovals(array $tenders, array $methods, PosSession $session, array &$claimedIds = []): array
    {
        $claimed = [];
        foreach ($tenders as $tender) {
            $methodId = $tender['payment_method_id'];
            $requestId = $tender['terminal_request_id'] ?? null;
            $method = $methods[$methodId] ?? null;

            if ($requestId === null) {
                if ($method !== null && $method->pos_terminal_required) {
                    throw new PosTerminalException('terminal_approval_required', "وسيلة الدفع «{$method->name}» تشترط موافقة جهاز مؤكدة قبل البيع.");
                }

                continue;
            }

            if ($method === null || $method->settlement_type === 'cash') {
                throw new PosTerminalException('method_not_card', 'موافقة الجهاز لا تنطبق على التحصيل النقدي.');
            }
            $request = PosTerminalRequest::query()->whereKey($requestId)->lockForUpdate()->first();
            if ($request === null) {
                throw new PosTerminalException('approval_not_found', 'موافقة الجهاز غير موجودة.');
            }
            if ($request->status !== PosTerminalRequest::STATUS_APPROVED) {
                throw new PosTerminalException('approval_not_approved', 'موافقة الجهاز غير مؤكدة أو سبق استهلاكها أو إلغاؤها.');
            }
            if (! $request->isApprovalAvailable()) {
                throw new PosTerminalException('approval_being_voided', 'موافقة الجهاز قيد الإلغاء ولا يمكن استهلاكها.');
            }
            if ($request->pos_session_id !== $session->id) {
                throw new PosTerminalException('approval_wrong_session', 'موافقة الجهاز تخص جلسة أخرى.');
            }
            if ($request->payment_method_id !== $methodId) {
                throw new PosTerminalException('approval_wrong_method', 'موافقة الجهاز تخص وسيلة دفع أخرى.');
            }
            if ($request->amount !== (int) $tender['amount']) {
                throw new PosTerminalException('approval_amount_mismatch', 'مبلغ وسيلة الدفع يجب أن يطابق المبلغ الموافَق عليه على الجهاز تماماً.');
            }
            if (isset($claimed[$methodId])) {
                throw new PosTerminalException('approval_duplicate', 'لا يمكن تكرار موافقة الجهاز نفسها.');
            }
            $claimed[$methodId] = $request;
            // لا تعويض آلي إلا لموافقة اجتازت **كل** فحوص هذا البيع (جلسة/وسيلة/مبلغ/توفر)؛ موافقة صالحة رُفض استعمالها لخلل في الطلب لا تُلغى.
            $claimedIds[] = $request->id;
        }

        return $claimed;
    }

    /** يربط الموافقة بالسند الناتج (نهائي): الاستهلاك مرة واحدة لكل سند. */
    public function markConsumed(PosTerminalRequest $request, Payment $payment, Invoice $invoice): void
    {
        $request->update([
            'status' => PosTerminalRequest::STATUS_CONSUMED,
            'consumed_payment_id' => $payment->id,
            'consumed_invoice_id' => $invoice->id,
            'consumed_at' => now('UTC'),
        ]);
    }

    /**
     * بعد تراجع معاملة بيع فاشلة: كل موافقة ما زالت `approved` لهذه الجلسة تُلغى على الجهاز (لا موافقة يتيمة). لا يلمس موافقة استهلكها بيع آخر
     * (يعيد فحص الحالة تحت القفل). لا يرمي: فشل الإلغاء يصير `compensation_required`.
     *
     * @param  list<string>  $requestIds
     */
    public function compensateAfterFailedCheckout(array $requestIds, string $sessionId): void
    {
        foreach (array_unique($requestIds) as $id) {
            try {
                $request = PosTerminalRequest::query()->whereKey($id)->first();
                if ($request === null || $request->pos_session_id !== $sessionId || $request->status !== PosTerminalRequest::STATUS_APPROVED) {
                    continue;
                }
                $this->compensate($request->id);
            } catch (Throwable $e) {
                report($e);
            }
        }
    }

    /**
     * يلغي موافقة على الجهاز. ثلاث مراحل: (1) قفل الصف وأخذ الإيجار (لا إيجار حي لغيرنا) (2) استدعاء الجهاز خارج المعاملة (3) تثبيت النتيجة.
     * النجاح ⇒ voided؛ أي فشل ⇒ compensation_required برمز ثابت.
     */
    public function compensate(string $requestId): PosTerminalRequest
    {
        $lease = max(10, (int) config('pos_terminals.compensation_lease_seconds', 90));

        $token = (string) Str::uuid();
        $claimed = DB::transaction(function () use ($requestId, $lease, $token) {
            $request = PosTerminalRequest::query()->whereKey($requestId)->lockForUpdate()->first();
            if ($request === null
                || ! in_array($request->status, [PosTerminalRequest::STATUS_APPROVED, PosTerminalRequest::STATUS_COMPENSATION_REQUIRED], true)
                || ($request->compensating_until !== null && $request->compensating_until->isFuture())) {
                return null;
            }
            $request->update(['compensating_until' => now('UTC')->addSeconds($lease), 'lease_token' => $token, 'void_attempts' => $request->void_attempts + 1]);

            return $request;
        });
        if ($claimed === null) {
            return PosTerminalRequest::query()->findOrFail($requestId);
        }

        $error = null;
        try {
            $terminal = PosPaymentTerminal::query()->findOrFail($claimed->pos_payment_terminal_id);
            $result = $this->adapters->for($terminal->provider)->void($terminal, $claimed);
            if ($result->status !== PosTerminalResult::VOIDED) {
                $error = $result->failureCode ?: 'void_not_confirmed';
            }
        } catch (Throwable) {
            $error = 'void_failed';
        }

        return DB::transaction(function () use ($requestId, $error, $token) {
            $request = PosTerminalRequest::query()->whereKey($requestId)->lockForUpdate()->firstOrFail();
            if (! in_array($request->status, [PosTerminalRequest::STATUS_APPROVED, PosTerminalRequest::STATUS_COMPENSATION_REQUIRED], true)) {
                return $request;
            }
            if ($request->lease_token !== $token) {
                return $request; // انتهى إيجار هذه المحاولة وأخذه غيرها: نتيجتها متأخرة ولا تُنهي الحالة ولا تحرّر إيجار المالك الحالي.
            }
            if ($error === null) {
                $request->update(['status' => PosTerminalRequest::STATUS_VOIDED, 'voided_at' => now('UTC'), 'compensating_until' => null, 'lease_token' => null, 'last_void_error' => null]);
            } else {
                $request->update(['status' => PosTerminalRequest::STATUS_COMPENSATION_REQUIRED, 'compensating_until' => null, 'lease_token' => null, 'last_void_error' => substr($error, 0, 48)]);
            }

            return $request->fresh();
        });
    }

    // ═══════════════ المجدول ═══════════════

    /**
     * يعالج المتأخر بلا سياق مستأجر/فرع: موافقات يتيمة تتجاوز المهلة ⇒ إلغاء؛ طلبات معلّقة قديمة ⇒ استعلام ثم إلغاء/انتهاء؛ تعويض فاشل ⇒ إعادة محاولة.
     *
     * @return array{voided:int, expired:int, failed:int, scanned:int}
     */
    public function sweep(int $limit = 200): array
    {
        $summary = ['voided' => 0, 'expired' => 0, 'failed' => 0, 'scanned' => 0];
        $now = now('UTC');
        $ttl = max(1, (int) config('pos_terminals.approval_ttl_minutes', 10));
        $pending = max(1, (int) config('pos_terminals.pending_expire_minutes', 15));

        $rows = PosTerminalRequest::query()->withoutGlobalScopes()
            ->where(function ($q) use ($now, $ttl, $pending) {
                $q->where(fn ($a) => $a->where('status', PosTerminalRequest::STATUS_APPROVED)->where('approved_at', '<=', $now->copy()->subMinutes($ttl)))
                    ->orWhere(fn ($b) => $b->whereIn('status', [PosTerminalRequest::STATUS_CREATED, PosTerminalRequest::STATUS_SENT])->where('created_at', '<=', $now->copy()->subMinutes($pending)))
                    ->orWhere(fn ($c) => $c->where('status', PosTerminalRequest::STATUS_COMPENSATION_REQUIRED)->where('updated_at', '<=', $now->copy()->subMinutes(5)));
            })
            // الأقدم تحديثاً أولاً: صف يفشل في التشغيل يُحرَّك إلى آخر الدور (touch أدناه) فلا يحتكر الدفعة ويجوّع غيره.
            ->orderBy('updated_at')->limit($limit)->get(['id', 'tenant_id', 'branch_id', 'status']);

        $tenant = app(TenantContext::class);
        $branch = app(BranchContext::class);
        foreach ($rows as $row) {
            $summary['scanned']++;
            $tenant->set((string) $row->tenant_id);
            $branch->set($row->branch_id);
            try {
                if (in_array($row->status, [PosTerminalRequest::STATUS_APPROVED, PosTerminalRequest::STATUS_COMPENSATION_REQUIRED], true)) {
                    $result = $this->compensate($row->id);
                    $result->status === PosTerminalRequest::STATUS_VOIDED ? $summary['voided']++ : $summary['failed']++;
                } else {
                    $expired = $this->expirePending($row->id);
                    $summary[$expired ? 'expired' : 'failed']++;
                    if (! $expired) {
                        DB::table('pos_terminal_requests')->where('id', $row->id)->update(['updated_at' => now('UTC')]);
                    }
                }
            } catch (Throwable $e) {
                $summary['failed']++;
                DB::table('pos_terminal_requests')->where('id', $row->id)->update(['updated_at' => now('UTC')]);
                report($e);
            } finally {
                $tenant->forget();
                $branch->forget();
            }
        }

        return $summary;
    }

    /** طلب معلّق قديم: يُلغى على الجهاز؛ إن كان الجهاز وافق بالفعل يصير approved (ويلغيه المجدول لاحقاً) ولا يُعتبر منتهياً. */
    private function expirePending(string $requestId): bool
    {
        $request = PosTerminalRequest::query()->findOrFail($requestId);
        if (! in_array($request->status, [PosTerminalRequest::STATUS_CREATED, PosTerminalRequest::STATUS_SENT], true)) {
            return true;
        }
        $applied = $this->providerOp($requestId, function (PosTerminalRequest $claimed) {
            $terminal = PosPaymentTerminal::query()->findOrFail($claimed->pos_payment_terminal_id);

            return $this->adapters->for($terminal->provider)->cancel($terminal, $claimed);
        }, expireOnCancel: true);

        return $applied->status === PosTerminalRequest::STATUS_EXPIRED;
    }

    /** @return array{compensation_required:int, in_flight:int} */
    public function blockersForSession(string $sessionId): array
    {
        $base = PosTerminalRequest::query()->where('pos_session_id', $sessionId);

        return [
            'compensation_required' => (clone $base)->where('status', PosTerminalRequest::STATUS_COMPENSATION_REQUIRED)->count(),
            'in_flight' => (clone $base)->whereIn('status', PosTerminalRequest::IN_FLIGHT)->count(),
        ];
    }

    // ═══════════════ تطبيق نتيجة الجهاز ═══════════════

    /** مبلغ موافقة مختلف عن المطلوب ⇒ المال محتجز: يُلغى على الجهاز فوراً بعد تثبيت الحالة. */
    private function settle(PosTerminalRequest $request): PosTerminalRequest
    {
        if ($request->status === PosTerminalRequest::STATUS_COMPENSATION_REQUIRED && $request->failure_code === 'amount_mismatch' && $request->void_attempts === 0) {
            return $this->compensate($request->id);
        }

        return $request;
    }

    private function apply(string $requestId, PosTerminalResult $result, bool $expireOnCancel = false, ?string $leaseToken = null): PosTerminalRequest
    {
        return DB::transaction(function () use ($requestId, $result, $expireOnCancel, $leaseToken) {
            $request = PosTerminalRequest::query()->whereKey($requestId)->lockForUpdate()->firstOrFail();
            $from = $request->status;
            if (! in_array($from, [PosTerminalRequest::STATUS_CREATED, PosTerminalRequest::STATUS_SENT], true)) {
                return $request; // نهائي أو موافَق عليه: لا يُعاد تفسيره بنتيجة متأخرة
            }
            if ($leaseToken !== null && $request->lease_token !== $leaseToken) {
                return $request; // انتهى إيجار هذه العملية وأخذه غيرها: نتيجتها متأخرة ولا تُطبَّق (صاحب الإيجار الحالي يقرّر).
            }

            // كل نتيجة تُحرّر إيجار عملية المزوّد (providerOp).
            $refs = ['provider_ref' => $result->providerRef ?? $request->provider_ref, 'compensating_until' => null, 'lease_token' => null];
            switch ($result->status) {
                case PosTerminalResult::PENDING:
                    $request->update([
                        ...$refs,
                        'status' => PosTerminalRequest::STATUS_SENT,
                        // نتيجة استعلام لاحقة تمسح علامة "غير مؤكد" السابقة؛ العلامة تُكتب فقط مع نتيجة غامضة.
                        'failure_code' => $result->failureCode !== null ? substr($result->failureCode, 0, 48) : null,
                    ]);
                    break;
                case PosTerminalResult::APPROVED:
                    $request->update([
                        ...$refs,
                        'status' => PosTerminalRequest::STATUS_APPROVED,
                        'failure_code' => null,
                        'approval_code' => $result->approvalCode,
                        'rrn' => $result->rrn,
                        'last4' => $result->last4,
                        'approved_at' => now('UTC'),
                    ]);
                    if ($result->amountMinor !== null && $result->amountMinor !== $request->amount) {
                        // مبلغ مختلف عمّا طُلب: المال محتجز على الجهاز ⇒ لا يُستهلك أبداً، يُعوَّض فوراً (يلتقطه compensate بعد الـcommit).
                        $request->update(['status' => PosTerminalRequest::STATUS_COMPENSATION_REQUIRED, 'failure_code' => 'amount_mismatch', 'last_void_error' => 'amount_mismatch']);
                    }
                    break;
                case PosTerminalResult::DECLINED:
                    $request->update([...$refs, 'status' => PosTerminalRequest::STATUS_DECLINED, 'failure_code' => substr((string) ($result->failureCode ?: 'declined'), 0, 48)]);
                    break;
                case PosTerminalResult::CANCELLED:
                    $request->update([...$refs, 'status' => $expireOnCancel ? PosTerminalRequest::STATUS_EXPIRED : PosTerminalRequest::STATUS_CANCELLED]);
                    break;
                default:
                    $request->update([...$refs, 'status' => PosTerminalRequest::STATUS_ERROR, 'failure_code' => substr((string) ($result->failureCode ?: 'terminal_error'), 0, 48)]);
            }

            return $request->fresh();
        });
    }
}
