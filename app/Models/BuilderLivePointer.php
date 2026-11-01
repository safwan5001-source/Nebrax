<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * مؤشر النسخة الحيّة لقناة جوال (AD-06 / S05c) — صفّ واحد لكل (مستأجر، قناة).
 *
 * يُحرَّك حصراً عبر `BuilderLivePointerService` (قفل + تدقيق)؛ ليس لأي مسار آخر كتابته.
 * `CompanyWide`: يتبع تصنيف `builder_apps` رأسه.
 */
class BuilderLivePointer extends BaseModel implements CompanyWide
{
    protected $fillable = ['tenant_id', 'sales_channel_id', 'builder_app_id', 'live_version_id', 'updated_by'];

    public function app(): BelongsTo
    {
        return $this->belongsTo(BuilderApp::class, 'builder_app_id');
    }

    public function liveVersion(): BelongsTo
    {
        return $this->belongsTo(BuilderPublishedExperienceVersion::class, 'live_version_id');
    }
}
