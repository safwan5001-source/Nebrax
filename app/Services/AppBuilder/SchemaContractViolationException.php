<?php

namespace App\Services\AppBuilder;

use DomainException;

/**
 * نشرٌ/فحصٌ يفشل بمخالفات عقد فعلية — AD-12 (S02). لا يرث `RuntimeException` عمداً (وإلا حوّله `ApiController::domain()` إلى 422 عام بلا `issues`)،
 * والمتحكّمون يلتقطونه صراحةً لإعادة `issues[]` المنظَّمة (`reason: contract_violations`).
 */
final class SchemaContractViolationException extends DomainException
{
    /** @param  list<ContractIssue>  $issues المخالفات الحاجبة وحدها */
    public function __construct(public readonly array $issues)
    {
        parent::__construct(sprintf('التجربة تخالف عقد المكوّنات (%d مخالفة تمنع النشر). أصلحها ثم أعد المحاولة.', count($issues)));
    }
}
