import { describe, it, expectTypeOf } from 'vitest';
import { value, valuePlain, valueScope } from '../../index.js';

const template = valueScope({
	name: value<string>('Alice'),
	metadata: valuePlain({ theme: 'dark' }),
	config: valuePlain({ apiUrl: 'https://api.example.com' }, { readonly: true }),
	derived: ({ use }) => (use('name') as string).toUpperCase(),
});

const inst = template.create();

describe('valuePlain types', () => {
	it('get() returns the correct type for plain values', () => {
		void inst;
		expectTypeOf(inst.get('metadata')).toEqualTypeOf<{ theme: string }>();
		expectTypeOf(inst.get('config')).toEqualTypeOf<{ apiUrl: string }>();
	});

	it('set() accepts writable plain values', () => {
		void inst;
		// Should compile — writable plain
		inst.set('metadata', { theme: 'light' });
	});

	it('set() rejects readonly plain values', () => {
		void inst;
		// @ts-expect-error — readonly plain key
		inst.set('config', { apiUrl: 'http://localhost' });
	});

	it('set() accepts callback for writable plain', () => {
		void inst;
		inst.set('metadata', (prev) => ({ ...prev, theme: 'light' }));
	});

	it('use() rejects plain keys', () => {
		void inst;
		// @ts-expect-error — plain key not allowed
		inst.use('metadata');
	});

	it('use() rejects readonly plain keys', () => {
		void inst;
		// @ts-expect-error — plain key not allowed
		inst.use('config');
	});

	it('use() still works for reactive keys', () => {
		void inst;
		expectTypeOf(inst.use('name')).toEqualTypeOf<
			[string, (value: string | ((prev: string) => string)) => void]
		>();
		expectTypeOf(inst.use('derived')).toEqualTypeOf<[string]>();
	});
});
