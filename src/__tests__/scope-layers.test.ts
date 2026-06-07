import { describe, it, expect } from 'vitest';
import { value } from '../core/value.js';
import { valueScope } from '../core/value-scope.js';
import { collapseLayers, deepMergeLayers } from '../core/scope-layers.js';

/**
 * Layer-boundary tracking on ScopeTemplate. Foundation for the flush
 * pipeline ($flush() cascade). See docs/derivations.md.
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

/**
 * Direct coverage for the runtime layer-collapse helpers. These were
 * previously only reachable through `valueScope(...)`; testing them in
 * isolation pins the config-vs-derivation disambiguation and merge semantics.
 */
describe('collapseLayers', () => {
	const onCreate = () => {};

	it('throws when given no layers', () => {
		expect(() => collapseLayers([])).toThrow(TypeError);
	});

	it('treats a lone layer as the field layer (definition === that layer)', () => {
		const fields = { a: 1 };
		const { definition, layers, config } = collapseLayers([fields]);
		expect(definition).toBe(fields);
		expect(layers).toEqual([fields]);
		expect(config).toBeUndefined();
	});

	it('detects a trailing config layer (all keys are config keys)', () => {
		const fields = { a: 1 };
		const { definition, layers, config } = collapseLayers([
			fields,
			{ onCreate },
		]);
		expect(config).toEqual({ onCreate });
		expect(layers).toEqual([fields]);
		expect(definition).toBe(fields);
	});

	it('treats a trailing empty object as the config disambiguator', () => {
		const fields = { a: 1 };
		const { layers, config } = collapseLayers([fields, {}]);
		expect(config).toEqual({});
		expect(layers).toEqual([fields]);
	});

	it('keeps a non-config trailing layer as a derivation layer', () => {
		const fields = { a: 1 };
		const derivs = { b: 2 };
		const { definition, layers, config } = collapseLayers([fields, derivs]);
		expect(config).toBeUndefined();
		expect(layers).toEqual([fields, derivs]);
		expect(definition).toEqual({ a: 1, b: 2 });
	});

	it('only the LAST arg can be config; middle args stay derivation layers', () => {
		const fields = { a: 1 };
		const middle = {}; // empty, but not last → derivation layer
		const { layers, config } = collapseLayers([fields, middle, { onCreate }]);
		expect(config).toEqual({ onCreate });
		expect(layers).toEqual([fields, middle]);
	});

	it('does not treat a leading config-shaped arg as config', () => {
		const first = { onCreate }; // config-shaped, but not last
		const last = { x: 1 };
		const { layers, config } = collapseLayers([first, last]);
		expect(config).toBeUndefined();
		expect(layers).toEqual([first, last]);
	});
});

describe('deepMergeLayers', () => {
	it('overrides leaf keys (B wins) and keeps disjoint keys', () => {
		expect(deepMergeLayers({ x: 1, y: 2 }, { y: 3, z: 4 })).toEqual({
			x: 1,
			y: 3,
			z: 4,
		});
	});

	it('recursively merges plain-object subtrees', () => {
		expect(
			deepMergeLayers({ g: { a: 1, b: 2 } }, { g: { b: 3, c: 4 } }),
		).toEqual({ g: { a: 1, b: 3, c: 4 } });
	});

	it('replaces (does not merge) when a side is a non-plain value', () => {
		const v = value(0);
		const merged = deepMergeLayers({ g: { a: 1 } }, { g: v });
		expect(merged.g).toBe(v);
	});

	it('replaces a function leaf wholesale', () => {
		const fn = () => 2;
		const merged = deepMergeLayers({ fn: () => 1 }, { fn });
		expect(merged.fn).toBe(fn);
	});

	it('does not mutate its inputs', () => {
		const a = { g: { a: 1 } };
		const b = { g: { b: 2 } };
		deepMergeLayers(a, b);
		expect(a).toEqual({ g: { a: 1 } });
		expect(b).toEqual({ g: { b: 2 } });
	});
});
