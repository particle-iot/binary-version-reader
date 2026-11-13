import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['specs/lib/**/*.spec.js'],
		coverage: {
			include: ['main.js', 'limited.js', 'lib/**/*.js'],
			thresholds: { statements: 81, branches: 61, functions: 90, lines: 81 }
		}
	}
});
