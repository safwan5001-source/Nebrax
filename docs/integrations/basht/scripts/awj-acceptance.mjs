#!/usr/bin/env node
// AWJ x BASHT acceptance test. Node >= 18, no dependencies.
// Needs env AWJ_API_BASE and AWJ_API_KEY. Prints NO secrets. Safe to re-run: fixed Idempotency-Keys and
// fixed SKU / customer name; existing test records are reused (searched first), nothing is duplicated.
// Creates ONLY: 1 test product, 1 test customer, 1 DRAFT invoice. Never posts / pays / collects.
const BASE = (process.env.AWJ_API_BASE || '').replace(/\/$/, '');
const KEY = process.env.AWJ_API_KEY || '';
if (!BASE || !KEY) { console.error('Missing AWJ_API_BASE or AWJ_API_KEY'); process.exit(2); }

const SKU = 'BASHT-TEST-001', CUSTOMER = 'BASHT TEST CUSTOMER';
const results = [];
const rec = (n, ok, note) => { results.push({ n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${note ? ' - ' + note : ''}`); };

async function call(method, path, body, idem) {
  const headers = { Authorization: `Bearer ${KEY}`, Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (idem) headers['Idempotency-Key'] = idem;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, replayed: r.headers.get('Idempotency-Replayed') === 'true', json: j };
}
const list = (r) => (Array.isArray(r.json?.data) ? r.json.data : []);
const errOf = (r) => `HTTP ${r.status} ${r.json?.error?.code ?? ''}`.trim();

try {
  // 1. read five real products
  const p5 = await call('GET', '/products?per_page=5');
  const prods = list(p5);
  rec('1 read 5 real products', p5.status === 200 && prods.length > 0, p5.status === 200 ? `${prods.length} returned: ` + prods.map(p => `${p.sku ?? '-'}|${p.name}`).join(' ; ') : errOf(p5));

  // 2. find an existing customer
  const c5 = await call('GET', '/partners?type=customer&per_page=5');
  const custs = list(c5);
  rec('2 find existing customer', c5.status === 200 && custs.length > 0, c5.status === 200 ? custs.map(c => c.name).join(' ; ') : errOf(c5));

  // 3. create test product (search first, fixed idempotency key)
  let prod = list(await call('GET', `/products?search=${SKU}&per_page=5`)).find(p => p.sku === SKU);
  const created = !prod;
  if (!prod) {
    const r = await call('POST', '/products', { name: 'BASHT TEST - delete me', sku: SKU, sale_price_minor: 10000, tax_rate: 15 }, 'basht-test-product-001');
    prod = r.json?.data;
    rec('3 create test product', r.status === 201 && !!prod?.id, errOf(r));
    // 4. replay must not duplicate
    const r2 = await call('POST', '/products', { name: 'BASHT TEST - delete me', sku: SKU, sale_price_minor: 10000, tax_rate: 15 }, 'basht-test-product-001');
    const n = list(await call('GET', `/products?search=${SKU}&per_page=10`)).filter(p => p.sku === SKU).length;
    rec('4 replay does not duplicate', r2.replayed && r2.json?.data?.id === prod?.id && n === 1, `replayed=${r2.replayed} count=${n}`);
  } else {
    rec('3 create test product', true, 'already exists - reused (no duplicate created)');
    const n = list(await call('GET', `/products?search=${SKU}&per_page=10`)).filter(p => p.sku === SKU).length;
    rec('4 replay does not duplicate', n === 1, `count=${n}`);
  }

  // 5. test customer (search first)
  let cust = list(await call('GET', `/partners?type=customer&search=${encodeURIComponent(CUSTOMER)}&per_page=5`)).find(c => c.name === CUSTOMER);
  if (!cust) {
    const r = await call('POST', '/partners', { name: CUSTOMER, type: 'customer' }, 'basht-test-customer-001');
    cust = r.json?.data;
    rec('5 create test customer', r.status === 201 && !!cust?.id, errOf(r));
  } else rec('5 create test customer', true, 'already exists - reused');

  // 6. DRAFT invoice (fixed idempotency key => one invoice only)
  let inv = null;
  if (prod?.id && cust?.id) {
    const body = { partner_id: cust.id, payment_type: 'credit', notes: 'BASHT TEST - draft only', items: [{ product_id: prod.id, quantity: 1, unit_price_minor: 10000, tax_rate: 15 }] };
    const r = await call('POST', '/invoices', body, 'basht-test-invoice-001');
    inv = r.json?.data;
    rec('6 create DRAFT sales invoice', (r.status === 201 || r.replayed) && inv?.status === 'draft', `${inv?.number ?? ''} status=${inv?.status} total_minor=${inv?.total_minor} replayed=${r.replayed} ${r.status === 201 || r.replayed ? '' : errOf(r)}`);
  } else rec('6 create DRAFT sales invoice', false, 'missing product/customer');

  // 7. statement
  if (cust?.id) {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    const s = await call('GET', `/partners/${cust.id}/statement?from=${from}&to=${to}`);
    const d = s.json?.data;
    rec('7 customer statement', s.status === 200 && !!d, s.status === 200 ? `rows=${d.rows?.length} opening=${d.opening_balance_minor} closing=${d.closing_balance_minor}` : errOf(s));
    // 8. draft => no ledger effect visible: statement shows no movement for the test customer
    rec('8 draft created no accounting entry (statement empty/zero)', s.status === 200 && (d?.rows?.length ?? 1) === 0 && d?.closing_balance_minor === 0, 'API-side check; DB-side check: see report section 5');
  } else { rec('7 customer statement', false, 'no customer'); rec('8 no accounting entry', false, 'no customer'); }
} catch (e) { console.error('ERROR', e.name, e.message); process.exitCode = 1; }

const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : process.exitCode || 0);
