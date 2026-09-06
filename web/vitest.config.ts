import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Next.js يبني بـ automatic JSX runtime؛ توحيد الاختبارات معه يجعل أي مكوّن
  // مشترك قابلاً للعرض في jsdom دون أن يشترط استيراد React صراحةً.
  esbuild: { jsx: 'automatic' },
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        // CI runners OOM with parallel jsdom suites; one fork serializes safely.
        singleFork: true,
      },
    },
    maxWorkers: 1,
    fileParallelism: false,
    environment: 'node',
    environmentMatchGlobs: [
      ['src/components/platform/**/*.test.tsx', 'jsdom'],
      ['src/components/delivery-notes/**/*.test.tsx', 'jsdom'],
      ['src/components/reports/**/*.test.tsx', 'jsdom'],
      ['src/components/products/**/*.test.tsx', 'jsdom'],
      ['src/components/inventory/**/*.test.tsx', 'jsdom'],
      ['src/components/accounts/**/*.test.tsx', 'jsdom'],
      ['src/components/pos/**/*.test.tsx', 'jsdom'],
      // يطابق كلاً من (pos)/pos/** و(app)/pos/sessions/** — الأقواس في اسم
      // مجلد Next.js route group لا يطابقها micromatch حرفياً كنمط ثابت.
      ['src/app/**/pos/**/*.test.tsx', 'jsdom'],
      ['src/app/(app)/inventory/**/*.test.tsx', 'jsdom'],
      ['src/app/(app)/accounts/**/*.test.tsx', 'jsdom'],
      ['src/app/platform/tenants/**/*.test.tsx', 'jsdom'],
    ],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
