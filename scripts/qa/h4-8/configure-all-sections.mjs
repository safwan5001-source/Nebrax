import { browser, login, WEB, OUT, SEED, API, log } from './lib.mjs';
import { execSync } from 'node:child_process';
function clear() { execSync('cd /home/user/nibras-app && php artisan cache:clear', { stdio: 'ignore' }); }
clear();
const tok = (await (await fetch(`${API}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email: SEED.email, password: SEED.password }) })).json()).token;
const api = (m, p, body) => fetch(`${API}/api/commerce/workspace/storefronts/${SEED.storefrontA}${p}`, { method: m, headers: { Authorization: `Bearer ${tok}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const vs = (await api('GET', '/presentation/versions')).json;
const draft = vs.data.find(v => v.state === 'draft'); const full = (await api('GET', `/presentation/versions/${draft.id}`)).json.data;
const cfg = full.config; log('apps:', JSON.stringify(cfg.apps));
const secs = cfg.homepage.sections; const set = (id, patch) => Object.assign(secs.find(x => x.id === id), patch);
set('banner', { visible: true, content: { title: 'تخفيضات الخريف', subtitle: 'عروض حقيقية على منتجات مختارة', ctaLabel: 'تسوق الآن', ctaHref: '/products', imageUrl: null } });
set('featured', { visible: true, content: { productIds: [SEED.products.C, SEED.products.A, SEED.products.D, 'not a valid id!'] } });
set('benefits', { visible: true, content: { items: [{ id: 'b1', title: 'شحن سريع', body: 'خلال ٢٤ ساعة' }, { id: 'b2', title: 'دفع آمن', body: 'بوابات موثوقة' }] } });
set('customContent', { visible: true, content: { blocks: [{ id: 'c1', kind: 'heading', text: 'عن متجرنا' }, { id: 'c2', kind: 'paragraph', text: 'نص حر محكوم.' }] } });
set('appPromo', { visible: true });
cfg.apps = { ...cfg.apps, iosUrl: 'https://apps.apple.com/sa/app/id123456789', androidUrl: 'https://play.google.com/store/apps/details?id=sa.h48.qa', appName: 'متجر QA', showHomepageSection: true, showFooterLinks: true };
if (cfg.apps && typeof cfg.apps === 'object') { for (const k of Object.keys(cfg.apps)) if (/url/i.test(k) || /ios|android|apple|google/i.test(k)) cfg.apps[k] = cfg.apps[k] ?? null; }
const put = await api('PUT', `/presentation/versions/${draft.id}`, { config: cfg, revision: full.revision }); log('PUT', put.status, put.json?.data?.revision ?? JSON.stringify(put.json).slice(0, 300));
const after = (await api('GET', `/presentation/versions/${draft.id}`)).json.data; const hs = after.config.homepage.sections;
log('persisted featured ids:', JSON.stringify(hs.find(x => x.id === 'featured').content?.productIds?.map(i => i === SEED.products.C ? 'C' : i === SEED.products.A ? 'A' : i === SEED.products.D ? 'D' : i)), '(bogus dropped by normalizer:', !JSON.stringify(hs).includes('not a valid'), ')');
log('persisted offers content (no commerce data):', JSON.stringify(hs.filter(x => x.type === 'offers').map(x => x.content)));
const noCommerce = !/amount_minor|offer_price|discount|reference_price|thumbnail|stock/i.test(JSON.stringify(hs)); log('no commerce facts in presentation JSON:', noCommerce);
const head = (await api('GET', '/presentation/versions')).json.data; const pub = head.find(v => v.state === 'published');
const pr = await api('POST', `/presentation/versions/${draft.id}/publish`, { revision: after.revision, expected_published_revision: pub?.published_revision ?? null, expected_active_version_id: pub?.id ?? null }); log('PUBLISH', pr.status, pr.json?.data?.state ?? JSON.stringify(pr.json).slice(0, 300));
