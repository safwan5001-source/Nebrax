<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasManyThrough;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * هوية قالب طباعة في مكتبة المؤسسة.
 *
 * القالب ليس نسخة فرع ولا مستنداً محاسبياً: يشارك جميع الفروع التعريف نفسه،
 * ويقع اختلاف الفروع في `PrintTemplateAssignment`. المراجعة المنشورة لقطة
 * ثابتة، وتربط المستندات لاحقاً بها عند الإصدار كي لا يعيد تعديل قالب تفسير
 * مطبوع تاريخي.
 *
 * @see design-system/foundations/multi-branch-architecture.md
 */
class PrintTemplate extends BaseModel implements CompanyWide
{
    use SoftDeletes;

    protected $fillable = [
        'tenant_id', 'name', 'source', 'status', 'document_types',
        'published_revision_id', 'created_by',
    ];

    protected $casts = [
        'document_types' => 'array',
    ];

    public function revisions(): HasMany
    {
        return $this->hasMany(PrintTemplateRevision::class);
    }

    public function publishedRevision(): BelongsTo
    {
        return $this->belongsTo(PrintTemplateRevision::class, 'published_revision_id');
    }

    /** آخر مسودة فقط؛ لا تعدل مراجعة منشورة مطلقاً. */
    public function draftRevision(): HasOne
    {
        return $this->hasOne(PrintTemplateRevision::class)
            ->where('status', PrintTemplateRevision::STATUS_DRAFT)
            ->latest('version');
    }

    /** تعيينات القالب تمر عبر مراجعاته؛ لا يحمل جدول التعيين معرف القالب مباشرةً. */
    public function assignments(): HasManyThrough
    {
        return $this->hasManyThrough(
            PrintTemplateAssignment::class,
            PrintTemplateRevision::class,
            'print_template_id',
            'print_template_revision_id',
        );
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
