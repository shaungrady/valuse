import { expectTypeOf } from 'expect-type';
import { value, valueScope } from '../../index.js';
import type { AsyncState } from '../../index.js';

// --- Define a scope with sync and async derivations ---

const profile = valueScope({
	userId: value<string>('user-1'),
	name: value<string>('Alice'),

	// Sync derivation
	greeting: ({ use }) => `Hello, ${use('name') as string}`,

	// Async derivation
	user: async ({ use, signal }) => {
		const res = await fetch(`/api/users/${use('userId') as string}`, {
			signal,
		});
		return (await res.json()) as { id: string; email: string };
	},

	// Sync derivation reading async derivation
	displayEmail: ({ use }) =>
		(use('user') as { email: string } | undefined)?.email ?? 'loading...',
});

const inst = profile.create();

// --- get() on async derivation returns T | undefined ---

expectTypeOf(inst.get('user')).toEqualTypeOf<
	{ id: string; email: string } | undefined
>();

// --- get() on sync derivation returns R (unchanged) ---

expectTypeOf(inst.get('greeting')).toEqualTypeOf<string>();

// --- get() on value returns T ---

expectTypeOf(inst.get('userId')).toEqualTypeOf<string>();

// --- getAsync() on async derivation returns AsyncState<T> ---

expectTypeOf(inst.getAsync('user')).toEqualTypeOf<
	AsyncState<{ id: string; email: string }>
>();

// --- getAsync() on sync derivation returns AsyncState<R> ---

expectTypeOf(inst.getAsync('greeting')).toEqualTypeOf<AsyncState<string>>();

// --- getAsync() on value returns AsyncState<T> ---

expectTypeOf(inst.getAsync('userId')).toEqualTypeOf<AsyncState<string>>();

// --- useAsync() on async derivation returns [T | undefined, AsyncState<T>] ---

const [userValue, userState] = inst.useAsync('user');
expectTypeOf(userValue).toEqualTypeOf<
	{ id: string; email: string } | undefined
>();
expectTypeOf(userState).toEqualTypeOf<
	AsyncState<{ id: string; email: string }>
>();

// --- useAsync() on sync field returns [T, AsyncState<T>] ---

const [greetingValue, greetingState] = inst.useAsync('greeting');
expectTypeOf(greetingValue).toEqualTypeOf<string>();
expectTypeOf(greetingState).toEqualTypeOf<AsyncState<string>>();

// --- Async derivation keys are NOT in ValueKeys (cannot set) ---

// @ts-expect-error - cannot set an async derivation
inst.set('user', { id: 'x', email: 'x' });

// @ts-expect-error - cannot set a sync derivation
inst.set('greeting', 'hi');

// --- CreateInput accepts async derivation keys as optional seed values ---

// Seeding an async derivation with cached data is allowed
profile.create({ user: { id: 'x', email: 'x' } });

// --- Sync derivation downstream of async gets T | undefined ---

expectTypeOf(inst.get('displayEmail')).toEqualTypeOf<string>();

// --- Async derivation with set() for intermediate values ---

void valueScope({
	query: value<string>(''),
	results: async ({ use, set }) => {
		set([]); // intermediate
		void use('query');
		return ['result'] as string[];
	},
});

// --- Async derivation with onCleanup ---

void valueScope({
	url: value<string>(''),
	data: async ({ use, onCleanup }) => {
		const ws = new WebSocket(use('url') as string);
		onCleanup(() => ws.close());
		return 'connected';
	},
});

// --- Async derivation with previousValue ---

void valueScope({
	id: value<number>(1),
	item: async ({ use, previousValue }) => {
		void use('id');
		if (previousValue) return previousValue as { id: number };
		return { id: 1 };
	},
});
