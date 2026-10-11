<?php

namespace App\Support;

use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;

/**
 * أدوات Idempotency الخالصة لطلبات الواجهة. الفرق الجوهري عن `PublicApiIdempotency`: الطلبات هنا
 * قد تكون multipart (مرفقات)، وحدّ الفاصل (boundary) يتغيّر في كل إعادة إرسال، فبصمة البايتات الخام
 * لا تصلح. البصمة تُبنى من الحقول المقنَّنة + وصف كل ملف (اسم الحقل، الاسم الأصلي، الحجم، sha256).
 */
final class UserRequestIdempotency
{
    public const KEY_PATTERN = '/^[A-Za-z0-9._:\-]{8,255}$/';
    public const MAX_REPLAY_BYTES = 65535;
    /** إيجار الطلب قيد التنفيذ؛ أطول من أقصى عمر طلب على هذه البنية. */
    public const IN_PROGRESS_LEASE_SECONDS = 300;
    public const RETENTION_HOURS = 48;

    public static function isValidKey(string $raw): bool
    {
        return preg_match(self::KEY_PATTERN, $raw) === 1;
    }

    public static function hashKey(string $raw): string
    {
        return hash('sha256', $raw);
    }

    public static function fingerprint(Request $request): string
    {
        $fields = $request->except(array_keys($request->allFiles()));
        $files = [];
        foreach ($request->allFiles() as $name => $value) {
            foreach (self::flattenFiles($value) as $file) {
                $files[] = [
                    'field' => (string) $name,
                    'name' => $file->getClientOriginalName(),
                    'size' => (int) $file->getSize(),
                    'sha256' => $file->getRealPath() ? hash_file('sha256', $file->getRealPath()) : '',
                ];
            }
        }
        usort($files, fn (array $a, array $b) => [$a['field'], $a['sha256'], $a['name']] <=> [$b['field'], $b['sha256'], $b['name']]);

        return hash('sha256', implode("\n", [
            strtoupper($request->getMethod()),
            '/'.ltrim($request->path(), '/'),
            self::canonical($request->query()),
            self::canonical($fields),
            self::canonical($files),
        ]));
    }

    /** @return array<int,UploadedFile> */
    private static function flattenFiles(mixed $value): array
    {
        if ($value instanceof UploadedFile) {
            return [$value];
        }
        $out = [];
        if (is_array($value)) {
            foreach ($value as $item) {
                $out = array_merge($out, self::flattenFiles($item));
            }
        }

        return $out;
    }

    private static function canonical(array $data): string
    {
        self::ksortRecursive($data);

        return (string) json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    private static function ksortRecursive(array &$data): void
    {
        foreach ($data as &$value) {
            if (is_array($value)) {
                self::ksortRecursive($value);
            }
        }
        unset($value);
        // القوائم المرقّمة تحتفظ بترتيبها (ترتيب السطور له معنى)، والمفاتيح النصية تُرتَّب.
        if (! array_is_list($data)) {
            ksort($data);
        }
    }
}
