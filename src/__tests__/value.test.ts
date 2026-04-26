import { describe, it, expect, vi } from 'vitest';
import { value } from '../core/value.js';
import { batchSets } from '../core/signal.js';

describe('value (v2)', () => {
	describe('creation', () => {
		it('creates a value with a default', () => {
			const name = value<string>('hello');
			expect(name.get()).toBe('hello');
		});

		it('creates a value without a default (undefined)', () => {
			const name = value<string>();
			expect(name.get()).toBeUndefined();
		});

		it('infers type from default', () => {
			const count = value(42);
			expect(count.get()).toBe(42);
		});
	});

	describe('.set()', () => {
		it('sets a direct value', () => {
			const name = value<string>('hello');
			name.set('world');
			expect(name.get()).toBe('world');
		});

		it('sets via callback', () => {
			const count = value<number>(10);
			count.set((prev) => prev + 5);
			expect(count.get()).toBe(15);
		});

		it('sets a value that was initially undefined', () => {
			const name = value<string>();
			name.set('hello');
			expect(name.get()).toBe('hello');
		});
	});

	describe('.subscribe()', () => {
		it('calls subscriber on change with value and previous', () => {
			const name = value<string>('hello');
			const calls: [string, string][] = [];
			name.subscribe((current, previous) => calls.push([current, previous]));
			name.set('world');
			expect(calls).toEqual([['world', 'hello']]);
		});

		it('returns an unsubscribe function', () => {
			const name = value<string>('hello');
			const calls: string[] = [];
			const unsub = name.subscribe((current) => calls.push(current));
			unsub();
			name.set('world');
			expect(calls).toHaveLength(0);
		});

		it('tracks previous value across multiple changes', () => {
			const count = value(0);
			const calls: [number, number][] = [];
			count.subscribe((current, previous) => calls.push([current, previous]));
			count.set(1);
			count.set(2);
			count.set(3);
			expect(calls).toEqual([
				[1, 0],
				[2, 1],
				[3, 2],
			]);
		});
	});

	describe('.pipe() — sync transforms', () => {
		it('transforms values on set', () => {
			const name = value<string>('').pipe((s) => s.trim());
			name.set('  hello  ');
			expect(name.get()).toBe('hello');
		});

		it('chains multiple pipes', () => {
			const name = value<string>('')
				.pipe((s) => s.trim())
				.pipe((s) => s.toLowerCase());
			name.set('  HELLO  ');
			expect(name.get()).toBe('hello');
		});

		it('applies pipe to initial value', () => {
			const name = value<string>('  HELLO  ')
				.pipe((s) => s.trim())
				.pipe((s) => s.toLowerCase());
			expect(name.get()).toBe('hello');
		});
	});

	describe('.pipe() — type-changing', () => {
		it('changes the output type', () => {
			const parsed = value<string>('42').pipe((v) => parseInt(v));
			expect(parsed.get()).toBe(42);
		});

		it('set() still accepts the original input type', () => {
			const parsed = value<string>('42').pipe((v) => parseInt(v));
			parsed.set('100');
			expect(parsed.get()).toBe(100);
		});

		it('chains sync then type-changing', () => {
			const parsed = value<string>('  42  ')
				.pipe((s) => s.trim())
				.pipe((s) => parseInt(s));
			expect(parsed.get()).toBe(42);
			parsed.set('  100  ');
			expect(parsed.get()).toBe(100);
		});

		it('set callback receives Out type as prev', () => {
			const parsed = value<string>('42').pipe((v) => parseInt(v));
			parsed.set((prev) => {
				expect(typeof prev).toBe('number');
				return String(prev + 1);
			});
			expect(parsed.get()).toBe(43);
		});
	});

	describe('.pipe() — factory pipes', () => {
		it('routes values through the factory writer', () => {
			const doubled = value<number>(5).pipe<number>({
				create:
					({ set }) =>
					(value) =>
						set(value * 2),
			});
			expect(doubled.get()).toBe(10);
			doubled.set(3);
			expect(doubled.get()).toBe(6);
		});

		it('supports type-changing factory pipes', () => {
			const parsed = value<string>('42').pipe<number>({
				create:
					({ set }) =>
					(value) =>
						set(parseInt(value)),
			});
			expect(parsed.get()).toBe(42);
			parsed.set('100');
			expect(parsed.get()).toBe(100);
		});

		it('runs onCleanup on destroy', () => {
			const cleanup = vi.fn();
			const count = value<number>(0).pipe<number>({
				create: ({ set, onCleanup }) => {
					onCleanup(cleanup);
					return (value) => set(value);
				},
			});
			expect(cleanup).not.toHaveBeenCalled();
			count.destroy();
			expect(cleanup).toHaveBeenCalledOnce();
		});

		it('factory pipe with debounce-like behavior', () => {
			vi.useFakeTimers();

			const debounced = value<string>('').pipe<string>({
				create: ({ set, onCleanup }) => {
					let timer: ReturnType<typeof setTimeout> | undefined;
					onCleanup(() => {
						if (timer !== undefined) clearTimeout(timer);
					});
					return (value) => {
						if (timer !== undefined) clearTimeout(timer);
						timer = setTimeout(() => set(value), 100);
					};
				},
			});

			debounced.set('a');
			debounced.set('ab');
			debounced.set('abc');

			// Before timer fires, value should still be initial (from create's initial run)
			expect(debounced.get()).toBe('');

			vi.advanceTimersByTime(100);
			expect(debounced.get()).toBe('abc');

			vi.useRealTimers();
		});
	});

	describe('.compareUsing()', () => {
		it('suppresses updates when comparator returns true', () => {
			const user = value<{ id: number; name: string }>({
				id: 1,
				name: 'Alice',
			}).compareUsing((a, b) => a.id === b.id);
			const calls: { id: number; name: string }[] = [];
			user.subscribe((current) => calls.push(current));
			user.set({ id: 1, name: 'Bob' }); // same id — should not notify
			expect(calls).toHaveLength(0);
		});

		it('allows updates when comparator returns false', () => {
			const user = value<{ id: number; name: string }>({
				id: 1,
				name: 'Alice',
			}).compareUsing((a, b) => a.id === b.id);
			const calls: { id: number; name: string }[] = [];
			user.subscribe((current) => calls.push(current));
			user.set({ id: 2, name: 'Bob' }); // different id — should notify
			expect(calls).toHaveLength(1);
		});

		it('chains with pipe', () => {
			const name = value<string>('')
				.pipe((s) => s.trim())
				.compareUsing((a, b) => a === b);
			const calls: string[] = [];
			name.subscribe((current) => calls.push(current));
			name.set('hello');
			name.set('  hello  '); // after trim, same as current — should not notify
			expect(calls).toHaveLength(1);
		});

		it('compares post-pipe values for type-changing pipes', () => {
			const parsed = value<string>('42')
				.pipe((v) => parseInt(v))
				.compareUsing((a, b) => a === b);
			const calls: number[] = [];
			parsed.subscribe((current) => calls.push(current));
			parsed.set('42'); // same parsed result — should not notify
			expect(calls).toHaveLength(0);
			parsed.set('43'); // different — should notify
			expect(calls).toHaveLength(1);
		});

		it('preserves comparator through a same-type pipe', () => {
			const user = value<{ id: number; name: string }>({
				id: 1,
				name: 'Alice',
			})
				.compareUsing((a, b) => a.id === b.id)
				.pipe((u) => ({ ...u, name: u.name.trim() }));
			const calls: { id: number; name: string }[] = [];
			user.subscribe((current) => calls.push(current));
			user.set({ id: 1, name: '  Bob  ' }); // same id — should not notify
			expect(calls).toHaveLength(0);
			user.set({ id: 2, name: 'Bob' }); // different id — should notify
			expect(calls).toHaveLength(1);
		});
	});

	describe('.destroy()', () => {
		it('stops all subscribers from firing', () => {
			const count = value(0);
			const calls: number[] = [];
			count.subscribe((current) => calls.push(current));
			count.set(1);
			expect(calls).toEqual([1]);
			count.destroy();
			count.set(2);
			expect(calls).toEqual([1]);
		});

		it('value is still readable after destroy', () => {
			const count = value(0);
			count.subscribe(() => {});
			count.destroy();
			count.set(5);
			expect(count.get()).toBe(5);
		});
	});

	describe('.use() outside React', () => {
		it('returns [value, setter] tuple', () => {
			const name = value<string>('hello');
			const [current, setter] = name.use();
			expect(current).toBe('hello');
			expect(typeof setter).toBe('function');
		});

		it('setter from use() updates the value', () => {
			const count = value<number>(10);
			const [, setter] = count.use();
			setter(20);
			expect(count.get()).toBe(20);
		});

		it('setter from use() supports callback form', () => {
			const count = value<number>(10);
			const [, setter] = count.use();
			setter((prev) => prev + 5);
			expect(count.get()).toBe(15);
		});
	});

	describe('.pipe() — sync steps before factory', () => {
		it('applies sync steps before handing off to factory', () => {
			const processed = value<string>('  raw  ')
				.pipe((s) => s.trim())
				.pipe<string>({
					create:
						({ set }) =>
						(value) =>
							set(value.toUpperCase()),
				});
			// Initial: "  raw  " -> trim -> "raw" -> factory -> "RAW"
			expect(processed.get()).toBe('RAW');

			processed.set('  hello  ');
			expect(processed.get()).toBe('HELLO');
		});
	});

	describe('.pipe() — factory with comparator', () => {
		it('comparator skips identical factory output', () => {
			const count = value<number>(0)
				.pipe<number>({
					create:
						({ set }) =>
						(value) =>
							set(value * 2),
				})
				.compareUsing((a, b) => a === b);

			const calls: number[] = [];
			count.subscribe((current) => calls.push(current));
			count.set(0); // 0 * 2 = 0, same as current
			expect(calls).toHaveLength(0);
			count.set(5); // 5 * 2 = 10, different
			expect(calls).toHaveLength(1);
		});
	});

	describe('batchSets()', () => {
		it('batches multiple updates into one subscriber notification', () => {
			const a = value(0);
			const b = value(0);
			let callCount = 0;
			a.subscribe(() => callCount++);
			b.subscribe(() => callCount++);

			batchSets(() => {
				a.set(1);
				b.set(2);
			});

			expect(callCount).toBe(2); // each fires once, not during the batch
			expect(a.get()).toBe(1);
			expect(b.get()).toBe(2);
		});
	});
});
