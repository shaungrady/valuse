import { describe, it, expect, vi } from 'vitest';
import { value } from '../core/value.js';
import { valueScope } from '../core/value-scope.js';
import { withHistory } from '../middleware/history.js';

describe('withHistory', () => {
	it('undo restores the previous value', () => {
		const scope = valueScope({
			count: value<number>(),
			name: value<string>(),
		});
		const undoable = withHistory(scope);
		const instance = undoable.create({ count: 0, name: 'Alice' });

		instance.count.set(1);
		instance.count.set(2);
		instance.name.set('Bob');

		instance.undo();
		expect(instance.count.get()).toBe(2);
		expect(instance.name.get()).toBe('Alice');

		instance.undo();
		expect(instance.count.get()).toBe(1);

		instance.undo();
		expect(instance.count.get()).toBe(0);
	});

	it('redo replays forward', () => {
		const scope = valueScope({ count: value<number>() });
		const undoable = withHistory(scope);
		const instance = undoable.create({ count: 0 });

		instance.count.set(1);
		instance.count.set(2);

		instance.undo();
		instance.undo();
		expect(instance.count.get()).toBe(0);

		instance.redo();
		expect(instance.count.get()).toBe(1);
		instance.redo();
		expect(instance.count.get()).toBe(2);
	});

	it('canUndo and canRedo track availability', () => {
		const scope = valueScope({ count: value<number>() });
		const undoable = withHistory(scope);
		const instance = undoable.create({ count: 0 });

		expect(instance.canUndo).toBe(false);
		expect(instance.canRedo).toBe(false);

		instance.count.set(1);
		expect(instance.canUndo).toBe(true);
		expect(instance.canRedo).toBe(false);

		instance.undo();
		expect(instance.canUndo).toBe(false);
		expect(instance.canRedo).toBe(true);

		instance.redo();
		expect(instance.canUndo).toBe(true);
		expect(instance.canRedo).toBe(false);
	});

	it('undo at the beginning is a no-op', () => {
		const scope = valueScope({ count: value<number>() });
		const undoable = withHistory(scope);
		const instance = undoable.create({ count: 0 });

		expect(() => {
			instance.undo();
		}).not.toThrow();
		expect(instance.count.get()).toBe(0);
	});

	it('redo at the end is a no-op', () => {
		const scope = valueScope({ count: value<number>() });
		const undoable = withHistory(scope);
		const instance = undoable.create({ count: 0 });

		instance.count.set(1);
		expect(() => {
			instance.redo();
		}).not.toThrow();
		expect(instance.count.get()).toBe(1);
	});

	it('setting a value after undo clears the redo stack', () => {
		const scope = valueScope({ count: value<number>() });
		const undoable = withHistory(scope);
		const instance = undoable.create({ count: 0 });

		instance.count.set(1);
		instance.count.set(2);
		instance.undo();
		expect(instance.canRedo).toBe(true);

		// Fork the history.
		instance.count.set(99);
		expect(instance.canRedo).toBe(false);

		instance.undo();
		expect(instance.count.get()).toBe(1);
	});

	it('respects maxDepth, dropping oldest entries', () => {
		const scope = valueScope({ count: value<number>() });
		const undoable = withHistory(scope, { maxDepth: 3 });
		const instance = undoable.create({ count: 0 });

		instance.count.set(1);
		instance.count.set(2);
		instance.count.set(3);
		instance.count.set(4);

		// Stack should contain only 3 entries now.
		// Oldest entries dropped — we can undo at most 2 times.
		instance.undo();
		expect(instance.count.get()).toBe(3);
		instance.undo();
		expect(instance.count.get()).toBe(2);

		// canUndo is false now: dropped initial {0} and {1}.
		expect(instance.canUndo).toBe(false);
	});

	it('clearHistory resets the stack', () => {
		const scope = valueScope({ count: value<number>() });
		const undoable = withHistory(scope);
		const instance = undoable.create({ count: 0 });

		instance.count.set(1);
		instance.count.set(2);
		expect(instance.canUndo).toBe(true);

		instance.clearHistory();
		expect(instance.canUndo).toBe(false);
		expect(instance.canRedo).toBe(false);
		// Current value is preserved.
		expect(instance.count.get()).toBe(2);
	});

	it('undo does not trigger onChange recording', () => {
		const scope = valueScope({ count: value<number>() });
		const undoable = withHistory(scope);
		const instance = undoable.create({ count: 0 });

		instance.count.set(1);
		instance.count.set(2);

		instance.undo();
		// Was at position 2, now at position 1. Redo should still be available.
		expect(instance.canRedo).toBe(true);
	});

	it('fields option limits tracked state', () => {
		const scope = valueScope({
			tracked: value<number>(),
			untracked: value<string>(),
		});
		const undoable = withHistory(scope, { fields: ['tracked'] });
		const instance = undoable.create({ tracked: 0, untracked: 'a' });

		instance.tracked.set(1);
		instance.untracked.set('b');

		// untracked changes still push a new entry (there is an onChange), but
		// the recorded snapshot only contains 'tracked'. Undo should restore
		// tracked without clobbering untracked value.
		instance.undo();
		expect(instance.tracked.get()).toBe(0);
		// untracked is unaffected since it isn't in the snapshot.
		expect(instance.untracked.get()).toBe('b');
	});

	it('batches rapid changes when batch option is set', () => {
		vi.useFakeTimers();
		const scope = valueScope({ text: value<string>() });
		const undoable = withHistory(scope, { batchMs: 300 });
		const instance = undoable.create({ text: '' });

		// Type "hello" quickly.
		instance.text.set('h');
		instance.text.set('he');
		instance.text.set('hel');
		instance.text.set('hell');
		instance.text.set('hello');

		// A single batch window — one undo should go back to the initial ''.
		vi.advanceTimersByTime(300);
		instance.undo();
		expect(instance.text.get()).toBe('');

		vi.useRealTimers();
	});

	it('starts a new batch entry after the window expires', () => {
		vi.useFakeTimers();
		const scope = valueScope({ text: value<string>() });
		const undoable = withHistory(scope, { batchMs: 300 });
		const instance = undoable.create({ text: '' });

		instance.text.set('a');
		vi.advanceTimersByTime(301);
		instance.text.set('b');
		vi.advanceTimersByTime(301);

		instance.undo();
		expect(instance.text.get()).toBe('a');
		instance.undo();
		expect(instance.text.get()).toBe('');

		vi.useRealTimers();
	});

	it('$destroy cleans up history state', () => {
		const scope = valueScope({ count: value<number>() });
		const undoable = withHistory(scope);
		const instance = undoable.create({ count: 0 });

		instance.count.set(1);
		instance.count.set(2);
		expect(instance.canUndo).toBe(true);

		instance.$destroy();

		// After destroy, undo/redo/clearHistory should be removed
		expect(instance.undo).toBeUndefined();
		expect(instance.redo).toBeUndefined();
		expect(instance.clearHistory).toBeUndefined();
	});

	it('$destroy with pending batch timer clears it', () => {
		vi.useFakeTimers();
		const scope = valueScope({ text: value<string>() });
		const undoable = withHistory(scope, { batchMs: 300 });
		const instance = undoable.create({ text: '' });

		instance.text.set('a');
		// Batch timer is pending (300ms not elapsed yet)
		instance.$destroy();

		// Advancing time should not cause errors
		vi.advanceTimersByTime(300);
		vi.useRealTimers();
	});
});
