import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		react: 'src/react.ts',
		svelte: 'src/svelte.ts',
		vue: 'src/vue.ts',
		angular: 'src/angular.ts',
		utils: 'src/utils.ts',
		middleware: 'src/middleware.ts',
	},
	format: ['esm'],
	dts: true,
	// No source maps: for a published library they're dead weight. JS maps
	// would roughly double the tarball, and declaration maps only enable
	// editor "go to definition" if `src/` is published (it isn't).
	sourcemap: false,
	clean: true,
	deps: {
		neverBundle: ['react', 'svelte', 'svelte/store', 'vue', '@angular/core'],
	},
});
