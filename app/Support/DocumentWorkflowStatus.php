<?php

namespace App\Support;

enum DocumentWorkflowStatus: string
{
    case DRAFT = 'draft';
    case RECEIVING = 'receiving';
    case RECEIVED = 'received';
    case QUEUED = 'queued';
    case PROCESSING = 'processing';
    case NEEDS_REVIEW = 'needs_review';
    case READY_FOR_DRAFT = 'ready_for_draft';
    case CREATING_DRAFT = 'creating_draft';
    case DRAFT_CREATED = 'draft_created';
    case ARCHIVED = 'archived';
    case FAILED = 'failed';
    case QUARANTINED = 'quarantined';
    case DUPLICATE = 'duplicate';
    case CANCELLED = 'cancelled';
}
