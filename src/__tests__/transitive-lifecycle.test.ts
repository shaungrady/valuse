import { describe, it, expect, vi } from 'vitest';
import { value } from '../core/value.js';
import { valueRef } from '../core/value-ref.js';
import { valueScope } from '../core/value-scope.js';

describe('per-instance factory refs', () => {
	it('factory ref creates a fresh instance per scope create()', () => {
		const child = valueScope({
			name: value<string>('child'),
		});

		const parent = valueScope({
			label: value<string>(),
			child: valueRef(() => child.create()),
		});

		const instance1 = parent.create({ label: 'a' });
		const instance2 = parent.create({ label: 'b' });

		// Each parent gets its own child
		const child1 = instance1.child as any;
		const child2 = instance2.child as any;
		expect(child1).not.toBe(child2);
		expect(child1.name.get()).toBe('child');
		expect(child2.name.get()).toBe('child');

		// Mutating one child doesn't affect the other
		child1.name.set('modified');
		expect(child1.name.get()).toBe('modified');
		expect(child2.name.get()).toBe('child');
	});

	it('factory ref with createMap() creates per-instance maps', () => {
		const item = valueScope({
			name: value<string>(),
		});

		const container = valueScope({
			title: value<string>(),
			items: valueRef(() => item.createMap()),
		});

		const instance = container.create({ title: 'Container' });
		const items = instance.items as any;
		items.set('a', { name: 'Alpha' });
		expect(items.get('a').name.get()).toBe('Alpha');
	});

	it('factory ref is destroyed when parent is destroyed', () => {
		const onDestroy = vi.fn();
		const child = valueScope({ name: value<string>('child') }, { onDestroy });

		const parent = valueScope({
			child: valueRef(() => child.create()),
		});

		const instance = parent.create();
		expect(onDestroy).not.toHaveBeenCalled();

		instance.$destroy();
		expect(onDestroy).toHaveBeenCalledOnce();
	});
});

describe('transitive lifecycle', () => {
	it('onUsed propagates to referenced scopes', () => {
		const childOnUsed = vi.fn();
		const child = valueScope(
			{ name: value<string>('child') },
			{ onUsed: childOnUsed },
		);

		const parent = valueScope({
			title: value<string>(),
			child: valueRef(() => child.create()),
		});

		const instance = parent.create({ title: 'Parent' });
		expect(childOnUsed).not.toHaveBeenCalled();

		// Subscribing to the parent should transitively mark the child as used
		const unsub = instance.title.subscribe(() => {});
		expect(childOnUsed).toHaveBeenCalledOnce();

		unsub();
	});

	it('onUnused propagates to referenced scopes', () => {
		const childOnUnused = vi.fn();
		const child = valueScope(
			{ name: value<string>('child') },
			{ onUnused: childOnUnused },
		);

		const parent = valueScope({
			title: value<string>(),
			child: valueRef(() => child.create()),
		});

		const instance = parent.create({ title: 'Parent' });
		const unsub = instance.title.subscribe(() => {});
		expect(childOnUnused).not.toHaveBeenCalled();

		unsub();
		expect(childOnUnused).toHaveBeenCalledOnce();
	});

	it('shared ref onUsed fires only once for multiple parents', () => {
		const sharedOnUsed = vi.fn();
		const shared = value<string>('shared');

		const parent = valueScope(
			{
				label: value<string>(),
				shared: valueRef(shared),
			},
			{ onUsed: sharedOnUsed },
		);

		// Two instances sharing the same ref
		const instance1 = parent.create({ label: 'a' });
		const instance2 = parent.create({ label: 'b' });

		// Both instances can read the shared value
		expect((instance1 as any).shared.get()).toBe('shared');
		expect((instance2 as any).shared.get()).toBe('shared');
	});

	it('reactivity flows through refs', () => {
		const shared = value<string>('initial');

		const parent = valueScope({
			label: value<string>(),
			shared: valueRef(shared),

			combined: ({ scope }: { scope: any }) =>
				`${scope.label.use()} - ${scope.shared.use()}`,
		});

		const instance = parent.create({ label: 'parent' });
		expect(instance.combined.get()).toBe('parent - initial');

		// Changing the shared value should recompute the derivation
		shared.set('updated');
		expect(instance.combined.get()).toBe('parent - updated');
	});

	it('$destroy propagates to factory-created refs', () => {
		const childDestroy = vi.fn();
		const child = valueScope(
			{ name: value<string>('child') },
			{ onDestroy: childDestroy },
		);

		const parent = valueScope({
			child: valueRef(() => child.create()),
		});

		const instance = parent.create();
		instance.$destroy();
		expect(childDestroy).toHaveBeenCalledOnce();
	});

	it('$destroy does not destroy shared (non-factory) refs', () => {
		const sharedValue = value<string>('alive');
		const parent = valueScope({
			shared: valueRef(sharedValue),
		});

		const instance = parent.create();
		instance.$destroy();
		// Shared value should still be accessible after parent destroy
		expect(sharedValue.get()).toBe('alive');
		sharedValue.set('still alive');
		expect(sharedValue.get()).toBe('still alive');
	});

	it('onUsed/onUnused cycle fires each transition', () => {
		const childOnUsed = vi.fn();
		const childOnUnused = vi.fn();
		const child = valueScope(
			{ name: value<string>('child') },
			{ onUsed: childOnUsed, onUnused: childOnUnused },
		);

		const parent = valueScope({
			title: value<string>(),
			child: valueRef(() => child.create()),
		});

		const instance = parent.create({ title: 'Parent' });

		// First cycle
		const unsub1 = instance.title.subscribe(() => {});
		expect(childOnUsed).toHaveBeenCalledTimes(1);
		unsub1();
		expect(childOnUnused).toHaveBeenCalledTimes(1);

		// Second cycle
		const unsub2 = instance.title.subscribe(() => {});
		expect(childOnUsed).toHaveBeenCalledTimes(2);
		unsub2();
		expect(childOnUnused).toHaveBeenCalledTimes(2);
	});
});

describe('shared ref to scope instance', () => {
	it('shared scope ref is accessible and not destroyed with parent', () => {
		const childDestroy = vi.fn();
		const child = valueScope(
			{ name: value<string>('shared-child') },
			{ onDestroy: childDestroy },
		);
		const sharedChild = child.create();

		const parent = valueScope({
			label: value<string>(),
			child: valueRef(sharedChild),
		});

		const instance = parent.create({ label: 'parent' });
		expect((instance as any).child.$get().name).toBe('shared-child');

		instance.$destroy();
		// Shared scope instance must NOT be destroyed
		expect(childDestroy).not.toHaveBeenCalled();
		expect(sharedChild.$get().name).toBe('shared-child');
	});

	it('shared scope ref is the same object across parent instances', () => {
		const child = valueScope({ name: value<string>('shared') });
		const sharedChild = child.create();

		const parent = valueScope({
			label: value<string>(),
			child: valueRef(sharedChild),
		});

		const instance1 = parent.create({ label: 'a' });
		const instance2 = parent.create({ label: 'b' });
		expect((instance1 as any).child).toBe((instance2 as any).child);
	});
});

describe('shared ref mutation from outside', () => {
	it('external mutations to a shared Value are visible on the parent instance', () => {
		const shared = value<string>('before');

		const parent = valueScope({
			label: value<string>(),
			shared: valueRef(shared),
		});

		const instance = parent.create({ label: 'parent' });
		expect((instance as any).shared.get()).toBe('before');

		shared.set('after');
		expect((instance as any).shared.get()).toBe('after');
	});

	it('subscribing to a shared ref notifies on external mutation', () => {
		const shared = value<string>('initial');

		const parent = valueScope({
			label: value<string>(),
			shared: valueRef(shared),
		});

		const instance = parent.create({ label: 'test' });
		const subscriber = vi.fn();
		(instance as any).shared.subscribe(subscriber);

		shared.set('changed');
		expect(subscriber).toHaveBeenCalled();
	});
});

describe('multiple factory refs', () => {
	it('$destroy propagates to all factory-created refs', () => {
		const destroyA = vi.fn();
		const destroyB = vi.fn();
		const childA = valueScope(
			{ name: value<string>('a') },
			{ onDestroy: destroyA },
		);
		const childB = valueScope(
			{ name: value<string>('b') },
			{ onDestroy: destroyB },
		);

		const parent = valueScope({
			a: valueRef(() => childA.create()),
			b: valueRef(() => childB.create()),
		});

		const instance = parent.create();
		expect(destroyA).not.toHaveBeenCalled();
		expect(destroyB).not.toHaveBeenCalled();

		instance.$destroy();
		expect(destroyA).toHaveBeenCalledOnce();
		expect(destroyB).toHaveBeenCalledOnce();
	});

	it('onUsed/onUnused propagates to all factory refs', () => {
		const usedA = vi.fn();
		const usedB = vi.fn();
		const unusedA = vi.fn();
		const unusedB = vi.fn();

		const childA = valueScope(
			{ name: value<string>('a') },
			{ onUsed: usedA, onUnused: unusedA },
		);
		const childB = valueScope(
			{ name: value<string>('b') },
			{ onUsed: usedB, onUnused: unusedB },
		);

		const parent = valueScope({
			label: value<string>(),
			a: valueRef(() => childA.create()),
			b: valueRef(() => childB.create()),
		});

		const instance = parent.create({ label: 'parent' });
		const unsub = instance.label.subscribe(() => {});

		expect(usedA).toHaveBeenCalledOnce();
		expect(usedB).toHaveBeenCalledOnce();

		unsub();
		expect(unusedA).toHaveBeenCalledOnce();
		expect(unusedB).toHaveBeenCalledOnce();
	});
});

describe('nested factory refs', () => {
	it('$destroy cascades through grandparent > parent > child', () => {
		const grandchildDestroy = vi.fn();
		const childDestroy = vi.fn();

		const grandchild = valueScope(
			{ name: value<string>('gc') },
			{ onDestroy: grandchildDestroy },
		);

		const child = valueScope(
			{
				name: value<string>('child'),
				grandchild: valueRef(() => grandchild.create()),
			},
			{ onDestroy: childDestroy },
		);

		const parent = valueScope({
			child: valueRef(() => child.create()),
		});

		const instance = parent.create();
		expect(childDestroy).not.toHaveBeenCalled();
		expect(grandchildDestroy).not.toHaveBeenCalled();

		instance.$destroy();
		expect(childDestroy).toHaveBeenCalledOnce();
		expect(grandchildDestroy).toHaveBeenCalledOnce();
	});

	it('onUsed cascades through nested factory refs', () => {
		const grandchildUsed = vi.fn();

		const grandchild = valueScope(
			{ name: value<string>('gc') },
			{ onUsed: grandchildUsed },
		);

		const child = valueScope({
			name: value<string>('child'),
			grandchild: valueRef(() => grandchild.create()),
		});

		const parent = valueScope({
			label: value<string>(),
			child: valueRef(() => child.create()),
		});

		const instance = parent.create({ label: 'root' });
		expect(grandchildUsed).not.toHaveBeenCalled();

		const unsub = instance.label.subscribe(() => {});
		expect(grandchildUsed).toHaveBeenCalledOnce();

		unsub();
	});
});
