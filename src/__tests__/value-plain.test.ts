import { describe, it, expect } from 'vitest';
import { value, valuePlain, valueScope } from '../index.js';

const profile = valueScope({
	name: value<string>('Alice'),
	metadata: valuePlain({ theme: 'dark', locale: 'en' }),
	config: valuePlain({ apiUrl: 'https://api.example.com' }, { readonly: true }),
});

describe('valuePlain', () => {
	describe('get()', () => {
		it('returns the initial plain value', () => {
			const inst = profile.create();
			expect(inst.get('metadata')).toEqual({ theme: 'dark', locale: 'en' });
		});

		it('returns the initial readonly plain value', () => {
			const inst = profile.create();
			expect(inst.get('config')).toEqual({
				apiUrl: 'https://api.example.com',
			});
		});
	});

	describe('set()', () => {
		it('updates a writable plain value', () => {
			const inst = profile.create();
			inst.set('metadata', { theme: 'light', locale: 'fr' });
			expect(inst.get('metadata')).toEqual({ theme: 'light', locale: 'fr' });
		});

		it('supports prev => next callback', () => {
			const inst = profile.create();
			inst.set('metadata', (prev) => ({ ...prev, theme: 'light' }));
			expect(inst.get('metadata')).toEqual({ theme: 'light', locale: 'en' });
		});

		it('throws on readonly plain value', () => {
			const inst = profile.create();
			expect(() => {
				// @ts-expect-error — readonly plain key
				inst.set('config', { apiUrl: 'http://localhost' });
			}).toThrow('Cannot set readonly plain value "config"');
		});

		it('throws on readonly plain value in bulk set', () => {
			const inst = profile.create();
			expect(() => {
				// @ts-expect-error — readonly plain key
				inst.set({ config: { apiUrl: 'http://localhost' } });
			}).toThrow('Cannot set readonly plain value "config"');
		});
	});

	describe('use()', () => {
		it('throws on plain value', () => {
			const inst = profile.create();
			expect(() => {
				// @ts-expect-error — plain key not allowed in use()
				inst.use('metadata');
			}).toThrow('Cannot use() plain value "metadata"');
		});

		it('throws on readonly plain value', () => {
			const inst = profile.create();
			expect(() => {
				// @ts-expect-error — plain key not allowed in use()
				inst.use('config');
			}).toThrow('Cannot use() plain value "config"');
		});
	});

	describe('useAsync()', () => {
		it('throws on plain value', () => {
			const inst = profile.create();
			expect(() => {
				inst.useAsync('metadata');
			}).toThrow('Cannot useAsync() plain value "metadata"');
		});
	});

	describe('create() with override', () => {
		it('overrides writable plain value at creation', () => {
			const inst = profile.create({
				metadata: { theme: 'light', locale: 'de' },
			});
			expect(inst.get('metadata')).toEqual({ theme: 'light', locale: 'de' });
		});
	});

	describe('getSnapshot()', () => {
		it('includes plain values', () => {
			const inst = profile.create();
			const snap = inst.getSnapshot();
			expect(snap.metadata).toEqual({ theme: 'dark', locale: 'en' });
			expect(snap.config).toEqual({ apiUrl: 'https://api.example.com' });
		});
	});

	describe('non-reactivity', () => {
		it('does not trigger subscribe when plain value changes', () => {
			const inst = profile.create();
			let callCount = 0;
			inst.subscribe(() => {
				callCount++;
			});
			inst.set('metadata', { theme: 'light', locale: 'en' });
			expect(callCount).toBe(0);
		});
	});

	describe('extend()', () => {
		it('preserves plain fields in extended scope', () => {
			const extended = profile.extend({
				extra: value<number>(0),
			});
			const inst = extended.create();
			expect(inst.get('metadata')).toEqual({ theme: 'dark', locale: 'en' });
			expect(inst.get('config')).toEqual({
				apiUrl: 'https://api.example.com',
			});
		});

		it('preserves readonly status in extended scope', () => {
			const extended = profile.extend({
				extra: value<number>(0),
			});
			const inst = extended.create();
			expect(() => {
				(inst as any).set('config', { apiUrl: 'hacked' });
			}).toThrow('Cannot set readonly plain value "config"');
		});
	});

	describe('createMap()', () => {
		it('plain values work in scope map instances', () => {
			const map = profile.createMap();
			map.set('a', { name: 'Alice' });
			const inst = map.get('a');
			expect(inst?.get('metadata')).toEqual({ theme: 'dark', locale: 'en' });
			inst?.set('metadata', { theme: 'light', locale: 'fr' });
			expect(inst?.get('metadata')).toEqual({ theme: 'light', locale: 'fr' });
		});
	});

	describe('callback set after create override', () => {
		it('callback receives the overridden initial value', () => {
			const inst = profile.create({
				metadata: { theme: 'custom', locale: 'jp' },
			});
			inst.set('metadata', (prev) => ({ ...prev, theme: 'updated' }));
			expect(inst.get('metadata')).toEqual({
				theme: 'updated',
				locale: 'jp',
			});
		});
	});
});
