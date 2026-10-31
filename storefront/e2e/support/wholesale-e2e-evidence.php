<?php

/**
 * H6 Batch L — READ-ONLY evidence probe for the local wholesale browser E2E.
 *
 * Prints one sanitized JSON document about what the journey left behind: orders (buyer/channel/price provenance),
 * and counts of everything that must stay untouched (invoices, payments, journal entries, stock movements, cart rows).
 * Same guard as the seed: throwaway SQLite whose path contains `e2e`. It writes nothing. No emails, tokens or names are printed.
 *
 *   php wholesale-e2e-evidence.php [identity_email]
 */

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

require getcwd().'/vendor/autoload.php';
$app = require getcwd().'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$db = (string) config('database.connections.sqlite.database');
if (getenv('E2E_ALLOW_SEED') !== '1' || config('database.default') !== 'sqlite' || ! str_contains($db, 'e2e')) {
    fwrite(STDERR, "refusing: needs E2E_ALLOW_SEED=1 and a throwaway sqlite path containing 'e2e'\n");
    exit(1);
}

$count = fn (string $t): int => DB::getSchemaBuilder()->hasTable($t) ? (int) DB::table($t)->count() : -1;
$email = $argv[1] ?? null;
$identity = $email ? DB::table('customer_identities')->where('email', $email)->first() : null;

$orders = DB::table('commerce_orders')->orderBy('created_at')->get()->map(function ($o) use ($identity) {
    $lines = DB::table('commerce_order_lines')->where('commerce_order_id', $o->id)->orderBy('created_at')->get();

    return [
        'id' => $o->id,
        'order_status' => $o->status,
        'channel_id' => $o->sales_channel_id,
        'owned_by_expected_identity' => $identity ? ($o->customer_identity_id ?? null) === $identity->id : null,
        'total_minor' => (int) ($o->total_minor ?? $o->total ?? 0),
        'lines' => $lines->map(fn ($l) => [
            'product_id' => $l->product_id,
            'quantity' => (int) $l->quantity,
            'unit_price_minor' => (int) ($l->unit_price_minor ?? $l->unit_price ?? 0),
            'price_source' => $l->price_source ?? null,
            'price_list_id' => $l->price_list_id ?? null,
        ])->all(),
    ];
})->all();

echo json_encode([
    'orders' => $orders,
    'order_count' => count($orders),
    'untouched' => [
        'invoices' => $count('invoices'),
        'payments' => $count('payments'),
        'payment_allocations' => $count('payment_allocations'),
        'journal_entries' => $count('journal_entries'),
        'journal_lines' => $count('journal_lines'),
        'stock_movements' => $count('stock_movements'),
        'commerce_payment_intents' => $count('commerce_payment_intents'),
        'payment_attempts' => $count('payment_attempts'),
        'credit_notes' => $count('credit_notes'),
    ],
    'payment_intents' => DB::getSchemaBuilder()->hasTable('commerce_payment_intents') ? DB::table('commerce_payment_intents')->get(['method', 'status'])->map(fn ($i) => ['method' => $i->method, 'status' => $i->status])->all() : [],
    'memberships' => DB::table('wholesale_memberships')->select('status', DB::raw('count(*) as n'))->groupBy('status')->pluck('n', 'status')->all(),
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT)."\n";
