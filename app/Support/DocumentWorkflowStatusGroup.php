<?php

namespace App\Support;

/** مجموعات حالة سير عمل مركز المستندات — مرآة `statusesForGroup` في الواجهة. */
final class DocumentWorkflowStatusGroup
{
    /** @var list<string> */
    private const INBOX = ['draft', 'receiving', 'received', 'queued', 'processing'];

    /** @var list<string> */
    private const TERMINAL = ['failed', 'quarantined', 'duplicate', 'cancelled'];

    /** @return list<string> */
    public static function statusesFor(string $group): array
    {
        return match ($group) {
            'inbox' => self::INBOX,
            'review' => ['needs_review'],
            'ready' => ['ready_for_draft', 'creating_draft'],
            'completed' => ['reviewed', 'draft_created', 'archived'],
            'terminal' => self::TERMINAL,
            default => [],
        };
    }

    public static function isValid(string $group): bool
    {
        return self::statusesFor($group) !== [];
    }
}
