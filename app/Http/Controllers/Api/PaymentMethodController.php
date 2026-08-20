<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StorePaymentMethodRequest;
use App\Http\Resources\PaymentMethodResource;
use App\Models\CashBankAccount;
use App\Models\PaymentMethod;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/** إدارة بيان طرق الدفع المشترك للمؤسسة، بلا رسوم أو قيود محاسبية. */
class PaymentMethodController extends ApiController
{
    public function index(): JsonResponse
    {
        return PaymentMethodResource::collection(
            PaymentMethod::query()
                ->with('cashBankAccount.account')
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

        $method = DB::transaction(function () use ($data) {
            if ($data['is_default']) {
                PaymentMethod::where('is_default', true)->update(['is_default' => false]);
            }

            return PaymentMethod::create($data);
        });

        return (new PaymentMethodResource($method->load('cashBankAccount.account')))
            ->response()->setStatusCode(201);
    }

    public function update(StorePaymentMethodRequest $request, string $id): JsonResponse
    {
        $method = PaymentMethod::findOrFail($id);
        $data = $this->normalize($request->validated(), $method);
        $this->assertNameFree($data['name'], $method->id);
        $this->assertCashBankAccount($data['cash_bank_account_id'], $data['settlement_type']);

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

        return (new PaymentMethodResource($method->fresh()->load('cashBankAccount.account')))->response();
    }

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

        return (new PaymentMethodResource($method->fresh()->load('cashBankAccount.account')))->response();
    }

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

    private function normalize(array $data, ?PaymentMethod $current = null): array
    {
        $value = function (string $key, mixed $default) use ($data, $current): mixed {
            return array_key_exists($key, $data) ? $data[$key] : ($current?->{$key} ?? $default);
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
}
