<?php

namespace Tests\Unit;

use App\Support\DocumentLanguageMode;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use RuntimeException;

class DocumentLanguageModeTest extends TestCase
{
    public static function validModes(): array
    {
        return [
            'arabic' => ['ar'],
            'english' => ['en'],
            'bilingual' => ['bilingual'],
        ];
    }

    #[DataProvider('validModes')]
    public function test_it_accepts_supported_document_language_modes(string $mode): void
    {
        $this->assertSame($mode, DocumentLanguageMode::assert($mode));
    }

    public function test_it_rejects_unknown_document_language_mode(): void
    {
        $this->expectException(RuntimeException::class);
        DocumentLanguageMode::assert('auto');
    }
}
