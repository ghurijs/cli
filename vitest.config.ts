import { defineConfig } from 'vitest/config'

// Loading fixture projects (jiti) and wrangler is slow on a cold cache — allow generous timeouts.
export default defineConfig({
  test: { include: ['test/**/*.test.ts', 'test/**/*.test.tsx'], testTimeout: 60_000, hookTimeout: 60_000 },
})
