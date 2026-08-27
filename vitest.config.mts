import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/unit/**/*.spec.ts'],
    globals: true,
    environment: 'node',
    passWithNoTests: false,
  },
})
