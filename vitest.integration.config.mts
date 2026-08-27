import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/integration/**/*.spec.ts'],
    globals: true,
    environment: 'node',
    // True until the first Postgres-backed module (OAuth, Phase 2) adds a real
    // integration test — flip to false alongside that first test, matching
    // vitest.config.mts and vitest.e2e.config.mts.
    passWithNoTests: true,
    setupFiles: ['test/setup/environment.ts'],
  },
})
