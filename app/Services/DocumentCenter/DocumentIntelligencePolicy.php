<?php

namespace App\Services\DocumentCenter;

use App\Models\Tenant;
use App\Support\DocumentIntelligence;
use App\Support\DocumentTypeCatalog;
use App\Support\Settings;

/**
 * القارئ الوحيد لإعدادات الذكاء المستندي على مستوى المستأجر. الخدمات تقرأ
 * القرار من هنا لا من `tenants.settings` مباشرةً — فلا تتناثر دلالةُ
 * الإعداد ولا يقترن المفهومان (المعالجة / الاحتفاظ) في مكان دون آخر.
 *
 * **لا يُجري هذا الصنف أي اتصال بمزود خارجي ولا يستخرج شيئاً**؛ يقرّر فقط
 * ما تسمح به سياسة المستأجر. توصيل التنفيذ الفعلي للاستخراج مرحلةٌ لاحقة.
 */
final class DocumentIntelligencePolicy
{
    /** @param array<string, mixed> $settings */
    private function __construct(private readonly array $settings)
    {
    }

    public static function forTenant(?Tenant $tenant = null): self
    {
        return new self(Settings::group(DocumentIntelligence::SETTINGS_GROUP, $tenant));
    }

    /** هل فعّل المستأجر المعالجة الذكية؟ (مستقلّ عن الاحتفاظ). */
    public function processingEnabled(): bool
    {
        return (bool) ($this->settings['processing_enabled'] ?? false);
    }

    /**
     * الأنواع المسموح بمعالجتها ذكياً — قائمة صريحة فقط، مصفّاة على التصنيف
     * المعتمد كي لا يتسرّب نوع محذوف من إعداد قديم. القائمة الفارغة تعني «لا
     * نوع»، لا «كل الأنواع»: التفعيل اختيارٌ صريح لكل نوع.
     *
     * @return list<string>
     */
    public function allowedDocumentTypes(): array
    {
        $stored = $this->settings['allowed_document_types'] ?? [];
        if (! is_array($stored)) {
            return [];
        }

        return array_values(array_filter(
            $stored,
            static fn ($type): bool => is_string($type) && DocumentTypeCatalog::supports($type),
        ));
    }

    public function allowsDocumentType(string $type): bool
    {
        return in_array($type, $this->allowedDocumentTypes(), true);
    }

    /**
     * قرار المعالجة الذكية لنوع بعينه: التفعيل العام **و** إدراج النوع صراحةً.
     * هذه هي البوّابة التي سيستشيرها مسار الاستخراج في المرحلة القادمة.
     */
    public function shouldProcessDocumentType(string $type): bool
    {
        return $this->processingEnabled() && $this->allowsDocumentType($type);
    }

    public function retentionMode(): string
    {
        $mode = (string) ($this->settings['retention_mode'] ?? DocumentIntelligence::DEFAULT_RETENTION_MODE);

        return DocumentIntelligence::isValidRetentionMode($mode)
            ? $mode
            : DocumentIntelligence::DEFAULT_RETENTION_MODE;
    }

    /** هل تُبقي سياسةُ المستأجر الأصلَ في مركز المستندات؟ */
    public function retainsOriginalInDocumentCenter(): bool
    {
        return DocumentIntelligence::retainsInDocumentCenter($this->retentionMode());
    }

    /** هل تفرض سياسةُ المستأجر إرفاق الأصل بالسجل الناتج؟ */
    public function attachesOriginalToRecord(): bool
    {
        return DocumentIntelligence::attachesToRecord($this->retentionMode());
    }

    /**
     * لقطة القرار الفعّال — تستهلكها الواجهة والخدمات دون إعادة اشتقاق.
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'processing_enabled' => $this->processingEnabled(),
            'allowed_document_types' => $this->allowedDocumentTypes(),
            'retention_mode' => $this->retentionMode(),
            'retains_original_in_document_center' => $this->retainsOriginalInDocumentCenter(),
            'attaches_original_to_record' => $this->attachesOriginalToRecord(),
        ];
    }
}
