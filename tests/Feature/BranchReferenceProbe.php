<?php

namespace Tests\Feature;

use App\Models\Appointment;
use App\Models\Partner;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * نموذج فحص لعلاقات **حلّ المراجع**: يثبت أن `referenceBelongsTo` يُسقط عزل
 * الفرع مع بقاء استنتاج Eloquent لاسم العلاقة ومفتاحها الأجنبي سليماً.
 * لا يُنشئ صفاً ولا يلمس قاعدة البيانات.
 */
class BranchReferenceProbe extends Appointment
{
    use ResolvesBranchReferences;

    protected $table = 'appointments';

    public function partner(): BelongsTo
    {
        return $this->referenceBelongsTo(Partner::class);
    }
}
