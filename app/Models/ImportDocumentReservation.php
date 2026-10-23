<?php

namespace App\Models;

use App\Tenancy\CompanyWide;

/**
 * حجز هوية مستند مستورد (IMP-H5-S1a). مشترك على مستوى المؤسسة (`CompanyWide`): التكرار لا يعرف الفروع، فمستندٌ في فرعٍ يحجز مفتاحه للمؤسسة كلها.
 * يكتبه `DocumentDuplicateReservationService` وحده (في معاملة المستند)؛ لا يعدّله أحد بعد الإدراج إلا بإعادة الاشتقاق (حذف وإدراج).
 */
class ImportDocumentReservation extends BaseModel implements CompanyWide
{
    protected $fillable = ['tenant_id', 'domain', 'dedupe_key', 'counterparty_id', 'document_type', 'document_id', 'source', 'predicate'];

    protected $casts = ['predicate' => 'array'];
}
