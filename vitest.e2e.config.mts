import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e-spec.ts'],
    globals: true,
    environment: 'node',
    passWithNoTests: false,
    setupFiles: ['test/setup/environment.ts'],
  },
})
