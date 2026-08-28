<?php

namespace App\Services\Accounting;

use App\Support\Settings;
use RuntimeException;

/** قراءة آمنة لجاهزية التوقيع؛ لا تعيد مادة اعتماد أو تفاصيل استثناءات. */
final class ZatcaSigningReadiness
{
    public const CREDENTIAL_UNAVAILABLE = 'credential_unavailable';
    public const SIGNATURE_POLICY_UNAVAILABLE = 'signature_policy_unavailable';

    public function __construct(
        private readonly ZatcaSigningCredentialResolver $credentials,
        private readonly ZatcaSignaturePolicyResolver $policy,
    ) {}

    /**
     * @return array{
     *   ready: bool,
     *   environment: string,
     *   credential_stage: ?string,
     *   blockers: list<string>
     * }
     */
    public function inspect(): array
    {
        $environment = (string) Settings::get('zatca', 'active_environment');
        $stage = null;
        $blockers = [];

        try {
            $stage = $this->credentials->resolve()->stage;
        } catch (RuntimeException) {
            $blockers[] = self::CREDENTIAL_UNAVAILABLE;
        }

        try {
            $this->policy->resolve();
        } catch (RuntimeException) {
            $blockers[] = self::SIGNATURE_POLICY_UNAVAILABLE;
        }

        return [
            'ready' => $blockers === [],
            'environment' => $environment,
            'credential_stage' => $stage,
            'blockers' => $blockers,
        ];
    }
}
