<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StorePosDeviceRequest;
use App\Http\Resources\PosDeviceResource;
use App\Models\PosDevice;
use App\Models\PosSession;
use App\Services\Accounting\PosDeviceService;
use App\Services\Pos\CashDrawerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Validation\Rule;

class PosDeviceController extends ApiController
{
    public function __construct(
        protected PosDeviceService $devices,
        protected CashDrawerService $cashDrawer,
    ) {}

    public function index(): JsonResponse
    {
        return PosDeviceResource::collection(PosDevice::with('warehouse')->orderBy('name')->get())->response();
    }

    public function store(StorePosDeviceRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertWarehouseAllowed($data['warehouse_id'], $this->activeBranchId());
        $device = $this->domain(fn () => $this->devices->create($data));

        return (new PosDeviceResource($device->load('warehouse')))->response()->setStatusCode(201);
    }

    public function update(StorePosDeviceRequest $request, string $id): JsonResponse
    {
        $device = PosDevice::findOrFail($id);
        $data = $request->validated();
        if (array_key_exists('warehouse_id', $data)) {
            $this->assertWarehouseAllowed($data['warehouse_id'], $device->branch_id);
        }

        $device = $this->domain(fn () => $this->devices->update($device, $data));

        return (new PosDeviceResource($device))->response();
    }

    /**
     * الحفظ لا يشغّل أي أمر مادي. المتصفح ينفذ pairing code محلياً أولاً ثم يرسل
     * السر الناتج هنا ليحفظ مشفراً؛ الـ resource لا يعيده بعد ذلك أبداً.
     */
    public function pairCashDrawer(Request $request, string $id): JsonResponse
    {
        $device = PosDevice::findOrFail($id);
        $data = $request->validate([
            'bridge_url' => ['required', 'string', 'max:120', 'regex:/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):[0-9]{4,5}$/i'],
            'pairing_secret' => ['required', 'string', 'min:32', 'max:256'],
            'printer_identifier' => ['required', 'string', 'min:1', 'max:256'],
            'drawer_channel' => ['required', 'integer', Rule::in([0, 1])],
            'pulse_on_ms' => ['required', 'integer', 'between:2,510'],
            'pulse_off_ms' => ['required', 'integer', 'between:2,510'],
        ]);

        $device->update(['cash_drawer_config' => [
            'bridge_url' => $data['bridge_url'],
            'pairing_secret' => Crypt::encryptString($data['pairing_secret']),
            'printer_identifier' => $data['printer_identifier'],
            'drawer_channel' => $data['drawer_channel'],
            'pulse_on_ms' => $data['pulse_on_ms'],
            'pulse_off_ms' => $data['pulse_off_ms'],
            'paired_at' => now()->toIso8601String(),
            'last_result' => ['status' => 'not_configured', 'error_code' => null, 'at' => now()->toIso8601String()],
        ]]);

        return (new PosDeviceResource($device->fresh('warehouse')))->response();
    }

    /** يبدأ الاختبار من جلسة مفتوحة للجهاز، فلا توجد محاولة مجهولة بلا سياق تدقيق. */
    public function testCashDrawer(Request $request, string $id): JsonResponse
    {
        $device = PosDevice::findOrFail($id);
        $session = PosSession::query()
            ->where('pos_device_id', $device->id)
            ->where('status', 'open')
            ->latest('opened_at')
            ->firstOrFail();
        $result = $this->domain(fn () => $this->cashDrawer->test($session, $request->user()));

        return response()->json(['data' => $result], ($result['status'] ?? null) === 'pending' ? 202 : 409);
    }

    public function completeCashDrawerTest(Request $request, string $id): JsonResponse
    {
        $device = PosDevice::findOrFail($id);
        $data = $request->validate([
            'action_id' => ['required', 'uuid'],
            'result' => ['required', 'array', 'max:12'],
        ]);
        $session = PosSession::query()
            ->where('pos_device_id', $device->id)
            ->where('status', 'open')
            ->latest('opened_at')
            ->firstOrFail();
        $result = $this->domain(fn () => $this->cashDrawer->complete($session, $request->user(), $data['action_id'], $data['result']));

        return response()->json(['data' => $result], $result['status'] === 'opened' ? 200 : 409);
    }

    public function drawerBridgeUnavailable(Request $request, string $id): JsonResponse
    {
        $device = PosDevice::findOrFail($id);
        $data = $request->validate(['action_id' => ['required', 'uuid']]);
        $session = PosSession::query()
            ->where('pos_device_id', $device->id)
            ->where('status', 'open')
            ->latest('opened_at')
            ->firstOrFail();
        $result = $this->domain(fn () => $this->cashDrawer->markBridgeUnavailable($session, $request->user(), $data['action_id']));

        return response()->json(['data' => $result], 409);
    }

    public function destroy(string $id): JsonResponse
    {
        $device = PosDevice::findOrFail($id);
        $this->domain(fn () => $this->devices->delete($device));

        return response()->json(['message' => 'تم حذف جهاز نقطة البيع.']);
    }
}
