<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * مدخل سلسلة ZATCA المشتركة: مستند إلكتروني صدر (فاتورة 388 أو إشعار دائن 381) — REM-18b-1 (مخطط فقط).
 *
 * غير قابل للتعديل ولا الحذف: حارس النموذج رسالة مبكرة، والحارس الحقيقي مُشغّلات القاعدة (T1–T3) التي تصمد أمام
 * `DB::table()` وSQL الخام. لا يقرأ هذا النموذج ولا يكتبه أي مسار قائم بعد (المخصِّص في REM-18b-2).
 */
class ZatcaChainEntry extends BaseModel implements CompanyWide
{
    public const UPDATED_AT = null;

    protected $fillable = [
        'chain_id', 'icv', 'document_type', 'invoice_id', 'credit_note_id', 'type_code', 'subtype',
        'zatca_uuid', 'previous_hash', 'hash', 'signed', 'issued_at',
    ];

    protected function casts(): array
    {
        return [
            'icv' => 'integer',
            'signed' => 'boolean',
            'issued_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('مدخل سلسلة ZATCA الصادر لا يتغيّر.'));
        static::deleting(fn () => throw new LogicException('مدخل سلسلة ZATCA الصادر لا يُحذف.'));
    }

    public function chain(): BelongsTo
    {
        return $this->belongsTo(ZatcaChain::class, 'chain_id');
    }
}
