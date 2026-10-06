<?php

namespace App\Models;

use App\Tenancy\CompanyWide;

/**
 * CUST-HV V2c — وسيطٌ تشير إليه الوثيقة المنشورة لمتجرٍ بعينه (V0 §7.8). لا
 * يُكتب إلا عبر `StorefrontPublishedMediaIndex` (يُعاد بناؤه كاملاً مع كل كتابة
 * لـ`published_config`)؛ ولا يخرج في أي استجابة. مشترك على مستوى المؤسسة كالمتجر.
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: مرتبط بمتجر المؤسسة */
class StorefrontPublishedMedia extends BaseModel implements CompanyWide
{
    protected $table = 'storefront_published_media';

    protected $fillable = ['tenant_id', 'storefront_id', 'media_id'];
}
