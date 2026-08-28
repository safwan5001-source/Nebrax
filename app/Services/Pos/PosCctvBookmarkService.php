<?php

namespace App\Services\Pos;

use App\Models\PosCaseActivity;
use App\Models\PosCctvBookmark;
use App\Models\PosInvestigationCase;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * مرجع كاميرا (بيانات وصفية فقط — لا فيديو). كل إضافة/تعديل/حذف يكتب نشاط قضية مقابلاً
 * append-only، والحذف Soft لا صلب.
 */
final class PosCctvBookmarkService
{
    public function create(User $actor, PosInvestigationCase $case, array $data): PosCctvBookmark
    {
        return DB::transaction(function () use ($actor, $case, $data) {
            $bookmark = PosCctvBookmark::create([
                'branch_id' => $case->branch_id,
                'case_id' => $case->id,
                'pos_session_id' => $data['pos_session_id'] ?? $case->pos_session_id,
                'cart_id' => $data['cart_id'] ?? $case->cart_id,
                'correlation_id' => $data['correlation_id'] ?? null,
                'camera_label' => $data['camera_label'],
                'timestamp_start' => Carbon::parse($data['timestamp_start']),
                'timestamp_end' => isset($data['timestamp_end']) ? Carbon::parse($data['timestamp_end']) : null,
                'source_timezone' => $data['source_timezone'] ?? 'UTC',
                'external_reference' => $data['external_reference'] ?? null,
                'note' => $data['note'] ?? null,
                'created_by' => $actor->id,
            ]);

            PosCaseActivity::create([
                'branch_id' => $case->branch_id, 'case_id' => $case->id,
                'action' => PosCaseActivity::ACTION_CCTV_BOOKMARK_ADDED, 'actor_id' => $actor->id,
                'meta' => ['bookmark_id' => $bookmark->id, 'camera_label' => $bookmark->camera_label],
                'created_at' => Carbon::now(),
            ]);
            PosInvestigationCase::query()->whereKey($case->id)->update(['last_activity_at' => Carbon::now()]);

            return $bookmark;
        });
    }

    public function update(User $actor, PosInvestigationCase $case, PosCctvBookmark $bookmark, array $data): PosCctvBookmark
    {
        return DB::transaction(function () use ($actor, $case, $bookmark, $data) {
            $bookmark->fill([
                'camera_label' => $data['camera_label'] ?? $bookmark->camera_label,
                'timestamp_start' => isset($data['timestamp_start']) ? Carbon::parse($data['timestamp_start']) : $bookmark->timestamp_start,
                'timestamp_end' => array_key_exists('timestamp_end', $data)
                    ? ($data['timestamp_end'] !== null ? Carbon::parse($data['timestamp_end']) : null)
                    : $bookmark->timestamp_end,
                'source_timezone' => $data['source_timezone'] ?? $bookmark->source_timezone,
                'external_reference' => array_key_exists('external_reference', $data) ? $data['external_reference'] : $bookmark->external_reference,
                'note' => array_key_exists('note', $data) ? $data['note'] : $bookmark->note,
            ])->save();

            PosCaseActivity::create([
                'branch_id' => $case->branch_id, 'case_id' => $case->id,
                'action' => PosCaseActivity::ACTION_CCTV_BOOKMARK_UPDATED, 'actor_id' => $actor->id,
                'meta' => ['bookmark_id' => $bookmark->id],
                'created_at' => Carbon::now(),
            ]);
            PosInvestigationCase::query()->whereKey($case->id)->update(['last_activity_at' => Carbon::now()]);

            return $bookmark->fresh();
        });
    }

    public function delete(User $actor, PosInvestigationCase $case, PosCctvBookmark $bookmark): void
    {
        DB::transaction(function () use ($actor, $case, $bookmark) {
            $bookmark->delete();

            PosCaseActivity::create([
                'branch_id' => $case->branch_id, 'case_id' => $case->id,
                'action' => PosCaseActivity::ACTION_CCTV_BOOKMARK_REMOVED, 'actor_id' => $actor->id,
                'meta' => ['bookmark_id' => $bookmark->id, 'camera_label' => $bookmark->camera_label],
                'created_at' => Carbon::now(),
            ]);
            PosInvestigationCase::query()->whereKey($case->id)->update(['last_activity_at' => Carbon::now()]);
        });
    }
}
