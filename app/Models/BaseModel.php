<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;
use App\Tenancy\BranchScope;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

abstract class BaseModel extends Model
{
    use HasUuids;
    use BelongsToTenant;

    public $incrementing = false;
    protected $keyType = 'string';

    /**
     * علاقة إلى مرجع مُخزَّن في سجل تاريخي أو مستند.
     *
     * يبقى TenantScope مفعلاً دائماً، لذلك لا يمكن أن يحلّ المرجع من مستأجر آخر.
     * نستثني BranchScope وحده حتى لا يختفي مرجع صحيح عند تغيير الفرع النشط بعد
     * إنشاء السجل؛ هذه العلاقة لا تُستخدم لتوسيع قوائم التصفح التشغيلي.
     *
     * @param  class-string<Model>  $related
     */
    public function referenceBelongsTo(string $related, ?string $foreignKey = null, ?string $ownerKey = null, ?string $relation = null): BelongsTo
    {
        return $this->belongsTo($related, $foreignKey, $ownerKey, $relation)
            ->withoutGlobalScope(BranchScope::class);
    }
}
