-- ═══════════════════════════════════════════════════════════════════════════
-- AWJ Treasury Cash Routing — فحوص الجاهزية للإنتاج (قراءة فقط، PostgreSQL)
-- ═══════════════════════════════════════════════════════════════════════════
-- التشغيل (بصلاحية قراءة، يفضَّل نسخة قراءة/Replica):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v since="'2026-10-23 06:56:00+00'" -f treasury-readiness-scans.sql
-- كل شيء داخل معاملة READ ONLY ويُرجَع (ROLLBACK) في النهاية؛ لا كتابة ولا DDL.
-- المخرجات أعداد مجمّعة (ومعرّفات مستأجرين فقط حيث يلزم) — لا أسماء ولا بيانات عملاء.
-- :'since' = لحظة نشر T6 على الإنتاج (من سجل Railway) لفحص Q12.
-- كل استعلام مفصول بسطر `-- @@ <اسم>` (يعتمده مشغّل التحقق المحلي).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';

-- @@ Q00_tenants
select count(*) as tenants, count(*) filter (where is_active) as active_tenants from tenants;

-- @@ Q01_stored_policy_distribution
-- السياسة المخزَّنة (البوابة المغلقة تتجاهلها وقت الترحيل). المتوقع الآن: legacy/غير مضبوطة فقط.
select coalesce(settings::jsonb -> 'sales' ->> 'cash_sale_treasury_policy', '(unset = legacy)') as stored_policy, count(*) as tenants
from tenants group by 1 order by 2 desc;

-- @@ Q02_T4a_main_cash_treasury_validity
with cash as (
  select t.id as tenant_id,
         count(c.id) filter (where c.type = 'cash') as entities,
         count(c.id) filter (where c.type = 'cash' and c.is_main) as mains,
         count(c.id) filter (where c.type = 'cash' and c.is_main and c.is_active) as active_mains
  from tenants t left join cash_bank_accounts c on c.tenant_id = t.id
  group by t.id)
select count(*) as tenants,
       count(*) filter (where entities = 0) as no_cash_entity_never_bootstrapped,
       count(*) filter (where entities > 0 and mains = 0) as no_main_cash,
       count(*) filter (where mains > 1) as multiple_mains,
       count(*) filter (where mains = 1 and active_mains = 0) as main_inactive
from cash;

-- @@ Q03_T4a_main_cash_shape
select count(*) as main_cash_entities,
       count(*) filter (where a.id is null) as main_without_ledger_account,
       count(*) filter (where a.code <> '1110') as main_not_1110,
       count(*) filter (where a.is_active = false or a.is_group = true) as main_gl_inactive_or_group,
       count(*) filter (where upper(c.currency) <> upper(coalesce(t.currency, 'SAR'))) as main_currency_mismatch
from cash_bank_accounts c
join tenants t on t.id = c.tenant_id
left join accounts a on a.id = c.account_id and a.tenant_id = c.tenant_id
where c.type = 'cash' and c.is_main;

-- @@ Q03b_T4a_tenants_main_not_1110
select c.tenant_id, a.code as main_account_code
from cash_bank_accounts c join accounts a on a.id = c.account_id and a.tenant_id = c.tenant_id
where c.type = 'cash' and c.is_main and a.code <> '1110'
order by 1 limit 100;

-- @@ Q04_T4b_draft_cash_invoices_with_cash_account_id
select count(*) as draft_cash_invoices, count(distinct tenant_id) as tenants
from invoices where status = 'draft' and payment_type = 'cash' and cash_account_id is not null;

-- @@ Q05_T6a_open_pos_sessions_without_pinned_treasury
select count(*) as open_sessions,
       count(*) filter (where cash_account_id is null) as unpinned_sessions,
       count(distinct tenant_id) filter (where cash_account_id is null) as tenants_with_unpinned
from pos_sessions where status = 'open';

-- @@ Q05b_T6a_pinned_session_treasury_integrity
select count(*) filter (where a.id is null) as pinned_account_missing_or_foreign_tenant,
       count(*) filter (where a.id is not null and (a.is_active = false or a.is_group = true)) as pinned_gl_inactive_or_group,
       count(*) filter (where a.id is not null and c.id is null) as pinned_account_not_a_treasury,
       count(*) filter (where c.id is not null and c.is_active = false) as pinned_treasury_inactive
from pos_sessions s
left join accounts a on a.id = s.cash_account_id and a.tenant_id = s.tenant_id
left join cash_bank_accounts c on c.account_id = s.cash_account_id and c.tenant_id = s.tenant_id
where s.status = 'open' and s.cash_account_id is not null;

-- @@ Q06_T6b_active_cash_methods_linked_outside_1110
select count(*) as active_cash_methods,
       count(*) filter (where c.id is null) as unlinked_or_foreign,
       count(*) filter (where c.id is not null and c.type <> 'cash') as linked_to_bank_entity,
       count(*) filter (where a.code <> '1110') as linked_not_1110,
       count(distinct m.tenant_id) filter (where a.code <> '1110') as tenants_affected_at_activation
from payment_methods m
left join cash_bank_accounts c on c.id = m.cash_bank_account_id and c.tenant_id = m.tenant_id
left join accounts a on a.id = c.account_id and a.tenant_id = m.tenant_id
where m.settlement_type = 'cash' and m.is_active;

-- @@ Q07_returns_cash_posted_last_90d_by_source
-- أثر D-T6-2 عند التفعيل: standalone و credit_non_pos سيُرفضان (البديل رصيد ثم سند صرف)؛ linked_cash يُشتق؛ pos خزينة الجلسة.
select count(*) filter (where r.original_id is null and r.pos_session_id is null) as standalone_would_be_rejected,
       count(*) filter (where r.pos_session_id is null and r.original_id is not null and i.payment_type = 'credit') as credit_sourced_non_pos_would_be_rejected,
       count(*) filter (where r.pos_session_id is null and r.original_id is not null and i.payment_type = 'cash') as cash_sourced_routed_from_sale_treasury,
       count(*) filter (where r.pos_session_id is not null) as pos_returns_routed_from_session_treasury,
       count(distinct r.tenant_id) as tenants
from return_documents r
left join invoices i on i.id = r.original_id and i.tenant_id = r.tenant_id and r.original_type like '%Invoice'
where r.type = 'sales' and r.status = 'posted' and r.payment_type = 'cash' and r.created_at >= now() - interval '90 days';

-- @@ Q07b_credit_notes_cash_refund_posted_last_90d_by_source
select count(*) filter (where n.original_invoice_id is null) as standalone_would_be_rejected,
       count(*) filter (where n.original_invoice_id is not null and i.payment_type = 'credit') as credit_sourced_would_be_rejected,
       count(*) filter (where n.original_invoice_id is not null and i.payment_type = 'cash') as cash_sourced_routed_from_sale_treasury,
       count(distinct n.tenant_id) as tenants
from credit_notes n
left join invoices i on i.id = n.original_invoice_id and i.tenant_id = n.tenant_id
where n.type = 'sales' and n.status = 'posted' and n.refund_type = 'cash' and n.created_at >= now() - interval '90 days';

-- @@ Q08_T6_pos_invoices_collected_outside_the_session_treasury
-- فواتير POS حُصِّل نقدها في خزينة غير خزينة جلستها المثبَّتة ⇒ سيُرفض ردّها النقدي (refund_treasury_mismatch).
select count(distinct i.id) as pos_invoices_mismatch, count(distinct i.tenant_id) as tenants
from invoices i
join pos_sessions s on s.id = i.pos_session_id and s.tenant_id = i.tenant_id
join payments p on p.invoice_id = i.id and p.tenant_id = i.tenant_id
  and p.status = 'posted' and p.direction = 'received' and p.method = 'cash'
where s.cash_account_id is not null and (p.cash_account_id is null or p.cash_account_id <> s.cash_account_id);

-- @@ Q09_tenant_isolation_cross_references
select 'pos_sessions.cash_account_id' as reference, count(*) as cross_tenant_rows
  from pos_sessions s join accounts a on a.id = s.cash_account_id where a.tenant_id <> s.tenant_id
union all select 'payments.cash_account_id', count(*)
  from payments p join accounts a on a.id = p.cash_account_id where a.tenant_id <> p.tenant_id
union all select 'cash_bank_accounts.account_id', count(*)
  from cash_bank_accounts c join accounts a on a.id = c.account_id where a.tenant_id <> c.tenant_id
union all select 'payment_methods.cash_bank_account_id', count(*)
  from payment_methods m join cash_bank_accounts c on c.id = m.cash_bank_account_id where c.tenant_id <> m.tenant_id
union all select 'invoices.journal_entry_id', count(*)
  from invoices i join journal_entries e on e.id = i.journal_entry_id where e.tenant_id <> i.tenant_id
union all select 'journal_lines.journal_entry_id', count(*)
  from journal_lines l join journal_entries e on e.id = l.journal_entry_id where e.tenant_id <> l.tenant_id
union all select 'journal_lines.account_id', count(*)
  from journal_lines l join accounts a on a.id = l.account_id where a.tenant_id <> l.tenant_id;

-- @@ Q10_currency_treasuries_not_in_tenant_currency
select count(*) as treasuries_in_foreign_currency, count(distinct c.tenant_id) as tenants
from cash_bank_accounts c join tenants t on t.id = c.tenant_id
where upper(c.currency) <> upper(coalesce(t.currency, 'SAR'));

-- @@ Q11_unbalanced_posted_entries
select count(*) as unbalanced_entries from (
  select e.id from journal_entries e join journal_lines l on l.journal_entry_id = e.id
  where e.status in ('posted', 'reversed') group by e.id having sum(l.debit) <> sum(l.credit)) x;

-- @@ Q12_no_unintended_routing_since_deploy
-- بوابة مغلقة ⇒ المتوقع صفر: لا ردّ (مرتجع/إشعار/استبدال) دائن لخزينة غير 1110 منذ نشر T6.
select count(*) as refund_entries_credited_outside_1110
from journal_lines l
join journal_entries e on e.id = l.journal_entry_id
join cash_bank_accounts c on c.account_id = l.account_id and c.tenant_id = l.tenant_id
join accounts a on a.id = l.account_id
where l.credit > 0 and a.code <> '1110' and e.posted_at >= :'since'
  and (e.source_type like '%ReturnDocument' or e.source_type like '%CreditNote' or e.source_type like '%PosExchange');

ROLLBACK;
