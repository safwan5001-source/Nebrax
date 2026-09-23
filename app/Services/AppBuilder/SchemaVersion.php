<?php

namespace App\Services\AppBuilder;

/**
 * ═══════════════════════════════════════════════════════════════
 *  مقارن SemVer مصغَّر — مطابقٌ حرفياً لـ mobile/lib/schema/schema_version.dart
 * ═══════════════════════════════════════════════════════════════
 *
 * APP-BUILDER-2: «لا تخترع عقد مخطط/تشغيل ثانياً» — App Schema الحقيقي
 * المُختبَر فعلياً هو ما بنته AWJ Mobile Runtime Proof V1
 * (`mobile/lib/schema/`)، لا الشكل التوضيحي في `APP_SCHEMA_V1.md` §4 (الذي
 * يصرّح صراحةً أنه "contract candidates... not locked"). هذا الصنف نسخة
 * PHP طبق الأصل من مقارن `x.y.z` الخاص بـFlutter — رقمي فقط، بلا
 * pre-release/build-metadata، بنفس السبب: مشكلة محدودة لا تستحق حزمة SemVer
 * خارجية.
 */
final class SchemaVersion
{
    public function __construct(
        public readonly int $major,
        public readonly int $minor,
        public readonly int $patch,
    ) {}

    public static function tryParse(string $value): ?self
    {
        $parts = explode('.', trim($value));
        if (count($parts) !== 3) {
            return null;
        }

        $nums = [];
        foreach ($parts as $part) {
            if (! ctype_digit($part)) {
                return null;
            }
            $nums[] = (int) $part;
        }

        return new self($nums[0], $nums[1], $nums[2]);
    }

    public function compareTo(self $other): int
    {
        if ($this->major !== $other->major) {
            return $this->major <=> $other->major;
        }
        if ($this->minor !== $other->minor) {
            return $this->minor <=> $other->minor;
        }

        return $this->patch <=> $other->patch;
    }

    public function lessThan(self $other): bool
    {
        return $this->compareTo($other) < 0;
    }

    public function greaterThan(self $other): bool
    {
        return $this->compareTo($other) > 0;
    }

    public function __toString(): string
    {
        return "{$this->major}.{$this->minor}.{$this->patch}";
    }
}
