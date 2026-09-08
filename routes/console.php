<?php

use Illuminate\Support\Facades\Schedule;

Schedule::command('finance:scan-controls')->hourly()->withoutOverlapping()->onOneServer();
Schedule::command('inventory:scan-alerts')->hourly()->withoutOverlapping()->onOneServer();

// PR-NOTIF-5: receivables are date-driven, so one daily evaluation is sufficient.
Schedule::command('receivables:scan-notifications')->dailyAt('08:00')->withoutOverlapping()->onOneServer();
// POS pending variance/handover is operational; hourly projection is intentionally
// read-only and idempotent through NotificationService dedupe keys.
Schedule::command('pos:scan-notifications')->hourly()->withoutOverlapping()->onOneServer();

Schedule::command('pos:generate-lp-digest')->dailyAt('01:00')->withoutOverlapping()->onOneServer();
Schedule::command('webhooks:deliver')->everyMinute()->withoutOverlapping()->onOneServer();
Schedule::command('webhooks:prune')->dailyAt('02:00')->withoutOverlapping()->onOneServer();
