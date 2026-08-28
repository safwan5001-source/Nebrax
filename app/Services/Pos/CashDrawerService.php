<?php

namespace App\Services\Pos;

use App\Models\Invoice;
use App\Models\PosDevice;
use App\Models\PosSession;
use App\Models\PosSessionEvent;
use App\Models\User;
use App\Services\Pos\Hardware\CashDrawerAdapter;
use App\Services\Pos\Hardware\LocalBridgeCashDrawerAdapter;
use App\Services\Pos\Hardware\UnavailableCashDrawerAdapter;
use App\Support\PosSettings;
use App\Services\Pos\PosAuditService;
use App\Tenancy\BranchContext;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use RuntimeException;
use Throwable;

/**
 * بوابة الأجهزة المعزولة عن البيع. الخادم لا يصل USB/Printer ولا يثق بنجاح المتصفح:
 * يهيئ أمراً قصير العمر، ثم يثبت HMAC الناتج من Local Bridge قبل قول "opened".
 */
final class CashDrawerService
{
    private const ACTION_TTL_SECONDS = 60;

    public function __construct(
        private readonly ?CashDrawerAdapter $overrideAdapter = null,
        private readonly ?PosAuditService $auditTrail = null,
    ) {}

    /** @return array<string, mixed> */
    public function openManually(PosSession $session, User $actor, ?string $reason = null): array
    {
        if (! $actor->hasPermission('pos.cash_drawer.open')) {
            throw new RuntimeException('لا تملك صلاحية فتح درج نقطة البيع.');
        }

        return $this->prepare($session, $actor, 'manual', null, $reason);
    }

    /** لا يفشل البيع؛ يعيد الأمر للجلسة الواجهة بعد commit فقط. */
    public function openAfterCashPayment(PosSession $session, ?User $actor, Invoice $invoice): array
    {
        return $this->prepare($session, $actor, 'automatic', $invoice, null);
    }

    /** اختبار الجهاز لا يعمل بلا وردية مفتوحة لذلك الجهاز، ولا يتجاوز صلاحية الدرج. */
    public function test(PosSession $session, User $actor): array
    {
        if (! $actor->hasPermission('pos.cash_drawer.open')) {
            throw new RuntimeException('لا تملك صلاحية اختبار درج نقطة البيع.');
        }

        return $this->prepare($session, $actor, 'test', null, null);
    }

    /**
     * يقبل فقط نتيجة موقعة من bridge للأمر الموجود مرة واحدة. أي استجابة بلا HMAC
     * أو من جهاز/جلسة/مستخدم آخر تتحول إلى فشل ولا تبلغ "opened".
     *
     * @param array<string, mixed> $bridgeResult
     * @return array{status:string,error_code:?string,device?:string}
     */
    public function complete(PosSession $session, ?User $actor, string $actionId, array $bridgeResult): array
    {
        $action = $this->takeAction($session, $actor, $actionId);
        $config = is_array($session->posDevice?->cash_drawer_config) ? $session->posDevice->cash_drawer_config : [];
        $secret = $this->pairingSecret($config);
        if ($secret === null) {
            return $this->recordResult($session, $actor, $action, ['status' => 'not_configured', 'error_code' => 'cash_drawer_pairing_invalid']);
        }

        $status = $bridgeResult['status'] ?? null;
        $errorCode = $bridgeResult['error_code'] ?? null;
        $requestId = $bridgeResult['request_id'] ?? null;
        $receipt = $bridgeResult['receipt'] ?? null;
        $device = $bridgeResult['device'] ?? null;
        if (! is_string($status) || ! in_array($status, self::finalStatuses(), true)
            || ! is_null($errorCode) && ! is_string($errorCode)
            || ! is_string($requestId) || $requestId === ''
            || ! is_string($receipt) || ! is_string($device) || $device === '') {
            return $this->recordResult($session, $actor, $action, ['status' => 'failed', 'error_code' => 'cash_drawer_bridge_invalid_response']);
        }

        $canonical = implode('|', [$actionId, $session->pos_device_id, $status, $errorCode ?? '', $requestId]);
        $expected = hash_hmac('sha256', $canonical, $secret);
        if (! hash_equals($expected, $receipt)) {
            return $this->recordResult($session, $actor, $action, ['status' => 'permission_denied', 'error_code' => 'cash_drawer_bridge_receipt_invalid']);
        }

        return $this->recordResult($session, $actor, $action, [
            'status' => $status,
            'error_code' => $errorCode,
            'device' => $device,
        ]);
    }

    /** يسجل تعذر الاتصال محلياً، لكن لا يستطيع العميل صناعة نجاح وهمي. */
    public function markBridgeUnavailable(PosSession $session, ?User $actor, string $actionId): array
    {
        $action = $this->takeAction($session, $actor, $actionId);

        return $this->recordResult($session, $actor, $action, [
            'status' => 'bridge_unavailable',
            'error_code' => 'cash_drawer_bridge_unreachable',
        ]);
    }

    /** @return array<string, mixed> */
    private function prepare(PosSession $session, ?User $actor, string $mode, ?Invoice $invoice, ?string $reason): array
    {
        $branchId = app(BranchContext::class)->id();
        if (! $session->isOpen() || $session->branch_id !== $branchId) {
            throw new RuntimeException('جلسة نقطة البيع ليست مفتوحة في الفرع النشط.');
        }
        if ($actor && (! $actor->canAccessBranch($branchId)
            || ($session->warehouse_id !== null && ! $actor->canAccessWarehouse($session->warehouse_id)))) {
            throw new RuntimeException('جلسة نقطة البيع أو مخزنها خارج نطاق صلاحياتك.');
        }

        try {
            $result = $this->adapter()->open($session->loadMissing('posDevice'), [
                'mode' => $mode,
                'invoice_id' => $invoice?->id,
                'reason' => $reason,
            ]);
        } catch (Throwable) {
            $result = ['status' => 'failed', 'error_code' => 'cash_drawer_adapter_error'];
        }

        if (($result['status'] ?? null) !== 'pending') {
            $this->audit($session, $actor, $mode, $invoice, $reason, $result);

            return $result;
        }

        $actionId = $result['action_id'] ?? null;
        if (! is_string($actionId) || $actionId === '') {
            $result = ['status' => 'failed', 'error_code' => 'cash_drawer_action_invalid'];
            $this->audit($session, $actor, $mode, $invoice, $reason, $result);

            return $result;
        }

        Cache::put($this->cacheKey($actionId), [
            'session_id' => $session->id,
            'device_id' => $session->pos_device_id,
            'actor_id' => $actor?->id,
            'mode' => $mode,
            'invoice_id' => $invoice?->id,
            'reason' => $reason,
        ], now()->addSeconds(self::ACTION_TTL_SECONDS));
        $this->audit($session, $actor, $mode, $invoice, $reason, ['status' => 'pending', 'error_code' => null]);

        return $result;
    }

    /** @return array<string, mixed> */
    private function takeAction(PosSession $session, ?User $actor, string $actionId): array
    {
        $action = Cache::pull($this->cacheKey($actionId));
        if (! is_array($action)
            || ($action['session_id'] ?? null) !== $session->id
            || ($action['device_id'] ?? null) !== $session->pos_device_id
            || ($action['actor_id'] ?? null) !== $actor?->id) {
            throw new RuntimeException('أمر درج النقدية غير صالح أو انتهت صلاحيته.');
        }

        return $action;
    }

    /** @param array<string, mixed> $result @return array{status:string,error_code:?string,device?:string} */
    private function recordResult(PosSession $session, ?User $actor, array $action, array $result): array
    {
        $normalized = [
            'status' => $result['status'],
            'error_code' => $result['error_code'] ?? null,
        ];
        if (isset($result['device']) && is_string($result['device'])) {
            $normalized['device'] = $result['device'];
        }

        $this->audit($session, $actor, (string) $action['mode'], null, $action['reason'] ?? null, $normalized, $action['invoice_id'] ?? null);
        $this->updateDeviceHealth($session->posDevice, $normalized);

        return $normalized;
    }

    /** @param array<string, mixed> $result */
    private function audit(PosSession $session, ?User $actor, string $mode, ?Invoice $invoice, ?string $reason, array $result, ?string $invoiceId = null): void
    {
        ($this->auditTrail ?? app(PosAuditService::class))->auditEventForExistingOperation($session, PosSessionEvent::TYPE_CASH_DRAWER_OPEN_ATTEMPT, $actor, [
            'correlation_id' => $invoice?->id ?? $invoiceId,
            'mode' => $mode,
            'pos_device_id' => $session->pos_device_id,
            'shift_id' => $session->shift_id,
            'invoice_id' => $invoice?->id ?? $invoiceId,
            'reason_note' => $reason,
            'status' => $result['status'] ?? 'failed',
            'error_code' => $result['error_code'] ?? null,
        ]);
    }

    /** @param array<string, mixed> $result */
    private function updateDeviceHealth(?PosDevice $device, array $result): void
    {
        if (! $device) {
            return;
        }
        $config = is_array($device->cash_drawer_config) ? $device->cash_drawer_config : [];
        $config['last_result'] = [
            'status' => $result['status'] ?? 'failed',
            'error_code' => $result['error_code'] ?? null,
            'at' => now()->toIso8601String(),
        ];
        if (($result['status'] ?? null) === 'opened') {
            $config['last_success_at'] = now()->toIso8601String();
        }
        $device->update(['cash_drawer_config' => $config]);
    }

    private function adapter(): CashDrawerAdapter
    {
        if ($this->overrideAdapter) {
            return $this->overrideAdapter;
        }

        return PosSettings::group()['cash_drawer_driver'] === PosSettings::CASH_DRAWER_DRIVER_LOCAL_BRIDGE
            ? new LocalBridgeCashDrawerAdapter()
            : new UnavailableCashDrawerAdapter();
    }

    /** @param array<string, mixed> $config */
    private function pairingSecret(array $config): ?string
    {
        $encrypted = $config['pairing_secret'] ?? null;
        if (! is_string($encrypted) || $encrypted === '') {
            return null;
        }
        try {
            $secret = Crypt::decryptString($encrypted);

            return $secret !== '' ? $secret : null;
        } catch (Throwable) {
            return null;
        }
    }

    /** @return list<string> */
    private static function finalStatuses(): array
    {
        return ['opened', 'unsupported', 'not_configured', 'printer_unavailable', 'permission_denied', 'failed'];
    }

    private function cacheKey(string $actionId): string
    {
        return 'pos:cash-drawer:'.$actionId;
    }
}
