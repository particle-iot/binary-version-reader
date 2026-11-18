import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		coverage: {
			include: ['src/**/*.ts'],
			exclude: ['src/cli.ts', 'src/types/**'],
			thresholds: { statements: 87, branches: 78, functions: 95, lines: 87 }
		}
	}
});
