<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\JournalEntry;
use App\Models\ManualJournal;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\ManualJournalService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * تثبت دورة القيد اليدوي أن المسودة لا تمس الأستاذ، وأن الترحيل والعكس يمران
 * بمحرك LedgerService ويتركان السجل الأصلي قابلاً للتدقيق.
 */
class ManualJournalTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected ManualJournalService $journals;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس القيود',
            'slug' => 'nibras-journals',
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        $this->journals = app(ManualJournalService::class);
    }

    private function account(string $code): Account
    {
        return Account::where('code', $code)->firstOrFail();
    }

    private function balancedDraft(): ManualJournal
    {
        return $this->journals->create([
            'entry_date' => '2026-08-20',
            'description' => 'تسوية يدوية للاختبار',
        ], [
            ['account_id' => $this->account('1110')->id, 'debit' => 125000],
            ['account_id' => $this->account('4110')->id, 'credit' => 125000],
        ]);
    }

    /** @test */
    public function it_saves_a_manual_journal_as_a_draft_without_ledger_effect(): void
    {
        $draft = $this->balancedDraft();

        $this->assertTrue($draft->isDraft());
        $this->assertStringStartsWith('MJE-2026-', $draft->number);
        $this->assertNull($draft->journal_entry_id);
        $this->assertCount(2, $draft->lines);
        $this->assertNull($this->account('1110')->balance);
    }

    /** @test */
    public function it_posts_a_balanced_manual_journal_through_the_ledger_and_links_the_source(): void
    {
        $posted = $this->journals->post($this->balancedDraft());
        $entry = JournalEntry::with('lines.account')
            ->where('source_type', ManualJournal::class)
            ->where('source_id', $posted->id)
            ->firstOrFail();

        $this->assertTrue($posted->isPosted());
        $this->assertSame($entry->id, $posted->journal_entry_id);
        $this->assertSame(ManualJournal::class, $entry->source_type);
        $this->assertSame($posted->id, $entry->source_id);
        $this->assertSame($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertSame(125000, $entry->lines->sum('debit'));
        $this->assertSame(125000, $entry->lines->firstWhere('account_id', $this->account('1110')->id)->debit);
        $this->assertSame(125000, $entry->lines->firstWhere('account_id', $this->account('4110')->id)->credit);
    }

    /** @test */
    public function it_rejects_an_unbalanced_draft_when_posting_without_touching_the_ledger(): void
    {
        $draft = $this->journals->create(['entry_date' => '2026-08-20'], [
            ['account_id' => $this->account('1110')->id, 'debit' => 125000],
            ['account_id' => $this->account('4110')->id, 'credit' => 100000],
        ]);

        $this->expectExceptionMessage('غير متوازن');
        try {
            $this->journals->post($draft);
        } finally {
            $this->assertTrue($draft->fresh()->isDraft());
            $this->assertSame(0, JournalEntry::count());
            $this->assertNull($this->account('1110')->balance);
        }
    }

    /** @test */
    public function it_reverses_a_posted_manual_journal_without_mutating_the_original_entry(): void
    {
        $posted = $this->journals->post($this->balancedDraft());
        $original = $posted->journalEntry()->with('lines')->firstOrFail();

        $reversed = $this->journals->reverse(
            $posted,
            '2026-08-21',
            'تصحيح تسوية أُدخلت بالخطأ'
        );
        $reversal = JournalEntry::with('lines')->where('reversal_of', $original->id)->firstOrFail();

        $this->assertTrue($reversed->isReversed());
        $this->assertSame('reversed', $original->fresh()->status);
        $this->assertSame(125000, $reversal->lines->sum('debit'));
        $this->assertSame(125000, $reversal->lines->sum('credit'));
        $this->assertSame(0, $this->account('1110')->balance->fresh()->balance);
        $this->assertSame(0, $this->account('4110')->balance->fresh()->balance);
    }

    /** @test */
    public function it_scopes_the_manual_document_and_posted_lines_to_the_active_branch(): void
    {
        $first = Branch::create(['tenant_id' => $this->tenant->id, 'code' => '00001', 'name' => 'الفرع الأول']);
        $second = Branch::create(['tenant_id' => $this->tenant->id, 'code' => '00002', 'name' => 'الفرع الثاني']);
        $context = app(BranchContext::class);

        $context->set($first->id);
        $firstJournal = $this->journals->post($this->balancedDraft());

        $context->set($second->id);
        $secondJournal = $this->journals->post($this->balancedDraft());

        $this->assertSame($first->id, $firstJournal->branch_id);
        $this->assertSame($second->id, $secondJournal->branch_id);
        $this->assertTrue($firstJournal->journalEntry()->firstOrFail()->lines()->where('branch_id', $first->id)->count() === 2);
        $this->assertTrue($secondJournal->journalEntry()->firstOrFail()->lines()->where('branch_id', $second->id)->count() === 2);
    }

    /** @test */
    public function it_never_reopens_a_posted_manual_journal_for_editing_or_deletion(): void
    {
        $posted = $this->journals->post($this->balancedDraft());

        try {
            $this->journals->update($posted, ['description' => 'تعديل غير مسموح'], []);
            $this->fail('كان يفترض رفض تعديل القيد المرحّل.');
        } catch (\RuntimeException $exception) {
            $this->assertStringContainsString('لا يمكن تعديل', $exception->getMessage());
        }

        $this->expectExceptionMessage('لا يمكن حذف');
        $this->journals->deleteDraft($posted->fresh());
    }
}
