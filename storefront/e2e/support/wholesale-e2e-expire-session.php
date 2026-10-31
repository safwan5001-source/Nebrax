<?php

/**
 * H6 Batch L — simulate session expiry in the THROWAWAY E2E database only.
 *
 * Sets `expires_at` to the past for every Sanctum token of the given buyer identity, which is exactly the state a
 * real TTL elapse produces (the backend checks `expires_at->isPast()` on every request). It exists because a browser
 * test cannot wait out the real TTL. Same guard as the seed; prints the number of tokens touched, nothing else.
 *
 *   php wholesale-e2e-expire-session.php buyer@example.test
 */

use App\Models\CustomerIdentity;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

require getcwd().'/vendor/autoload.php';
$app = require getcwd().'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$db = (string) config('database.connections.sqlite.database');
if (getenv('E2E_ALLOW_SEED') !== '1' || config('database.default') !== 'sqlite' || ! str_contains($db, 'e2e') || empty($argv[1])) {
    fwrite(STDERR, "refusing: needs E2E_ALLOW_SEED=1, a throwaway sqlite path containing 'e2e' and an email argument\n");
    exit(1);
}

$identity = DB::table('customer_identities')->where('email', $argv[1])->first();
$touched = $identity
    ? DB::table('personal_access_tokens')
        ->where('tokenable_type', CustomerIdentity::class)
        ->where('tokenable_id', $identity->id)
        ->update(['expires_at' => now()->subMinute()])
    : 0;

echo json_encode(['expired_tokens' => $touched])."\n";
