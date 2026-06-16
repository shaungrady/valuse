import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import jsdoc from 'eslint-plugin-jsdoc';
import vitest from 'eslint-plugin-vitest';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
	js.configs.recommended,
	...tseslint.configs.strictTypeChecked,
	sonarjs.configs.recommended,
	unicorn.configs.recommended,
	jsdoc.configs['flat/recommended-typescript'],
	reactHooks.configs.flat['recommended-latest'],
	prettierConfig,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		settings: {
			jsdoc: {
				// Project follows TSDoc conventions: `@typeParam` rather than
				// JSDoc-legacy `@template`. Maps redirect "template" to
				// "typeParam", which silences the default preference warning.
				tagNamePreference: {
					template: 'typeParam',
				},
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
			// --- unicorn ---
			// Opinionated naming (fn → function, ref → reference) would
			// trigger sweeping renames for marginal benefit.
			'unicorn/prevent-abbreviations': 'off',
			// Project uses `null` for "no value" semantics in signal payloads,
			// cache slots, and `Map.get` returns. Disallowing it project-wide
			// would force `undefined` everywhere and break those distinctions.
			'unicorn/no-null': 'off',
			// --- jsdoc ---
			// Tag-line formatting is pure style; not enforced.
			'jsdoc/tag-lines': 'off',
			// Inline-tag escaping isn't part of the project's doc style.
			'jsdoc/escape-inline-tags': 'off',
			// `@param` blocks are written conversationally on the public API,
			// not exhaustively on internal helpers. Keep `check-param-names`
			// on (below) to catch real drift, but don't require @param everywhere.
			'jsdoc/require-param': 'off',
			'jsdoc/require-param-description': 'off',
			'jsdoc/require-param-type': 'off',
			// Same reasoning for @returns — required on documented public API,
			// not on every internal function. `valid-types` still catches typos.
			'jsdoc/require-returns': 'off',
			'jsdoc/require-returns-description': 'off',
			'jsdoc/require-returns-type': 'off',
			// Don't require JSDoc on every exported symbol; only on the
			// genuinely public API, which already has it.
			'jsdoc/require-jsdoc': 'off',
			// `ScopeConfig`'s lifecycle hooks take a single `context` object;
			// some entries summarize as `@param context - ...`, others document
			// individual fields (`@param context.scope - ...`). Both are useful;
			// don't demand exhaustive subfield documentation. Still catches
			// real drift (wrong param names).
			'jsdoc/check-param-names': [
				'warn',
				{ checkDestructured: false, disableMissingParamChecks: true },
			],
			// Project uses TSDoc-standard tags (@typeParam, @defaultValue,
			// @module). The plugin's "preferred" defaults disagree on a few of
			// these — see settings.jsdoc.tagNamePreference + definedTags.
			'jsdoc/check-tag-names': [
				'warn',
				{ typed: true, definedTags: ['defaultValue', 'module'] },
			],
			'jsdoc/no-undefined-types': 'off',
			'jsdoc/check-types': 'off',
			// `@internal — additional description` is the project's idiom for
			// flagging non-exported APIs with a one-liner. The plugin wants
			// `@internal` to be alone on its line; that's not the convention here.
			'jsdoc/empty-tags': 'off',
			'jsdoc/valid-types': 'off',
			// Stylistic unicorn rules that fight project idioms. Keeping the
			// rules that catch real modernization / correctness, dropping the
			// pure-style ones.
			'unicorn/switch-case-braces': 'off',
			'unicorn/no-useless-undefined': 'off',
			'unicorn/no-negated-condition': 'off',
			'unicorn/prefer-ternary': 'off',
			'unicorn/consistent-function-scoping': 'off',
			// Project preference: group digits in 4+ digit numbers (the preset
			// default only kicks in at 5). e.g. `1_000`, not `1000`.
			'unicorn/numeric-separators-style': [
				'error',
				{ number: { minimumDigits: 4, groupLength: 3 } },
			],
		},
	},
	{
		// IndexedDB's API uses `onsuccess`/`onerror` properties, not
		// `addEventListener('error')` — those behave differently on IDB
		// requests. Override only where IDB is touched.
		files: ['**/indexed-db*.ts', '**/indexed-db-adapter.ts'],
		rules: {
			'unicorn/prefer-add-event-listener': 'off',
		},
	},
	{
		files: ['src/__tests__/**'],
		extends: [tseslint.configs.disableTypeChecked],
		plugins: vitest.configs.recommended.plugins,
		rules: {
			...vitest.configs.recommended.rules,
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
			// Tests don't carry public JSDoc; rules are about doc/sig alignment
			// in published API, not in test setup.
			'jsdoc/require-jsdoc': 'off',
			'jsdoc/require-returns': 'off',
			'jsdoc/require-param': 'off',
			'jsdoc/require-yields': 'off',
		},
	},
	{
		// Type-test files (`.test-d.ts`) routinely assign runtime values
		// purely to derive types via `typeof`. The lint rule can't see the
		// type-only usage, so we relax it here. Also relax the empty-object
		// type check — `{}` is a meaningful sentinel in many type tests.
		files: ['src/__tests__/**/*.test-d.ts'],
		rules: {
			'@typescript-eslint/no-unused-vars': 'off',
			'@typescript-eslint/no-empty-object-type': 'off',
		},
	},
	{
		// Examples are user-facing demo code that'll be rewritten during
		// the variadic-scope refactor (#54); linting them now would gate
		// on cleanup that's about to be thrown away. Typecheck still
		// runs via `pnpm typecheck:examples`.
		ignores: [
			'dist/',
			'node_modules/',
			'coverage/',
			'*.config.*',
			'examples/',
			// Dev-only throughput harness, run manually against built dist.
			'bench/',
		],
	},
);
