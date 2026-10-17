<?php

namespace Tests\Feature;

use App\Models\AiAuditEvent;
use App\Models\AiBudget;
use App\Models\AiRequest;
use App\Support\AiDocumentDigest;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * AI-07ب — مراجعة قبل الدمج (٢): `AiDocumentDigest` لا يتجاوز الحدّ الصارم للرموز مهما طالت حقول الرأس أو تضخّم ترميزها،
 * وما لا يتّسع يُرفض رفضاً آمناً **قبل أي اتصال خارجي** وبلا رسوم.
 *
 * تشغيل: php artisan test --filter=AiDocumentDigestBoundTest
 */
class AiDocumentDigestBoundTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use InteractsWithAiAssistant;
    use InteractsWithDocumentPipeline;

    private const LONG = 'خدمة-طويلة-جدا-CANARY-';

    // ───────────────────────── وحدة صرفة: AiDocumentDigest ─────────────────────────

    /** @return array<string,mixed> إسقاط مرجعي بحقول رأس طويلة وسطور كثيرة. */
    private function projection(int $headerChars, int $lines = 0, int $lineChars = 40, string $fill = 'ن'): array
    {
        $text = static fn (string $key, int $len): array => ['key' => $key, 'type' => 'text', 'value' => mb_substr(str_repeat($fill, $len), 0, $len), 'redacted' => false];
        $fields = [
            $text('issuer_name', $headerChars), $text('recipient_name', $headerChars), $text('document_number', $headerChars),
            $text('document_date', 10), $text('currency', 3), $text('external_reference', $headerChars), $text('purchase_order_number', $headerChars),
            ['key' => 'price_includes_tax', 'type' => 'flag', 'value' => false, 'redacted' => false],
            ['key' => 'subtotal_minor', 'type' => 'money', 'value' => 10000, 'decimal' => '100.00', 'redacted' => false],
            ['key' => 'tax_amount_minor', 'type' => 'money', 'value' => 1500, 'decimal' => '15.00', 'redacted' => false],
            ['key' => 'total_amount_minor', 'type' => 'money', 'value' => 11500, 'decimal' => '115.00', 'redacted' => false],
        ];
        $rows = [];
        for ($i = 0; $i < $lines; $i++) {
            $rows[] = ['index' => $i, 'fields' => [$text('description', $lineChars), ['key' => 'total_minor', 'type' => 'money', 'value' => 100, 'decimal' => '1.00', 'redacted' => false]]];
        }

        return [
            'document' => ['document_type' => 'expense', 'language' => 'ar'], 'fields' => $fields, 'lines' => $rows,
            'warnings' => array_fill(0, 5, str_repeat('تحذير', 40)), 'basis' => ['redacted_values' => 0],
        ];
    }

    /** @return array<string,array{0:int,1:int,2:int,3:int,4:string}> */
    public static function shapes(): array
    {
        return [
            'normal document' => [30, 5, 40, 4000, 'ن'],
            'very long header fields (200 chars each)' => [200, 10, 80, 600, 'ن'],
            'huge header fields (5,000 chars each)' => [5000, 50, 200, 1500, 'ن'],
            'many long lines' => [60, 50, 200, 800, 'ن'],
            'angle-bracket heavy values that expand 6x when escaped' => [3000, 20, 200, 2500, '<'],
            'ampersand heavy values (escaped to &)' => [3000, 20, 200, 2500, '&'],
        ];
    }

    /**
     * @test
     * @dataProvider shapes
     */
    public function the_digest_never_exceeds_the_hard_limit_measured_on_the_exact_text_that_would_be_sent(int $header, int $lines, int $lineChars, int $max, string $fill): void
    {
        $built = AiDocumentDigest::build($this->projection($header, $lines, $lineChars, $fill), $max);

        $wireTokens = intdiv(strlen(AiDocumentDigest::encode($built['digest'])) + 2, 3);
        if ($built['fits']) {
            $this->assertLessThanOrEqual($max, $wireTokens, 'measured on encode(), the string that is actually transmitted');
            $this->assertSame($wireTokens, $built['tokens']);
        } else {
            $this->assertTrue($built['fits'] === false);
        }
        // الأساس المالي لا يُحذف أبداً حين يكفي المكان.
        if ($built['fits']) {
            $this->assertSame('115.00', $built['digest']['fields']['total_amount']);
            $this->assertSame('100.00', $built['digest']['fields']['subtotal']);
        }
    }

    /** @test */
    public function shrinking_follows_the_ladder_lines_then_text_then_optional_fields_and_announces_truncation(): void
    {
        $roomy = AiDocumentDigest::build($this->projection(30, 10), 100_000);
        $this->assertTrue($roomy['fits']);
        $this->assertSame([10, 0], [$roomy['lines'], $roomy['digest']['lines_omitted']]);
        $this->assertArrayNotHasKey('truncated', $roomy['digest']);

        $tight = AiDocumentDigest::build($this->projection(3000, 50, 200), 700);
        $this->assertTrue($tight['fits']);
        $this->assertTrue($tight['digest']['truncated'] ?? false, 'a clipped value is never presented as complete');
        $this->assertLessThan(50, $tight['lines']);
        $this->assertSame(50 - $tight['lines'], $tight['digest']['lines_omitted'], 'omitted lines are declared exactly');
        foreach ($tight['digest']['fields'] as $key => $value) {
            if (is_string($value) && ! preg_match('/^(Party-\d+|\d+\.\d{2}|\d{4}-\d{2}-\d{2}|[A-Z]{3})$/', $value)) {
                $this->assertLessThanOrEqual(100, mb_strlen($value), "{$key} clipped");
            }
        }
    }

    /** @test */
    public function a_digest_that_cannot_fit_even_after_every_reduction_is_reported_as_not_fitting_never_returned_as_ok(): void
    {
        $built = AiDocumentDigest::build($this->projection(5000, 50), 40);

        $this->assertFalse($built['fits']);
        $this->assertGreaterThan(40, $built['tokens']);
    }

    /** @test */
    public function the_estimate_counts_the_escaped_form_so_markup_heavy_text_cannot_sneak_under_the_limit(): void
    {
        $plain = AiDocumentDigest::build($this->projection(600, 0, 10, 'x'), 100_000)['tokens'];
        $markup = AiDocumentDigest::build($this->projection(600, 0, 10, '<'), 100_000)['tokens'];

        $this->assertGreaterThan($plain * 2, $markup, '< is sent as \\u003C (6 bytes) and must be measured as such');
    }

    // ───────────────────────── من البوابة إلى الشبكة ─────────────────────────

    private function readyTenant(string $slug, int $maxTokens): array
    {
        $this->bootDocumentPipeline();
        $auth = $this->documentTenant($slug);
        $tid = $auth['tenant_id'];
        config([
            'ai_assistant.enabled' => true, 'ai_assistant.provider' => 'anthropic', 'ai_assistant.external_network_enabled' => true,
            'ai_assistant.documents.enabled' => true, 'ai_assistant.documents.external_send_enabled' => true,
            'ai_assistant.documents.external_max_tokens' => $maxTokens,
            'ai_assistant.documents.max_text_chars' => 5000,
            'ai_assistant.pricing.anthropic' => [self::DOC_MODEL => ['input_micro_usd_per_1k' => 3000, 'output_micro_usd_per_1k' => 15000]],
        ]);
        \App\Support\Settings::put('ai_assistant', ['enabled' => true, 'consented_categories' => ['assistant_messages', 'financial_summary', 'document_projected_text']]);
        \App\Support\Settings::put('ai_assistant_external', ['acknowledged' => true, 'documents_acknowledged' => true]);
        $this->setCaps(null, 50_000_000, 500_000_000_000);
        $this->setCaps($tid, 50_000_000, 500_000_000_000);

        return $auth;
    }

    /** مستند مراجَع بحقول رأس طويلة (تمر الاستخراج الحقيقي ثم المراجعة والإكمال). */
    private function reviewedLongDocument(array $auth, int $chars): string
    {
        $long = fn (string $tag) => mb_substr(self::LONG . $tag . str_repeat('م', $chars), 0, 128);   // المراجعة تحدّ النص بـ128
        $payload = $this->extractionPayload('expense');
        $payload['lines'][0]['tax_rate'] = '15';
        $payload['fields'] = array_replace($payload['fields'], [
            'issuer_name' => $long('issuer'), 'recipient_name' => $long('recipient'), 'document_number' => $long('number'),
            'external_reference' => $long('ref'), 'purchase_order_number' => $long('po'), 'document_date' => '2026-10-10',
            'price_includes_tax' => false, 'subtotal' => '100.00', 'tax_amount' => '15.00', 'total_amount' => '115.00',
        ]);
        Http::fake([self::ANTHROPIC_ENDPOINT => function (\Illuminate\Http\Client\Request $request) use ($payload) {
            return collect($request->data()['tools'] ?? [])->contains(fn ($t) => ($t['name'] ?? '') === 'submit_document_extraction')
                ? Http::response($this->anthropicExtractionResponse($payload, 4200, 900))
                : Http::response(['id' => 'm', 'type' => 'message', 'role' => 'assistant', 'content' => [['type' => 'text', 'text' => 'الإجمالي 115.00']], 'usage' => ['input_tokens' => 700, 'output_tokens' => 20]]);
        }]);
        $batch = $this->batchWithFile($auth['token'], 'expense');
        $this->runExtraction($this->completeAndScan($auth['token'], $batch));
        $id = $batch['id'];
        $version = fn () => \App\Models\DocumentBatch::withoutGlobalScopes()->findOrFail($id)->version;
        $this->withToken($auth['token'])->postJson("/api/document-batches/{$id}/complete-review", ['expected_version' => $version(), 'reason' => 'اكتملت'])->assertOk();

        return $id;
    }

    private function sentDigestTokens(): array
    {
        $calls = array_values(array_filter(Http::recorded()->all(), fn ($p) => $p[0]->url() === self::ANTHROPIC_ENDPOINT && ! collect($p[0]->data()['tools'] ?? [])->contains(fn ($t) => ($t['name'] ?? '') === 'submit_document_extraction')));
        $this->assertCount(1, $calls, 'exactly one assistant call');
        $text = $calls[0][0]->data()['messages'][0]['content'][1]['text'];
        $this->assertSame(1, preg_match('#^<document_data>\n(.*)\n</document_data>$#s', $text, $m));

        return [intdiv(strlen($m[1]) + 2, 3), $m[1]];
    }

    /** @test */
    public function an_oversized_header_is_clipped_to_fit_and_what_is_sent_never_exceeds_the_configured_limit(): void
    {
        $auth = $this->readyTenant('bound-clip', 260);
        $id = $this->reviewedLongDocument($auth, 128);

        $res = $this->aiAsk($auth['token'], ['message' => 'ما إجمالي المستند؟', 'locale' => 'ar', 'document_id' => $id])->assertOk();

        [$tokens, $json] = $this->sentDigestTokens();
        $this->assertLessThanOrEqual(260, $tokens, 'the digest on the wire stays within the hard limit');
        $this->assertStringContainsString('"truncated":true', $json);
        $this->assertStringContainsString('115.00', $json, 'amounts survive the reduction');
        $this->assertSame('ok', $res->json('data.status'));
    }

    /** @test */
    public function a_document_that_cannot_fit_is_refused_before_any_external_call_without_charge_or_leak(): void
    {
        $auth = $this->readyTenant('bound-refuse', 40);
        $id = $this->reviewedLongDocument($auth, 128);
        $before = count(array_filter(Http::recorded()->all(), fn ($p) => $p[0]->url() === self::ANTHROPIC_ENDPOINT));

        $res = $this->aiAsk($auth['token'], ['message' => 'ما إجمالي المستند؟', 'locale' => 'ar', 'document_id' => $id])->assertStatus(422)->assertJsonPath('error.code', 'document_too_large');

        $this->assertSame($before, count(array_filter(Http::recorded()->all(), fn ($p) => $p[0]->url() === self::ANTHROPIC_ENDPOINT)), 'no external call');
        $row = AiRequest::query()->where('feature', 'assistant_document')->firstOrFail();
        $this->assertSame([AiRequest::STATUS_FAILED, 'document_too_large', 0, 0, 0, 0], [$row->status, $row->error_code, $row->input_tokens, $row->output_tokens, $row->unmetered_tokens, $row->cost_micro_usd], 'released at zero cost');
        $global = AiBudget::query()->where('budget_key', 'global')->firstOrFail();
        $this->assertSame([0, 0], [$global->reserved_tokens, $global->used_tokens]);
        $denied = AiAuditEvent::withoutGlobalScopes()->where('event', 'request.denied')->firstOrFail();
        $this->assertSame('document_too_large', $denied->reason);
        $this->assertStringNotContainsString(self::LONG, $res->getContent() . json_encode(DB::table('ai_audit_events')->get()) . json_encode(DB::table('ai_requests')->get()));
    }

    /** @test */
    public function a_refusal_for_size_leaves_the_budget_and_the_document_untouched_and_a_smaller_limit_change_takes_effect_immediately(): void
    {
        $auth = $this->readyTenant('bound-flip', 40);
        $id = $this->reviewedLongDocument($auth, 128);
        $this->aiAsk($auth['token'], ['message' => 'x', 'document_id' => $id])->assertStatus(422);

        config(['ai_assistant.documents.external_max_tokens' => 4000]);
        $this->aiAsk($auth['token'], ['message' => 'ما إجمالي المستند؟', 'locale' => 'ar', 'document_id' => $id])->assertOk();

        [$tokens] = $this->sentDigestTokens();
        $this->assertLessThanOrEqual(4000, $tokens);
        $this->assertSame(0, (int) AiBudget::query()->where('budget_key', 'global')->value('reserved_tokens'));
    }
}
