import { defineConfig } from 'vitest/config'

// `ghuri test` runs vitest. App tests live in src/<app>/tests.ts (Django style) or *.test.ts files.
export default defineConfig({
  test: {
    include: ['src/**/tests.ts', 'src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
})
