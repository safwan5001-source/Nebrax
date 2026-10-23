<?php

namespace App\Support;

use RuntimeException;

/**
 * فشل قطعةٍ سببه وحداتٌ بعينها (IMP-H1-S8a): يحمل ترتيب كل وحدةٍ فاشلة (بين صفوف البيانات الفعلية، من 0) ورمزها ورسالتها، فيسجّلها
 * `ImportJobUnitRecorder` وحدةً وحدة بدل عدّ النافذة كلها فاشلةً بلا تمييز. يرث `RuntimeException` برسالته القديمة نفسها فلا يتغيّر أي
 * مستهلك قائم (المسار المتزامن يردّ 422 بالرسالة ذاتها).
 */
class ImportUnitFailureException extends RuntimeException
{
    /** @param  list<array{ordinal: int, code: string, message: string}>  $failures */
    public function __construct(string $message, public readonly array $failures)
    {
        parent::__construct($message);
    }
}
