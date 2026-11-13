<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * TANKER-PR5 — مرفق سند تعبئة صهريج (صورة السند الورقي أو PDF). **دليل فقط: لا أثر مخزني أو محاسبي ولا يغيّر السند نفسه.**
 *
 * - `BranchScoped` كسند التعبئة (سجل تشغيلي يتبع فرع محطته). الكتابة عبر `FuelTankerFillAttachmentService` وحده.
 * - **السجل التاريخي لا يُفقد:** لا حذف أبداً. الانتقال الوحيد `active → removed|replaced` (منفّذ + وقت [+ سبب]) وأعمدة هوية الملف ثابتة — يحرسه مُشغّل قاعدة بيانات أيضاً.
 *   الملف الفعلي يبقى في التخزين الخاص بعد الإزالة (قرار الاحتفاظ/المحو الفعلي للملفات للمالك).
 */
class FuelTankerFillAttachment extends BaseModel
{
    use BranchScoped;

    public const STATUS_ACTIVE = 'active';
    public const STATUS_REMOVED = 'removed';
    public const STATUS_REPLACED = 'replaced';
    public const STATUSES = [self::STATUS_ACTIVE, self::STATUS_REMOVED, self::STATUS_REPLACED];

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_tanker_fill_id', 'disk', 'path', 'original_name', 'mime_type', 'size', 'sha256', 'status',
        'uploaded_by', 'uploaded_at', 'replaces_attachment_id', 'replaced_by_attachment_id', 'removed_by', 'removed_at', 'removal_reason',
    ];

    protected $casts = [
        'size' => 'integer',
        'uploaded_at' => 'datetime',
        'removed_at' => 'datetime',
    ];

    protected $attributes = ['status' => self::STATUS_ACTIVE];

    /** الحقول القابلة للتغيير الوحيدة (مع الطابع الزمني): كل ما عداها ثابت بعد الإنشاء. */
    private const TRANSITION_FIELDS = ['status', 'removed_by', 'removed_at', 'removal_reason', 'replaced_by_attachment_id', 'updated_at'];

    protected static function booted(): void
    {
        static::creating(function (self $attachment): void {
            if ($attachment->status !== self::STATUS_ACTIVE) {
                throw new LogicException('يُنشأ المرفق نشطاً فقط.');
            }
        });
        static::updating(function (self $attachment): void {
            if (array_diff(array_keys($attachment->getDirty()), self::TRANSITION_FIELDS) !== []) {
                throw new LogicException('بيانات المرفق غير قابلة للتعديل؛ الانتقال الوحيد المسموح هو الإزالة أو الاستبدال.');
            }
            if ($attachment->getOriginal('status') !== self::STATUS_ACTIVE) {
                throw new LogicException('المرفق المُزال أو المُستبدَل لا يتغيّر.');
            }
        });
        static::deleting(fn () => throw new LogicException('المرفق لا يُحذف؛ يُزال أو يُستبدل ويبقى سجله التاريخي.'));
    }

    public function isImage(): bool
    {
        return str_starts_with((string) $this->mime_type, 'image/');
    }

    public function tankerFill(): BelongsTo { return $this->belongsTo(FuelTankerFill::class, 'fuel_tanker_fill_id'); }
    public function uploader(): BelongsTo { return $this->belongsTo(User::class, 'uploaded_by'); }
    public function remover(): BelongsTo { return $this->belongsTo(User::class, 'removed_by'); }
}
