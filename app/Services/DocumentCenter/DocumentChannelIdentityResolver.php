<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentChannelIdentity;
use App\Models\User;
use App\Support\DocumentSourceChannel;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;

/** يحل صف الهوية الوحيد من fingerprint آمن قبل ضبط نطاق المستندات التشغيلي. */
final class DocumentChannelIdentityResolver
{
    public function __construct(
        private readonly TenantContext $tenantContext,
        private readonly BranchContext $branchContext,
    ) {}

    public function resolve(DocumentSourceChannel $channel, string $externalIdentity, User $actor): DocumentChannelIdentity
    {
        $normalized = DocumentSourceEnvelope::normalizeIdentity($externalIdentity);

        return $this->resolveFingerprint($channel, DocumentSourceEnvelope::fingerprint($normalized), $actor);
    }

    public function resolveFingerprint(DocumentSourceChannel $channel, string $fingerprint, User $actor): DocumentChannelIdentity
    {
        if (! preg_match('/^[a-f0-9]{64}$/', $fingerprint)) {
            throw new DocumentSourceException(DocumentSourceException::IDENTITY_NOT_FOUND);
        }

        return $this->withoutContext(function () use ($channel, $fingerprint, $actor): DocumentChannelIdentity {
            $identity = DocumentChannelIdentity::query()
                ->where('channel', $channel->value)
                ->where('external_identity_fingerprint', $fingerprint)
                ->first();

            if ($identity === null || ! $actor->is_active || $identity->tenant_id !== $actor->tenant_id) {
                throw new DocumentSourceException(DocumentSourceException::IDENTITY_NOT_FOUND);
            }

            return $identity;
        });
    }

    /** @template T @param callable():T $callback @return T */
    private function withoutContext(callable $callback): mixed
    {
        $tenantId = $this->tenantContext->id();
        $branchId = $this->branchContext->id();
        $this->tenantContext->forget();
        $this->branchContext->forget();

        try {
            return $callback();
        } finally {
            $tenantId === null ? $this->tenantContext->forget() : $this->tenantContext->set($tenantId);
            $branchId === null ? $this->branchContext->forget() : $this->branchContext->set($branchId);
        }
    }
}
