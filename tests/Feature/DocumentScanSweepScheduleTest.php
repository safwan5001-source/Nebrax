<?php

namespace Tests\Feature;

use Illuminate\Console\Scheduling\Schedule;
use Tests\TestCase;

class DocumentScanSweepScheduleTest extends TestCase
{
    /** @test */
    public function the_sweeper_is_scheduled_every_ten_minutes_with_visible_output_and_no_overlap(): void
    {
        $event = collect(app(Schedule::class)->events())
            ->first(fn ($e) => str_contains((string) $e->command, 'documents:sweep-scans'));

        $this->assertNotNull($event, 'documents:sweep-scans must be scheduled');
        $this->assertSame('*/10 * * * *', $event->expression);
        $this->assertSame('/proc/1/fd/1', $event->output);
        $this->assertTrue($event->withoutOverlapping);
        $this->assertTrue($event->onOneServer);
    }
}
