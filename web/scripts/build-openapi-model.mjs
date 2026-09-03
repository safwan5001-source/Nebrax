/**
 * مولّد نموذج التوثيق: يقرأ عقد OpenAPI 3.1 الرسمي (`docs/openapi/public-api-v1.yaml`
 * في جذر المستودع)، يشغّل المحوّل النقيّ، ويكتب الناتج الثابت
 * `src/modules/developer/docs/openapi-model.generated.ts`.
 *
 * **يُشغَّل يدويّاً/في التطوير** عند تغيّر العقد (`npm run openapi:generate`)، والناتج
 * **مُودَع في المستودع** فلا يعتمد بناءُ الواجهة (CI/Vercel) على وجود ملف `docs/` وقت
 * البناء. اختبار الانحراف (`openapi-model.drift.test.ts`) يفرض بقاء المُودَع مطابقاً
 * للعقد حين يكون العقد حاضراً (وهو كذلك في Web CI بالسحب الكامل للمستودع).
 *
 * إن غاب ملف العقد (بيئة لا تضمّ `docs/`) يخرج المولّد بلا خطأ محافظاً على المُودَع.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { transformOpenApi } from './openapi-transform.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const specPath = resolve(here, '../../docs/openapi/public-api-v1.yaml');
const outPath = resolve(here, '../src/modules/developer/docs/openapi-model.generated.ts');

if (!existsSync(specPath)) {
  console.warn(`[openapi] العقد غير موجود عند ${specPath} — أُبقيَ الملف المولَّد كما هو.`);
  process.exit(0);
}

const spec = parse(readFileSync(specPath, 'utf8'));
const model = transformOpenApi(spec);

const banner = `/**
 * ⚠️ ملفّ مولَّد آليّاً — لا تُحرّره يدويّاً.
 *
 * المصدر: docs/openapi/public-api-v1.yaml (عقد OpenAPI 3.1 الرسمي للـ Public API).
 * التوليد: web/scripts/build-openapi-model.mjs (\`npm run openapi:generate\`).
 * الأنواع: ./openapi-types. اختبار الانحراف يحرس تطابقه مع العقد.
 */
import type { OpenApiModel } from './openapi-types';

export const OPENAPI_MODEL: OpenApiModel = `;

const body = JSON.stringify(model, null, 2);
writeFileSync(outPath, `${banner}${body};\n`, 'utf8');
console.log(`[openapi] كُتب النموذج: ${outPath} (${model.tags.length} مجموعات، ${model.tags.reduce((sum, tag) => sum + tag.operations.length, 0)} عمليّات، ${model.scopes.length} نطاقات).`);
