<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentChannelIdentity;
use App\Models\DocumentSourceAuditEvent;
use App\Models\User;
use App\Support\DocumentSourceChannel;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

final class DocumentChannelIdentityService
{
    public function __construct(
        private readonly DocumentSourceAccessGate $access,
        private readonly DocumentSourceAuditLogger $audit,
        private readonly TenantContext $tenantContext,
        private readonly BranchContext $branchContext,
    ) {}

    /** @param array<string, mixed> $metadata */
    public function create(
        User $actor,
        DocumentSourceChannel $channel,
        string $displayName,
        string $externalIdentity,
        array $metadata = [],
    ): DocumentChannelIdentity {
        $this->access->assertCanManageIdentity($actor);
        $this->assertActorScope($actor);
        if (! $channel->isInternallySupported()) {
            throw new DocumentSourceException(DocumentSourceException::NOT_SUPPORTED);
        }

        $displayName = trim($displayName);
        if ($displayName === '' || mb_strlen($displayName) > 160) {
            throw new DocumentSourceException(DocumentSourceException::INTAKE_REJECTED);
        }
        $normalized = DocumentSourceEnvelope::normalizeIdentity($externalIdentity);

        return DB::transaction(function () use ($actor, $channel, $displayName, $normalized, $metadata): DocumentChannelIdentity {
            $identity = DocumentChannelIdentity::create([
                'channel' => $channel,
                'display_name' => $displayName,
                'external_identity_fingerprint' => DocumentSourceEnvelope::fingerprint($normalized),
                'external_identity_masked' => DocumentSourceEnvelope::mask($normalized),
                'metadata' => DocumentSourceEnvelope::sanitizeMetadata($metadata) ?: null,
                'created_by' => $actor->id,
            ]);
            $this->audit->record(
                DocumentSourceAuditEvent::IDENTITY_CREATED,
                $identity,
                actor: $actor,
                metadata: ['channel' => $channel->value, 'identity_label' => $identity->external_identity_masked],
            );

            return $identity;
        }, 3);
    }

    public function disable(DocumentChannelIdentity $identity, User $actor): DocumentChannelIdentity
    {
        return $this->setEnabled($identity, $actor, false);
    }

    public function enable(DocumentChannelIdentity $identity, User $actor): DocumentChannelIdentity
    {
        return $this->setEnabled($identity, $actor, true);
    }

    private function setEnabled(DocumentChannelIdentity $identity, User $actor, bool $enabled): DocumentChannelIdentity
    {
        $this->access->assertCanManageIdentity($actor);
        if ($actor->tenant_id !== $identity->tenant_id || ! $actor->canAccessBranch($identity->branch_id)) {
            throw new DocumentSourceException(DocumentSourceException::IDENTITY_NOT_FOUND);
        }
        $this->assertActorScope($actor, $identity->branch_id);

        return DB::transaction(function () use ($identity, $actor, $enabled): DocumentChannelIdentity {
            $locked = DocumentChannelIdentity::query()->lockForUpdate()->findOrFail($identity->id);
            $locked->forceFill([
                'status' => $enabled ? DocumentChannelIdentity::STATUS_ACTIVE : DocumentChannelIdentity::STATUS_DISABLED,
                'disabled_by' => $enabled ? null : $actor->id,
                'disabled_at' => $enabled ? null : now('UTC'),
            ])->save();
            $locked = $locked->fresh();
            $this->audit->record(
                $enabled ? DocumentSourceAuditEvent::IDENTITY_ENABLED : DocumentSourceAuditEvent::IDENTITY_DISABLED,
                $locked,
                actor: $actor,
                metadata: ['channel' => $locked->channel->value, 'identity_label' => $locked->external_identity_masked],
            );

            return $locked;
        }, 3);
    }

    private function assertActorScope(User $actor, ?string $requiredBranch = null): void
    {
        if ($this->tenantContext->id() !== $actor->tenant_id
            || ! $this->branchContext->has()
            || ! $actor->canAccessBranch($this->branchContext->id())
            || ($requiredBranch !== null && $this->branchContext->id() !== $requiredBranch)) {
            throw new DocumentSourceException(DocumentSourceException::ACCESS_DENIED);
        }
    }
}
