/* اختبار آلي لنموذج الوضع السهل V2 — Playwright (Chromium)
   التشغيل:  NODE_PATH=$(npm root -g) node tests/run.js   [SHOTS_DIR=مسار لقطات اختياري]
   يغطي: سطح 1440، ثلاثة أعمدة 1100، عمودان 1050، آيباد أفقي 1194 و1080، آيباد عمودي 834 و744،
   جوال 390 عمودي و844×390 أفقي (لمس). لا يتصل بأي خادم. */
const { chromium } = require('playwright');
const path = require('path'), os = require('os'), fs = require('fs');
const FILE = 'file://' + path.resolve(__dirname, '..', 'index.html');
const D = (process.env.SHOTS_DIR || path.join(os.tmpdir(), 'awj-easy-mode-v2-shots')) + path.sep; fs.mkdirSync(D, { recursive: true });
const R = []; const ok = (n, c, x = '') => R.push((c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  [' + x + ']' : ''));
const txt = async (p, s) => (await p.locator(s).first().innerText().catch(() => '')) || '';
async function a11y(p, label) {
  const bad = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll('button').forEach(b => { if (b.offsetParent === null) return; const n = (b.getAttribute('aria-label') || b.textContent || '').trim(); if (!n) out.push('button:' + b.outerHTML.slice(0, 80)); });
    document.querySelectorAll('input,select,textarea').forEach(i => { if (i.offsetParent === null && i.type !== 'checkbox') return; if (i.type === 'hidden') return; const has = i.getAttribute('aria-label') || (i.id && document.querySelector('label[for="' + i.id + '"]')) || i.closest('label'); if (!has) out.push('field:' + i.outerHTML.slice(0, 80)); });
    return out;
  });
  ok('a11y: كل الأزرار والحقول بأسماء وصول (' + label + ')', bad.length === 0, bad.slice(0, 3).join(' | '));
}
async function boot(p) { await p.goto(FILE); await p.waitForTimeout(250); await p.click('text=إنشاء تطبيقي'); await p.waitForSelector('#screen', { timeout: 8000 }); await p.waitForTimeout(200); }
(async () => {
  const b = await chromium.launch(); const errs = [];
  const watch = (p, tag) => { p.on('pageerror', e => errs.push(tag + ' pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR|Failed to load resource/.test(m.text())) errs.push(tag + ' console: ' + m.text()); }); };

  /* ================= سطح المكتب 1440 ================= */
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar-SA' }); const p = await ctx.newPage(); watch(p, 'D');
  await p.goto(FILE); await p.waitForTimeout(250); await p.screenshot({ path: D + 'd01-create.png' });
  await p.click('text=إنشاء تطبيقي'); await p.waitForSelector('#screen', { timeout: 8000 }); await p.waitForTimeout(250);
  await p.screenshot({ path: D + 'd02-entry-preview-first.png' });
  ok('المعاينة نقطة الدخول: تظهر المعاينة والتطبيق جاهز', await p.locator('#screen .sx').count() === 3);
  ok('المفتش فارغ «اضغط أي عنصر»', (await txt(p, '#insp')).includes('اضغط أي عنصر في المعاينة'));
  ok('ثلاثة أعمدة ظاهرة (مستكشف/معاينة/مفتش)', await p.locator('#navp').isVisible() && await p.locator('#stage').isVisible() && await p.locator('#insp').isVisible());
  ok('الحالة الأولية محفوظ + حفظ معطّل', (await txt(p, '#status')).includes('محفوظ') && await p.locator('#savebtn').isDisabled());
  ok('لا تمرير أفقي (1440)', await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);
  await a11y(p, '1440');

  // التحرير بالضغط على العنصر داخل المعاينة
  await p.click('#screen .sx:nth-child(2)'); await p.waitForTimeout(150);
  ok('الضغط على عنصر المعاينة يحدده', await p.locator('#screen .sx.on').count() === 1 && (await txt(p, '#insp-title')) === 'منتجاتنا');
  ok('الصف يُبرز في القائمة', await p.locator('#seclist .row.sel .nm').innerText() === 'منتجاتنا');
  ok('الشريط العائم يظهر على المحدد', await p.locator('#screen .sx.on .ftb').count() === 1);
  await p.screenshot({ path: D + 'd03-selected.png' });
  await p.fill('#insp [data-fld="title"]', 'الأكثر مبيعاً'); await p.waitForTimeout(100);
  ok('المعاينة فورية مع الكتابة', await p.locator('#screen h3', { hasText: 'الأكثر مبيعاً' }).count() === 1);
  ok('مؤشر تغييرات غير محفوظة', (await txt(p, '#status')).includes('غير محفوظة') && await p.locator('#savebtn').isEnabled());
  ok('المفتش لم يفقد التركيز أثناء الكتابة', await p.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-fld') === 'title'));
  ok('ترتيب المنتجات موسوم مقترح ومعطّل', await p.locator('#insp .badge.proposed').count() >= 1 && await p.locator('#insp input[disabled]').count() >= 1);

  // شريط عائم: أعلى
  await p.click('#screen .sx.on .ftb [data-act="up"]'); await p.waitForTimeout(150);
  ok('الشريط العائم ينقل القسم لأعلى', (await p.locator('#seclist .row .nm').allInnerTexts())[0] === 'الأكثر مبيعاً'.replace('الأكثر مبيعاً', (await p.locator('#seclist .row .nm').first().innerText())) && (await p.locator('#seclist .row .nm').first().innerText()) === 'منتجاتنا');
  ok('القسم يبقى محدداً بعد النقل', await p.locator('#screen .sx.on').count() === 1);
  // إخفاء/إظهار
  await p.click('#screen .sx.on .ftb [data-act="vis"]'); await p.waitForTimeout(150);
  ok('الإخفاء يزيله من المعاينة ويعلّمه في القائمة', await p.locator('#screen .sx').count() === 2 && await p.locator('#seclist .row.hid').count() === 1);
  await p.click('#undo'); await p.waitForTimeout(150);
  ok('التراجع يعيد القسم', await p.locator('#screen .sx').count() === 3);
  await p.click('#redo'); await p.click('#undo'); await p.waitForTimeout(100);
  // تكرار وحذف + تراجع
  await p.click('#screen .sx.on .ftb [data-act="dup"]'); await p.waitForTimeout(150);
  ok('التكرار يضيف قسماً ويحدده', await p.locator('#seclist .row').count() === 4 && (await txt(p, '#insp-title')).includes('نسخة'));
  await p.click('#insp [data-act="del"]'); await p.waitForTimeout(150);
  ok('الحذف يزيل القسم', await p.locator('#seclist .row').count() === 3);
  await p.click('.toast button:has-text("تراجع")'); await p.waitForTimeout(150);
  ok('«تراجع» في الإشعار يعيد المحذوف', await p.locator('#seclist .row').count() === 4);
  await p.keyboard.press('Control+z'); await p.waitForTimeout(100); await p.keyboard.press('Control+z'); await p.waitForTimeout(100);
  // لوحة مفاتيح: تحديد
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  ok('Esc يلغي التحديد', await p.locator('#screen .sx.on').count() === 0 && (await txt(p, '#insp')).includes('اضغط أي عنصر'));
  await p.focus('#screen .sx:nth-child(1)'); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
  ok('لوحة المفاتيح: Enter على عنصر المعاينة يحدده', await p.locator('#screen .sx.on').count() === 1);
  await p.click('#screen .a-body', { position: { x: 4, y: 4 } }).catch(() => {}); await p.keyboard.press('Escape');

  // ترتيب القائمة: مؤشر
  const before = await p.locator('#seclist .row .nm').allInnerTexts();
  const rows = p.locator('#seclist .row'); const g = await rows.nth(0).locator('.grip').boundingBox(); const t = await rows.nth(2).boundingBox();
  await p.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await p.mouse.down(); await p.mouse.move(g.x + g.width / 2, t.y + t.height - 4, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(200);
  const after = await p.locator('#seclist .row .nm').allInnerTexts();
  ok('سحب المقبض يعيد الترتيب', JSON.stringify(before) !== JSON.stringify(after), before.join('|') + ' => ' + after.join('|'));
  ok('المعاينة تعكس الترتيب الجديد', (await p.locator('#screen .sx .lbl').allInnerTexts()).map(s => s.split(' · ')[0]).join('|') === after.join('|'));
  await p.focus('#seclist .row:first-child .grip'); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(150);
  ok('لوحة المفاتيح تحرك الصف', (await p.locator('#seclist .row .nm').first().innerText()) !== after[0]);

  // الكتالوج
  await p.click('#seclist .row:nth-child(1) .main'); await p.waitForTimeout(100);
  const selName = await txt(p, '#insp-title');
  await p.click('#navp .add'); await p.waitForSelector('.cat');
  ok('الكتالوج: 17 نوعاً', await p.locator('.cat .ct').count() === 17);
  await p.screenshot({ path: D + 'd04-catalog.png' });
  await p.click('[data-act="catf"][data-v="products"]'); ok('تصنيف المنتجات يصفّي', await p.locator('.cat .ct').count() === 3, 'count=' + await p.locator('.cat .ct').count());
  await p.click('[data-act="catf"][data-v="all"]'); await p.click('[data-act="cats"][data-v="proposed"]'); ok('تصفية الحالة «مقترح»', await p.locator('.cat .ct').count() === 10, 'count=' + await p.locator('.cat .ct').count());
  await p.click('[data-act="cats"][data-v="all"]'); await p.fill('#catq', 'سلايدر'); await p.waitForTimeout(100); ok('البحث بالنص', await p.locator('.cat .ct').count() === 1);
  await p.click('.ct[data-v="slider"]'); await p.waitForSelector('#catnote'); ok('نوع مقترح يعرض متطلبه', (await txt(p, '#catnote')).includes('Carousel'));
  await p.screenshot({ path: D + 'd05-catalog-proposed.png' });
  await p.click('[data-act="catadd"]'); await p.waitForTimeout(250);
  ok('أُضيف المقترح ومُحدد وموسوم في المعاينة', await p.locator('#screen .sx.on .a-prop').count() === 1);
  const names = await p.locator('#seclist .row .nm').allInnerTexts(); ok('أُدرج بعد القسم المحدد', names[1] === 'سلايدر صور', names.join('|'));
  let c = await p.evaluate(() => window.__proto.compat()); ok('المقترح يمنع النشر', c.block.length >= 1);
  await p.locator('#insp .sw:has(input[data-fld="__opt"])').click(); await p.waitForTimeout(100);
  c = await p.evaluate(() => window.__proto.compat()); ok('جعله اختيارياً يرفع المنع ويبقي تنبيهاً (سلوك optional)', c.block.length === 0 && c.warn.some(w => w.includes('اختياري')), 'block=' + c.block.length);
  await p.keyboard.press('Escape'); await p.click('#navp .add'); await p.waitForSelector('.cat'); await p.click('.ct[data-v="text"]'); await p.waitForTimeout(200);
  ok('إضافة نوع جاهز تحدده وتفتح المفتش', await p.locator('#screen .sx.on').count() === 1 && (await txt(p, '#insp-title')) === 'نص');

  // الصفحات منفصلة عن الأقسام
  await p.click('.ptabs [data-v="pages"]'); await p.waitForTimeout(100);
  await p.click('.pgrow[data-v="categories"]'); await p.waitForTimeout(150);
  ok('صفحة مقترحة: تصوّر موسوم في المعاينة', await p.locator('#screen .a-ghost').count() === 1 && (await txt(p, '#screen .a-ghost')).includes('تصوّر'));
  await p.click('.ptabs [data-v="pages"]'); await p.click('.pgrow[data-v="product"]'); await p.waitForTimeout(150);
  ok('شاشة المنتج الأصلية: عرض فقط', (await txt(p, '#screen .a-ghost')).includes('عرض فقط') && (await txt(p, '#navp')).includes('لا أقسام قابلة للتحرير'));
  await p.screenshot({ path: D + 'd06-native-page.png' });
  await p.click('.ptabs [data-v="pages"]'); await p.click('.pgrow[data-v="home"]'); await p.waitForTimeout(100);
  await p.click('.ptabs [data-v="pages"]');
  await p.locator('.sw:has(input[data-nv="enabled"])').click(); await p.waitForTimeout(150);
  ok('التبويبات السفلية (مقترح): تظهر في المعاينة وتمنع النشر', await p.locator('#screen .a-tabs').count() === 1 && (await p.evaluate(() => window.__proto.compat())).block.some(x => x.includes('التنقل السفلي')));
  await p.locator('.sw:has(input[data-tab="t5"][data-tk="visible"])').click(); await p.waitForTimeout(100);
  ok('خمسة تبويبات ظاهرة مسموحة', await p.locator('#screen .a-tabs > div').count() === 5);
  await p.screenshot({ path: D + 'd07-pages-nav.png' });
  await p.locator('.sw:has(input[data-nv="enabled"])').click();

  // الهوية
  await p.click('.ptabs [data-v="identity"]'); await p.waitForTimeout(100);
  await p.click('.swc button[data-v="#7C3AED"]'); await p.waitForTimeout(150);
  ok('اللون يغيّر المعاينة فوراً', (await p.evaluate(() => getComputedStyle(document.querySelector('#screen .app')).getPropertyValue('--ap'))).trim().toLowerCase() === '#7c3aed');
  ok('عناصر الهوية المقترحة موسومة ومعطّلة', await p.locator('#navp .badge.proposed').count() >= 4 && await p.locator('#navp input[disabled]').count() >= 1);
  await p.screenshot({ path: D + 'd08-identity.png' });
  await p.click('.ptabs [data-v="sections"]');

  // الجهاز والاتجاه
  await p.click('[data-act="dev"][data-v="t768"]'); await p.waitForTimeout(100);
  ok('عرض التابلت 768', await p.evaluate(() => document.querySelector('.phone').getBoundingClientRect().width) > 700);
  await p.click('[data-act="dev"][data-v="p360"]'); ok('جوال صغير 360', await p.evaluate(() => Math.round(document.querySelector('.phone').getBoundingClientRect().width)) === 380);
  await p.click('[data-act="dev"][data-v="p390"]');
  await p.click('[data-act="dir"]'); await p.waitForTimeout(100);
  ok('RTL ← LTR', await p.evaluate(() => document.querySelector('#screen .app').getAttribute('dir')) === 'ltr' && await p.evaluate(() => getComputedStyle(document.querySelector('#screen .app')).direction) === 'ltr');
  await p.click('[data-act="dir"]');

  // الحفظ وحالاته
  ok('غير محفوظ قبل الحفظ', (await txt(p, '#status')).includes('غير محفوظة'));
  await p.click('#savebtn'); await p.waitForTimeout(150); ok('جارٍ الحفظ', (await txt(p, '#status')).includes('جارٍ'));
  await p.waitForTimeout(900); ok('محفوظ بعد النجاح', (await txt(p, '#status')).includes('محفوظ') && await p.locator('#savebtn').isDisabled());
  await p.click('[data-act="more"]'); await p.click('[data-act="failnext"]'); await p.waitForTimeout(100);
  await p.click('#seclist .row:has-text("ترحيب") .main'); await p.fill('#insp [data-fld="title"]', 'عنوان جديد'); await p.waitForTimeout(100);
  await p.click('#savebtn'); await p.waitForTimeout(1000);
  ok('فشل الحفظ: رسالة صريحة وإعادة محاولة', (await txt(p, '#status')).includes('فشل الحفظ') && await p.locator('#status [data-act="save"]').count() === 1);
  ok('فشل الحفظ لا يفقد التعديلات', await p.locator('#screen h3', { hasText: 'عنوان جديد' }).count() >= 1 && await p.evaluate(() => window.__proto.isDirty()));
  await p.screenshot({ path: D + 'd09-save-failed.png' });
  await p.click('#status [data-act="save"]'); await p.waitForTimeout(1000);
  ok('إعادة المحاولة تنجح', (await txt(p, '#status')).includes('محفوظ'));

  // جاهزية النشر
  await p.click('[data-act="more"]'); await p.click('[data-act="pubcheck"]'); await p.waitForSelector('.note');
  ok('نشر تجريبي متاح عند عدم وجود موانع وبعد الحفظ', await p.locator('[data-act="pubfake"]').isEnabled(), (await p.evaluate(() => window.__proto.compat())).block.join(';'));
  await p.keyboard.press('Escape');

  // ===== سلامة البيانات بين الوضعين =====
  await p.click('#seclist .row:has-text("منتجاتنا") .main'); await p.waitForTimeout(100);
  const prodId = await p.evaluate(() => window.__proto.ui.sel);
  await p.click('.seg-d [data-v="advanced"]'); await p.waitForTimeout(200);
  ok('المتقدم: يحتفظ بالتحديد ويعرض شجرة المخطط', await p.locator('.tree button').count() > 3 && await p.evaluate(() => window.__proto.ui.advNode) === prodId);
  await p.click('.tree button:has-text("ProductList")'); await p.waitForTimeout(100);
  await p.selectOption('#insp select[data-afld="sort"]', '-created_at'); await p.waitForTimeout(150);
  ok('المتقدم: ضبط binding.query.sort', (await p.evaluate(() => JSON.stringify(window.__proto.schema()))).includes('"sort":"-created_at"'));
  ok('المتقدم يوسم الحالة غير محفوظة (المسودة نفسها)', (await txt(p, '#status')).includes('غير محفوظة'));
  await p.screenshot({ path: D + 'd10-advanced.png' });
  await p.click('.ptabs [data-v="json"]'); await p.waitForTimeout(100);
  ok('JSON يعرض sort وبذور السجل الحقيقي', (await txt(p, '#jsonpre')).includes('"sort": "-created_at"') && (await txt(p, '#jsonpre')).includes('commerce.products') && (await txt(p, '#jsonpre')).includes('openProduct'));
  await p.click('.ptabs [data-v="tree"]');
  await p.click('.seg-d [data-v="easy"]'); await p.waitForTimeout(200);
  ok('العودة للسهل: يبقى القسم محدداً', (await txt(p, '#insp-title')) === 'منتجاتنا');
  ok('السهل يعرض «مضبوط من الوضع المتقدم» ولا يمسحه', (await txt(p, '#insp')).includes('sort=-created_at'));
  await p.fill('#insp [data-fld="title"]', 'عنوان بعد الرجوع'); await p.waitForTimeout(100);
  await p.click('.seg-d [data-v="advanced"]'); await p.waitForTimeout(200); await p.click('.ptabs [data-v="json"]'); await p.waitForTimeout(100);
  const j = await txt(p, '#jsonpre'); ok('ذهاب وعودة: sort وعنوان السهل كلاهما باقيان', j.includes('"sort": "-created_at"') && j.includes('عنوان بعد الرجوع'));
  ok('تنبيه التوافق: الترتيب لن يُطبَّق في Runtime', (await p.evaluate(() => window.__proto.compat())).warn.some(w => w.includes('لن يُطبَّق')));
  await p.click('.ptabs [data-v="tree"]'); await p.click('.tree button:has-text("Text")').catch(() => {});
  // تحرير نص في المتقدم ثم الظهور في السهل
  await p.click('#navp [data-act="page"][data-v="home"]'); await p.waitForTimeout(100);
  const textNode = p.locator('.tree button', { hasText: /^Text/ }).first(); await textNode.click(); await p.waitForTimeout(120);
  await p.fill('#insp [data-afld="text"]', 'نص من المتقدم'); await p.waitForTimeout(120);
  await p.click('.seg-d [data-v="easy"]'); await p.waitForTimeout(150);
  ok('تعديل المتقدم يظهر في المعاينة والسهل', await p.locator('#screen p', { hasText: 'نص من المتقدم' }).count() === 1 && await p.locator('#insp [data-fld="text"]').inputValue() === 'نص من المتقدم');
  ok('لا فقد: عدد الأقسام ثابت', await p.locator('#seclist .row').count() >= 4);
  // تراجع عبر الوضعين
  await p.click('#undo'); await p.click('#undo'); await p.waitForTimeout(120);
  ok('التراجع يعمل عبر الوضعين', await p.locator('#screen p', { hasText: 'نص من المتقدم' }).count() === 0);

  // الداكن
  await p.click('[data-act="more"]'); await p.click('[data-act="theme"]'); await p.waitForTimeout(150); await p.screenshot({ path: D + 'd11-dark.png' });
  ok('وضع المحرر الداكن', await p.evaluate(() => document.documentElement.classList.contains('dark')));
  await a11y(p, '1440 بعد التفاعل');
  ok('لا أخطاء console (سطح المكتب)', errs.filter(e => e.startsWith('D')).length === 0, errs.filter(e => e.startsWith('D')).join(' ; '));

  /* ================= 1100: ثلاثة أعمدة ================= */
  const tctx = await b.newContext({ viewport: { width: 1100, height: 800 } }); const tp = await tctx.newPage(); watch(tp, 'T'); await boot(tp);
  ok('1100: ثلاثة أعمدة ظاهرة معاً (مستكشف/معاينة/مفتش)', await tp.locator('#navp').isVisible() && await tp.locator('#stage').isVisible() && await tp.locator('#insp').isVisible());
  await tp.click('#screen .sx:nth-child(2)'); await tp.waitForTimeout(150);
  ok('1100: التحديد لا يخفي المستكشف', await tp.locator('#navp').isVisible() && await tp.locator('#insp-title').isVisible());
  ok('1100: زر الرجوع مخفي (المفتش دائم)', !(await tp.locator('#insp .back').isVisible()));
  ok('1100: إطار الجهاز كامل داخل المعاينة بلا اقتطاع', await tp.evaluate(() => { const f = document.querySelector('.phone').getBoundingClientRect(), s = document.querySelector('#stage').getBoundingClientRect(); return f.left >= s.left - 1 && f.right <= s.right + 1; }));
  ok('1100: لا تمرير أفقي', await tp.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);
  await tp.screenshot({ path: D + 't01-1100-three-cols.png' });
  ok('لا أخطاء console (1100)', errs.filter(e => e.startsWith('T')).length === 0, errs.filter(e => e.startsWith('T')).join(' ; '));

  /* ================= 1050: عمودان ================= */
  const mctx = await b.newContext({ viewport: { width: 1050, height: 800 } }); const mp = await mctx.newPage(); watch(mp, 'M'); await boot(mp);
  ok('1050: عمودان، المستكشف ظاهر والمفتش مخفي', await mp.locator('#navp').isVisible() && !(await mp.locator('#insp').isVisible()));
  await mp.click('#screen .sx:nth-child(2)'); await mp.waitForTimeout(150);
  ok('1050: التحديد يبدّل المفتش مكان المستكشف', await mp.locator('#insp').isVisible() && !(await mp.locator('#navp').isVisible()));
  ok('1050: زر الرجوع ظاهر', await mp.locator('#insp .back').isVisible());
  await mp.screenshot({ path: D + 'm01-1050-selected.png' });
  await mp.click('#insp .back'); await mp.waitForTimeout(100);
  ok('1050: الرجوع يعيد المستكشف', await mp.locator('#navp').isVisible() && !(await mp.locator('#insp').isVisible()));
  ok('1050: لا تمرير أفقي', await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);
  ok('لا أخطاء console (1050)', errs.filter(e => e.startsWith('M')).length === 0, errs.filter(e => e.startsWith('M')).join(' ; '));

  /* ================= جوال 390 ================= */
  const jctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'ar-SA' }); const m = await jctx.newPage(); watch(m, 'J');
  await m.goto(FILE); await m.waitForTimeout(250); await m.screenshot({ path: D + 'j01-create.png' });
  await m.tap('text=إنشاء تطبيقي'); await m.waitForSelector('#screen', { timeout: 8000 }); await m.waitForTimeout(250);
  await m.screenshot({ path: D + 'j02-entry.png' });
  ok('جوال: المعاينة بملء الشاشة بلا إطار هاتف', await m.locator('.stage.flat').count() === 1 && await m.evaluate(() => getComputedStyle(document.querySelector('.phone')).borderTopWidth) === '0px');
  ok('جوال: شريط سفلي ظاهر، والمستكشف/المفتش مغلقان', await m.locator('.bbar').isVisible() && !(await m.locator('#navp').isVisible()) && !(await m.locator('#insp').isVisible()));
  ok('جوال: لا تمرير أفقي', await m.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);
  ok('جوال: أهداف اللمس ≥ 36px في الأزرار الرئيسية', await m.evaluate(() => [...document.querySelectorAll('.bbar button,#savebtn,.modebar button')].every(b => b.getBoundingClientRect().height >= 36)));
  await m.tap('#screen .sx:nth-child(2)'); await m.waitForTimeout(250);
  ok('جوال: لمس العنصر يفتح ورقة المفتش وتبقى المعاينة ظاهرة', await m.locator('#insp.open').count() === 1 && await m.locator('#screen').isVisible());
  const vis = await m.evaluate(() => { const el = document.querySelector('.sx.on'); const r = el.getBoundingClientRect(); const ins = document.querySelector('#insp').getBoundingClientRect(); return r.bottom <= ins.top + 4 && r.top >= 0; });
  ok('جوال: العنصر المحدد ظاهر فوق الورقة (لا تحجبه)', vis);
  await m.screenshot({ path: D + 'j03-selected-sheet.png' });
  await m.fill('#insp [data-fld="title"]', 'تعديل جوال'); await m.waitForTimeout(100);
  ok('جوال: المعاينة تتحدث خلف الورقة', await m.locator('#screen h3', { hasText: 'تعديل جوال' }).count() === 1);
  ok('جوال: مؤشر غير محفوظ مختصر', (await txt(m, '#status')).includes('غير محفوظ'));
  await m.tap('#insp [data-act="back"] >> nth=-1'); await m.waitForTimeout(150);
  ok('جوال: إغلاق الورقة يلغي التحديد', !(await m.locator('#insp').isVisible()));
  await m.tap('.bbar [data-v="sections"]'); await m.waitForTimeout(200);
  ok('جوال: ورقة الأقسام', await m.locator('#navp.open').count() === 1 && await m.locator('#seclist .row').count() === 3);
  await m.screenshot({ path: D + 'j04-sections-sheet.png' });
  await m.tap('#seclist .row:nth-child(3) .main'); await m.waitForTimeout(250);
  ok('جوال: اختيار قسم من القائمة يفتح المفتش', await m.locator('#insp.open').count() === 1 && !(await m.locator('#navp').isVisible()));
  await m.tap('#insp [data-act="back"] >> nth=-1'); await m.waitForTimeout(120);
  await m.tap('.bbar [data-act="add"]'); await m.waitForSelector('.cat'); await m.waitForTimeout(200);
  await m.screenshot({ path: D + 'j05-catalog.png' });
  ok('جوال: كتالوج بلا تمرير أفقي', await m.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);
  await m.tap('.ct[data-v="hero"]'); await m.waitForTimeout(300);
  ok('جوال: إضافة من الكتالوج تحدد القسم الجديد', await m.locator('#screen .sx.on').count() === 1 && await m.locator('#insp.open').count() === 1);
  await m.tap('#insp [data-act="back"] >> nth=-1');
  await m.tap('.bbar [data-v="pages"]'); await m.waitForTimeout(200); await m.tap('.pgrow[data-v="account"]'); await m.waitForTimeout(250);
  ok('جوال: تبديل الصفحة من الورقة', await m.locator('#screen .a-ghost').count() === 1);
  await m.screenshot({ path: D + 'j06-page-proposed.png' });
  await m.tap('.modebar [data-v="advanced"]'); await m.waitForTimeout(250);
  ok('جوال: المتقدم يعمل ويحتفظ بالبيانات', await m.evaluate(() => window.__proto.doc.pages.home.length) === 4);
  await m.screenshot({ path: D + 'j07-advanced.png' });
  await a11y(m, '390');
  ok('لا أخطاء console (جوال)', errs.filter(e => e.startsWith('J')).length === 0, errs.filter(e => e.startsWith('J')).join(' ; '));

  /* ================= قوالب البداية + عنوان فرعي + افتراضيات (سطح المكتب، مؤشر دقيق) ================= */
  const nctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar-SA' }); const n = await nctx.newPage(); watch(n, 'N');
  await n.goto(FILE); await n.waitForTimeout(250);
  ok('القوالب: ثلاث بطاقات والأساسي محدد افتراضياً', await n.locator('.tp').count() === 3 && await n.locator('.tp[data-v="basic"][aria-pressed="true"]').count() === 1);
  ok('القوالب: ملاحظة أن الاستراتيجية قرار مفتوح', (await txt(n, '.crt')).includes('قرار مفتوح'));
  await n.screenshot({ path: D + 'n01-templates-default.png' });
  await n.fill('#newname', 'متجر العروض'); await n.click('.tp[data-v="offers"]'); await n.waitForTimeout(120);
  ok('القوالب: اختيار قالب يحدّثه ويحدّث ما سيُجهَّز', await n.locator('.tp[data-v="offers"][aria-pressed="true"]').count() === 1 && (await txt(n, '#tplines')).includes('بنر ترويجي'));
  ok('القوالب: اسم التطبيق يبقى بعد إعادة العرض', await n.inputValue('#newname') === 'متجر العروض');
  ok('القوالب: التركيز يبقى على البطاقة المختارة', await n.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-v') === 'offers'));
  await n.screenshot({ path: D + 'n02-templates-offers.png' });
  await n.click('text=إنشاء تطبيقي'); await n.waitForSelector('#screen', { timeout: 8000 }); await n.waitForTimeout(250);
  ok('قالب العروض: بنر + منتجات + نص، ولون الهوية الدافئ', await n.evaluate(() => window.__proto.doc.pages.home.map(x => x.type).join(',')) === 'hero,products,text' && await n.evaluate(() => window.__proto.doc.primary) === '#B45309');
  ok('قالب العروض: لا مكوّنات مقترحة (لا منع نشر)', (await n.evaluate(() => window.__proto.compat())).block.length === 0);
  ok('قالب العروض: بنر بلا صورة = تنبيه لا منع', (await n.evaluate(() => window.__proto.compat())).warn.some(w => w.includes('بلا رابط صورة')));
  await n.screenshot({ path: D + 'n03-offers-editor.png' });
  const subs = await n.locator('#seclist .row .sb').allInnerTexts();
  ok('عنوان فرعي مشتق لكل صف', subs.length === 3 && subs.every(x => x.trim().length > 0), subs.join(' | '));
  ok('عنوان البنر الفرعي يعكس العنوان والوجهة', subs[0].includes('عروض الموسم') && subs[0].includes('السلة'));
  await n.click('#seclist .row:has-text("منتجاتنا") .main'); await n.waitForTimeout(100);
  ok('رأس المفتش يعرض النوع والعنوان الفرعي', (await txt(n, '#insp-sub')).includes('قائمة منتجات') && (await txt(n, '#insp-sub')).includes('منتجات حيّة'));
  await n.click('#insp [data-act="dup"]'); await n.waitForTimeout(150);
  const ords = await n.locator('#seclist .row .ty .num').allInnerTexts();
  ok('الأقسام المتكررة النوع تحمل ترتيباً 1/2 و2/2', ords.join(',') === '1/2,2/2', ords.join(','));
  await n.fill('#insp [data-fld="title"]', 'وصل حديثاً'); await n.waitForTimeout(100);
  const subs2 = await n.locator('#seclist .row .sb').allInnerTexts();
  ok('العنوان الفرعي يتحدث مع الكتابة ويميّز النسختين', subs2[1] !== subs2[2] && subs2.some(x => x.includes('وصل حديثاً')), subs2.join(' | '));
  const sj = await n.evaluate(() => JSON.stringify(window.__proto.schema()));
  ok('AppSchema لم يتغير شكله: لا عنوان فرعي ولا ترتيب في المخطط', !sj.includes('subtitle') && !sj.includes('منتجات حيّة') && !sj.includes('1/2'));
  ok('الإجماليات: المخطط يحتوي الأقسام المعروضة فقط', (await n.evaluate(() => Object.keys(window.__proto.schema().pages.home).join(','))) === 'type,id,children');
  // افتراضيات معلنة
  await n.click('#seclist .row:has-text("بنر العروض") .main'); await n.waitForTimeout(100);
  const dfl = await n.locator('#insp .help.dflt').allInnerTexts();
  ok('افتراضيات معلنة للحقول الاختيارية (بنر)', dfl.length >= 5 && dfl.some(x => x.includes('صورة بديلة')) && dfl.some(x => x.includes('يُخفى الزر')), dfl.length + '');
  await n.fill('#insp [data-fld="__name"]', ''); await n.keyboard.press('Tab'); await n.waitForTimeout(200);
  ok('اسم القسم الفارغ يعود لاسم النوع عند ترك الحقل', await n.inputValue('#insp [data-fld="__name"]') === 'بنر ترويجي' && (await n.locator('#seclist .row .nm').first().innerText()) === 'بنر ترويجي');
  await n.click('#undo'); await n.waitForTimeout(100);
  ok('التراجع يعيد الاسم المخصص', (await n.locator('#seclist .row .nm').first().innerText()) === 'بنر العروض');
  await n.click('.ptabs [data-v="identity"]'); await n.waitForTimeout(100);
  ok('افتراضي معلن لاسم التطبيق', (await txt(n, '#navp .help.dflt')).includes('تطبيقي'));
  await n.click('.ptabs [data-v="sections"]');
  ok('كثافة سطح المكتب محفوظة (مؤشر دقيق): أزرار الأيقونة 36px والمفتاح 26px', !(await n.evaluate(() => matchMedia('(pointer:coarse)').matches)) && await n.evaluate(() => Math.round(document.querySelector('.btn.ic').getBoundingClientRect().width)) === 36 && await n.evaluate(() => Math.round(document.querySelector('.sw') ? document.querySelector('.sw').getBoundingClientRect().height : 26)) === 26);
  await a11y(n, 'قوالب/افتراضيات');
  // قالب الكتالوج + البدء من الصفر
  await n.click('[data-act="more"]'); await n.click('[data-act="reset"]'); await n.click('[data-act="confirm"]'); await n.waitForTimeout(200);
  await n.click('.tp[data-v="catalog"]'); await n.click('text=إنشاء تطبيقي'); await n.waitForSelector('#screen'); await n.waitForTimeout(250);
  ok('قالب الكتالوج: قسمان ولون أَوْج الأزرق', await n.evaluate(() => window.__proto.doc.pages.home.length) === 2 && await n.evaluate(() => window.__proto.doc.primary) === '#1E40AF');
  await n.click('[data-act="more"]'); await n.click('[data-act="reset"]'); await n.click('[data-act="confirm"]'); await n.waitForTimeout(200);
  await n.click('[data-act="blank"]'); await n.waitForSelector('#screen', { timeout: 8000 }); await n.waitForTimeout(250);
  ok('البدء من الصفر: وضع متقدم وصفحة رئيسية فارغة', await n.evaluate(() => window.__proto.ui.mode) === 'advanced' && await n.evaluate(() => window.__proto.doc.pages.home.length) === 0);
  ok('لا أخطاء console (قوالب/افتراضيات)', errs.filter(e => e.startsWith('N')).length === 0, errs.filter(e => e.startsWith('N')).join(' ; '));

  /* ================= آيباد وجوال: لمس ================= */
  async function targets(pg) {
    return pg.evaluate(() => { const out = []; document.querySelectorAll('button,a,input,select,textarea,[role=button]').forEach(e => { if (e.type === 'hidden') return; const r = e.getBoundingClientRect(), cs = getComputedStyle(e); if (!r.width || !r.height || cs.visibility === 'hidden') return; if (r.width < 43.5 || r.height < 43.5) out.push((e.getAttribute('aria-label') || e.textContent || e.className || e.tagName).trim().slice(0, 22) + ':' + Math.round(r.width) + 'x' + Math.round(r.height)); }); return out; });
  }
  const hscroll = async pg => (await pg.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1;
  async function tabletCtx(w, h, tag) { const c = await b.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'ar-SA' }); const pg = await c.newPage(); watch(pg, tag); await pg.goto(FILE); await pg.waitForTimeout(250); return pg; }
  async function enter(pg) { await pg.tap('text=إنشاء تطبيقي'); await pg.waitForSelector('#screen', { timeout: 8000 }); await pg.waitForTimeout(300); }

  // ---- آيباد أفقي 11" (1194×834): ثلاثة أعمدة ----
  const L = await tabletCtx(1194, 834, 'L');
  ok('آيباد أفقي: شاشة الإنشاء بلا تمرير أفقي', await hscroll(L));
  await L.screenshot({ path: D + 'l01-1194-templates.png' }); await enter(L);
  ok('آيباد أفقي: مؤشر لمس (coarse) مفعّل', await L.evaluate(() => matchMedia('(pointer:coarse)').matches));
  ok('آيباد أفقي: المستكشف والمعاينة والمفتش جنباً إلى جنب', await L.locator('#navp').isVisible() && await L.locator('#stage').isVisible() && await L.locator('#insp').isVisible());
  await L.tap('#screen .sx:nth-child(2)'); await L.waitForTimeout(250);
  ok('آيباد أفقي: لمس العنصر يحرّره والقائمة والمعاينة باقيتان', (await txt(L, '#insp-title')) === 'منتجاتنا' && await L.locator('#navp').isVisible() && await L.locator('#screen').isVisible());
  ok('آيباد أفقي: إطار الجهاز كامل داخل المعاينة', await L.evaluate(() => { const f = document.querySelector('.phone').getBoundingClientRect(), s = document.querySelector('#stage').getBoundingClientRect(); return f.left >= s.left - 1 && f.right <= s.right + 1; }));
  const tl = await targets(L); ok('آيباد أفقي: كل أهداف اللمس ≥ 44px', tl.length === 0, tl.slice(0, 6).join(' | '));
  ok('آيباد أفقي: لا تمرير أفقي', await hscroll(L));
  await L.screenshot({ path: D + 'l02-1194-selected.png' });
  await L.fill('#insp [data-fld="title"]', 'عنوان آيباد'); await L.waitForTimeout(100);
  ok('آيباد أفقي: تحرير + معاينة فورية + غير محفوظ', await L.locator('#screen h3', { hasText: 'عنوان آيباد' }).count() === 1 && (await txt(L, '#status')).includes('غير محفوظة'));
  await L.tap('#savebtn'); await L.waitForTimeout(1000); ok('آيباد أفقي: حفظ تجريبي ينجح', (await txt(L, '#status')).includes('محفوظ') && await L.locator('#savebtn').isDisabled());
  await L.tap('#undo'); await L.waitForTimeout(120); ok('آيباد أفقي: التراجع يعيد العنوان', await L.locator('#screen h3', { hasText: 'عنوان آيباد' }).count() === 0 && (await txt(L, '#status')).includes('غير محفوظة'));
  await L.tap('#redo'); await L.waitForTimeout(120); ok('آيباد أفقي: الإعادة', await L.locator('#screen h3', { hasText: 'عنوان آيباد' }).count() === 1);
  await L.tap('.seg-d [data-v="advanced"]'); await L.waitForTimeout(250);
  ok('آيباد أفقي: المتقدم يحتفظ بالتحديد والبيانات', await L.locator('.tree button').count() > 3 && (await L.evaluate(() => JSON.stringify(window.__proto.schema()))).includes('عنوان آيباد'));
  await L.screenshot({ path: D + 'l03-1194-advanced.png' });
  await L.tap('.seg-d [data-v="easy"]'); await L.waitForTimeout(250);
  ok('آيباد أفقي: العودة للسهل بلا فقد', await L.locator('#screen h3', { hasText: 'عنوان آيباد' }).count() === 1);
  await a11y(L, 'آيباد أفقي'); ok('لا أخطاء console (آيباد أفقي)', errs.filter(e => e.startsWith('L')).length === 0, errs.filter(e => e.startsWith('L')).join(' ; '));

  // ---- آيباد أفقي 10.2" (1080×810): عمودان ----
  const L2 = await tabletCtx(1080, 810, 'K'); await enter(L2);
  ok('آيباد 1080: المحرر والمعاينة جنباً إلى جنب', await L2.locator('#stage').isVisible() && (await L2.locator('#navp').isVisible() !== await L2.locator('#insp').isVisible()));
  await L2.tap('#screen .sx:nth-child(2)'); await L2.waitForTimeout(250);
  ok('آيباد 1080: التحديد يبدّل المفتش ويبقى المعاينة', await L2.locator('#insp').isVisible() && await L2.locator('#screen').isVisible());
  await L2.screenshot({ path: D + 'k01-1080-selected.png' });
  const t2 = await targets(L2); ok('آيباد 1080: أهداف اللمس ≥ 44px', t2.length === 0, t2.slice(0, 6).join(' | '));
  ok('آيباد 1080: لا تمرير أفقي', await hscroll(L2));
  await L2.tap('#insp .back'); await L2.waitForTimeout(150); ok('آيباد 1080: الرجوع للقائمة', await L2.locator('#navp').isVisible());
  ok('لا أخطاء console (آيباد 1080)', errs.filter(e => e.startsWith('K')).length === 0, errs.filter(e => e.startsWith('K')).join(' ; '));

  // ---- آيباد عمودي (834×1194 و744×1133) ----
  for (const [w, h, tag, nm] of [[834, 1194, 'P', 'آيباد عمودي 834'], [744, 1133, 'Q', 'آيباد mini عمودي 744']]) {
    const P = await tabletCtx(w, h, tag);
    ok(nm + ': شاشة الإنشاء بلا تمرير أفقي', await hscroll(P)); await P.screenshot({ path: D + tag.toLowerCase() + '01-' + w + '-templates.png' });
    await enter(P);
    ok(nm + ': المعاينة داخل إطار جهاز لا بملء الشاشة', await P.locator('.stage.flat').count() === 0 && await P.evaluate(() => getComputedStyle(document.querySelector('.phone')).borderTopWidth) === '10px');
    ok(nm + ': عرض الإطار = 390 + إطار', await P.evaluate(() => Math.round(document.querySelector('.phone').getBoundingClientRect().width)) === 410);
    ok(nm + ': مبدّل الجهاز ظاهر (3 أجهزة)', await P.locator('.stbar .seg [data-act="dev"]').count() === 3 && await P.locator('.stbar .seg').first().isVisible());
    ok(nm + ': تراجع/إعادة ظاهران', await P.locator('#undo').isVisible() && await P.locator('#redo').isVisible());
    ok(nm + ': الشريط السفلي ظاهر والمستكشف/المفتش مغلقان', await P.locator('.bbar').isVisible() && !(await P.locator('#navp').isVisible()) && !(await P.locator('#insp').isVisible()));
    await P.screenshot({ path: D + tag.toLowerCase() + '02-' + w + '-entry.png' });
    await P.tap('#screen .sx:nth-child(2)'); await P.waitForTimeout(300);
    ok(nm + ': لمس العنصر يفتح الورقة والمعاينة ظاهرة', await P.locator('#insp.open').count() === 1 && await P.locator('#screen').isVisible());
    ok(nm + ': العنصر المحدد فوق الورقة', await P.evaluate(() => { const el = document.querySelector('.sx.on').getBoundingClientRect(), ins = document.querySelector('#insp').getBoundingClientRect(); return el.bottom <= ins.top + 4 && el.top >= 0; }));
    await P.screenshot({ path: D + tag.toLowerCase() + '03-' + w + '-selected.png' });
    await P.fill('#insp [data-fld="title"]', 'عنوان ' + w); await P.waitForTimeout(100);
    ok(nm + ': المعاينة تتحدث خلف الورقة', await P.locator('#screen h3', { hasText: 'عنوان ' + w }).count() === 1);
    await P.tap('#insp [data-act="back"] >> nth=-1'); await P.waitForTimeout(150);
    await P.tap('[data-act="dev"][data-v="t768"]'); await P.waitForTimeout(150);
    ok(nm + ': التابلت 768 داخل المعاينة بلا اقتطاع', await P.evaluate(() => { const f = document.querySelector('.phone').getBoundingClientRect(); return f.left >= -1 && f.right <= innerWidth + 1; }));
    await P.screenshot({ path: D + tag.toLowerCase() + '04-' + w + '-tablet-device.png' });
    await P.tap('[data-act="dev"][data-v="p390"]');
    await P.tap('[data-act="dir"]'); await P.waitForTimeout(100); ok(nm + ': RTL ← LTR', await P.evaluate(() => document.querySelector('#screen .app').getAttribute('dir')) === 'ltr'); await P.tap('[data-act="dir"]');
    await P.tap('#undo'); await P.waitForTimeout(100); ok(nm + ': التراجع', await P.locator('#screen h3', { hasText: 'عنوان ' + w }).count() === 0);
    await P.tap('#redo'); await P.tap('#savebtn'); await P.waitForTimeout(1000); ok(nm + ': حفظ تجريبي', (await txt(P, '#status')).includes('محفوظ'));
    await P.tap('.bbar [data-v="sections"]'); await P.waitForTimeout(250); ok(nm + ': ورقة الأقسام بعناوينها الفرعية', await P.locator('#navp.open').count() === 1 && await P.locator('#seclist .row .sb').count() === 3);
    await P.screenshot({ path: D + tag.toLowerCase() + '05-' + w + '-sections.png' }); await P.tap('#navp [data-act="sheetclose"]');
    await P.tap('.modebar [data-v="advanced"]'); await P.waitForTimeout(250);
    ok(nm + ': المتقدم يحتفظ بالمسودة', (await P.evaluate(() => JSON.stringify(window.__proto.schema()))).includes('عنوان ' + w));
    await P.tap('.modebar [data-v="easy"]'); await P.waitForTimeout(200);
    ok(nm + ': العودة للسهل بلا فقد', await P.locator('#screen h3', { hasText: 'عنوان ' + w }).count() === 1);
    const tt = await targets(P); ok(nm + ': أهداف اللمس ≥ 44px', tt.length === 0, tt.slice(0, 6).join(' | '));
    ok(nm + ': لا تمرير أفقي', await hscroll(P)); await a11y(P, nm);
    ok('لا أخطاء console (' + nm + ')', errs.filter(e => e.startsWith(tag)).length === 0, errs.filter(e => e.startsWith(tag)).join(' ; '));
  }

  // ---- جوال: لا تراجع عن السلوك السابق + أفقي ----
  const PH = await tabletCtx(390, 844, 'H');
  ok('جوال: القوالب بعمود واحد بلا تمرير أفقي', await PH.evaluate(() => getComputedStyle(document.querySelector('.tpls')).gridTemplateColumns.split(' ').length) === 1 && await hscroll(PH));
  await PH.screenshot({ path: D + 'h01-390-templates.png' }); await enter(PH);
  ok('جوال: يبقى مسطّحاً بلا إطار ومبدّل الجهاز غير ظاهر', await PH.locator('.stage.flat').count() === 1 && await PH.locator('.stbar .seg').count() === 0);
  const th = await targets(PH); ok('جوال: أهداف اللمس ≥ 44px', th.length === 0, th.slice(0, 6).join(' | '));
  await PH.screenshot({ path: D + 'h02-390-entry.png' });
  const PL = await tabletCtx(844, 390, 'G'); await enter(PL);
  ok('جوال أفقي (844×390): يبقى مسطّحاً بلا تمرير أفقي', await PL.locator('.stage.flat').count() === 1 && await hscroll(PL));
  await PL.tap('#screen .sx:nth-child(2)'); await PL.waitForTimeout(250); ok('جوال أفقي: لمس العنصر يحرّره', await PL.locator('#insp.open').count() === 1);
  await PL.screenshot({ path: D + 'g01-844x390.png' });
  ok('لا أخطاء console (جوال)', errs.filter(e => e.startsWith('H') || e.startsWith('G')).length === 0, errs.filter(e => e.startsWith('H') || e.startsWith('G')).join(' ; '));

  console.log(R.join('\n')); const f = R.filter(x => x.startsWith('FAIL')).length; console.log('\nTOTAL', R.length, 'FAIL', f, '\nERRS', JSON.stringify(errs));
  await b.close();
})().catch(e => { console.log('TEST CRASH', e.message); console.log(R.join('\n')); process.exit(1); });
