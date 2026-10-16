<?php

namespace App\Support;

/**
 * عقد فئات البيانات للمساعد الذكي (AWJ Intelligence، AI-01).
 *
 * الحدّ الأدنى العملي: فئةٌ واحدة متاحة اليوم — نصّ رسالة المستخدم نفسه — وفئتان
 * **محجوزتان** تُعلَنان كي لا تُستنتَج موافقتهما من غيرهما، ولا يمكن تفعيلهما
 * في هذه المرحلة مهما خُزِّن في إعدادات المستأجر: لا بيانات مالية ولا نصوص
 * مستندات تُرسَل في AI-01. توسيع `AVAILABLE` قرارٌ لمرحلة لاحقة بعد اعتماد
 * الخصوصية والاحتفاظ لكل فئة.
 *
 * هذه الموافقة لا علاقة لها بـ`allow_document_sending` ولا بـ`document_intelligence`.
 */
final class AiAssistantDataCategory
{
    /** نصّ ما يكتبه المستخدم في المحادثة. */
    public const ASSISTANT_MESSAGES = 'assistant_messages';

    /** محجوزة: ملخصات مالية من خدمات التقارير الحتمية (AI-02). */
    public const FINANCIAL_SUMMARY = 'financial_summary';

    /** محجوزة: نصّ مستند مُسقَط/مُنقَّح من مركز المستندات (AI-04). */
    public const DOCUMENT_PROJECTED_TEXT = 'document_projected_text';

    /** @var list<string> */
    public const ALL = [
        self::ASSISTANT_MESSAGES,
        self::FINANCIAL_SUMMARY,
        self::DOCUMENT_PROJECTED_TEXT,
    ];

    /** @var list<string> الفئات التي يجوز إرسالها فعلاً في هذه المرحلة. */
    public const AVAILABLE = [self::ASSISTANT_MESSAGES];

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
