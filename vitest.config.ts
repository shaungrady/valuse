import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
	test: {
		globals: true,
		environment: 'jsdom',
		include: [
			'src/__tests__/**/*.test.{ts,tsx}',
			'examples/**/*.test.{ts,tsx}',
		],
		typecheck: {
			include: ['src/__tests__/**/*.test-d.ts'],
		},
	},
	resolve: {
		// Examples import valuse by package name so they read like real consumer
		// code. Longest-match order matters for Vite's resolver — subpaths first.
		alias: {
			'valuse/react': resolve(import.meta.dirname, 'src/react.ts'),
			'valuse/svelte': resolve(import.meta.dirname, 'src/svelte.ts'),
			'valuse/vue': resolve(import.meta.dirname, 'src/vue.ts'),
			'valuse/angular': resolve(import.meta.dirname, 'src/angular.ts'),
			'valuse/utils': resolve(import.meta.dirname, 'src/utils.ts'),
			'valuse/middleware': resolve(import.meta.dirname, 'src/middleware.ts'),
			valuse: resolve(import.meta.dirname, 'src/index.ts'),
		},
	},
});
