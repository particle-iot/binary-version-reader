import shared from '@particle/tooling/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(
	shared,
	defineConfig({
		test: {
			include: ['test/**/*.test.ts'],
			coverage: {
				include: ['src/**/*.ts'],
				exclude: ['src/cli.ts', 'src/types/**'],
				thresholds: { statements: 87, branches: 78, functions: 95, lines: 87 }
			}
		}
	})
);
