import { describe, it, expect } from 'vitest';
import { value } from '../core/value.js';
import { valueScope } from '../core/value-scope.js';

/**
 * Layer-boundary tracking on ScopeTemplate. Foundation for the flush
 * pipeline ($flush() cascade). See docs/proposals/flush-pipeline.md.
 */
describe('ScopeTemplate.$layers', () => {
	const layersOf = (t: unknown) =>
		(t as { $layers: ReadonlyArray<Record<string, unknown>> }).$layers;

	it('tracks the field layer for a fields-only scope', () => {
		const fields = { name: value<string>(''), count: value<number>(0) };
		const template = valueScope(fields);
		const layers = layersOf(template);
		expect(layers).toHaveLength(1);
		expect(layers[0]).toBe(fields);
	});

	it('tracks fields + one derivation layer', () => {
		const fields = { first: value<string>(''), last: value<string>('') };
		const derivs = {
			full: ({ scope }: { scope: any }) =>
				`${scope.first.use()} ${scope.last.use()}`,
		};
		const template = valueScope(fields, derivs);
		const layers = layersOf(template);
		expect(layers).toHaveLength(2);
		expect(layers[0]).toBe(fields);
		expect(layers[1]).toBe(derivs);
	});

	it('tracks fields + multiple derivation layers, excluding config', () => {
		const fields = { a: value<number>(0) };
		const d1 = { b: ({ scope }: { scope: any }) => scope.a.use() + 1 };
		const d2 = { c: ({ scope }: { scope: any }) => scope.b.use() * 2 };
		const config = { onCreate: () => {} };
		const template = valueScope(fields, d1, d2, config);
		const layers = layersOf(template);
		expect(layers).toHaveLength(3);
		expect(layers[0]).toBe(fields);
		expect(layers[1]).toBe(d1);
		expect(layers[2]).toBe(d2);
	});

	it('appends extension layers after base layers via extendValues', () => {
		const baseFields = { a: value<number>(0) };
		const baseDerivs = { b: ({ scope }: { scope: any }) => scope.a.use() + 1 };
		const base = valueScope(baseFields, baseDerivs);

		const extFields = { c: value<string>('') };
		const extDerivs = {
			d: ({ scope }: { scope: any }) => `${scope.b.use()}-${scope.c.use()}`,
		};
		const extended = base.extendValues(extFields, extDerivs);

		const layers = layersOf(extended);
		expect(layers).toHaveLength(4);
		expect(layers[0]).toBe(baseFields);
		expect(layers[1]).toBe(baseDerivs);
		expect(layers[2]).toBe(extFields);
		expect(layers[3]).toBe(extDerivs);
	});

	it('preserves layers across extendConfig', () => {
		const fields = { a: value<number>(0) };
		const derivs = { b: ({ scope }: { scope: any }) => scope.a.use() + 1 };
		const base = valueScope(fields, derivs);
		const baseLayers = layersOf(base);

		const withHooks = base.extendConfig({ onCreate: () => {} });
		const extLayers = layersOf(withHooks);

		expect(extLayers).toHaveLength(2);
		expect(extLayers[0]).toBe(baseLayers[0]);
		expect(extLayers[1]).toBe(baseLayers[1]);
	});

	it('single-literal valueScope produces a one-entry layer list', () => {
		const definition = {
			a: value<number>(0),
			b: ({ scope }: { scope: any }) => scope.a.use() + 1,
		};
		const template = valueScope(definition);
		const layers = layersOf(template);
		expect(layers).toHaveLength(1);
		expect(layers[0]).toBe(definition);
	});
});
