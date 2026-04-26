import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		react: 'src/react.ts',
		utils: 'src/utils.ts',
		middleware: 'src/middleware.ts',
	},
	format: ['esm'],
	dts: true,
	sourcemap: true,
	clean: true,
	deps: {
		neverBundle: ['react'],
	},
});
