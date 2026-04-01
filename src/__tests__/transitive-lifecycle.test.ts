import { describe, it, expect, vi } from 'vitest';
import { value, valueRef, valueScope } from '../index.js';

describe('transitive onUsed/onUnused', () => {
	it("ref'd ScopeInstance becomes 'used' when outer scope gets first subscriber", () => {
		const onUsed = vi.fn();
		const inner = valueScope({ price: value(100) }, { onUsed });
		const innerInstance = inner.create();

		const outer = valueScope({
			name: value('AAPL'),
			stock: valueRef(innerInstance),
		});
		const outerInstance = outer.create();

		expect(onUsed).not.toHaveBeenCalled();

		// First subscriber on outer → inner should become "used"
		const unsub = outerInstance.subscribe(() => {});
		expect(onUsed).toHaveBeenCalledOnce();

		unsub();
	});

	it("ref'd ScopeInstance becomes 'unused' when outer scope loses last subscriber", () => {
		const onUnused = vi.fn();
		const inner = valueScope({ price: value(100) }, { onUnused });
		const innerInstance = inner.create();

		const outer = valueScope({
			name: value('AAPL'),
			stock: valueRef(innerInstance),
		});
		const outerInstance = outer.create();

		const unsub = outerInstance.subscribe(() => {});
		expect(onUnused).not.toHaveBeenCalled();

		unsub();
		expect(onUnused).toHaveBeenCalledOnce();
	});

	it('multiple subscribers on outer only trigger inner onUsed once', () => {
		const onUsed = vi.fn();
		const inner = valueScope({ price: value(100) }, { onUsed });
		const innerInstance = inner.create();

		const outer = valueScope({
			stock: valueRef(innerInstance),
		});
		const outerInstance = outer.create();

		const unsub1 = outerInstance.subscribe(() => {});
		const unsub2 = outerInstance.subscribe(() => {});

		// onUsed on inner fires once (from first outer subscriber)
		// and once again (from second outer subscriber triggering inner 0→1 again? No.)
		// Actually inner gets subscribed once when outer goes 0→1, and stays subscribed.
		expect(onUsed).toHaveBeenCalledOnce();

		unsub1();
		// Still one subscriber on outer — inner should still be "used"
		unsub2();
		// Now outer is at 0 — inner should become "unused"
	});

	it('transitive lifecycle flows through multiple levels of refs', () => {
		const onUsed = vi.fn();
		const deepInner = valueScope({ data: value('deep') }, { onUsed });
		const deepInnerInstance = deepInner.create();

		const middle = valueScope({
			source: valueRef(deepInnerInstance),
		});
		const middleInstance = middle.create();

		const outer = valueScope({
			middle: valueRef(middleInstance),
		});
		const outerInstance = outer.create();

		expect(onUsed).not.toHaveBeenCalled();

		const unsub = outerInstance.subscribe(() => {});
		// outer → middle → deepInner: all should become "used"
		expect(onUsed).toHaveBeenCalledOnce();

		unsub();
	});

	it("destroy on outer unsubscribes from ref'd instances", () => {
		const onUnused = vi.fn();
		const inner = valueScope({ price: value(100) }, { onUnused });
		const innerInstance = inner.create();

		const outer = valueScope({
			stock: valueRef(innerInstance),
		});
		const outerInstance = outer.create();

		outerInstance.subscribe(() => {});
		expect(onUnused).not.toHaveBeenCalled();

		outerInstance.destroy();
		// Destroy tears down all subscribers, including transitive ones
		expect(onUnused).toHaveBeenCalledOnce();
	});

	it("ref'd instance with async derivation activates when outer becomes used", async () => {
		let fetchCount = 0;
		const inner = valueScope({
			symbol: value('AAPL'),
			price: async ({ use }) => {
				fetchCount++;
				return `price-for-${use('symbol') as string}`;
			},
		});
		const innerInstance = inner.create();

		const outer = valueScope({
			stock: valueRef(innerInstance),
		});
		const outerInstance = outer.create();

		// Async derivation runs eagerly in effect, but let's verify
		// the subscriber triggers it to be live
		const unsub = outerInstance.subscribe(() => {});

		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect(fetchCount).toBeGreaterThanOrEqual(1);
		expect(innerInstance.get('price')).toBe('price-for-AAPL');

		unsub();
	});
});
