<?php

namespace App\Support;

/**
 * عقد فئات البيانات للمساعد الذكي (AWJ Intelligence، AI-01).
 *
 * الحدّ الأدنى العملي: فئتان متاحتان — نصّ رسالة المستخدم نفسه (AI-01)، والملخصات المالية الحتمية
 * (AI-02B) — وفئة **محجوزة** (نصّ مستند، AI-04) لا يمكن تفعيلها مهما خُزِّن في إعدادات المستأجر. لا
 * فئة تُعدّ موافَقاً عليها ضمناً من غيرها. توسيع `AVAILABLE` قرارٌ لمرحلة لاحقة بعد اعتماد الخصوصية
 * والاحتفاظ لكل فئة.
 *
 * هذه الموافقة لا علاقة لها بـ`allow_document_sending` ولا بـ`document_intelligence`.
 */
final class AiAssistantDataCategory
{
    /** نصّ ما يكتبه المستخدم في المحادثة. */
    public const ASSISTANT_MESSAGES = 'assistant_messages';

    /**
     * ملخصات مالية من خدمات التقارير الحتمية (AI-02B). **متاحة كقدرة** لا كموافقة: لا تعمل أداة ماليةٌ
     * إلا بعد موافقة المستأجر الصريحة عليها (الافتراضي رفض)، ونتائجها تُعاد للمستخدم المصادَق فقط ولا
     * تُرسَل لأي مزوّد في هذه المرحلة.
     */
    public const FINANCIAL_SUMMARY = 'financial_summary';

    /** محجوزة: نصّ مستند مُسقَط/مُنقَّح من مركز المستندات (AI-04). */
    public const DOCUMENT_PROJECTED_TEXT = 'document_projected_text';

    /** @var list<string> */
    public const ALL = [
        self::ASSISTANT_MESSAGES,
        self::FINANCIAL_SUMMARY,
        self::DOCUMENT_PROJECTED_TEXT,
    ];

    /** @var list<string> الفئات التي يجوز استعمالها فعلاً (بعد موافقة المستأجر) في هذه المرحلة. */
    public const AVAILABLE = [self::ASSISTANT_MESSAGES, self::FINANCIAL_SUMMARY];

    public static function isKnown(string $category): bool
    {
        return in_array($category, self::ALL, true);
    }

    public static function isAvailable(string $category): bool
    {
        return in_array($category, self::AVAILABLE, true);
    }

    /**
     * يصفّي قيمةً مخزَّنة إلى فئات معروفة ومتاحة وفريدة — أي شيء آخر يسقط.
     *
     * @return list<string>
     */
    public static function sanitize(mixed $stored): array
    {
        if (! is_array($stored)) {
            return [];
        }

        return array_values(array_unique(array_filter(
            $stored,
            static fn ($category): bool => is_string($category) && self::isAvailable($category),
        )));
    }
}
