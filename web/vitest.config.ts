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
    environment: 'node',
    environmentMatchGlobs: [
      ['src/components/platform/**/*.test.tsx', 'jsdom'],
      ['src/app/platform/tenants/**/*.test.tsx', 'jsdom'],
    ],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
