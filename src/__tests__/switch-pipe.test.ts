import { describe, it, expect } from 'vitest';
import { value } from '../core/value.js';
import { createSwitchPipe } from '../utils/switch-pipe.js';

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

describe('createSwitchPipe', () => {
	it('only the latest write commits when a prior async handler is superseded', async () => {
		const committed: string[] = [];
		const factory = createSwitchPipe<string, string>(async ({ value, set }) => {
			// Async work that does NOT throw on abort (e.g. a fetch that ignores
			// the signal). 'a' takes longer than 'b' so the superseded run would
			// otherwise land last.
			await sleep(value === 'a' ? 100 : 20);
			set(value);
		});
		const v = value<string>().pipe(factory);
		v.subscribe((next) => committed.push(next));

		v.set('a'); // starts the 100ms handler
		await sleep(5);
		v.set('b'); // supersedes 'a', starts the 20ms handler
		await sleep(200);

		// The superseded 'a' must never commit; only 'b' should land.
		expect(committed).not.toContain('a');
		expect(v.get()).toBe('b');
	});
});
