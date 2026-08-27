<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentChannelIdentity;
use App\Models\Tenant;
use App\Models\User;
use App\Services\ApplicationAccessDecision;
use App\Support\ApplicationAccessLevel;
use App\Support\ApplicationOperationClass;

/** يفصل حارس المستخدم/التجاري عن حل الهوية وعن مسار الملف. */
final class DocumentSourceAccessGate
{
    public function __construct(private readonly ApplicationAccessDecision $access) {}

    public function assertCanReceive(User $actor, DocumentChannelIdentity $identity): void
    {
        if (! $actor->is_active || $actor->tenant_id !== $identity->tenant_id) {
            throw new DocumentSourceException(DocumentSourceException::IDENTITY_NOT_FOUND);
        }
        if (! $actor->hasPermission('documents.center.manage') || ! $actor->canAccessBranch($identity->branch_id)) {
            throw new DocumentSourceException(DocumentSourceException::ACCESS_DENIED);
        }

        $this->assertCommercialAccess($actor, 'documents.center.manage');
    }

    public function assertCanManageIdentity(User $actor): void
    {
        if (! $actor->is_active || ! $actor->hasPermission('documents.center.settings')) {
            throw new DocumentSourceException(DocumentSourceException::ACCESS_DENIED);
        }

        $this->assertCommercialAccess($actor, 'documents.center.settings');
    }

    private function assertCommercialAccess(User $actor, string $permission): void
    {
        $tenant = Tenant::query()->findOrFail($actor->tenant_id);
        $decision = $this->access->decide(
            $tenant,
            'document_center.core',
            ApplicationOperationClass::WRITE,
            $actor->hasPermission($permission),
        );
        if ($decision->level === ApplicationAccessLevel::DENIED) {
            throw new DocumentSourceException(DocumentSourceException::ACCESS_DENIED);
        }
    }
}
