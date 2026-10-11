<?php

namespace App\Console\Commands;

use App\Models\UserRequestIdempotencyKey;
use Illuminate\Console\Command;

/** تقليم مفاتيح Idempotency المنتهية لطلبات المستخدمين (احتفاظ حتمي، يتجاوز نطاق المستأجر عمداً). */
class PruneUserRequestIdempotency extends Command
{
    protected $signature = 'request-idempotency:prune {--dry-run : عُدّ دون حذف}';

    protected $description = 'يقلّم مفاتيح Idempotency المنتهية لطلبات الواجهة';

    public function handle(): int
    {
        $query = UserRequestIdempotencyKey::query()->withoutGlobalScopes()->where('expires_at', '<=', now());
        if ($this->option('dry-run')) {
            $this->line('مفاتيح منتهية مرشّحة للحذف: '.$query->count());

            return self::SUCCESS;
        }
        $this->line('حُذفت مفاتيح منتهية: '.$query->delete());

        return self::SUCCESS;
    }
}
