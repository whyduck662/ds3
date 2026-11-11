import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], exclude: ['tests/integration/**'], reporters: ['default', 'json'], outputFile: 'artifacts/unit.json' } });
