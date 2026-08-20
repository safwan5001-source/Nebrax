<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StorePaymentMethodRequest;
use App\Http\Resources\PaymentMethodResource;
use App\Models\Account;
use App\Models\CashBankAccount;
use App\Models\PaymentMethod;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * إدارة بيان طرق الدفع المشترك للمؤسسة.
 *
 * لا ينشئ المتحكم قيوداً: يثبت صحة الإعدادات، ويقرأ PaymentService اللقطة عند
 * إنشاء السند. يظل إلغاء الطريقة المستخدمة حظراً تدقيقياً، وتعطيلها هو البديل.
 */
class PaymentMethodController extends ApiController
{
    public function index(): JsonResponse
    {
        return PaymentMethodResource::collection(
            PaymentMethod::query()
                ->with(['cashBankAccount.account', 'feeExpenseAccount'])
                ->withCount('payments')
                ->orderByDesc('is_default')
                ->orderBy('name')
                ->get()
        )->response();
    }

    public function store(StorePaymentMethodRequest $request): JsonResponse
    {
        $data = $this->normalize($request->validated());
        $this->assertNameFree($data['name']);
        $this->assertCashBankAccount($data['cash_bank_account_id'], $data['settlement_type']);
        $this->assertFeeExpenseAccount($data);

        $method = DB::transaction(function () use ($data) {
            if ($data['is_default']) {
                PaymentMethod::where('is_default', true)->update(['is_default' => false]);
            }

            return PaymentMethod::create($data);
        });

        return (new PaymentMethodResource($method->load(['cashBankAccount.account', 'feeExpenseAccount'])))
            ->response()->setStatusCode(201);
    }

    public function update(StorePaymentMethodRequest $request, string $id): JsonResponse
    {
        $method = PaymentMethod::findOrFail($id);
        $data = $this->normalize($request->validated(), $method);
        $this->assertNameFree($data['name'], $method->id);
        $this->assertCashBankAccount($data['cash_bank_account_id'], $data['settlement_type']);
        $this->assertFeeExpenseAccount($data);

        DB::transaction(function () use ($method, $data) {
            if (! $data['is_active'] && $data['is_default']) {
                abort(422, 'لا يمكن أن تكون طريقة دفع معطلة هي الافتراضية. فعّلها أو عيّن بديلاً أولاً.');
            }
            if ($data['is_default']) {
                PaymentMethod::where('is_default', true)->whereKeyNot($method->id)->update(['is_default' => false]);
            }
            if ($method->is_default && ! $data['is_default'] && ! PaymentMethod::where('is_active', true)->where('id', '!=', $method->id)->exists()) {
                abort(422, 'لا يمكن إزالة الافتراضي من دون وجود طريقة دفع نشطة بديلة.');
            }

            $method->update($data);
        });

        return (new PaymentMethodResource($method->fresh()->load(['cashBankAccount.account', 'feeExpenseAccount'])))->response();
    }

    /** تعيين الافتراضي إجراء صريح، ويمنع اختيار طريقة معطلة. */
    public function makeDefault(string $id): JsonResponse
    {
        $method = PaymentMethod::findOrFail($id);
        if (! $method->is_active) {
            abort(422, 'لا يمكن تعيين طريقة دفع معطلة كافتراضية.');
        }

        DB::transaction(function () use ($method) {
            PaymentMethod::where('is_default', true)->whereKeyNot($method->id)->update(['is_default' => false]);
            $method->update(['is_default' => true]);
        });

        return (new PaymentMethodResource($method->fresh()->load(['cashBankAccount.account', 'feeExpenseAccount'])))->response();
    }

    /** الحذف آمن فقط إن لم يلتقط أي سند لقطة هذه الطريقة. */
    public function destroy(string $id): JsonResponse
    {
        $method = PaymentMethod::findOrFail($id);
        if ($method->payments()->exists()) {
            abort(422, 'لا يمكن حذف طريقة دفع مستخدمة في سندات. عطّلها بدلاً من ذلك.');
        }
        if ($method->is_default) {
            abort(422, 'لا يمكن حذف طريقة الدفع الافتراضية. عيّن بديلاً أولاً.');
        }

        $method->delete();

        return response()->json(['message' => 'deleted']);
    }

    /** يملأ القيم الغائبة من السجل عند التعديل، مع تمييز الغائب عن الصفر أو النص الفارغ. */
    private function normalize(array $data, ?PaymentMethod $current = null): array
    {
        $value = function (string $key, mixed $default) use ($data, $current): mixed {
            if (array_key_exists($key, $data)) {
                return $data[$key];
            }

            return $current?->{$key} ?? $default;
        };

        return [
            'name' => trim((string) $value('name', '')),
            'name_en' => $value('name_en', null),
            'settlement_type' => $value('settlement_type', 'cash'),
            'cash_bank_account_id' => $value('cash_bank_account_id', null),
            'instructions' => $value('instructions', null),
            'available_online' => (bool) $value('available_online', false),
            'is_active' => (bool) $value('is_active', true),
            'is_default' => (bool) $value('is_default', false),
            'fees_enabled' => (bool) $value('fees_enabled', false),
            'fee_rate_bps' => (int) $value('fee_rate_bps', 0),
            'fee_fixed_amount' => (int) $value('fee_fixed_amount', 0),
            'fee_min_amount' => (int) $value('fee_min_amount', 0),
            'fee_tax_rate' => (int) $value('fee_tax_rate', 0),
            'fee_expense_account_id' => $value('fee_expense_account_id', null),
        ];
    }

    private function assertNameFree(string $name, ?string $exceptId = null): void
    {
        $query = PaymentMethod::query()->where('name', $name);
        if ($exceptId !== null) {
            $query->whereKeyNot($exceptId);
        }
        if ($query->exists()) {
            abort(422, 'توجد طريقة دفع بهذا الاسم.');
        }
    }

    private function assertCashBankAccount(string $id, string $type): void
    {
        $entity = CashBankAccount::with('account')->find($id);
        if (! $entity || $entity->type !== $type || ! $entity->is_active || ! $entity->account?->is_active) {
            abort(422, 'الخزينة أو الحساب البنكي المختار غير نشط أو لا يطابق نوع التسوية.');
        }
    }

    private function assertFeeExpenseAccount(array $data): void
    {
        if (! $data['fees_enabled']) {
            return;
        }

        $account = Account::find($data['fee_expense_account_id']);
        if (! $account || $account->type !== 'expense' || $account->is_group) {
            abort(422, 'حساب رسوم الدفع يجب أن يكون حساب مصروفات فعلياً غير تجميعي.');
        }
    }
}
