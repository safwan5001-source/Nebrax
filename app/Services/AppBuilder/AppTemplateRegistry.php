<?php

namespace App\Services\AppBuilder;

use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  سجل قوالب التطبيقات — AD-11 / S22a (معتمد)
 * ═══════════════════════════════════════════════════════════════
 *
 * مصدر واحد لقوالب البدء، من ملفات JSON مُراجَعة في `resources/app-builder/templates/*.v1.json` (نفس الملفات تقرؤها اختبارات
 * Dart فتُثبَّت صلاحيتها على المحللَين وCI). **لا محرك قوالب موازٍ**: القالب مخطط `AppSchema` عادي،
 * و«التطبيق» = نسخ إلى المسودة بلا ارتباط حي (تعديل القالب لاحقاً لا يمسّ تطبيقاً سبق إنشاؤه).
 *
 * `vertical` اقتراحي فقط (CLAUDE.md قاعدة 6: تُضبط ولا تُفرض) — لا قالب مفروض على نوع نشاط.
 * قوالب مخصصة للمستأجر (جدول) مؤجَّلة صراحةً كما قرّر AD-11.
 */
final class AppTemplateRegistry
{
    /** @var list<string> أنواع الأنشطة الاقتراحية. */
    public const VERTICALS = ['general', 'retail', 'food', 'fashion', 'services'];

    /** @var list<array<string, mixed>>|null */
    private ?array $cache = null;

    public function __construct(private readonly ?string $directory = null) {}

    /** @return list<array<string, mixed>> بالترتيب الأبجدي لمفاتيح الملفات (حتمي). */
    public function all(): array
    {
        if ($this->cache !== null) {
            return $this->cache;
        }
        $dir = $this->directory ?? resource_path('app-builder/templates');
        $files = glob($dir.'/*.v1.json') ?: [];
        sort($files);
        $templates = [];
        foreach ($files as $file) {
            $json = json_decode((string) file_get_contents($file), true);
            if (! is_array($json) || ! isset($json['key'], $json['schema'])) {
                throw new RuntimeException('قالب تطبيق تالف: '.basename($file));
            }
            $templates[] = $json;
        }

        return $this->cache = $templates;
    }

    /** نسخة مستقلة من القالب (تعديلها لا يغيّر السجل) أو null. @return array<string, mixed>|null */
    public function find(string $key): ?array
    {
        foreach ($this->all() as $template) {
            if ($template['key'] === $key) {
                return unserialize(serialize($template));
            }
        }

        return null;
    }
}
