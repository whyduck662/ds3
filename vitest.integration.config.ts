import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/integration/**/*.test.ts'], testTimeout: 30000, hookTimeout: 30000, fileParallelism: false, reporters: ['default', 'json'], outputFile: 'artifacts/integration.json' } });
