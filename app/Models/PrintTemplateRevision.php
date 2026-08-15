<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * مراجعة مرقمة لتعريف قالب طباعة.
 *
 * المسودة وحدها قابلة للتحرير. حين تُنشر تصبح المرجع الذي يثبت على المستند
 * وقت الإصدار؛ لذلك يمنع النموذج تغيير حقول تعريفها أو حذفها، وتبقى النسخ
 * القديمة قابلة لإعادة طباعة مستند تاريخي كما صدر.
 */
class PrintTemplateRevision extends BaseModel implements CompanyWide
{
    public const STATUS_DRAFT = 'draft';
    public const STATUS_PUBLISHED = 'published';
    public const STATUS_SUPERSEDED = 'superseded';

    protected $fillable = [
        'tenant_id', 'print_template_id', 'version', 'status', 'schema_version',
        'document_types', 'definition', 'checksum', 'created_by', 'published_at',
    ];

    protected $casts = [
        'document_types' => 'array',
        'definition'     => 'array',
        'version'        => 'integer',
        'schema_version' => 'integer',
        'published_at'   => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(function (self $revision): void {
            if ($revision->getOriginal('status') !== self::STATUS_PUBLISHED) {
                return;
            }

            $guarded = ['document_types', 'definition', 'checksum', 'schema_version', 'version'];
            if ($revision->isDirty($guarded)) {
                throw new \RuntimeException('لا يمكن تعديل تعريف مراجعة قالب منشورة. أنشئ مسودة جديدة أولاً.');
            }
        });

        static::deleting(function (self $revision): void {
            if ($revision->status === self::STATUS_PUBLISHED) {
                throw new \RuntimeException('لا يمكن حذف مراجعة قالب منشورة.');
            }
        });
    }

    public function template(): BelongsTo
    {
        return $this->belongsTo(PrintTemplate::class, 'print_template_id');
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(PrintTemplateAssignment::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function isDraft(): bool
    {
        return $this->status === self::STATUS_DRAFT;
    }

    public function isPublished(): bool
    {
        return $this->status === self::STATUS_PUBLISHED;
    }
}
