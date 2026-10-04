<?php
use Illuminate\Http\Request; use Illuminate\Support\Facades\DB;
require '/home/user/nibras-app/vendor/autoload.php';
$app = require '/home/user/nibras-app/bootstrap/app.php'; $kernel = $app->make(Illuminate\Contracts\Http\Kernel::class); $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$seed = json_decode(file_get_contents(__DIR__.'/seed.json'), true);
$run = function (string $label, Request $req) use ($kernel) { DB::flushQueryLog(); DB::enableQueryLog(); $t = microtime(true); $res = $kernel->handle($req); $ms = (microtime(true)-$t)*1000; $n = count(DB::getQueryLog()); echo sprintf("%-46s http %d  queries %3d  %.0f ms\n", $label, $res->getStatusCode(), $n, $ms); };
// warm
$pub = fn () => Request::create('/store/v1/offers', 'GET', [], [], [], ['HTTP_HOST' => 'a.h48.test', 'HTTP_ACCEPT' => 'application/json']);
$run('public offers (warm-up)', $pub()); $run('public offers  — 2 live offers (A,B tracked)', $pub()); 
$login = $kernel->handle(Request::create('/api/login', 'POST', [], [], [], ['HTTP_ACCEPT' => 'application/json', 'CONTENT_TYPE' => 'application/json'], json_encode(['email' => $seed['email'], 'password' => $seed['password']])));
$tok = json_decode($login->getContent(), true)['token'];
$ws = Request::create('/api/commerce/workspace/storefronts/'.$seed['storefrontA'].'/offers', 'GET', [], [], [], ['HTTP_ACCEPT' => 'application/json', 'HTTP_AUTHORIZATION' => 'Bearer '.$tok]);
$run('workspace offers — 5 configured (2 live)', $ws);
