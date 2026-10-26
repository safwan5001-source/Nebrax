<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StorePaymentMethodRequest;
use App\Http\Requests\UploadPaymentMethodLogoRequest;
use App\Http\Resources\PaymentMethodResource;
use App\Models\CashBankAccount;
use App\Models\PaymentGateway;
use App\Models\PaymentMethod;
use App\Services\Accounting\CashBankAccountService;
use App\Services\AttachmentStorage;
use App\Support\PaymentMethodVisual;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\StreamedResponse;

/** إدارة بيان طرق الدفع المشترك للمؤسسة، بلا رسوم أو قيود محاسبية. */
class PaymentMethodController extends ApiController
{
    public function __construct(private CashBankAccountService $cashBankAccounts, private AttachmentStorage $attachmentStorage) {}

    public function index(): JsonResponse
    {
        $this->cashBankAccounts->bootstrapDefaults();

        return PaymentMethodResource::collection(
            PaymentMethod::query()
                ->with(['cashBankAccount.account', 'posClearingGateway'])
                ->withCount('payments')
                ->orderByDesc('is_default')
                ->orderBy('name')
                ->get()
        )->response();
    }

    public function store(StorePaymentMethodRequest $request): JsonResponse
    {
        $data = $this->normalize($request->validated());
        $visual = $this->resolveVisual($request->validated(), null);
        $this->assertNameFree($data['name']);
        $this->assertCashBankAccount($data['cash_bank_account_id'], $data['settlement_type']);
        $this->assertPosClearingGateway($data['pos_clearing_gateway_id'], $data['settlement_type'], null);
        $this->assertTerminalPolicy($data['pos_terminal_required'], $data['settlement_type']);

        $method = DB::transaction(function () use ($data, $visual) {
            if ($data['is_default']) {
                PaymentMethod::where('is_default', true)->update(['is_default' => false]);
            }

            return PaymentMethod::create($data + $visual['attributes']);
        });

        return (new PaymentMethodResource($method->load(['cashBankAccount.account', 'posClearingGateway'])))
            ->response()->setStatusCode(201);
    }

    public function update(StorePaymentMethodRequest $request, string $id): JsonResponse
    {
        $method = PaymentMethod::findOrFail($id);
        $data = $this->normalize($request->validated(), $method);
        $visual = $this->resolveVisual($request->validated(), $method);
        $this->assertNameFree($data['name'], $method->id);
        $this->assertCashBankAccount($data['cash_bank_account_id'], $data['settlement_type']);
        $this->assertPosClearingGateway($data['pos_clearing_gateway_id'], $data['settlement_type'], $method);
        $this->assertTerminalPolicy($data['pos_terminal_required'], $data['settlement_type']);

        DB::transaction(function () use ($method, $data, $visual) {
            if (! $data['is_active'] && $data['is_default']) {
                abort(422, 'لا يمكن أن تكون طريقة دفع معطلة هي الافتراضية. فعّلها أو عيّن بديلاً أولاً.');
            }
            if ($data['is_default']) {
                PaymentMethod::where('is_default', true)->whereKeyNot($method->id)->update(['is_default' => false]);
            }
            if ($method->is_default && ! $data['is_default'] && ! PaymentMethod::where('is_active', true)->where('id', '!=', $method->id)->exists()) {
                abort(422, 'لا يمكن إزالة الافتراضي من دون وجود طريقة دفع نشطة بديلة.');
            }

            $method->update($data + $visual['attributes']);
            if ($visual['dropLogo']) {
                $method->logo_path = null;
                $method->logo_disk = null;
                $method->save();
            }
        });

        // بعد الالتزام: محو كائن الشعار المستبدَل بالأيقونة/الافتراضي (فشل المحو يُسجَّل ولا يُفشل الطلب).
        if ($visual['dropLogo'] && $visual['oldLogo'] !== null) {
            $this->attachmentStorage->discard([$visual['oldLogo']]);
        }

        return (new PaymentMethodResource($method->fresh()->load(['cashBankAccount.account', 'posClearingGateway'])))->response();
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

        return (new PaymentMethodResource($method->fresh()->load(['cashBankAccount.account', 'posClearingGateway'])))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        $method = PaymentMethod::findOrFail($id);
        if ($method->payments()->exists()) {
            abort(422, 'لا يمكن حذف طريقة دفع مستخدمة في سندات. عطّلها بدلاً من ذلك.');
        }
        // H6-02: طلبات أجهزة الدفع دليل مالي (FK مقيِّد): الحذف يُرفض بتحقق عادي لا 500.
        if (\App\Models\PosTerminalRequest::query()->withoutGlobalScopes()->where('payment_method_id', $method->id)->exists()) {
            abort(422, 'لا يمكن حذف طريقة دفع لها عمليات على أجهزة الدفع. عطّلها بدلاً من ذلك.');
        }
        if ($method->is_default) {
            abort(422, 'لا يمكن حذف طريقة الدفع الافتراضية. عيّن بديلاً أولاً.');
        }

        $logo = $this->logoPointer($method);
        $method->delete();
        if ($logo !== null) {
            $this->attachmentStorage->discard([$logo]);
        }

        return response()->json(['message' => 'deleted']);
    }

    /** يستبدل شعار الطريقة (يحوّلها إلى وضع الصورة). الجديد يُكتب أولاً ثم يُثبَّت المؤشّر ثم يُحذف القديم. */
    public function uploadLogo(UploadPaymentMethodLogoRequest $request, string $id): JsonResponse
    {
        $method = PaymentMethod::findOrFail($id);
        $old = $this->logoPointer($method);

        $new = $this->attachmentStorage->put(
            AttachmentStorage::DOMAIN_PAYMENT_METHOD_LOGO, (string) $method->id, $request->file('logo'), "payment-methods/{$method->id}",
        );

        try {
            $method->logo_path = $new['path'];
            $method->logo_disk = $new['disk'];
            $method->visual_mode = PaymentMethodVisual::MODE_IMAGE;
            $method->icon_key = null;
            $method->icon_color = null;
            $method->save();
        } catch (\Throwable $e) {
            $this->attachmentStorage->discard([$new]);
            throw $e;
        }

        if ($old !== null) {
            $this->attachmentStorage->discard([$old]);
        }

        return $this->resource($method);
    }

    /** يزيل الشعار ويعيد الطريقة إلى الافتراضي. محو الكائن قبل إزالة المؤشّر: الفشل يرمي والمؤشّر باقٍ. */
    public function removeLogo(string $id): JsonResponse
    {
        $method = PaymentMethod::findOrFail($id);
        $logo = $this->logoPointer($method);

        if ($logo !== null) {
            $this->attachmentStorage->delete($logo['disk'], $logo['path']);
            $method->logo_path = null;
            $method->logo_disk = null;
            if ($method->visual_mode === PaymentMethodVisual::MODE_IMAGE) {
                $method->visual_mode = PaymentMethodVisual::MODE_DEFAULT;
            }
            $method->save();
        }

        return $this->resource($method);
    }

    /** بث الشعار للعرض (مصادَق، بعزل المستأجر عبر findOrFail). */
    public function showLogo(string $id): StreamedResponse
    {
        $method = PaymentMethod::findOrFail($id);
        $logo = $this->logoPointer($method);
        if ($logo === null) {
            abort(404, 'لا شعار لطريقة الدفع هذه.');
        }

        return $this->attachmentStorage->inlineImage($logo['disk'], $logo['path']);
    }

    private function resource(PaymentMethod $method): JsonResponse
    {
        return (new PaymentMethodResource($method->fresh()->load(['cashBankAccount.account', 'posClearingGateway'])))->response();
    }

    /** @return array{disk:string,path:string}|null `null`/`local` = القرص المحلي. */
    private function logoPointer(PaymentMethod $method): ?array
    {
        return $method->logo_path ? ['disk' => $method->logo_disk ?: 'local', 'path' => $method->logo_path] : null;
    }

    /**
     * يحسم التخصيص البصري. غياب مفاتيحه كلها يُبقي القائم تماماً (توافق العملاء القدامى ومسار التفعيل/التعطيل).
     * الأوضاع متنافية: أيقونة/افتراضي يُسقطان الشعار، والصورة تشترط شعاراً مرفوعاً سلفاً.
     *
     * @return array{attributes:array<string,mixed>,dropLogo:bool,oldLogo:?array{disk:string,path:string}}
     */
    private function resolveVisual(array $validated, ?PaymentMethod $current): array
    {
        $touched = array_intersect_key($validated, array_flip(['visual_mode', 'icon_key', 'icon_color']));
        if ($touched === []) {
            return ['attributes' => [], 'dropLogo' => false, 'oldLogo' => null];
        }

        $logo = $current ? $this->logoPointer($current) : null;
        $mode = array_key_exists('visual_mode', $validated)
            ? ($validated['visual_mode'] ?: PaymentMethodVisual::MODE_DEFAULT)
            : ($current?->visual_mode ?: PaymentMethodVisual::MODE_DEFAULT);
        $key = array_key_exists('icon_key', $validated) ? $validated['icon_key'] : $current?->icon_key;
        $color = array_key_exists('icon_color', $validated) ? $validated['icon_color'] : $current?->icon_color;

        if ($mode === PaymentMethodVisual::MODE_ICON) {
            if ($key === null) {
                abort(422, 'اختر أيقونة لطريقة الدفع.');
            }
            return ['attributes' => ['visual_mode' => $mode, 'icon_key' => $key, 'icon_color' => $color], 'dropLogo' => $logo !== null, 'oldLogo' => $logo];
        }

        if ($mode === PaymentMethodVisual::MODE_IMAGE) {
            if ($logo === null) {
                abort(422, 'ارفع شعاراً أولاً قبل اختيار وضع الصورة.');
            }
            return ['attributes' => ['visual_mode' => $mode, 'icon_key' => null, 'icon_color' => null], 'dropLogo' => false, 'oldLogo' => null];
        }

        return ['attributes' => ['visual_mode' => $mode, 'icon_key' => null, 'icon_color' => null], 'dropLogo' => $logo !== null, 'oldLogo' => $logo];
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
            // غياب المفتاح في التحديث يُبقي الربط القائم؛ null الصريح يفكّه.
            'pos_clearing_gateway_id' => $value('pos_clearing_gateway_id', null),
            'pos_terminal_required' => (bool) $value('pos_terminal_required', false),
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

    /**
     * D-09: ربط المقاصة يخص طريقة بنكية (بطاقة/تحويل) فقط، وباتصال نشط للمستأجر. الربط القائم غير المتغيّر لا يُعاد فحصه (كي لا تُحجب
     * تعديلات الطريقة الأخرى لأن اتصالها أُوقف لاحقاً)؛ POS يفحص صلاحيته عند كل بيع ويفشل مغلقاً.
     */
    private function assertPosClearingGateway(?string $gatewayId, string $type, ?PaymentMethod $current): void
    {
        if ($gatewayId === null) {
            return;
        }
        if ($type !== 'bank') {
            abort(422, 'مقاصة نقطة البيع تخص الطرق البنكية فقط؛ فكّ الربط قبل تحويل الطريقة إلى نقدية.');
        }
        if ($current !== null && $current->pos_clearing_gateway_id === $gatewayId) {
            return;
        }
        $gateway = PaymentGateway::query()->find($gatewayId);
        if ($gateway === null || ! $gateway->isUsable()) {
            abort(422, 'اتصال المستحوذ المختار غير موجود أو غير نشط.');
        }
    }

    /** شرط موافقة الجهاز يخص الطرق البنكية (بطاقة) فقط. */
    private function assertTerminalPolicy(bool $required, string $type): void
    {
        if ($required && $type !== 'bank') {
            abort(422, 'اشتراط موافقة جهاز الدفع يخص الطرق البنكية فقط.');
        }
    }
}
