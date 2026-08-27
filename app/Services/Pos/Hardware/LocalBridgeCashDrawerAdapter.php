<?php

namespace App\Services\Pos\Hardware;

use App\Models\PosSession;
use App\Support\PosSettings;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Str;
use Throwable;

/**
 * يجهز أمراً قصير العمر لجسر أجهزة محلي. هذا الـ adapter لا ينفذ I/O إلى USB أو
 * طابعة ولا يثق في المتصفح: الجسر لا يقبل الأمر إلا بعد التحقق من HMAC محلي.
 */
final class LocalBridgeCashDrawerAdapter implements CashDrawerAdapter
{
    public function open(PosSession $session, array $context): array
    {
        $settings = PosSettings::group();
        if (($settings['cash_drawer_enabled'] ?? false) !== true) {
            return ['status' => 'not_configured', 'error_code' => 'cash_drawer_disabled'];
        }
        if (($settings['cash_drawer_driver'] ?? 'unavailable') !== PosSettings::CASH_DRAWER_DRIVER_LOCAL_BRIDGE) {
            return ['status' => 'unsupported', 'error_code' => 'cash_drawer_driver_unavailable'];
        }

        $device = $session->posDevice;
        $config = is_array($device?->cash_drawer_config) ? $device->cash_drawer_config : [];
        $bridgeUrl = $config['bridge_url'] ?? null;
        $encryptedSecret = $config['pairing_secret'] ?? null;
        if (! is_string($bridgeUrl) || ! $this->isLocalBridgeUrl($bridgeUrl) || ! is_string($encryptedSecret) || $encryptedSecret === '') {
            return ['status' => 'not_configured', 'error_code' => 'cash_drawer_bridge_not_paired'];
        }

        try {
            $secret = Crypt::decryptString($encryptedSecret);
        } catch (Throwable) {
            return ['status' => 'not_configured', 'error_code' => 'cash_drawer_pairing_invalid'];
        }
        if ($secret === '') {
            return ['status' => 'not_configured', 'error_code' => 'cash_drawer_pairing_invalid'];
        }

        $actionId = (string) Str::uuid();
        $nonce = bin2hex(random_bytes(16));
        $expiresAt = now()->addSeconds(45)->getTimestamp();
        $signature = hash_hmac('sha256', $this->canonical($actionId, $session->pos_device_id, $expiresAt, $nonce), $secret);

        return [
            'status' => 'pending',
            'error_code' => null,
            'action_id' => $actionId,
            'nonce' => $nonce,
            'expires_at' => $expiresAt,
            'bridge' => [
                'url' => rtrim($bridgeUrl, '/').'/v1/cash-drawer/open',
                'request' => [
                    'version' => 1,
                    'action_id' => $actionId,
                    'device_id' => $session->pos_device_id,
                    'expires_at' => $expiresAt,
                    'nonce' => $nonce,
                    'signature' => $signature,
                ],
            ],
        ];
    }

    public static function canonical(string $actionId, string $deviceId, int $expiresAt, string $nonce): string
    {
        return implode('|', [$actionId, $deviceId, (string) $expiresAt, $nonce]);
    }

    /** يقبل bridge حلقة IPv4/IPv6 فقط؛ لا عنوان LAN أو اسم مضيف خارجي. */
    private function isLocalBridgeUrl(string $url): bool
    {
        $parts = parse_url($url);
        if (! is_array($parts) || ($parts['scheme'] ?? null) !== 'http' || ! isset($parts['host'])) {
            return false;
        }

        return in_array(strtolower($parts['host']), ['127.0.0.1', 'localhost', '::1'], true)
            && isset($parts['port'])
            && is_int($parts['port'])
            && $parts['port'] >= 1024
            && $parts['port'] <= 65535
            && ! isset($parts['user'], $parts['pass'], $parts['query'], $parts['fragment']);
    }
}
