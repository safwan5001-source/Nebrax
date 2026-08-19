import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ═══════════════════════════════════════════════════════════════
 *  حارس مفاتيح الترجمة
 * ═══════════════════════════════════════════════════════════════
 *  مفتاحٌ مفقود في next-intl **لا يرمي خطأً**: يطبع مساره الخام في الشاشة
 *  (`purchaseSettings.return_window_days` بدل «مهلة الردّ»). فيمرّ البناء
 *  أخضرَ وتصل الشاشة إلى المستخدم مشوّهة.
 *
 *  هذا الحارس يحوّل الفشل الصامت إلى فشلٍ في CI: يقرأ كل `useTranslations`
 *  في المصدر، ويتحقّق أن كل مفتاح يُستدعى منها موجودٌ **في اللغتين**.
 *
 *  ويفحص أيضاً تطابق شجرتَي `ar` و`en`، فمفتاحٌ يُضاف لواحدةٍ دون الأخرى
 *  يظهر خاماً عند تبديل اللغة وحده — وهو أخفى من الأول.
 */

const ROOT = join(__dirname, '..', '..');
const MESSAGES = join(ROOT, 'messages');

type Tree = Record<string, unknown>;

const load = (lang: string): Tree =>
  JSON.parse(readFileSync(join(MESSAGES, `${lang}.json`), 'utf8')) as Tree;

const ar = load('ar');
const en = load('en');

/** كل مسارات الأوراق (النصوص) في الشجرة، مسطَّحةً بنقاط. */
function leaves(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return v !== null && typeof v === 'object'
      ? leaves(v as Tree, path)
      : [path];
  });
}

/** هل المسار يشير إلى **نصّ** (لا مجموعة ولا غائب)؟ */
function resolves(tree: Tree, path: string): boolean {
  let node: unknown = tree;
  for (const part of path.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in (node as Tree))) return false;
    node = (node as Tree)[part];
  }
  return typeof node === 'string';
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'messages' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.ts$/.test(name) ? [full] : [];
  });
}

/**
 * المفاتيح المستدعاة استدعاءً **ساكناً** — أي `t('key')` بنصٍّ حرفي.
 * المفاتيح المبنيّة وقت التشغيل (`t(`received_${x}`)` أو `ts(row.status)`)
 * لا تُفحَص هنا: لا سبيل لحلّها بلا تشغيل. وهي قليلة ومقصورة على قوائم
 * حالاتٍ مغلقة.
 */
function staticCalls(): { file: string; key: string }[] {
  const found: { file: string; key: string }[] = [];

  for (const file of sourceFiles(ROOT)) {
    const src = readFileSync(file, 'utf8');

    // المتغيّر ← المجموعة:  const tp = useTranslations('purchases')
    const bindings = new Map<string, string>();
    for (const m of src.matchAll(/const\s+(\w+)\s*=\s*useTranslations\(\s*'([^']+)'\s*\)/g)) {
      bindings.set(m[1], m[2]);
    }
    if (bindings.size === 0) continue;

    for (const [variable, group] of bindings) {
      const call = new RegExp(`\\b${variable}\\(\\s*'([^']+)'\\s*[,)]`, 'g');
      for (const m of src.matchAll(call)) {
        found.push({ file: file.slice(ROOT.length + 1), key: `${group}.${m[1]}` });
      }
    }
  }

  return found;
}

/**
 * المفاتيح المكرَّرة **حرفياً** داخل الكائن الواحد.
 *
 * `JSON.parse` يوحّدها بصمت (الأخيرة تفوز)، فلا يراها أيُّ فحصٍ يعمل على
 * الشجرة المحلَّلة — ومنها الفحوص الثلاثة أعلاه. ولذلك يُقرأ النصّ الخام هنا:
 * مفتاحٌ مكرَّر يعني قيمةً ميتة لا يعرض شيئاً، وتعديلَ المترجم للنسخة الخطأ
 * فلا يتغيّر شيء في الشاشة — وهو عطلٌ يصعب تفسيره.
 */
function duplicateKeys(lang: string): string[] {
  const lines = readFileSync(join(MESSAGES, `${lang}.json`), 'utf8').split('\n');
  const stack: string[] = [];
  const seen = new Map<string, Set<string>>();
  const dups: string[] = [];

  for (const line of lines) {
    const key = /^\s*"([^"]+)"\s*:/.exec(line);
    if (key) {
      const path = stack.join('.');
      const keys = seen.get(path) ?? new Set<string>();
      if (keys.has(key[1])) dups.push(`${lang}: ${path ? `${path}.` : ''}${key[1]}`);
      keys.add(key[1]);
      seen.set(path, keys);
    }
    if (/^\s*"[^"]+"\s*:\s*\{\s*$/.test(line)) stack.push(key![1]);
    else if (/^\s*\},?\s*$/.test(line) && stack.length) {
      seen.delete(stack.join('.'));
      stack.pop();
    }
  }

  return dups;
}

describe('مفاتيح الترجمة', () => {
  it('يفحص عدداً معتبراً من الاستدعاءات (حارسٌ للحارس)', () => {
    // لو انكسر التعرّف على الاستدعاءات لصار الحارس أخضرَ بلا فحص — وهو أسوأ
    // من غيابه. الرقم أدنى حدٍّ لا هدف.
    expect(staticCalls().length).toBeGreaterThan(1500);
  });

  it('كل مفتاح مستدعى موجودٌ في العربية والإنجليزية', () => {
    const broken = staticCalls()
      .filter(({ key }) => !resolves(ar, key) || !resolves(en, key))
      .map(({ file, key }) => `${key}  ←  ${file}`);

    expect([...new Set(broken)]).toEqual([]);
  });

  it('لا مفتاح مكرَّر داخل الكائن الواحد', () => {
    expect([...duplicateKeys('ar'), ...duplicateKeys('en')]).toEqual([]);
  });

  it('شجرتا العربية والإنجليزية متطابقتان', () => {
    const a = new Set(leaves(ar));
    const e = new Set(leaves(en));

    expect([...a].filter((k) => !e.has(k))).toEqual([]); // في العربية دون الإنجليزية
    expect([...e].filter((k) => !a.has(k))).toEqual([]); // والعكس
  });
});
