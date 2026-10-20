<?php

namespace App\Support;

use InvalidArgumentException;

/**
 * أسباب إصدار الإشعار الدائن/المدين المعتمدة في قاموس بيانات ZATCA — REM-18a.
 *
 * **المصدر الرسمي:** قاموس البيانات (Data Dictionary)، الحقل KSA-10 «Reasons for issuance of credit / debit note»،
 * §13.2: «as per Article 40 (paragraph 1) and Article 54 (3) of KSA VAT regulations, a Credit and Debit Note is issued
 * for these 5 instances» — خمس حالات بنصّين إنجليزي/عربي. التطابق مع اللائحة التنفيذية (المادتان 40(1) و54) موثَّق في
 * سجل الأدلة (صفّا 49 و55). نصّا السببين «ترجيع السلع أو الخدمات» و«تعديل قيمة التوريد المتفق عليها مسبقاً» مطابقان
 * حرفياً لما في عيّنات SDK الرسمية (بصيغة `EN | AR`).
 *
 * **ما هو محسوم وما ليس كذلك (يُسجَّل ولا يُفترض):**
 *  • محسوم: القائمة خمسة بنود، والحقل نصّي 1–1000 حرف، ومطلوب للإشعارات (BR-KSA-17: غيابه خطأ في SDK).
 *  • غير محسوم: هل تقصر المنصة الحيّة القيم على هذه الخمسة؟ SDK يقبل أي نصّ غير فارغ، والقاموس يصف الخمسة «حالات»
 *    لا قائمة مغلقة. لذلك **اعتماد AWJ لها إلزامية قرارٌ داخلي** (محافظ: لا ينتج AWJ سبباً خارجها) لا قاعدة ZATCA مثبتة.
 *  • غير محسوم: الصيغة الحرفية للفاصل (`EN | AR` في عيّنات الاعتماد، وبلا مسافات في عيّنة مبسّطة واحدة) والنقطة الختامية
 *    في بند الترجيع (قاموس: بنقطة، عيّنة: بلا نقطة). نعتمد صيغة عيّنات الاعتماد؛ SDK لا يفحص النص.
 *  • خارج النطاق: أكثر من سبب في إشعار واحد (KSA-10 يسمح بـ0..*؛ العيّنات سبب واحد) وربط السبب تلقائياً من نوع العملية —
 *    يختار المستخدم، ولا يُستنتج من مرتجع أو خصم.
 *
 * الرموز (`code`) من وضع AWJ (ثابتة، لا رموز ZATCA)، وتصلح لتخزين لاحق (REM-18b) دون تغيير النص.
 */
final class ZatcaNoteReason
{
    /** الفاصل بين النصّين كما في عيّنات الاعتماد. */
    public const SEPARATOR = ' | ';

    /** @var array<string, array{en: string, ar: string}> */
    private const REASONS = [
        'supply_cancelled_or_suspended' => [
            'en' => 'Cancellation or suspension of the supplies after its occurrence either wholly or partially',
            'ar' => 'تم إلغاء أو وقف التوريد بعد حدوثه أو اعتباره كلياً أو جزئياً',
        ],
        'supply_materially_changed' => [
            'en' => 'In case of essential change or amendment in the supply, which leads to the change of the VAT due',
            'ar' => 'وجود تغيير أو تعديل جوهري في طبيعة التوريد بحيث يؤدي الى تغيير الضريبة المستحقة',
        ],
        'supply_value_amended_by_agreement' => [
            'en' => 'Amendment of the supply value which is pre-agreed upon between the supplier and consumer',
            'ar' => 'تم الاتفاق على تعديل قيمة التوريد مسبقاً',
        ],
        'goods_or_services_refund' => [
            'en' => 'In case of goods or services refund',
            'ar' => 'عند ترجيع السلع أو الخدمات',
        ],
        'party_details_changed' => [
            'en' => 'In case of change in Seller\'s or Buyer\'s information',
            'ar' => 'عند التعديل على بيانات المورد أو المشتري',
        ],
    ];

    /** @return list<string> */
    public static function codes(): array
    {
        return array_keys(self::REASONS);
    }

    public static function isKnown(mixed $code): bool
    {
        return is_string($code) && isset(self::REASONS[$code]);
    }

    /** نصّ `cac:PaymentMeans/cbc:InstructionNote` للسبب (EN | AR). رمز مجهول ⇒ رفض، لا تخمين ولا نصّ حرّ. */
    public static function instructionNote(mixed $code): string
    {
        if (! self::isKnown($code)) {
            throw new InvalidArgumentException('سبب إصدار الإشعار غير معتمد؛ يجب أن يكون أحد أسباب قاموس بيانات ZATCA الخمسة (KSA-10).');
        }

        return self::REASONS[$code]['en'].self::SEPARATOR.self::REASONS[$code]['ar'];
    }
}
