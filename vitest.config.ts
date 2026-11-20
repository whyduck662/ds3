import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], exclude: ['tests/integration/**'], reporters: ['default', 'json'], outputFile: `${process.env.DS03_ARTIFACT_DIR ?? 'artifacts'}/unit.json` } });
