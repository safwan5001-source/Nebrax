<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use Illuminate\Console\Command;

/** تحقق نطاق المستأجر المشترك لأوامر مراجعة الإشعارات التاريخية. */
final class LegacyCreditNoteCommandSupport
{
    /** @return string|null معرّف المستأجر الصالح، أو null بعد طباعة الخطأ */
    public static function tenantOrFail(Command $command): ?string
    {
        $tenantId = $command->option('tenant');
        if (! is_string($tenantId) || ! preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $tenantId)) {
            $command->error('The --tenant option must be a UUID.');

            return null;
        }
        if (Tenant::query()->find($tenantId) === null) {
            $command->error('Tenant not found.');

            return null;
        }

        return $tenantId;
    }
}
