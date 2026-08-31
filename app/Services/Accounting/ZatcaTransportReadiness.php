<?php

namespace App\Services\Accounting;

use Illuminate\Contracts\Encryption\DecryptException;
use RuntimeException;

/** فحص آمن لتشغيل النقل؛ لا يجري اتصالاً ولا يعيد بيانات اعتماد. */
final class ZatcaTransportReadiness
{
    public const DISPATCH_DISABLED = 'dispatch_disabled';
    public const UNSAFE_QUEUE_CONNECTION = 'unsafe_queue_connection';
    public const CREDENTIAL_UNAVAILABLE = 'transport_credential_unavailable';
    public const ENDPOINT_UNAVAILABLE = 'submission_endpoint_unavailable';

    public function __construct(
        private readonly ZatcaTransportCredentialResolver $credentials,
        private readonly ZatcaSubmissionEndpointResolver $endpoints,
    ) {}

    /** @return array{ready:bool,enabled:bool,environment:string,queue_connection:string,blockers:list<string>} */
    public function inspect(): array
    {
        $enabled = config('zatca.transport.dispatch_enabled') === true;
        $connection = $this->queueConnection();
        $environment = '';
        $blockers = [];

        if (! $enabled) {
            $blockers[] = self::DISPATCH_DISABLED;
        }
        if ($connection === '' || in_array($connection, ['sync', 'null'], true)) {
            $blockers[] = self::UNSAFE_QUEUE_CONNECTION;
        }

        try {
            $material = $this->credentials->resolve();
            $environment = $material->environment;
        } catch (DecryptException | RuntimeException) {
            $material = null;
            $blockers[] = self::CREDENTIAL_UNAVAILABLE;
        }

        if ($material !== null) {
            try {
                $this->endpoints->resolve($material->environment, 'reporting');
                $this->endpoints->resolve($material->environment, 'clearance');
            } catch (RuntimeException) {
                $blockers[] = self::ENDPOINT_UNAVAILABLE;
            }
        }

        return [
            'ready' => $blockers === [],
            'enabled' => $enabled,
            'environment' => $environment,
            'queue_connection' => $connection,
            'blockers' => array_values(array_unique($blockers)),
        ];
    }

    public function queueConnection(): string
    {
        $configured = config('zatca.transport.queue_connection');

        return is_string($configured) && trim($configured) !== ''
            ? trim($configured)
            : trim((string) config('queue.default'));
    }
}
