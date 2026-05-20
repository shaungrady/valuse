import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
	js.configs.recommended,
	...tseslint.configs.strictTypeChecked,
	sonarjs.configs.recommended,
	prettierConfig,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// `void signal.value` is the canonical Preact-signals tracking
			// idiom: register a dep without using the value.
			'sonarjs/void-use': 'off',
			// Sonar's default ceiling (15) is lower than this codebase's
			// orchestration functions warrant. Not enforcing complexity here.
			'sonarjs/cognitive-complexity': 'off',
			// Overloaded `get()` methods on ValueArray/ValueMap intentionally
			// return different types based on arg presence (array vs element).
			'sonarjs/function-return-type': 'off',
			// devtools.ts declares the global `__REDUX_DEVTOOLS_EXTENSION__`
			// via a `declare const globalThis` augmentation; not shadowing.
			'sonarjs/no-globals-shadowing': 'off',
			// Project uses TODO comments as tracked work items, not lint debt.
			'sonarjs/todo-tag': 'off',
			// Frequently false-positives on narrowed union members where the
			// secondary null-check is a deliberate runtime guard.
			'sonarjs/different-types-comparison': 'off',
			// Some tests use shared assertion helpers Sonar can't trace.
			'sonarjs/assertions-in-tests': 'off',
		},
	},
	{
		files: ['src/__tests__/**'],
		extends: [tseslint.configs.disableTypeChecked],
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_' },
			],
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-non-null-assertion': 'off',
			// Test fixtures often necessarily mirror each other (same render
			// shape, different scope wiring); extracting helpers tends to
			// obscure intent more than it deduplicates code.
			'sonarjs/no-identical-functions': 'off',
		},
	},
	{
		ignores: ['dist/', 'node_modules/', '*.config.*'],
	},
);
