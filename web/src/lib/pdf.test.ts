// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { getPdfImageSlices, hasDirectArabicText, normalizePdfCloneForArabic } from './pdf';

const AR = 'فاتورة ضريبية شركة نبراكس';
const AR_NUM = 'فاتورة رقم 310122393500003';
const AR_EN = 'فاتورة Tax نبراكس Co';
const EN = 'Tax Invoice Nebrax Co';

/** يبني عنصراً في المستند (getComputedStyle يحتاج الإرفاق) ويعيده. */
function mount(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  return container.firstElementChild as HTMLElement;
}

/** يحاكي مسار onclone: ينسخ العنصر الحيّ، ويطبّع النسخة وحدها. */
function cloneAndNormalize(live: HTMLElement): HTMLElement {
  const clone = live.cloneNode(true) as HTMLElement;
  document.body.appendChild(clone);
  normalizePdfCloneForArabic(clone);
  return clone;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('normalizePdfCloneForArabic — RC1: letter-spacing على النصّ العربي', () => {
  it('1) نصّ عربي بتباعد أحرف غير طبيعي → يُطبَّع إلى normal في النسخة', () => {
    const clone = cloneAndNormalize(mount(`<div style="letter-spacing:-0.025em">${AR}</div>`));
    expect(clone.style.letterSpacing).toBe('normal');
  });

  it('2) عربي + أرقام يعمل', () => {
    const clone = cloneAndNormalize(mount(`<div style="letter-spacing:0.03em">${AR_NUM}</div>`));
    expect(clone.style.letterSpacing).toBe('normal');
  });

  it('3) عربي + إنجليزي مختلط يعمل', () => {
    const clone = cloneAndNormalize(mount(`<div style="letter-spacing:-0.02em">${AR_EN}</div>`));
    expect(clone.style.letterSpacing).toBe('normal');
  });

  it('4) الإنجليزية تبقى صالحة — لا يُمسّ تباعدها (مطابقة للمعاينة)', () => {
    const clone = cloneAndNormalize(mount(`<div style="letter-spacing:-0.025em">${EN}</div>`));
    // اللاتينية تُصيَّر سليمة مع التباعد في html2canvas، فنُبقيها كما هي.
    expect(clone.style.letterSpacing).toBe('-0.025em');
  });

  it('5) المستند الحيّ يحتفظ بتباعده الأصلي (التطبيع على النسخة فقط)', () => {
    const live = mount(`<div style="letter-spacing:-0.025em">${AR}</div>`);
    cloneAndNormalize(live);
    expect(live.style.letterSpacing).toBe('-0.025em');
  });

  it('يطبّع التباعد الموروث من الأب حين يحمل الأب نصاً عربياً', () => {
    const clone = cloneAndNormalize(mount(`<div style="letter-spacing:0.05em">${AR} <span>تكملة</span></div>`));
    expect(clone.style.letterSpacing).toBe('normal');
  });
});

describe('normalizePdfCloneForArabic — RC2: القص على عناصر النصّ العربية الطرفية', () => {
  it('6a) عنصر نصّ عربي طرفي بـ overflow:hidden + max-height → يُبطَل القص في النسخة', () => {
    const clone = cloneAndNormalize(mount(`<div style="overflow:hidden;max-height:2.6em">${AR}</div>`));
    expect(clone.style.overflow).toBe('visible');
    expect(clone.style.maxHeight).toBe('none');
  });

  it('6b) line-clamp (display:-webkit-box) على نصّ عربي → يُفكّ في النسخة', () => {
    const live = mount(
      `<div style="overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;max-height:3em">${AR}</div>`,
    );
    const clone = cloneAndNormalize(live);
    expect(clone.style.overflow).toBe('visible');
    expect(clone.style.display).toBe('block');
    expect(clone.style.maxHeight).toBe('none');
    expect(clone.style.getPropertyValue('-webkit-line-clamp')).toBe('unset');
  });

  it('7) المستند الحيّ يبقى دون تغيير', () => {
    const live = mount(`<div style="overflow:hidden;max-height:2.6em">${AR}</div>`);
    cloneAndNormalize(live);
    expect(live.style.overflow).toBe('hidden');
    expect(live.style.maxHeight).toBe('2.6em');
  });

  it('8) حاوية قصٍّ بنيوية (بلا نصّ مباشر) تبقى دون تغيير', () => {
    const clone = cloneAndNormalize(
      mount(`<div style="overflow:hidden"><section><p>${AR}</p></section></div>`),
    );
    expect(clone.style.overflow).toBe('hidden'); // الحاوية البنيوية لم تُمسّ
  });

  it('9) غلاف جدول/تخطيط (div > table) بـ overflow:hidden يبقى دون تغيير', () => {
    const clone = cloneAndNormalize(
      mount(`<div style="overflow:hidden"><table><tbody><tr><td>${AR}</td></tr></tbody></table></div>`),
    );
    expect(clone.style.overflow).toBe('hidden');
  });

  it('10) حاوية شعار/صورة (div > img) بـ overflow:hidden تبقى دون تغيير', () => {
    const clone = cloneAndNormalize(
      mount(`<div style="overflow:hidden"><img alt="logo" src="data:," /></div>`),
    );
    expect(clone.style.overflow).toBe('hidden');
  });

  it('11) حاوية رمز QR/شبيه صورة (div > svg) بـ overflow:hidden تبقى دون تغيير', () => {
    const clone = cloneAndNormalize(
      mount(`<div style="overflow:hidden"><svg width="60" height="60"></svg></div>`),
    );
    expect(clone.style.overflow).toBe('hidden');
  });

  it('عنصر نصّ لاتينيّ مقصوص لا يُبطَل قصّه (مطابقة للمعاينة — العلّة عربية فقط)', () => {
    const clone = cloneAndNormalize(mount(`<div style="overflow:hidden;max-height:2.6em">${EN}</div>`));
    expect(clone.style.overflow).toBe('hidden');
    expect(clone.style.maxHeight).toBe('2.6em');
  });
});

describe('hasDirectArabicText — تمييز عنصر النصّ العربي الطرفي', () => {
  it('صحيح لعنصر نصّه المباشر عربي', () => {
    expect(hasDirectArabicText(mount(`<div>${AR}</div>`))).toBe(true);
  });
  it('خطأ لحاوية بنيوية أبناؤها عناصر لا نصّ مباشر', () => {
    expect(hasDirectArabicText(mount(`<div><span>${AR}</span></div>`))).toBe(false);
  });
  it('خطأ لعنصر نصّه المباشر لاتينيّ فقط', () => {
    expect(hasDirectArabicText(mount(`<div>${EN}</div>`))).toBe(false);
  });
  it('خطأ لحاوية صورة', () => {
    expect(hasDirectArabicText(mount(`<div><img alt="" src="data:," /></div>`))).toBe(false);
  });
});

/**
 * اختبار قبول إلزامي: مستند AWJ افتراضيّ عامّ **ليس** قالب فاتورة، بلا أي معرّف قالب
 * V2 ولا نوع مستند — يمرّ عبر نفس طبقة التطبيع فيرث حماية العربية تلقائياً.
 */
describe('مستند مستقبلي عامّ (ليس فاتورة) يرث الحماية دون كود خاص بالقالب', () => {
  it('يطبّع العربي المتباعد والمقصوص، ويصون الحاويات البنيوية والصور واللاتينية', () => {
    const live = mount(`
      <article dir="rtl" data-generic-awj-doc="true">
        <h1 style="letter-spacing:-0.03em">${AR}</h1>
        <div class="addr" style="overflow:hidden;max-height:2.6em">${AR_NUM}</div>
        <div class="structural" style="overflow:hidden">
          <table><tbody><tr><td>${AR}</td></tr></tbody></table>
        </div>
        <div class="logo" style="overflow:hidden"><img alt="" src="data:," /></div>
        <div class="latin" style="letter-spacing:-0.02em">${EN}</div>
      </article>
    `);
    const clone = cloneAndNormalize(live);

    const title = clone.querySelector('h1') as HTMLElement;
    const addr = clone.querySelector('.addr') as HTMLElement;
    const structural = clone.querySelector('.structural') as HTMLElement;
    const logo = clone.querySelector('.logo') as HTMLElement;
    const latin = clone.querySelector('.latin') as HTMLElement;

    // العربي المتباعد → طُبِّع
    expect(title.style.letterSpacing).toBe('normal');
    // نصّ عربي مقصوص → أُبطِل قصّه
    expect(addr.style.overflow).toBe('visible');
    expect(addr.style.maxHeight).toBe('none');
    // حاوية بنيوية → لم تُمسّ
    expect(structural.style.overflow).toBe('hidden');
    // حاوية صورة → لم تُمسّ
    expect(logo.style.overflow).toBe('hidden');
    // لاتينيّ → لم يُمسّ تباعده
    expect(latin.style.letterSpacing).toBe('-0.02em');

    // المستند الحيّ سليم تماماً
    const liveTitle = live.querySelector('h1') as HTMLElement;
    const liveAddr = live.querySelector('.addr') as HTMLElement;
    expect(liveTitle.style.letterSpacing).toBe('-0.03em');
    expect(liveAddr.style.overflow).toBe('hidden');
    expect(liveAddr.style.maxHeight).toBe('2.6em');
  });
});

/** حماية سلوك المُصدِّر القائم: ترقيم الصفحات وتحسين الصفحة الواحدة (PR #637). */
describe('getPdfImageSlices — ترقيم A4 غير متغيّر', () => {
  it('محتوى يتّسع في صفحة واحدة = شريحة واحدة كاملة', () => {
    const slices = getPdfImageSlices(1000, 1200, []);
    expect(slices).toHaveLength(1);
    expect(slices[0]).toEqual({ top: 0, height: 1000 });
  });

  it('محتوى أطول يُقطَّع عند أقرب حدّ آمن قبل نهاية الصفحة', () => {
    const slices = getPdfImageSlices(2000, 1000, [600, 950, 1300, 1800]);
    expect(slices.length).toBeGreaterThan(1);
    // أول قطع يفضّل حدّاً آمناً ضمن الصفحة (950) لا القطع الحسابي (1000).
    expect(slices[0]).toEqual({ top: 0, height: 950 });
    // لا فراغ ولا تراكب: مجموع الارتفاعات = ارتفاع الصورة، وكل شريحة متّصلة بسابقتها.
    let cursor = 0;
    for (const s of slices) {
      expect(s.top).toBe(cursor);
      cursor += s.height;
    }
    expect(cursor).toBe(2000);
  });

  it('لا صفحات فارغة: كل شريحة ارتفاعها موجب', () => {
    const slices = getPdfImageSlices(3333, 1000, [500, 1500, 2500]);
    for (const s of slices) expect(s.height).toBeGreaterThan(0);
  });
});
