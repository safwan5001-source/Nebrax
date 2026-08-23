<?php

namespace App\Providers;

use App\Contracts\DocumentSafetyScanner;
use App\Models\PlatformRuntimeHeartbeat;
use App\Services\DocumentCenter\ClamAvTcpDocumentSafetyScanner;
use Illuminate\Queue\Events\Looping;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\ServiceProvider;
use Throwable;

class DocumentCenterServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(DocumentSafetyScanner::class, ClamAvTcpDocumentSafetyScanner::class);
    }

    public function boot(): void
    {
        Queue::looping(function (Looping $event): void {
            static $lastBeat = 0;
            if (time() - $lastBeat < 30 || $event->connectionName !== 'redis') {
                return;
            }
            $lastBeat = time();

            try {
                if (! Schema::hasTable('platform_runtime_heartbeats')) {
                    return;
                }
                PlatformRuntimeHeartbeat::query()->updateOrCreate(
                    ['component' => 'document-worker'],
                    [
                        'instance_id' => gethostname() ?: null,
                        'status' => 'online',
                        'metadata' => ['queue' => 'documents'],
                        'last_seen_at' => now('UTC'),
                    ],
                );
            } catch (Throwable) {
                // النبضة تشخيصية؛ لا يجوز أن توقف معالجة مستند قائم.
            }
        });
    }
}
