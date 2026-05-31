import { describe, it, expect } from 'vitest';
import {
	initialAsyncState,
	settingAsyncState,
	resolvedAsyncState,
	errorAsyncState,
} from '../core/async-state.js';

describe('AsyncState convenience flags', () => {
	it('initial: neither pending nor error', () => {
		const state = initialAsyncState<string>();
		expect(state.isPending).toBe(false);
		expect(state.isError).toBe(false);
	});

	it('first load (setting, no prior value) is pending, not updating', () => {
		const state = settingAsyncState(initialAsyncState<string>());
		expect(state.status).toBe('setting');
		expect(state.isPending).toBe(true); // show a spinner
		expect(state.isUpdating).toBe(false);
		expect(state.isError).toBe(false);
	});

	it('updating (setting with a prior value) is updating, not pending', () => {
		const resolved = resolvedAsyncState('cached');
		const state = settingAsyncState(resolved);
		expect(state.status).toBe('setting');
		expect(state.hasValue).toBe(true);
		expect(state.isPending).toBe(false); // keep the stale value on screen
		expect(state.isUpdating).toBe(true);
		expect(state.value).toBe('cached');
	});

	it('isPending and isUpdating are mutually exclusive', () => {
		const first = settingAsyncState(initialAsyncState<string>());
		const refresh = settingAsyncState(resolvedAsyncState('cached'));
		expect(first.isPending && first.isUpdating).toBe(false);
		expect(refresh.isPending && refresh.isUpdating).toBe(false);
	});

	it('resolved: none of the in-flight flags', () => {
		const state = resolvedAsyncState('done');
		expect(state.isPending).toBe(false);
		expect(state.isUpdating).toBe(false);
		expect(state.isError).toBe(false);
	});

	it('error: isError, not pending/updating, prior value preserved', () => {
		const prev = resolvedAsyncState('last good');
		const state = errorAsyncState(prev, new Error('boom'));
		expect(state.isError).toBe(true);
		expect(state.isPending).toBe(false);
		expect(state.isUpdating).toBe(false);
		expect(state.value).toBe('last good');
	});
});
