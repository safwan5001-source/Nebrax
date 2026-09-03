<?php

namespace App\Support;

/**
 * ═══════════════════════════════════════════════════════════════
 *  الذكاء المستندي — مفهومان مستقلّان لا يقترنان
 * ═══════════════════════════════════════════════════════════════
 *  قرار معماري غير قابل للكسر: **المعالجة الذكية** و**سياسة الاحتفاظ
 *  بالأصل** إعدادان منفصلان تماماً لكل مستأجر.
 *
 *  1) المعالجة الذكية (`processing_enabled` + `allowed_document_types`):
 *     هل يستخرج النظام بيانات المستند آلياً، ولأي أنواع؟
 *
 *  2) سياسة الاحتفاظ بالأصل (`retention_mode`): ما مصير الملف المرفوع
 *     **بعد** اكتمال المعالجة بأمان؟ أربع دلالات متمايزة.
 *
 *  **تفعيل الذكاء لا يعني أبداً وجوب الاحتفاظ بالأصل** — شركة قد تستخرج
 *  فاتورة ثم لا تحتفظ بصورتها، وأخرى تستعمل المركز أرشيفاً لمستندات لا
 *  تُنتج قيداً محاسبياً. القيمتان لا تشتقّ إحداهما من الأخرى.
 *
 *  هذا الملف تعريفٌ بحت (ثوابت ودلالات)؛ القراءة من إعدادات المستأجر تتم
 *  عبر `App\Services\DocumentCenter\DocumentIntelligencePolicy`.
 */
final class DocumentIntelligence
{
    public const SETTINGS_GROUP = 'document_intelligence';

    /** أبقِ الأصل في مركز المستندات فقط (السلوك القائم حرفياً — الافتراض الآمن). */
    public const RETENTION_DOCUMENT_CENTER_ONLY = 'document_center_only';

    /** أرفق الأصل بالسجل الناتج فقط (يُزال من المركز بعد اكتمال المسار بأمان). */
    public const RETENTION_RECORD_ATTACHMENT_ONLY = 'record_attachment_only';

    /** أبقِه في المركز وأرفقه بالسجل الناتج معاً. */
    public const RETENTION_DOCUMENT_CENTER_AND_ATTACHMENT = 'document_center_and_attachment';

    /** لا تحتفظ بالأصل بعد اكتمال المعالجة بأمان. */
    public const RETENTION_DO_NOT_RETAIN = 'do_not_retain';

    /** @var list<string> */
    public const RETENTION_MODES = [
        self::RETENTION_DOCUMENT_CENTER_ONLY,
        self::RETENTION_RECORD_ATTACHMENT_ONLY,
        self::RETENTION_DOCUMENT_CENTER_AND_ATTACHMENT,
        self::RETENTION_DO_NOT_RETAIN,
    ];

    /**
     * الافتراض يحفظ سلوك المستأجرين القائمين: الأصل يبقى في المركز، ولا
     * إرفاق تلقائي، ولا حذف مبكّر. المعالجة الذكية معطّلة حتى تُفعَّل صراحةً.
     */
    public const DEFAULT_RETENTION_MODE = self::RETENTION_DOCUMENT_CENTER_ONLY;

    public static function isValidRetentionMode(string $mode): bool
    {
        return in_array($mode, self::RETENTION_MODES, true);
    }

    /** هل تُبقي هذه السياسةُ الأصلَ داخل مركز المستندات؟ */
    public static function retainsInDocumentCenter(string $mode): bool
    {
        return in_array($mode, [
            self::RETENTION_DOCUMENT_CENTER_ONLY,
            self::RETENTION_DOCUMENT_CENTER_AND_ATTACHMENT,
        ], true);
    }

    /** هل تُرفق هذه السياسةُ الأصلَ بالسجل الناتج؟ */
    public static function attachesToRecord(string $mode): bool
    {
        return in_array($mode, [
            self::RETENTION_RECORD_ATTACHMENT_ONLY,
            self::RETENTION_DOCUMENT_CENTER_AND_ATTACHMENT,
        ], true);
    }
}
