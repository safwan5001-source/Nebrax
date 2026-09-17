<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * STORE-ADMIN-ADOPT-1B-3A — عمودان إضافيان فقط لتحقّق ملكية DNS TXT لنطاق
 * مخصَّص (`StorefrontDomain::TYPE_CUSTOM`).
 *
 * **التسمية**: فُضِّل `verification_token` على `verification_challenge` رغم
 * أن التذكرة تسمح بالاثنين — الاسم الآخر الوحيد المشابه في هذا الجدول هو
 * `verification_status` (موجود مسبقاً)، و«token» يطابق تسمية عائلة
 * `idempotency_key`/`request_checksum` القائمة في المستودع (قيمة تُخزَّن
 * وتُقارَن حرفياً)، ويطابق أيضاً قيمة سجلّ TXT الفعلي في العقد
 * (`awj-domain-verification=<token>`) — لا لبس بين اسم العمود واسم الحقل
 * الذي يحمله في السجلّ الخارجي.
 *
 * **`verified_at`**: طابع زمني فقط — لا يُشتقّ من `updated_at` (الذي يتغيّر
 * لأي حقل آخر) ولا من `verification_status` وحده (يفتقر لِمَتى بالضبط).
 *
 * **التوافق الرجعي (إلزامي)**: كلا العمودين `nullable` بلا `default`. صفوف
 * `awj_subdomain` التاريخية (مُثبَّتة عبر `RegisterStorefrontDomainCommand`
 * أو `StorefrontProvisioningService`، بالفعل `verification_status = verified`)
 * تبقى صالحة بـ`verification_token = null`/`verified_at = null` — لا تُطلَب
 * منها القيمتان أبداً؛ `ResolveStorefrontDomain` لا يفحص أياً منهما (يفحص
 * `isVerified()` وحدها، وهي مبنية على `verification_status` كما كانت).
 *
 * **بلا فهارس جديدة**: لا استعلام في هذه التذكرة يبحث بـ`verification_token`
 * أو يفرزه — القراءة الوحيدة له تمرّ عبر `storefront_id`/`id` المفهرَسين
 * أصلاً. فهرسٌ إضافي هنا مضاربة غير مبرَّرة (التذكرة تمنعها صراحة).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('storefront_domains', function (Blueprint $table) {
            $table->string('verification_token', 64)->nullable()->after('verification_status');
            $table->timestamp('verified_at')->nullable()->after('verification_token');
        });
    }

    public function down(): void
    {
        Schema::table('storefront_domains', function (Blueprint $table) {
            $table->dropColumn(['verification_token', 'verified_at']);
        });
    }
};
